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
 *
 * ---------------------------------------------------------------------------
 * And the briefing must be current
 * ---------------------------------------------------------------------------
 * Neither stage will COMMIT from a dossier older than 48 hours. The dossier is a
 * stored snapshot and this reads whatever is stored, so a rebuild that was skipped
 * does not fail — it silently serves the previous one, and the draft proceeds from an
 * injury and depth-chart picture that has already moved. A dry run only warns.
 *
 *   npm run ingest -- --preseason-stats --season 2026
 *   npx tsx --env-file=.env.local scripts/dossier.ts
 *
 * `--stale-dossier-ok` overrides it, for when drafting from an older briefing is the
 * actual intention rather than an oversight.
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
  buildScoutingIndex,
  dossierAgeHours,
  isDossierStale,
  loadStoredDossier,
} from '@/lib/preseason/scouting';
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
 * An explicit "yes, this briefing, deliberately". Kept separate from the commit locks:
 * those establish that you mean to write the season, this one establishes that you mean
 * to write it from data you already know is old.
 */
function staleDossierAccepted(): boolean {
  return flag('stale-dossier-ok');
}

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
 * The provisional-slot path exists so the draft dry run is worth running BEFORE the auction.
 * Without it the most valuable thing a dry run can check — that the pick DATA block
 * builds, fits the context ceiling and leaks no lab name against real 2026 data — is
 * unreachable until after the one irreversible step it is meant to de-risk.
 *
 * Provisional slots are seed-ordered and in memory only. `commitRequested()` is
 * checked by the caller before this is ever passed true, so a committing run always
 * uses the slots the auction actually awarded.
 */
/**
 * `dryRun` drives two things that both follow from it: provisional seed-ordered slots
 * when the auction has not run yet, and whether a stale dossier warns or refuses. They
 * are named as one parameter because they are one question — is this invocation going
 * to write the season — and passing them separately would let them disagree.
 */
