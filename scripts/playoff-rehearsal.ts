/**
 * Rehearse the postseason against 2025, the way weeks 5 and 6 were rehearsed.
 *
 *   npx tsx --env-file=.env.local scripts/playoff-rehearsal.ts --fast-forward --commit
 *   npx tsx --env-file=.env.local scripts/playoff-rehearsal.ts --playoffs
 *   npx tsx --env-file=.env.local scripts/playoff-rehearsal.ts --playoffs --commit --i-understand=2025
 *
 * ---------------------------------------------------------------------------
 * Two stages, because they cost very different things
 * ---------------------------------------------------------------------------
 * `--fast-forward` walks weeks 7 to 14 with DETERMINISTIC lineups and scores them. No
 * model is called and no money is spent. It exists only to produce a standings table
 * with a real shape at week 14, because a bracket cannot be seeded from a league that
 * has played two weeks. The lineups it writes are flagged `carried_forward`, so nothing
 * here is ever mistaken for a decision a model made.
 *
 * `--playoffs` runs the actual sequence §14.5 fixes, in order, with real model calls:
 *
 *   week 14 scored → seed the field → release the eliminated rosters
 *   → sealed bids from the four survivors → resolve → week 15 lineups → score
 *   → week 16 lineups → score → champion
 *
 * About twelve model calls. The point is not the result; it is to find out what breaks,
 * on a season where being wrong costs nothing.
 *
 * SEASON IS HARDCODED TO 2025 and there is no flag to change it, for the same reason
 * `backtest.ts` cannot write 2026: a script that rehearses is one stray argument away
 * from transacting against the real league.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { LEAGUE } from '@/lib/config/league';
import { FINAL_WEEK, SEMIFINAL_WEEK } from '@/lib/engine/bracket';
import { resolvePlayoffPool } from '@/lib/engine/playoff-pool';
import type { TeamWaiverState, WaiverClaim } from '@/lib/engine/faab';
import { decidePlayoffField, releaseEliminatedRosters } from '@/lib/playoffs/pool';
import { loadBracket, loadStoredSeeds, persistBracketWeek } from '@/lib/playoffs/state';
import { scoreWeek, seasonIdFor } from '@/lib/scoring/week';
import { buildWeeklyContext, teamsPlayingIn } from '@/lib/weekly/context';
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

const SEASON = 2025;

const flag = (name: string) => process.argv.includes(`--${name}`);

function argValue(name: string): string | null {
  const exact = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (exact) return exact.slice(name.length + 3);
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

function fail(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

function db(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

const money = (n: number) => `$${n.toFixed(4)}`;

function commitRequested(): boolean {
  if (!flag('commit')) return false;
  if (flag('playoffs') && argValue('i-understand') !== String(SEASON)) {
    fail(`--playoffs --commit spends model calls. Add --i-understand=${SEASON}.`);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Stage A — get the rehearsal season to a week-14 standings table
// ---------------------------------------------------------------------------

async function fastForward(supabase: SupabaseClient, seasonId: string, commit: boolean) {
  console.log(`\n  FAST-FORWARD — deterministic lineups, weeks 7 to ${LEAGUE.regularSeasonWeeks}`);
  console.log('  No model calls. These lineups are flagged carried_forward and are not decisions.\n');

  for (let week = 7; week <= LEAGUE.regularSeasonWeeks; week++) {
    const context = await buildWeeklyContext(supabase, {
      seasonId,
      season: SEASON,
      week,
      memoryType: 'lineup',
    });

    if (!commit) {
      console.log(`  week ${String(week).padStart(2)}  would seed ${context.teams.length} lineups and score`);
      continue;
    }

    const seeded = await seedFallbackLineups(supabase, context);
    const scored = await scoreWeek(supabase, {
      seasonId,
      season: SEASON,
      week,
      status: 'provisional',
      evaluateMoves: false,
    });
    console.log(
      `  week ${String(week).padStart(2)}  seeded ${String(seeded.seeded.length).padStart(2)}  ` +
        `scored ${scored.teamsScored} teams  leader ${scored.standings[0]?.teamId.slice(0, 8) ?? '—'}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Stage B — the postseason
// ---------------------------------------------------------------------------

async function playoffs(supabase: SupabaseClient, seasonId: string, commit: boolean) {
  let cost = 0;

  console.log(`\n  PLAYOFF REHEARSAL — season ${SEASON}`);
  console.log(`  mode  ${commit ? '*** COMMIT — spends model calls and writes rows ***' : 'DRY RUN'}\n`);

  // --- 1. the field -------------------------------------------------------
  const field = await decidePlayoffField(supabase, seasonId, { commit });
  if (!field) fail(`week ${LEAGUE.regularSeasonWeeks} is not scored — run --fast-forward --commit first.`);

  const { data: teamRows } = await supabase
    .from('teams')
    .select('id, models!inner(display_name)')
    .eq('season_id', seasonId);
  const nameOf = new Map(
    ((teamRows ?? []) as unknown as { id: string; models: { display_name: string } }[]).map((t) => [
      t.id,
      t.models.display_name,
    ]),
  );

  console.log('  [1/6] THE FIELD');
  field.seeds.forEach((teamId, i) => console.log(`        ${i + 1}. ${nameOf.get(teamId)}`));
  console.log(`        eliminated: ${field.eliminated.map((t) => nameOf.get(t)).join(', ')}`);
  console.log(`        ${field.frozen ? 'frozen now' : 'already frozen by an earlier run'}`);

  // --- 2. release ---------------------------------------------------------
  const released = commit
    ? await releaseEliminatedRosters(supabase, field.eliminated, SEMIFINAL_WEEK)
    : { players: 0, teams: 0 };
  console.log(`\n  [2/6] POOL RELEASE — ${released.players} players from ${released.teams} rosters`);

  // --- 3. sealed bids from the four survivors -----------------------------
  const poolContext = await buildWeeklyContext(supabase, {
    seasonId,
    season: SEASON,
    week: SEMIFINAL_WEEK,
    memoryType: 'waiver',
  });
  const bidders = teamsPlayingIn(poolContext);
  const freeAgents = await loadFreeAgents(supabase, poolContext);
  const input = { context: poolContext, freeAgents, bidWeek: LEAGUE.regularSeasonWeeks };
  assertWaiverContexts(input);

  console.log(
    `\n  [3/6] PLAYOFF POOL BIDS — ${bidders.length} bidders, ${freeAgents.length} available`,
  );
  if (bidders.length !== LEAGUE.playoffTeams) {
    fail(`expected ${LEAGUE.playoffTeams} bidders, got ${bidders.length}. The bracket is wrong.`);
  }

  if (commit) {
    const { decisions, failures } = await decideAllWaivers(input, supabase);
    for (const d of decisions) await storeWaiverBids(supabase, LEAGUE.regularSeasonWeeks, d);
    cost += decisions.reduce((sum, d) => sum + d.costUsd, 0);

    for (const d of decisions) {
      const what = d.fallbackApplied
        ? `REJECTED — ${d.problem}`
        : d.claims.length === 0
          ? 'stood pat'
          : d.claims.map((c) => `+${c.addPlayerId} $${c.bid}`).join(', ');
      console.log(`        ${d.team.displayName.padEnd(22)} $${d.team.faabRemaining} left · ${what}`);
      if (d.headline) console.log(`             "${d.headline}"`);
    }
    for (const f of failures) console.log(`        ${f.team.displayName} ERROR ${f.error}`);
  }

  // --- 4. resolution, deterministic ---------------------------------------
  console.log('\n  [4/6] RESOLUTION');
  if (commit) {
    const applied = await resolvePool(supabase, seasonId, nameOf);
    for (const line of applied) console.log(`        ${line}`);
  }

  // --- 5 & 6. the two bracket weeks ---------------------------------------
  for (const week of [SEMIFINAL_WEEK, FINAL_WEEK]) {
    const step = week === SEMIFINAL_WEEK ? '5/6' : '6/6';
    const bracket = await loadBracket(supabase, seasonId);
    if (!bracket) fail('no bracket — the field was never frozen.');

    const games = week === SEMIFINAL_WEEK ? bracket.semifinals : bracket.championship;
    if (games.length === 0) {
      // In a dry run this is expected, not an error: week 16's fixtures are a function
      // of week 15's scores, and a dry run has not played week 15.
      if (!commit) {
        console.log(`\n  [${step}] WEEK ${week} — undecided until week ${SEMIFINAL_WEEK} is scored`);
        continue;
      }
      fail(`week ${week} has no fixtures. Week ${SEMIFINAL_WEEK} must be scored first.`);
    }

    console.log(`\n  [${step}] WEEK ${week}`);
    for (const g of games) {
      console.log(
        `        ${g.round.padEnd(12)} (${g.homeSeed}) ${nameOf.get(g.homeTeamId)} v ` +
          `(${g.awaySeed}) ${nameOf.get(g.awayTeamId)}`,
      );
    }

    if (!commit) continue;

    await persistBracketWeek(supabase, seasonId, games);

    const context = await buildWeeklyContext(supabase, {
      seasonId,
      season: SEASON,
      week,
      memoryType: 'lineup',
    });
    const playing = teamsPlayingIn(context);
    if (playing.length !== games.length * 2) {
      fail(`week ${week}: ${playing.length} teams are playing but there are ${games.length} games.`);
    }
    assertLineupContexts(context);

    await seedFallbackLineups(supabase, context);
    const { decisions, failures } = await decideLineups(context, supabase);
    const lockedAt = new Date();
    for (const d of decisions) await storeLineup(supabase, week, d, lockedAt);
    cost += decisions.reduce((sum, d) => sum + d.costUsd, 0);

    for (const d of decisions) {
      console.log(
        `        ${d.team.displayName.padEnd(22)} ${d.valid ? 'ok' : `REJECTED — ${d.problem}`}` +
          `  conf ${d.confidence ?? '—'}`,
      );
      if (d.headline) console.log(`             "${d.headline}"`);
    }
    for (const f of failures) console.log(`        ${f.team.displayName} ERROR ${f.error}`);

    const scored = await scoreWeek(supabase, {
      seasonId,
      season: SEASON,
      week,
      status: 'provisional',
      evaluateMoves: true,
    });
    console.log(`        scored ${scored.teamsScored} teams, playoff=${scored.playoff}`);
  }

  // --- the result ---------------------------------------------------------
  const finalBracket = await loadBracket(supabase, seasonId);
  console.log('\n  RESULT');
  for (const r of finalBracket?.semifinalResults ?? []) {
    console.log(
      `        ${r.game.round}: ${nameOf.get(r.winnerTeamId)} ${r.winnerPts} def. ` +
        `${nameOf.get(r.loserTeamId)} ${r.loserPts}${r.decidedBySeed ? '  (on seed)' : ''}`,
    );
  }
  for (const r of finalBracket?.championshipResults ?? []) {
    console.log(
      `        ${r.game.round}: ${nameOf.get(r.winnerTeamId)} ${r.winnerPts} def. ` +
        `${nameOf.get(r.loserTeamId)} ${r.loserPts}${r.decidedBySeed ? '  (on seed)' : ''}`,
    );
  }
  if (finalBracket?.championTeamId) {
    console.log(`\n        CHAMPION — ${nameOf.get(finalBracket.championTeamId)}`);
    console.log(`        third    — ${nameOf.get(finalBracket.thirdTeamId ?? '') ?? '—'}`);
  }

  // The standings must NOT have moved. If they did, the bracket was re-seeded by its
  // own results, which is the worst thing this phase could do quietly.
  const { data: latest } = await supabase
    .from('standings')
    .select('week')
    .order('week', { ascending: false })
    .limit(1);
  console.log(
    `\n        standings still stop at week ${latest?.[0]?.week ?? '—'} ` +
      `(must be ${LEAGUE.regularSeasonWeeks})`,
  );
  console.log(`        model spend ${money(cost)}\n`);
}

/** Deterministic FAAB resolution, restricted to the four qualifiers (§14.5). */
async function resolvePool(
  supabase: SupabaseClient,
  seasonId: string,
  nameOf: Map<string, string>,
): Promise<string[]> {
  const { data: bidRows } = await supabase
    .from('waiver_bids')
    .select('id, team_id, add_player_id, drop_player_id, bid')
    .eq('week', LEAGUE.regularSeasonWeeks);
  if (!bidRows || bidRows.length === 0) return ['no bids filed — every survivor stood pat'];

  const context = await buildWeeklyContext(supabase, {
    seasonId,
    season: SEASON,
    week: SEMIFINAL_WEEK,
    memoryType: 'waiver',
  });
  const teams: TeamWaiverState[] = context.teams.map((t) => teamWaiverState(context, t));
  const claims: WaiverClaim[] = bidRows.map((b) => ({
    teamId: b.team_id as string,
    addPlayerId: b.add_player_id as string,
    dropPlayerId: b.drop_player_id as string,
    bid: Number(b.bid),
  }));

  const seeds = await loadStoredSeeds(supabase, seasonId);
  const resolution = resolvePlayoffPool(claims, teams, { qualified: seeds, eliminated: [] });

  const bidIdOf = new Map(bidRows.map((b) => [`${b.team_id}:${b.add_player_id}`, b.id as string]));
  for (const outcome of resolution.outcomes) {
    const id = bidIdOf.get(`${outcome.teamId}:${outcome.addPlayerId}`);
    if (id) {
      await supabase
        .from('waiver_bids')
        .update({ won: outcome.won, losing_reason: outcome.losingReason })
        .eq('id', id);
    }
  }

  for (const o of resolution.outcomes.filter((x) => x.won)) {
    await supabase
      .from('rosters')
      .update({ active: false, dropped_week: SEMIFINAL_WEEK })
      .eq('team_id', o.teamId)
      .eq('player_id', o.dropPlayerId)
      .eq('active', true);
    await supabase.from('rosters').insert({
      team_id: o.teamId,
      player_id: o.addPlayerId,
      acquired_via: 'waiver',
      acquired_week: SEMIFINAL_WEEK,
      faab_paid: o.bid,
      active: true,
    });
  }

  for (const team of resolution.teams) {
    await supabase
      .from('teams')
      .update({ faab_remaining: team.faabRemaining, waiver_priority: team.waiverPriority })
      .eq('id', team.teamId);
  }

  const lines = resolution.outcomes.map(
    (o) =>
      `${nameOf.get(o.teamId)} ${o.won ? 'WON' : 'lost'} ${o.addPlayerId} at $${o.bid}` +
      (o.losingReason ? ` (${o.losingReason})` : ''),
  );
  if (resolution.rejected.length > 0) {
    lines.push(`*** ${resolution.rejected.length} claims from ineligible teams — should be 0 ***`);
  }
  return lines;
}

async function main() {
  const supabase = db();
  const seasonId = await seasonIdFor(supabase, SEASON);
  const commit = commitRequested();

  if (flag('fast-forward')) await fastForward(supabase, seasonId, commit);
  if (flag('playoffs')) await playoffs(supabase, seasonId, commit);
  if (!flag('fast-forward') && !flag('playoffs')) {
    fail('Pick a stage: --fast-forward or --playoffs.');
  }
}

main();
