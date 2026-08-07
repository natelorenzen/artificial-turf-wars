/**
 * One full weekly cycle, run for real against the rehearsal season.
 *
 *   npx tsx --env-file=.env.local scripts/weekly-rehearsal.ts --week 5             # dry run
 *   ALLOW_IRREVERSIBLE=1 npx tsx --env-file=.env.local scripts/weekly-rehearsal.ts \
 *     --week 5 --commit --i-understand=2025
 *
 * ---------------------------------------------------------------------------
 * Why a script and not the cron routes
 * ---------------------------------------------------------------------------
 * The routes refuse, correctly, and they should keep refusing. `lineups` resolves its
 * week with `resolveUpcomingWeek`, which only ever finds a week whose kickoff is in the
 * FUTURE, and `assertBeforeKickoff` rejects anything already played. A 2025 week is a
 * year in the past. Loosening either guard to make a rehearsal possible would remove
 * the protection that stops the live season writing a lineup after kickoff — a bad
 * trade for a script that takes an hour to write.
 *
 * So this shares the ENGINE with the routes and duplicates only the sequencing, the
 * same split `scripts/draft.ts` makes for the same reason. `buildWeeklyContext`,
 * `decideLineups`, `scoreWeek`, `resolveWaivers` and `writeRecap` are literally the
 * modules production runs; if they are wrong here they are wrong there.
 *
 * ---------------------------------------------------------------------------
 * The order is the real cron order, which is not the obvious one
 * ---------------------------------------------------------------------------
 * Waivers come BEFORE lineups for a given week, because the Tuesday and Wednesday jobs
 * transact into the week the Thursday job then sets a lineup for. Rehearsing them the
 * other way round would hide the single most interesting interaction in the cycle: in
 * 2025 week 5 two teams' only defence is on bye, and streaming one is exactly what the
 * waiver run is for. Lineups-first would have scored those teams an empty DEF slot and
 * called it correct.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { LEAGUE } from '@/lib/config/league';
import { resolveWaivers, type TeamWaiverState, type WaiverClaim } from '@/lib/engine/faab';
import { scoreWeek, seasonIdFor } from '@/lib/scoring/week';
import { buildWeeklyContext } from '@/lib/weekly/context';
import {
  assertLineupContexts,
  decideLineups,
  seedFallbackLineups,
  storeLineup,
} from '@/lib/weekly/lineups';
import {
  assertWaiverContexts,
  decideAllWaivers,
  loadFreeAgents,
  storeWaiverBids,
  teamWaiverState,
} from '@/lib/weekly/waivers';
import { buildWrapFacts, writeRecap } from '@/lib/weekly/wrap';

/** The rehearsal season. Not a flag — the live season must never be reachable here. */
const SEASON = 2025;

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

function fail(message: string): never {
  console.error(`\n  REFUSING TO RUN\n  ${message}\n`);
  process.exit(1);
}

/**
 * The same three operator locks the draft runner uses.
 *
 * This spends real money and writes real rows. It is not irreversible in the way the
 * draft is — a rehearsal week can be deleted and re-run — but "cheap to undo" has never
 * been a good reason to make something easy to fire by accident.
 */
function commitRequested(): boolean {
  if (!flag('commit')) return false;
  if (process.env.ALLOW_IRREVERSIBLE !== '1') {
    fail('--commit requires ALLOW_IRREVERSIBLE=1 in the environment. This spends model calls.');
  }
  const phrase = argValue('i-understand');
  if (phrase !== String(SEASON)) {
    fail(`--commit requires --i-understand=${SEASON}. Got ${phrase === null ? '(nothing)' : `"${phrase}"`}.`);
  }
  return true;
}

const money = (n: number) => `$${n.toFixed(4)}`;

// ---------------------------------------------------------------------------