async function loadDraftState(supabase: SupabaseClient, dryRun = false): Promise<DraftState> {
  const { seasonId, teams, rulebookVersion } = await seasonAndTeams(supabase);
  assertRulebookMatches(rulebookVersion);
  const unassigned = teams.some((t) => t.draft_slot === null);

  if (unassigned && !dryRun) {
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
    scouting: await requireScouting(supabase, seasonId, { dryRun }),
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

/**
 * How old the briefing may be at the moment it decides a draft.
 *
 * Generous enough for the realistic workflow — rebuild the evening before, draft the
 * next morning — and tight enough to catch the failure this exists for, which is
 * forgetting to rebuild at all and silently drafting from a picture that is days old.
 */
const MAX_DOSSIER_AGE_HOURS = 48;

/**
 * The stored dossier, or an abort. Used by BOTH stages.
 *
 * Deliberately fatal rather than a warning. The failure guarded against is not a crash
 * — it is a draft that completes, looks entirely normal, and was made from raw
 * projections with no scarcity baseline. That is precisely what happened in the 2025
 * rehearsal, where five of the first eight picks were quarterbacks in a league that
 * starts one, and `/backtest` names the missing dossier as the cause. A draft is one
 * shot; "it ran, but without the briefing" is not a recoverable state.
 *
 * STALENESS is the second half of the same problem, and the likelier half now the first
 * is fixed. The dossier is a STORED snapshot and this loads whatever is stored, so a
 * rebuild that never happened does not fail — it silently serves the previous one.
 * Between 29 July and 16 August, 23 of the 119 players inside ADP 120 changed injury
 * status, and final roster cuts land the week of the draft. A week-old briefing is
 * wrong about the thing it is most needed for.
 *
 * The asymmetry is on purpose: a dry run WARNS, because exploring with yesterday's
 * briefing is reasonable and being blocked from it is not. A commit REFUSES, because
 * that is the invocation that cannot be taken back.
 *
 * Shared by the auction and the draft because the auction is the IRREVERSIBLE half —
 * it fixes the anonymous rival labels for the whole season — and a guard that covered
 * only the resumable stage would be protecting the wrong one.
 */
async function loadDossierOrFail(
  supabase: SupabaseClient,
  seasonId: string,
  { dryRun }: { dryRun: boolean },
) {
  const rebuild =
    `    npm run ingest -- --preseason-stats --season ${SEASON}\n` +
    '    npx tsx --env-file=.env.local scripts/dossier.ts\n';

  const stored = await loadStoredDossier(supabase, seasonId);
  if (!stored) {
    fail(
      `no dossier has been built for ${SEASON}.\n\n` +
        '  The models draft from the stored briefing — scarcity curves, last season, byes,\n' +
        "  depth chart, injuries and this year's preseason role. Build it first:\n\n" +
        rebuild,
    );
  }
  if ((stored!.dossier.players ?? []).length === 0) {
    fail(`the stored ${SEASON} dossier contains no players. Rebuild it:\n\n` + rebuild);
  }

  if (isDossierStale(stored!.builtAt, MAX_DOSSIER_AGE_HOURS)) {
    const hours = dossierAgeHours(stored!.builtAt);
    const age = Number.isFinite(hours) ? `${(hours / 24).toFixed(1)} days old` : 'of unknown age';

    if (dryRun) {
      console.log(`\n  WARNING: the stored dossier is ${age}. Rebuild before committing:\n`);
      console.log(rebuild);
    } else if (staleDossierAccepted()) {
      console.log(`\n  NOTE: dossier is ${age}, accepted via --stale-dossier-ok.\n`);
    } else {
      fail(
        `the stored ${SEASON} dossier is ${age}, over the ${MAX_DOSSIER_AGE_HOURS}h limit.\n\n` +
          '  It is a snapshot, and this would decide the season from an injury and depth-chart\n' +
          '  picture that has already moved. Rebuild it:\n\n' +
          rebuild +
          '\n  Or pass --stale-dossier-ok if drafting from this exact briefing is deliberate.\n',
      );
    }
  }

  return stored!;
}

async function requireScouting(
  supabase: SupabaseClient,
  seasonId: string,
  opts: { dryRun: boolean },
) {
  return buildScoutingIndex(await loadDossierOrFail(supabase, seasonId, opts));
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

  // The auction gets the dossier WHOLE. It is eight calls, and the question in front
  // of a model here — what a draft slot is worth for a whole season — is precisely a
  // question about scarcity across every position at once.
  const stored = await loadDossierOrFail(supabase, seasonId, { dryRun: !commit });

  const data = {
    budget_total: LEAGUE.budgetTotal,
    teams: LEAGUE.teams,
    rounds: LEAGUE.draftRounds,
    draft_type: LEAGUE.draftType,
    slot_pick_numbers: slotPickNumbers(),
    top_available: topAvailable,
    budget_rule:
      'Whatever you do not spend here is your entire FAAB budget for all 14 weeks, and for the playoff free-agent auction.',
    dossier: stored.dossier,
  };

  assertNoLabelLeak(JSON.stringify(data), FORBIDDEN_NAMES);

  // Report the briefing explicitly. The bug this stage was shipped with for weeks was
  // a dossier that was built, stored, published as sent, and never actually put in a
  // prompt — a dry run that does not SAY the dossier is in the block cannot tell you
  // it is missing, which is how it went unnoticed in the first place.
  const scouted = stored.dossier.players ?? [];
  const withPreseason = scouted.filter((p) => p.preseason !== null).length;

  console.log(`\n  PLAN — slot auction, season ${SEASON}\n`);
  console.log(`    board          ${topAvailable.length} players, ADP ${topAvailable[0].adp} to ${topAvailable[topAvailable.length - 1].adp}`);
  console.log(`    dossier        ${scouted.length} players, ${withPreseason} with a preseason line, ${stored.dossier.scarcity_curves?.length ?? 0} scarcity curves`);
  console.log(`    dossier hash   ${stored.hash.slice(0, 24)}…`);
  console.log(`    DATA size      ${JSON.stringify(data).length.toLocaleString()} chars`);
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
        dossierHash: stored.hash,
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


/**
 * Stamp `seasons.draft_completed_at` once all 120 picks exist.
 *
 * Nothing wrote this column. `src/lib/site/league-facts.ts` reads it into
 * `draftComplete`, which /preseason renders as a checkable "Draft complete" fact — so
 * a finished draft would have gone on telling the public it had not happened. Found by
 * verifying the finished draft against the database rather than against the runbook,
 * which is the only reason it was found at all.
 *
 * Idempotent, and never overwrites an existing timestamp: the first completion is the
 * one that happened.
 */
async function stampDraftComplete(supabase: SupabaseClient, seasonId: string, commit: boolean) {
  const { data, error } = await supabase
    .from('seasons')
    .select('draft_completed_at')
    .eq('id', seasonId)
    .single();
  if (error) fail(`seasons read: ${error.message}`);
  if (data.draft_completed_at) return;

  if (!commit) {
    console.log('  draft_completed_at is unset — a --commit run will stamp it.');
    return;
  }
  const { error: writeError } = await supabase
    .from('seasons')
    .update({ draft_completed_at: new Date().toISOString() })
    .eq('id', seasonId);
  if (writeError) fail(`draft_completed_at: ${writeError.message}`);
  console.log('  draft_completed_at stamped — /preseason will now report the draft as complete.');
}

async function stageDraft(commit: boolean) {
  const supabase = db();
  const state = await loadDraftState(supabase, !commit);
  const schedule = draftSchedule(state.teams);

  if (state.picks.length >= TOTAL_PICKS) {
    console.log(`\n  The ${SEASON} draft is complete: ${state.picks.length}/${TOTAL_PICKS} picks. Nothing to do.\n`);
    await stampDraftComplete(supabase, state.seasonId, commit);
    console.log('');
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

    const shown = context.data.available;
    const scoutedShown = shown.filter((p) => p.scouted).length;
    const withPre = shown.filter((p) => p.preseason !== null).length;

    console.log(`\n    dry-run context for pick ${next}:`);
    console.log(`      legal pool     ${context.legalPool.length}${context.narrowed ? ' (narrowed by the soft cap)' : ''}`);
    console.log(`      shown          ${shown.length} players`);
    console.log(`      scouted        ${scoutedShown}/${shown.length} carry a scouting line, ${withPre} with preseason`);
    console.log(`      curves         ${context.data.scarcity_curves.length} scarcity curves, ${context.data.data_notes.length} reading notes`);
    console.log(`      dossier hash   ${state.scouting?.hash.slice(0, 24) ?? 'NONE'}…`);
    console.log(`      DATA size      ${serialized.length.toLocaleString()} chars`);
    console.log(`      label leak     none (checked against ${FORBIDDEN_NAMES.length} lab and model names)`);

    // One real entry, printed whole. A count can be right while the shape is wrong.
    console.log(`\n      sample player as the model will receive it:`);
    console.log(
      JSON.stringify(shown[0], null, 2)
        .split('\n')
        .map((l) => `        ${l}`)
        .join('\n'),
    );
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
    await stampDraftComplete(supabase, state.seasonId, commit);
    console.log('');
  }
}

/**
 * Publish the seed (SPEC §8.3).
 *
 * The commitment is one half of a proof and the reveal is the other. `seed_commit_hash`
 * was published before anyone bid; until the raw seed is out, nobody outside this
 * machine can replay the tiebreak it decided — and in 2026 it decided a real outcome,
 * because three teams bid $0 and the seed alone put them in slots 4, 7 and 8.
 *
 * Order matters, and it is the whole reason this is a separate stage rather than a line
 * inside the auction. Revealed AFTER the draft, a seed can always be accused of having
 * been chosen to suit the picks. Revealed between the auction and the first pick, the
 * slots are already fixed and the seed cannot have been shopped for. This project was
 * built by Claude and Claude Opus 5 competes in it, so a checkable tiebreak is not a
 * nicety — it is the disclosure.
 *
 * Refuses before the auction (there is nothing to prove yet) and refuses to overwrite a
 * reveal that already happened (a second, different seed would void the first).
 */
async function stageRevealSeed(commit: boolean) {
  const supabase = db();
  const { seasonId, teams } = await seasonAndTeams(supabase);

  const slotted = teams.filter((t) => t.draft_slot !== null).length;
  if (slotted !== teams.length) {
    fail(
      `the auction has not run — ${slotted}/${teams.length} slots assigned.\n` +
        '  There is no tiebreak to prove yet. Run --auction first.',
    );
  }

  const { data: season, error } = await supabase
    .from('seasons')
    .select('seed_commit_hash, seed_revealed_at, draft_seed')
    .eq('id', seasonId)
    .single();
  if (error) fail(`seasons read: ${error.message}`);

  if (season.seed_revealed_at !== null) {
    fail(
      `the ${SEASON} seed was already revealed at ${season.seed_revealed_at}.\n` +
        '  Revealing a second, different seed would void the first. Nothing to do.',
    );
  }

  // Re-verifies against the published hash and refuses on a mismatch.
  const seed = await verifiedSeed(supabase, seasonId);

  const { count: picks } = await supabase
    .from('draft_picks')
    .select('*', { count: 'exact', head: true })
    .eq('season_id', seasonId);

  console.log(`\n  SEED REVEAL — season ${SEASON}\n`);
  console.log(`    commitment    ${season.seed_commit_hash}`);
  console.log(`    this seed     ${commitHash(seed)}  ✓ matches`);
  // Deliberately NOT the seed itself — a dry run must not put it on a terminal before
  // the commit that publishes it. This names the namespace the tiebreak is derived from.
  console.log('    tiebroken     slots decided by <seed>:auction');
  console.log(`    draft         ${picks ?? 0}/${TOTAL_PICKS} picks made`);
  if ((picks ?? 0) > 0) {
    console.log('    ⚠ picks already exist — revealing now is weaker than revealing before them.');
  }
  console.log(`    mode          ${commit ? '*** COMMIT — this publishes the seed ***' : 'DRY RUN — nothing published'}`);

  if (!commit) {
    console.log('\n    Re-run with --commit --i-understand=2026 and ALLOW_IRREVERSIBLE=1 to publish.\n');
    return;
  }

  const { error: writeError } = await supabase
    .from('seasons')
    .update({ draft_seed: seed, seed_revealed_at: new Date().toISOString() })
    .eq('id', seasonId);
  if (writeError) fail(`seed reveal: ${writeError.message}`);

  console.log('\n    Published. The auction tiebreak is now replayable by anyone.\n');
}

// ---------------------------------------------------------------------------

async function main() {
  const stages = ['status', 'auction', 'draft', 'reveal-seed'].filter(flag);
  if (stages.length === 0) {
    console.log('Pick a stage: --status, --auction, --reveal-seed, --draft');
    console.log('Add --commit --i-understand=2026 (with ALLOW_IRREVERSIBLE=1) to write. Default is a dry run.');
    return;
  }
  if (stages.length > 1) {
    fail(`one stage at a time. Got --${stages.join(' --')}.`);
  }

  const commit = commitRequested();

  if (flag('status')) await stageStatus();
  if (flag('auction')) await stageAuction(commit);
  if (flag('reveal-seed')) await stageRevealSeed(commit);
  if (flag('draft')) await stageDraft(commit);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
