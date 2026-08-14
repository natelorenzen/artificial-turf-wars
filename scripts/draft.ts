/**
 * THE REAL DRAFT. Season 2026. One shot, no undo.
 *
 *   npx tsx --env-file=.env.local scripts/draft.ts --status
 *   npx tsx --env-file=.env.local scripts/draft.ts --auction              # dry run
 *   npx tsx --env-file=.env.local scripts/draft.ts --draft --picks 1      # dry run
 *
 *   ALLOW_IRREVERSIBLE=1 npx tsx --env-file=.env.local scripts/draft.ts \
 *     --auction --commit --i-understand=2026
 *
 * ---------------------------------------------------------------------------
 * Why this is a separate file from `backtest.ts` rather than `--season 2026`
 * ---------------------------------------------------------------------------
 * A script named "backtest" that can write the live season is one stray flag away
 * from destroying a one-shot event. The ~200 lines of DB plumbing duplicated below
 * are the cheaper risk. The *engine* is not duplicated — `resolveAuction`,
 * `runPick`, `commitPick` and `draftSchedule` are the same modules the 2025
 * rehearsal exercised, which is the only reason that rehearsal proves anything.
 *
 * ---------------------------------------------------------------------------
 * Four independent locks stand between an invocation and a write
 * ---------------------------------------------------------------------------
 *   1. `--commit`. Absent, every stage runs read-only and prints what it would do.
 *   2. `ALLOW_IRREVERSIBLE=1` in the environment.
 *   3. `--i-understand=2026` — the season year, typed out, on the command line.
 *   4. The stage's own precondition: the auction refuses if slots are already
 *      assigned, and the draft refuses once all 120 picks exist.
 *
 * On top of those, `DRAFT_SEED` must hash to the `seed_commit_hash` published
 * before the auction. A seed that does not match means either the wrong .env or a
 * seed chosen after seeing something it should not have — both are aborts, because
 * the tiebreak commitment is the thing that makes the auction checkable (SPEC §8.3).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { COHORT, LEAGUE, RULEBOOK_VERSION, type Position } from '@/lib/config/league';
import { slotPickNumbers } from '@/lib/engine/draft';
import { auctionDiscriminates, resolveAuction, type AuctionEntry } from '@/lib/engine/auction';
import { assertSharedContext } from '@/lib/prompt/assemble';
import { auctionSchema } from '@/lib/schemas/decisions';
import { commitHash, seededTiebreakOrder } from '@/lib/engine/rng';
import { assertNoLabelLeak, buildLabelMap } from '@/lib/engine/labels';
import { runDecision } from '@/lib/decisions/run';
import {
  availableFor,
  buildPickContext,
  commitPick,
  draftSchedule,
  nextPickNumber,
  runPick,
  type DraftState,
  type DraftTeam,
} from '@/lib/engine/draft-runner';

/** Not a flag, not an argument, not an env var. The live season, and only ever it. */
const SEASON = LEAGUE.season;

const TOTAL_PICKS = LEAGUE.teams * LEAGUE.draftRounds;

/** Lab and model names that must never appear in a DATA block (SPEC §14.3). */
const FORBIDDEN_NAMES = [...COHORT.map((m) => m.displayName), ...COHORT.map((m) => m.lab)];