async function main() {
  const week = Number(argValue('week') ?? '5');
  if (!Number.isInteger(week) || week < 2 || week > LEAGUE.regularSeasonWeeks) {
    fail(`--week must be 2..${LEAGUE.regularSeasonWeeks} (week 1 has no preceding waiver run).`);
  }

  const commit = commitRequested();
  const supabase = db();
  const seasonId = await seasonIdFor(supabase, SEASON);
  let cost = 0;

  console.log(`\n  WEEKLY REHEARSAL — season ${SEASON}, week ${week}`);
  console.log(`  mode  ${commit ? '*** COMMIT — this spends model calls and writes rows ***' : 'DRY RUN — no calls, no writes'}\n`);

  // =========================================================================
  // Tuesday — waiver bids, filed under the week just played
  // =========================================================================
  const bidWeek = week - 1;
  const waiverContext = await buildWeeklyContext(supabase, {
    seasonId,
    season: SEASON,
    week,
    memoryType: 'waiver',
  });
  const freeAgents = await loadFreeAgents(supabase, waiverContext);
  const waiverInput = { context: waiverContext, freeAgents, bidWeek };
  assertWaiverContexts(waiverInput);

  console.log(`  [1/5] WAIVER BIDS — filed week ${bidWeek}, effective week ${week}`);
  console.log(`        pool ${freeAgents.length} free agents, ${waiverContext.teams.length} model calls`);

  if (commit) {
    const { decisions, failures } = await decideAllWaivers(waiverInput, supabase);
    for (const decision of decisions) await storeWaiverBids(supabase, bidWeek, decision);
    cost += decisions.reduce((sum, d) => sum + d.costUsd, 0);

    for (const d of decisions) {
      const what = d.fallbackApplied
        ? `REJECTED — ${d.problem}`
        : d.claims.length === 0
          ? 'stood pat'
          : d.claims.map((c) => `+${c.addPlayerId} $${c.bid}`).join(', ');
      console.log(`        ${d.team.label} ${d.team.displayName.padEnd(16)} ${what}`);
      if (d.headline) console.log(`             "${d.headline}"`);
    }
    for (const f of failures) console.log(`        ${f.team.label} ERROR ${f.error}`);
  }

  // =========================================================================
  // Wednesday — deterministic resolution. No model call.
  // =========================================================================
  console.log(`\n  [2/5] WAIVER RESOLUTION — into week ${week}`);

  if (commit) {
    const applied = await resolveAndApply(supabase, seasonId, bidWeek, week);
    console.log(`        ${applied.claims} claims, ${applied.won} won, $${applied.spent} spent`);
    for (const line of applied.lines) console.log(`        ${line}`);
  }

  // =========================================================================
  // Thursday — lineups, on the roster the waivers just produced
  // =========================================================================
  // Rebuilt, not reused: the waiver run changed rosters and budgets, and setting a
  // lineup from the pre-waiver context would ignore the player just bought.
  const lineupContext = await buildWeeklyContext(supabase, {
    seasonId,
    season: SEASON,
    week,
    memoryType: 'lineup',
  });
  assertLineupContexts(lineupContext);

  console.log(`\n  [3/5] LINEUPS — week ${week}, ${lineupContext.teams.length} model calls`);

  if (commit) {
    const seeded = await seedFallbackLineups(supabase, lineupContext);
    console.log(`        seeded ${seeded.seeded.length} deterministic lineups before calling anyone`);

    const { decisions, failures } = await decideLineups(lineupContext, supabase);
    const lockedAt = new Date();
    for (const decision of decisions) await storeLineup(supabase, week, decision, lockedAt);
    cost += decisions.reduce((sum, d) => sum + d.costUsd, 0);

    for (const d of decisions) {
      const tag = d.fallbackApplied ? ` [FALLBACK — ${d.problem}]` : '';
      console.log(`        ${d.team.label} ${d.team.displayName.padEnd(16)} conf ${d.confidence?.toFixed(2) ?? '—'}${tag}`);
      if (d.headline) console.log(`             "${d.headline}"`);
    }
    for (const f of failures) console.log(`        ${f.team.label} ERROR ${f.error}`);
  }

  // =========================================================================
  // Tuesday — scoring. Deterministic, and it fetches the real stat lines.
  // =========================================================================
  console.log(`\n  [4/5] SCORING — week ${week}, provisional`);

  if (commit) {
    const scored = await scoreWeek(supabase, {
      seasonId,
      season: SEASON,
      week,
      status: 'provisional',
      evaluateMoves: true,
    });
    console.log(`        ${scored.teamsScored} teams scored, ${scored.emptySlots} empty slots, ${scored.ingest.scored} stat lines`);
    for (const row of scored.standings) {
      const team = lineupContext.teams.find((t) => t.teamId === row.teamId)!;
      console.log(
        `        ${String(row.rank).padStart(2)}. ${team.label} ${team.displayName.padEnd(16)} ` +
          `${row.h2hW}-${row.h2hL} h2h, ${row.allplayW}-${row.allplayL} all-play, ${row.cumPts} pts`,
      );
    }
  }

  // =========================================================================
  // Tuesday — the column
  // =========================================================================
  console.log('\n  [5/5] WRAP — the beat writer, 1 model call');

  if (commit) {
    const facts = await buildWrapFacts(supabase, { seasonId, season: SEASON, week });
    const written = await writeRecap(facts);
    cost += written.costUsd;

    if (!written.recap) {
      console.log(`        FAILED — ${written.validationError}`);
    } else {
      console.log(`        "${written.recap.headline}"`);
      console.log(`        number check ${written.numbers.passed ? 'PASSED' : `FAILED — ${written.numbers.notes.join('; ')}`}`);
      for (const note of facts.luck) console.log(`        luck: ${note.model} ${note.note}`);

      const { error } = await supabase.from('recaps').upsert(
        {
          season_id: seasonId,
          week,
          headline: written.recap.headline,
          short_post: written.recap.short_post,
          column_md: written.recap.column_md,
          facts_packet: written.factsPacket as unknown as Record<string, unknown>,
          facts_packet_hash: written.factsPacketHash,
          number_check_passed: written.numbers.passed,
          number_check_notes: written.numbers.notes,
        },
        { onConflict: 'season_id,week' },
      );
      // Migration 0006 may not be applied. The column is the deliverable and it is
      // already written and paid for; losing the row must not lose the run's report.
      if (error) console.log(`        recaps write FAILED — ${error.message}`);
    }
  }

  if (!commit) {
    console.log(`\n  Re-run with --commit --i-understand=${SEASON} and ALLOW_IRREVERSIBLE=1 to fire it.`);
    console.log(`  That is ${waiverContext.teams.length * 2 + 1} model calls.\n`);
    return;
  }

  console.log(`\n  REHEARSAL COMPLETE — ${money(cost)} spent.\n`);
}

/**
 * The Wednesday job's body, against the bids just filed.
 *
 * A copy of `waiver-resolve`'s persistence rather than a call into it, because that
 * route derives its own week from the schedule and would resolve the wrong one here.
 * The RESOLUTION itself is `resolveWaivers`, the same tested engine function.
 */
async function resolveAndApply(
  supabase: SupabaseClient,
  seasonId: string,
  bidWeek: number,
  targetWeek: number,
) {
  const { data: bidRows, error } = await supabase
    .from('waiver_bids')
    .select('id, team_id, add_player_id, drop_player_id, bid')
    .eq('week', bidWeek);
  if (error) fail(`waiver_bids: ${error.message}`);
  if (!bidRows || bidRows.length === 0) {
    return { claims: 0, won: 0, spent: 0, lines: ['no bids filed — every team stood pat'] };
  }

  const context = await buildWeeklyContext(supabase, {
    seasonId,
    season: SEASON,
    week: targetWeek,
    memoryType: 'waiver',
  });
  const teams: TeamWaiverState[] = context.teams.map((team) => teamWaiverState(context, team));
  const claims: WaiverClaim[] = bidRows.map((b) => ({
    teamId: b.team_id as string,
    addPlayerId: b.add_player_id as string,
    dropPlayerId: b.drop_player_id as string,
    bid: Number(b.bid),
  }));

  const resolution = resolveWaivers(claims, teams);
  const labelOf = new Map(context.teams.map((t) => [t.teamId, `${t.label} ${t.displayName}`]));

  const bidIdOf = new Map(bidRows.map((b) => [`${b.team_id}:${b.add_player_id}`, b.id as string]));
  for (const outcome of resolution.outcomes) {
    const id = bidIdOf.get(`${outcome.teamId}:${outcome.addPlayerId}`);
    if (!id) continue;
    await supabase
      .from('waiver_bids')
      .update({ won: outcome.won, losing_reason: outcome.losingReason })
      .eq('id', id);
  }

  for (const outcome of resolution.outcomes.filter((o) => o.won)) {
    // Drop first — `rosters_one_active_stint` collides otherwise.
    await supabase
      .from('rosters')
      .update({ active: false, dropped_week: targetWeek })
      .eq('team_id', outcome.teamId)
      .eq('player_id', outcome.dropPlayerId)
      .eq('active', true);
    await supabase.from('rosters').insert({
      team_id: outcome.teamId,
      player_id: outcome.addPlayerId,
      acquired_via: 'waiver',
      acquired_week: targetWeek,
      faab_paid: outcome.bid,
      active: true,
    });
  }

  for (const team of resolution.teams) {
    await supabase
      .from('teams')
      .update({ faab_remaining: team.faabRemaining, waiver_priority: team.waiverPriority })
      .eq('id', team.teamId);
  }

  const won = resolution.outcomes.filter((o) => o.won);
  return {
    claims: resolution.outcomes.length,
    won: won.length,
    spent: won.reduce((sum, o) => sum + o.bid, 0),
    lines: resolution.outcomes.map(
      (o) =>
        `${labelOf.get(o.teamId)} ${o.won ? 'WON' : `lost (${o.losingReason})`} ` +
        `${o.addPlayerId} at $${o.bid}`,
    ),
  };
}

main().catch((err) => {
  console.error(`\n  ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