function db(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

const flag = (name: string) => process.argv.includes(`--${name}`);

function argValue(name: string): string | null {
  const exact = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (exact) return exact.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

// ---------------------------------------------------------------------------
// The locks
// ---------------------------------------------------------------------------

/**
 * Returns true only if all three operator locks are open. Called once, up front, so
 * a run that cannot commit says so before spending a single model call rather than
 * after seven of them.
 */
function commitRequested(): boolean {
  if (!flag('commit')) return false;

  if (process.env.ALLOW_IRREVERSIBLE !== '1') {
    fail(
      '--commit requires ALLOW_IRREVERSIBLE=1 in the environment.\n' +
        '  This writes the live season and cannot be undone.',
    );
  }
  const phrase = argValue('i-understand');
  if (phrase !== String(SEASON)) {
    fail(
      `--commit requires --i-understand=${SEASON}.\n` +
        `  Got ${phrase === null ? '(nothing)' : `"${phrase}"`}.`,
    );
  }
  return true;
}

function fail(message: string): never {
  console.error(`\n  REFUSING TO RUN\n  ${message}\n`);
  process.exit(1);
}

/**
 * The seed that breaks tied bids. Verified against the hash published before the
 * auction — see the header note on why a mismatch is an abort and not a warning.
 */
async function verifiedSeed(supabase: SupabaseClient, seasonId: string): Promise<string> {
  const seed = process.env.DRAFT_SEED;
  if (!seed) fail('DRAFT_SEED is not set.');
  if (seed.length < 32) fail('DRAFT_SEED is too short to be worth committing to.');

  const { data, error } = await supabase
    .from('seasons')
    .select('seed_commit_hash')
    .eq('id', seasonId)
    .single();
  if (error) fail(`seasons read: ${error.message}`);

  if (data.seed_commit_hash !== commitHash(seed)) {
    fail(
      `DRAFT_SEED does not match the published commitment for ${SEASON}.\n` +
        `  published  ${data.seed_commit_hash}\n` +
        `  this seed  ${commitHash(seed)}\n` +
        '  Either the wrong .env is loaded, or the seed changed after it was committed.\n' +
        '  Both destroy the tiebreak proof (SPEC §8.3). Fix the environment; do not edit the row.',
    );
  }
  return seed;
}

// ---------------------------------------------------------------------------
// Shared loaders
// ---------------------------------------------------------------------------

interface LeagueTeam {
  id: string;
  model_id: string;
  draft_slot: number | null;
  auction_bid: number | null;
  faab_remaining: number | null;
  models: { openrouter_id: string; display_name: string };
}

async function seasonAndTeams(supabase: SupabaseClient) {
  const { data: season, error } = await supabase
    .from('seasons')
    .select('id, rulebook_version')
    .eq('year', SEASON)
    .single();
  if (error) fail(`no ${SEASON} season row — run scripts/seed.ts first.`);

  const { data: teams, error: teamError } = await supabase
    .from('teams')
    .select('id, model_id, draft_slot, auction_bid, faab_remaining, models!inner(openrouter_id, display_name)')
    .eq('season_id', season.id);
  if (teamError) fail(`teams: ${teamError.message}`);

  const list = teams as unknown as LeagueTeam[];
  if (list.length !== LEAGUE.teams) {
    fail(`expected ${LEAGUE.teams} teams for ${SEASON}, found ${list.length}. Run scripts/seed.ts.`);
  }
  return { seasonId: season.id as string, rulebookVersion: season.rulebook_version as string, teams: list };
}

/**
 * Refuse to draft under a rulebook the league has not been told about.
 *
 * The season row freezes the rulebook version at seed time; `RULEBOOK_VERSION` is what
 * the generator stamps on the text every model actually receives. When they disagree,
 * the models are being sent rules that differ from the ones the site publishes and the
 * comprehension check was sat against — and the draft is the one step that cannot be
 * re-run afterwards.
 *
 * Found the honest way: bumping the rulebook to v3 for the playoff tie rule left the
 * 2026 season row reading v2 with nothing anywhere complaining about it.
 */
function assertRulebookMatches(rulebookVersion: string) {
  if (rulebookVersion === RULEBOOK_VERSION) return;
  fail(
    `the ${SEASON} season row was seeded under "${rulebookVersion}" but the code now generates ` +
      `"${RULEBOOK_VERSION}".\n` +
      '  The models would draft under rules the published season row does not describe.\n' +
      '  Update seasons.rulebook_version and re-run the comprehension check ' +
      '(scripts/preseason-rules-check.ts) before drafting.',
  );
}

/**
 * How deep a pool the draft runs against. 1000 is not arbitrary: it is what the 2025
 * rehearsal actually used, and the rehearsal only certifies the real draft if the two
 * see the same shape of board.
 *
 * It also has to be deep enough for the round-13 soft cap to always find a kicker and
 * a defence, which ordering by projected points does not guarantee on its face —
 * verified against the 2026 board on 4 August: all 32 DEF land by rank 337 and all 44
 * rostered-calibre K by rank 533, so both are comfortably inside 1000.
 */
const POOL_SIZE = 1000;

/** The projection board, ordered as the models will see it. */
async function loadPool(supabase: SupabaseClient, limit: number): Promise<DraftState['pool']> {
  const pool: DraftState['pool'] = [];
  for (let from = 0; pool.length < limit; from += 1000) {
    const { data, error } = await supabase
      .from('player_projections')
      .select('player_id, proj_pts, adp, players!inner(name, position)')
      .eq('season', SEASON)
      // Season-long rows only. The Thursday weekend guide ingests per-WEEK rows into
      // this same table, and without this filter every player would appear in the
      // draft pool once per ingested week.
      .is('week', null)
      .order('proj_pts', { ascending: false })
      .range(from, from + 999);
    if (error) fail(`player_projections: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      const p = row.players as unknown as { name: string; position: Position };
      pool.push({
        playerId: row.player_id as string,
        name: p.name,
        position: p.position,
        projSeasonPoints: Number(row.proj_pts),
        adp: row.adp === null ? null : Number(row.adp),
      });
    }
    if (data.length < 1000) break;
  }
  return pool.slice(0, limit);
}

/**
 * `provisionalSlots` exists so the draft dry run is worth running BEFORE the auction.
 * Without it the most valuable thing a dry run can check — that the pick DATA block
 * builds, fits the context ceiling and leaks no lab name against real 2026 data — is
 * unreachable until after the one irreversible step it is meant to de-risk.
 *
 * Provisional slots are seed-ordered and in memory only. `commitRequested()` is
 * checked by the caller before this is ever passed true, so a committing run always
 * uses the slots the auction actually awarded.
 */
async function loadDraftState(
  supabase: SupabaseClient,
  provisionalSlots = false,
): Promise<DraftState> {
  const { seasonId, teams, rulebookVersion } = await seasonAndTeams(supabase);
  assertRulebookMatches(rulebookVersion);
  const unassigned = teams.some((t) => t.draft_slot === null);

  if (unassigned && !provisionalSlots) {
    fail('draft slots are unassigned. Run --auction first.');
  }
  if (unassigned) {
    const order = seededTiebreakOrder(teams.map((t) => t.id), await verifiedSeed(supabase, seasonId));
    for (const team of teams) team.draft_slot = (order.get(team.id) ?? 0) + 1;
    console.log('\n  NOTE: the auction has not run. Using provisional seed-ordered slots for this');
    console.log('        dry run only. Nothing is written and these are not the real slots.');
  }

  const labels = buildLabelMap(teams.map((t) => ({ teamId: t.id, draftSlot: t.draft_slot! })));
  const draftTeams: DraftTeam[] = teams.map((t) => ({
    teamId: t.id,
    modelId: t.model_id,
    openrouterId: t.models.openrouter_id,
    displayName: t.models.display_name,
    draftSlot: t.draft_slot!,
    label: labels.get(t.id)!,
  }));

  const { data: picks, error } = await supabase
    .from('draft_picks')
    .select('pick_overall, round, team_id, player_id, players!inner(name, position)')
    .eq('season_id', seasonId)
    .order('pick_overall');
  if (error) fail(`draft_picks: ${error.message}`);

  return {
    seasonId,
    season: SEASON,
    teams: draftTeams,
    pool: await loadPool(supabase, POOL_SIZE),
    picks: (picks ?? []).map((row) => {
      const p = row.players as unknown as { name: string; position: Position };
      return {
        pickOverall: row.pick_overall as number,
        round: row.round as number,
        teamId: row.team_id as string,
        playerId: row.player_id as string,
        name: p.name,
        position: p.position,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// --status
// ---------------------------------------------------------------------------

async function stageStatus() {
  const supabase = db();
  const { seasonId, rulebookVersion, teams } = await seasonAndTeams(supabase);

  const { count: pickCount } = await supabase
    .from('draft_picks')
    .select('*', { count: 'exact', head: true })
    .eq('season_id', seasonId);
  const { count: scheduleCount } = await supabase
    .from('h2h_schedule')
    .select('*', { count: 'exact', head: true })
    .eq('season_id', seasonId);
  const { count: projCount } = await supabase
    .from('player_projections')
    .select('*', { count: 'exact', head: true })
    .eq('season', SEASON)
    .is('week', null);

  const slotted = teams.filter((t) => t.draft_slot !== null).length;

  console.log(`Season ${SEASON} — ${LEAGUE.name}\n`);
  console.log(
    `  rulebook      ${rulebookVersion}` +
      (rulebookVersion === RULEBOOK_VERSION
        ? ''
        : `  ⚠ the code now generates ${RULEBOOK_VERSION} — both stages will refuse until this is reconciled`),
  );
  console.log(`  teams         ${teams.length}`);
  console.log(`  auction       ${slotted === 0 ? 'not run' : `${slotted}/${teams.length} slots assigned`}`);
  console.log(`  draft         ${pickCount ?? 0}/${TOTAL_PICKS} picks`);
  console.log(`  schedule      ${scheduleCount ?? 0} matchups`);
  console.log(`  projections   ${projCount ?? 0} rows`);

  if (slotted > 0) {
    console.log('\n  slot  team              paid  FAAB left');
    for (const t of [...teams].sort((a, b) => (a.draft_slot ?? 0) - (b.draft_slot ?? 0))) {
      console.log(
        `  ${String(t.draft_slot).padStart(4)}  ${t.models.display_name.padEnd(16)}  ` +
          `$${String(t.auction_bid ?? 0).padStart(3)}  $${String(t.faab_remaining ?? 0).padStart(3)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// --auction
// ---------------------------------------------------------------------------

const AUCTION_OUTPUT_EXAMPLE = {
  bid: 30,
  slot_preference: [4, 3, 5, 2, 6, 1, 7, 8],
  headline: 'One sentence.',
  key_factors: ['cites a DATA field and value', '...'],
  closest_call: 'The bid level nearly chosen instead, and what it would have cost later.',
  what_would_change_it: 'One sentence.',
  confidence: 0.5,
};

const AUCTION_TASK =
  'Bid for your draft slot and rank all 8 slots in preference order. Your bid is deducted ' +
  'from the single budget that also funds every waiver claim you will make this season.';

async function stageAuction(commit: boolean) {
  const supabase = db();
  const { seasonId, teams, rulebookVersion } = await seasonAndTeams(supabase);
  assertRulebookMatches(rulebookVersion);

  // Precondition. The auction is single-round and first-price: re-running it after
  // slots exist would resolve a second time against different bids and silently
  // reassign a slot a model already drafted from.
  const alreadySlotted = teams.filter((t) => t.draft_slot !== null);
  if (alreadySlotted.length > 0) {
    fail(
      `the ${SEASON} auction has already run — ${alreadySlotted.length} of ${teams.length} teams hold a slot.\n` +
        '  Re-running it would reassign slots underneath a draft. Nothing was written.',
    );
  }

  const seed = await verifiedSeed(supabase, seasonId);

  const { data: board, error } = await supabase
    .from('player_projections')
    .select('player_id, proj_pts, adp, players!inner(name, position)')
    .eq('season', SEASON)
    .is('week', null)
    .not('adp', 'is', null)
    .order('adp', { ascending: true })
    .limit(60);
  if (error) fail(`board: ${error.message}`);

  const topAvailable = (board ?? []).map((row) => {
    const player = row.players as unknown as { name: string; position: string };
    return {
      player_id: row.player_id,
      name: player.name,
      position: player.position,
      proj_season_points: Number(row.proj_pts),
      adp: Number(row.adp),
    };
  });
  if (topAvailable.length < 60) {
    fail(`only ${topAvailable.length} players have ADP for ${SEASON}. Run the ingest before the auction.`);
  }

  const data = {
    budget_total: LEAGUE.budgetTotal,
    teams: LEAGUE.teams,
    rounds: LEAGUE.draftRounds,
    draft_type: LEAGUE.draftType,
    slot_pick_numbers: slotPickNumbers(),
    top_available: topAvailable,
    budget_rule:
      'Whatever you do not spend here is your entire FAAB budget for all 14 weeks, and for the playoff free-agent auction.',
  };

  assertNoLabelLeak(JSON.stringify(data), FORBIDDEN_NAMES);

  console.log(`\n  PLAN — slot auction, season ${SEASON}\n`);
  console.log(`    board          ${topAvailable.length} players, ADP ${topAvailable[0].adp} to ${topAvailable[topAvailable.length - 1].adp}`);
  console.log(`    model calls    ${teams.length}`);
  console.log(`    writes         auction_bids ×${teams.length}, teams.draft_slot ×${teams.length}, decisions ×${teams.length}`);
  console.log(`    seed           verified against the published commitment`);
  console.log(`    mode           ${commit ? '*** COMMIT — this spends money and writes the live season ***' : 'DRY RUN — no calls, no writes'}\n`);

  if (!commit) {
    console.log('    Re-run with --commit --i-understand=2026 and ALLOW_IRREVERSIBLE=1 to fire it.\n');
    return;
  }

  const entries: AuctionEntry[] = [];
  const hashes: string[] = [];
  const decisionIds = new Map<string, string | null>();
  let cost = 0;

  for (const team of teams) {
    const record = await runDecision(
      {
        seasonId,
        teamId: team.id,
        modelId: team.model_id,
        openrouterId: team.models.openrouter_id,
        type: 'auction',
        data,
        task: AUCTION_TASK,
        outputExample: AUCTION_OUTPUT_EXAMPLE,
        schema: auctionSchema,
      },
      supabase,
    );

    hashes.push(record.contextHash);
    decisionIds.set(team.id, record.decisionId);
    cost += record.call.usage.costUsd ?? 0;

    if (!record.parsed) {
      console.log(`  ✗ ${team.models.display_name.padEnd(16)} ${record.providerFailure ? 'provider failure' : 'invalid'}`);
      console.log(`        finish_reason=${record.call.finishReason}  out=${record.call.usage.tokensOut}`);
      console.log(`        ${record.call.validationError?.slice(0, 160)}`);
      entries.push({ teamId: team.id, bid: null, slotPreference: null });
      continue;
    }

    const { bid, slot_preference, headline, confidence } = record.parsed;
    entries.push({ teamId: team.id, bid, slotPreference: slot_preference });
    console.log(`  $${String(bid).padStart(3)}  slot pref ${slot_preference.join('')}  conf ${confidence.toFixed(2)}  ${team.models.display_name}`);
    console.log(`        "${headline}"`);
  }

  // All eight saw byte-identical context. The auction has no per-team overlay, so
  // this is still the strong form of the claim (SPEC §14.6 weakens it only later).
  assertSharedContext(hashes, `${SEASON} auction`);

  const result = resolveAuction(entries, seed);
  const gate = auctionDiscriminates(result);
  const byId = new Map(teams.map((t) => [t.id, t]));

  for (const award of result.awards) {
    const { error: bidError } = await supabase.from('auction_bids').upsert(
      {
        team_id: award.teamId,
        bid: award.bid,
        slot_preference: award.slotPreference,
        assigned_slot: award.assignedSlot,
        tiebroken: award.tiebroken,
        decision_id: decisionIds.get(award.teamId) ?? null,
      },
      { onConflict: 'team_id' },
    );
    if (bidError) fail(`auction_bids: ${bidError.message}`);

    const { error: teamError } = await supabase
      .from('teams')
      .update({
        draft_slot: award.assignedSlot,
        auction_bid: award.bid,
        slot_preference: award.slotPreference,
        faab_remaining: award.faabRemaining,
        waiver_priority: award.waiverPriority,
      })
      .eq('id', award.teamId);
    if (teamError) fail(`teams update: ${teamError.message}`);
  }

  console.log('\n  Resolution:');
  for (const award of result.awards) {
    const team = byId.get(award.teamId)!;
    console.log(
      `    slot ${award.assignedSlot}  ${team.models.display_name.padEnd(16)} paid $${String(award.bid).padStart(3)}  ` +
        `FAAB left $${String(award.faabRemaining).padStart(3)}${award.tiebroken ? '  (tiebroken)' : ''}${award.fallbackApplied ? '  (FALLBACK)' : ''}`,
    );
  }

  const d = result.dispersion;
  console.log(`\n  Dispersion: ${d.distinct} distinct bids, $${d.min}-$${d.max}, mean $${d.mean}, stdev ${d.stdev}`);
  console.log(`  Cost: $${cost.toFixed(4)}`);
  console.log(gate.ok ? `  Gate: MET — ${gate.reason}` : `  *** Gate NOT met — ${gate.reason}`);
  console.log('\n  Slots are now assigned. Publish the seed reveal before the draft runs.\n');
}

// ---------------------------------------------------------------------------
// --draft
// ---------------------------------------------------------------------------

async function stageDraft(commit: boolean) {
  const supabase = db();
  const state = await loadDraftState(supabase, !commit);
  const schedule = draftSchedule(state.teams);

  if (state.picks.length >= TOTAL_PICKS) {
    console.log(`\n  The ${SEASON} draft is complete: ${state.picks.length}/${TOTAL_PICKS} picks. Nothing to do.\n`);
    return;
  }

  const limitArg = argValue('picks');
  const remaining = TOTAL_PICKS - state.picks.length;
  const limit = limitArg ? Math.min(Number(limitArg), remaining) : remaining;
  if (!Number.isInteger(limit) || limit < 1) fail(`--picks must be a positive integer, got "${limitArg}".`);

  const next = nextPickNumber(state);
  const upcoming = schedule.slice(next - 1, next - 1 + Math.min(limit, 8));

  console.log(`\n  PLAN — draft, season ${SEASON}\n`);
  console.log(`    made           ${state.picks.length}/${TOTAL_PICKS}`);
  console.log(`    resume at      pick ${next} (round ${schedule[next - 1].round})`);
  console.log(`    this run       ${limit} pick${limit === 1 ? '' : 's'}, ${limit} model call${limit === 1 ? '' : 's'}`);
  console.log(`    pool           ${availableFor(state).length} players undrafted`);
  console.log(`    mode           ${commit ? '*** COMMIT — this spends money and writes the live season ***' : 'DRY RUN — no calls, no writes'}`);
  console.log('\n    next up:');
  for (const slot of upcoming) {
    console.log(`      ${String(slot.pickOverall).padStart(3)}  R${String(slot.round).padStart(2)}  ${slot.team.label}  ${slot.team.displayName}`);
  }

  if (!commit) {
    // Assemble the next pick's context for real — this is the part of a dry run
    // worth having. It proves the DATA block builds, fits the ceiling, and carries
    // no lab name, without calling anybody.
    const slot = schedule[next - 1];
    const context = buildPickContext(state, slot.team, slot.round, next);
    const serialized = JSON.stringify(context.data);
    assertNoLabelLeak(serialized, FORBIDDEN_NAMES);

    console.log(`\n    dry-run context for pick ${next}:`);
    console.log(`      legal pool     ${context.legalPool.length}${context.narrowed ? ' (narrowed by the soft cap)' : ''}`);
    console.log(`      shown          ${context.data.available.length} players`);
    console.log(`      DATA size      ${serialized.length} chars`);
    console.log(`      label leak     none (checked against ${FORBIDDEN_NAMES.length} lab and model names)`);
    console.log('\n    Re-run with --commit --i-understand=2026 and ALLOW_IRREVERSIBLE=1 to fire it.\n');
    return;
  }

  console.log('');
  let cost = 0;
  let fallbacks = 0;
  let done = 0;

  while (done < limit) {
    const at = nextPickNumber(state);
    if (at > TOTAL_PICKS) break;
    const slot = schedule[at - 1];

    const result = await runPick(state, supabase, slot.round, at, slot.team);
    await commitPick(state, supabase, result);
    cost += result.costUsd;
    if (result.fallbackApplied) fallbacks++;
    done++;

    const tag = result.fallbackApplied ? ' [FALLBACK]' : result.narrowed ? ' [narrowed]' : '';
    console.log(
      `  ${String(at).padStart(3)}/${TOTAL_PICKS} R${String(result.round).padStart(2)} ${result.team.label} ` +
        `${result.team.displayName.padEnd(16)} ${result.player.name} (${result.player.position})${tag}`,
    );
    if (result.headline) console.log(`         "${result.headline}"`);
  }

  console.log(`\n  ${state.picks.length}/${TOTAL_PICKS} picks complete, ${fallbacks} fallbacks, $${cost.toFixed(4)} this run.`);
  if (state.picks.length < TOTAL_PICKS) {
    console.log('  Resumable — re-run to continue from where this stopped.\n');
  } else {
    console.log('  DRAFT COMPLETE.\n');
  }
}

// ---------------------------------------------------------------------------

async function main() {
  const stages = ['status', 'auction', 'draft'].filter(flag);
  if (stages.length === 0) {
    console.log('Pick a stage: --status, --auction, --draft');
    console.log('Add --commit --i-understand=2026 (with ALLOW_IRREVERSIBLE=1) to write. Default is a dry run.');
    return;
  }
  if (stages.length > 1) {
    fail(`one stage at a time. Got --${stages.join(' --')}.`);
  }

  const commit = commitRequested();

  if (flag('status')) await stageStatus();
  if (flag('auction')) await stageAuction(commit);
  if (flag('draft')) await stageDraft(commit);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
