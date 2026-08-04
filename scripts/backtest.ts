/**
 * Phase 4 — the 2025 backtest (SPEC §9).
 *
 *   npx tsx --env-file=.env.local scripts/backtest.ts --ingest    # ~90s, no model calls
 *   npx tsx --env-file=.env.local scripts/backtest.ts --verify    # deterministic, free
 *   npx tsx --env-file=.env.local scripts/backtest.ts --auction   # 8 model calls, ~$0.20
 *
 * The gate this exists to satisfy: "Scoring math verified; auction shows bid
 * dispersion." The draft is one-shot and irreversible, so every part of the engine
 * that a bad number could poison gets exercised against a season whose answers are
 * already known.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { COHORT, LEAGUE } from '@/lib/config/league';
import { FANTASY_POSITIONS, fetchSeasonStats } from '@/lib/sleeper/client';
import { ingestProjections, ingestWeeklyStats } from '@/lib/sleeper/ingest';
import { slotPickNumbers } from '@/lib/engine/draft';
import { auctionDiscriminates, resolveAuction, type AuctionEntry } from '@/lib/engine/auction';
import { callModel } from '@/lib/openrouter/client';
import { assemblePrompt, assertSharedContext } from '@/lib/prompt/assemble';
import { auctionSchema } from '@/lib/schemas/decisions';
import {
  defenceBandIsPerGame,
  runSpotChecks,
  verifyWeeklyAgainstSeason,
  type SeasonRow,
  type WeeklyRow,
} from '@/lib/backtest/verify-scoring';
import type { Position } from '@/lib/config/league';
import { rulebook } from '@/lib/prompt/rulebook';
import { commitHash } from '@/lib/engine/rng';
import { generateH2HSchedule } from '@/lib/engine/schedule';
import { buildLabelMap } from '@/lib/engine/labels';
import { runDecision } from '@/lib/decisions/run';
import { optimalLineup, type LineupPlayer } from '@/lib/engine/lineup';
import { allPlayWeek, h2hWeek, rankStandings } from '@/lib/engine/allplay';
import {
  availableFor,
  commitPick,
  draftSchedule,
  nextPickNumber,
  runPick,
  type DraftState,
  type DraftTeam,
} from '@/lib/engine/draft-runner';

const SEASON = 2025;
/**
 * The LEAGUE runs weeks 1-14, but scoring verification must cover the FULL regular
 * season: Sleeper's season totals span all 18 weeks, so comparing them against a
 * 14-week sum would show a deficit for every player and look exactly like a scoring
 * bug. (It did, on the first run.)
 */
const VERIFY_WEEKS = 18;

function db(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

const flag = (name: string) => process.argv.includes(`--${name}`);

// ---------------------------------------------------------------------------
// Stage 1 — ingest the completed season
// ---------------------------------------------------------------------------

async function stageIngest() {
  console.log(`Ingesting ${SEASON}: projections, then weeks 1-${VERIFY_WEEKS}.\n`);

  const projections = await ingestProjections(SEASON);
  console.log(`  projections  ${projections.projections} rows, ${projections.withAdp} with ADP`);

  for (let week = 1; week <= VERIFY_WEEKS; week++) {
    const result = await ingestWeeklyStats(SEASON, week, 'final');
    process.stdout.write(`  week ${String(week).padStart(2)}     ${result.scored} scored`);
    if (result.backfilled > 0) process.stdout.write(`, ${result.backfilled} players backfilled`);
    if (result.skippedDefenses > 0) process.stdout.write(`, ${result.skippedDefenses} DEF skipped`);
    process.stdout.write('\n');
  }
}

// ---------------------------------------------------------------------------
// Stage 2 — verify the scoring math
// ---------------------------------------------------------------------------

async function stageVerify() {
  const supabase = db();
  console.log(`Verifying the scoring engine against completed ${SEASON} results.\n`);

  // Weekly rows we computed at ingest.
  const weekly: WeeklyRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('player_stats')
      .select('player_id, week, raw_stats, computed_pts')
      .eq('season', SEASON)
      .range(from, from + 999);
    if (error) throw new Error(`player_stats: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      weekly.push({
        playerId: row.player_id as string,
        week: row.week as number,
        stats: row.raw_stats as Record<string, unknown>,
        computedPts: Number(row.computed_pts),
      });
    }
    if (data.length < 1000) break;
  }
  console.log(`  loaded ${weekly.length} weekly stat lines`);

  // Season totals, fetched fresh — a different payload from a different endpoint.
  const seasonTotals: SeasonRow[] = [];
  for (const position of FANTASY_POSITIONS) {
    const result = await fetchSeasonStats(SEASON, position);
    for (const rec of result.data) {
      seasonTotals.push({
        playerId: rec.player_id,
        position: position as Position,
        name: [rec.player?.first_name, rec.player?.last_name].filter(Boolean).join(' ') || rec.player_id,
        stats: rec.stats ?? {},
      });
    }
  }
  console.log(`  loaded ${seasonTotals.length} season totals\n`);

  const result = verifyWeeklyAgainstSeason(weekly, seasonTotals);
  console.log(`  Weekly-sum vs season-total, offensive players:`);
  console.log(`    compared ${result.compared}, matched ${result.matched}, worst delta ${result.worstDelta.toFixed(2)}`);

  if (result.discrepancies.length > 0) {
    console.log(`\n    ${result.discrepancies.length} disagreements — top 10:`);
    for (const d of result.discrepancies.slice(0, 10)) {
      console.log(
        `      ${d.name.padEnd(24)} ${d.position}  weeks=${String(d.weeks).padStart(2)}  ` +
          `sum ${d.weeklySum.toFixed(2)} vs total ${d.seasonTotal.toFixed(2)}  delta ${d.delta.toFixed(2)}`,
      );
    }
  }

  // The DEF band must NOT be linear in the season total.
  const band = defenceBandIsPerGame();
  console.log(
    `\n  DEF points-allowed band is per-game (asserted): 17 weeks at 20 allowed = ` +
      `${band.weekly} pts, vs banding the 340 season total = ${band.seasonTotal} pts`,
  );

  // Whole-table errors that internal consistency cannot catch.
  const spot = runSpotChecks([
    { label: '6 rec, 82 yds, 1 TD (rulebook example)', position: 'WR', stats: { rec: 6, rec_yd: 82, rec_td: 1 }, expected: 20.2 },
    { label: '300 pass yds, 2 TD, 1 INT', position: 'QB', stats: { pass_yd: 300, pass_td: 2, pass_int: 1 }, expected: 19 },
    { label: '100 rush yds, 1 TD, 1 fumble lost', position: 'RB', stats: { rush_yd: 100, rush_td: 1, fum_lost: 1 }, expected: 14 },
    { label: '3 FG (one 45yd), 2 XP', position: 'K', stats: { fgm: 3, fgm_40_49: 1, xpm: 2 }, expected: 12 },
    { label: 'DEF: 4 sacks, 1 INT, 10 allowed', position: 'DEF', stats: { sack: 4, int: 1, pts_allow: 10 }, expected: 10 },
    { label: 'one kick-return TD, league-wide', position: 'DEF', stats: { def_st_td: 1, pts_allow: 24 }, expected: 6 },
  ]);

  console.log('\n  Spot checks against hand-computed values:');
  for (const check of spot) {
    console.log(`    ${check.ok ? '✓' : '✗'} ${check.label.padEnd(40)} ${check.actual} (expected ${check.expected})`);
  }

  const allOk = spot.every((c) => c.ok) && result.discrepancies.length === 0;
  console.log(
    allOk
      ? '\n  Scoring math VERIFIED.'
      : '\n  *** Scoring math NOT verified. Do not draft until this is clean. ***',
  );
  if (!allOk) process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// Stage 3 — the auction, against real 2025 pre-season data
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

async function stageAuction() {
  const supabase = db();
  const { seasonId, teams } = await seasonAndTeams(supabase);

  const { data: board, error } = await supabase
    .from('player_projections')
    .select('player_id, proj_pts, adp, players!inner(name, position)')
    .eq('season', SEASON)
    // Season-long rows only — per-WEEK projections now share this table.
    .is('week', null)
    .not('adp', 'is', null)
    .order('adp', { ascending: true })
    .limit(60);
  if (error) throw new Error(`board: ${error.message}`);

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

  console.log(`Slot auction against ${SEASON} pre-season data.`);
  console.log(`  ${topAvailable.length} players on the board\n`);

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
        task:
          'Bid for your draft slot and rank all 8 slots in preference order. Your bid is deducted ' +
          'from the single budget that also funds every waiver claim you will make this season.',
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
      console.log(`        finish_reason=${record.call.finishReason}  out=${record.call.usage.tokensOut} reasoning=${record.call.usage.reasoningTokens}`);
      console.log(`        ${record.call.validationError?.slice(0, 160)}`);
      entries.push({ teamId: team.id, bid: null, slotPreference: null });
      continue;
    }

    const { bid, slot_preference, headline, confidence } = record.parsed;
    entries.push({ teamId: team.id, bid, slotPreference: slot_preference });
    console.log(`  $${String(bid).padStart(3)}  slot pref ${slot_preference.join('')}  conf ${confidence.toFixed(2)}  ${team.models.display_name}`);
    console.log(`        "${headline}"`);
  }

  assertSharedContext(hashes, 'backtest auction');

  const result = resolveAuction(entries, BACKTEST_SEED);
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
    if (bidError) throw new Error(`auction_bids: ${bidError.message}`);

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
    if (teamError) throw new Error(`teams update: ${teamError.message}`);
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
  console.log(`  Total cost: $${cost.toFixed(4)}`);
  console.log(gate.ok ? `\n  GATE MET — ${gate.reason}` : `\n  *** GATE NOT MET — ${gate.reason}`);
  if (!gate.ok) process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// Stage 2b — seed a 2025 league so the backtest uses the REAL tables
// ---------------------------------------------------------------------------

const BACKTEST_SEED = `backtest-${SEASON}`;

async function seasonAndTeams(supabase: SupabaseClient) {
  const { data: season, error } = await supabase.from('seasons').select('id').eq('year', SEASON).single();
  if (error) throw new Error(`no ${SEASON} season — run --seed first`);
  const { data: teams, error: teamError } = await supabase
    .from('teams')
    .select('id, model_id, draft_slot, auction_bid, faab_remaining, models!inner(openrouter_id, display_name)')
    .eq('season_id', season.id);
  if (teamError) throw new Error(`teams: ${teamError.message}`);
  return { seasonId: season.id as string, teams: teams as unknown as BacktestTeam[] };
}

interface BacktestTeam {
  id: string;
  model_id: string;
  draft_slot: number | null;
  auction_bid: number | null;
  faab_remaining: number | null;
  models: { openrouter_id: string; display_name: string };
}

async function stageSeed() {
  const supabase = db();

  const { data: models } = await supabase.from('models').select('id, key');
  if (!models || models.length === 0) throw new Error('no models — run scripts/seed.ts first');

  const { error } = await supabase.from('seasons').upsert(
    {
      year: SEASON,
      scoring_config: LEAGUE.scoring as unknown as Record<string, unknown>,
      rulebook_version: 'rulebook-v2-backtest',
      rulebook_text: rulebook(),
      budget_total: LEAGUE.budgetTotal,
      seed_commit_hash: commitHash(BACKTEST_SEED),
    },
    { onConflict: 'year' },
  );
  if (error) throw new Error(`seasons: ${error.message}`);

  const { data: season } = await supabase.from('seasons').select('id').eq('year', SEASON).single();

  const { error: teamError } = await supabase.from('teams').upsert(
    models.map((m) => ({ season_id: season!.id, model_id: m.id, faab_remaining: LEAGUE.budgetTotal })),
    { onConflict: 'season_id,model_id' },
  );
  if (teamError) throw new Error(`teams: ${teamError.message}`);

  const { data: teams } = await supabase.from('teams').select('id').eq('season_id', season!.id);
  const { count } = await supabase
    .from('h2h_schedule').select('*', { count: 'exact', head: true }).eq('season_id', season!.id);

  if (!count) {
    const matchups = generateH2HSchedule(teams!.map((t) => t.id as string), BACKTEST_SEED);
    await supabase.from('h2h_schedule').insert(
      matchups.map((m) => ({ season_id: season!.id, week: m.week, home_team_id: m.homeTeamId, away_team_id: m.awayTeamId })),
    );
  }
  console.log(`Backtest league seeded for ${SEASON}: ${teams!.length} teams, schedule ready.`);
}

// ---------------------------------------------------------------------------
// Stage 4 — the draft, 120 picks, resumable
// ---------------------------------------------------------------------------

async function loadDraftState(supabase: SupabaseClient): Promise<DraftState> {
  const { seasonId, teams } = await seasonAndTeams(supabase);
  if (teams.some((t) => t.draft_slot === null)) throw new Error('draft slots unassigned — run --auction first');

  const labels = buildLabelMap(teams.map((t) => ({ teamId: t.id, draftSlot: t.draft_slot! })));
  const draftTeams: DraftTeam[] = teams.map((t) => ({
    teamId: t.id,
    modelId: t.model_id,
    openrouterId: t.models.openrouter_id,
    displayName: t.models.display_name,
    draftSlot: t.draft_slot!,
    label: labels.get(t.id)!,
  }));

  const pool: DraftState['pool'] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase
      .from('player_projections')
      .select('player_id, proj_pts, adp, players!inner(name, position)')
      .eq('season', SEASON)
      // Season-long rows only. Without this, an ingested week would put every player
      // into the draft pool once per week and silently corrupt the rehearsal.
      .is('week', null)
      .order('proj_pts', { ascending: false })
      .range(from, from + 999);
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
    if (pool.length >= 400) break;
  }

  const { data: picks } = await supabase
    .from('draft_picks')
    .select('pick_overall, round, team_id, player_id, players!inner(name, position)')
    .eq('season_id', seasonId)
    .order('pick_overall');

  return {
    seasonId,
    season: SEASON,
    teams: draftTeams,
    pool,
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

async function stageDraft() {
  const supabase = db();
  const state = await loadDraftState(supabase);
  const schedule = draftSchedule(state.teams);
  const total = schedule.length;

  const limitArg = process.argv.indexOf('--picks');
  const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : total;

  console.log(`Draft: ${state.picks.length}/${total} picks already made, pool ${state.pool.length} players.`);
  console.log(`Running up to ${limit} picks.\n`);

  let cost = 0;
  let fallbacks = 0;
  let done = 0;

  while (done < limit) {
    const next = nextPickNumber(state);
    if (next > total) break;
    const slot = schedule[next - 1];

    const result = await runPick(state, supabase, slot.round, next, slot.team);
    await commitPick(state, supabase, result);
    cost += result.costUsd;
    if (result.fallbackApplied) fallbacks++;
    done++;

    const tag = result.fallbackApplied ? ' [FALLBACK]' : result.narrowed ? ' [narrowed]' : '';
    console.log(
      `  ${String(next).padStart(3)}/${total} R${String(result.round).padStart(2)} ${result.team.label} ` +
        `${result.team.displayName.padEnd(16)} ${result.player.name} (${result.player.position})${tag}`,
    );
    if (result.headline) console.log(`         "${result.headline}"`);
  }

  console.log(`\n  ${state.picks.length}/${total} picks complete, ${fallbacks} fallbacks, $${cost.toFixed(4)} this run.`);
  if (availableFor(state).length === 0) console.log('  pool exhausted');
}

// ---------------------------------------------------------------------------
// Stage 5 — score the drafted rosters against what actually happened
// ---------------------------------------------------------------------------

async function stageScore() {
  const supabase = db();
  const { seasonId, teams } = await seasonAndTeams(supabase);
  const labels = buildLabelMap(teams.map((t) => ({ teamId: t.id, draftSlot: t.draft_slot! })));

  const { data: rosterRows } = await supabase
    .from('rosters')
    .select('team_id, player_id, players!inner(name, position)')
    .in('team_id', teams.map((t) => t.id));

  const rosters = new Map<string, { playerId: string; position: Position }[]>();
  for (const row of rosterRows ?? []) {
    const p = row.players as unknown as { position: Position };
    const list = rosters.get(row.team_id as string) ?? [];
    list.push({ playerId: row.player_id as string, position: p.position });
    rosters.set(row.team_id as string, list);
  }

  // Actual points, by player, by week.
  const points = new Map<string, Map<number, number>>();
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase
      .from('player_stats')
      .select('player_id, week, computed_pts')
      .eq('season', SEASON)
      .lte('week', LEAGUE.regularSeasonWeeks)
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    for (const row of data) {
      const byWeek = points.get(row.player_id as string) ?? new Map<number, number>();
      byWeek.set(row.week as number, Number(row.computed_pts));
      points.set(row.player_id as string, byWeek);
    }
    if (data.length < 1000) break;
  }

  const { data: schedule } = await supabase
    .from('h2h_schedule').select('week, home_team_id, away_team_id').eq('season_id', seasonId);

  const totals = new Map<string, number>();
  const allplay = new Map<string, { w: number; l: number }>();
  const h2h = new Map<string, { w: number; l: number; t: number }>();
  for (const t of teams) {
    totals.set(t.id, 0);
    allplay.set(t.id, { w: 0, l: 0 });
    h2h.set(t.id, { w: 0, l: 0, t: 0 });
  }

  for (let week = 1; week <= LEAGUE.regularSeasonWeeks; week++) {
    const weekScores = teams.map((t) => {
      const roster: LineupPlayer[] = (rosters.get(t.id) ?? []).map((p) => ({
        playerId: p.playerId,
        position: p.position,
        points: points.get(p.playerId)?.get(week) ?? 0,
      }));
      // Optimal lineup isolates ROSTER quality from lineup-setting skill, which no
      // model exercised here — nobody set a lineup in this backtest.
      return { teamId: t.id, points: optimalLineup(roster).total };
    });

    for (const s of weekScores) totals.set(s.teamId, (totals.get(s.teamId) ?? 0) + s.points);
    for (const rec of allPlayWeek(weekScores)) {
      const a = allplay.get(rec.teamId)!;
      a.w += rec.wins;
      a.l += rec.losses;
    }
    const weekGames = (schedule ?? []).filter((m) => m.week === week);
    for (const [teamId, outcome] of h2hWeek(
      weekGames.map((m) => ({ homeTeamId: m.home_team_id as string, awayTeamId: m.away_team_id as string })),
      weekScores,
    )) {
      const r = h2h.get(teamId)!;
      if (outcome === 'W') r.w++;
      else if (outcome === 'L') r.l++;
      else r.t++;
    }
  }

  const standings = rankStandings(
    teams.map((t) => ({
      teamId: t.id,
      h2hW: h2h.get(t.id)!.w,
      h2hL: h2h.get(t.id)!.l,
      h2hT: h2h.get(t.id)!.t,
      allplayW: allplay.get(t.id)!.w,
      allplayL: allplay.get(t.id)!.l,
      cumPts: totals.get(t.id) ?? 0,
    })),
  );

  const byId = new Map(teams.map((t) => [t.id, t]));
  console.log(`\n${SEASON} backtest results — optimal lineups, weeks 1-${LEAGUE.regularSeasonWeeks}\n`);
  console.log('  rk  team              label  slot  bid  points   H2H     all-play');
  for (const row of standings) {
    const t = byId.get(row.teamId)!;
    console.log(
      `  ${String(row.rank).padStart(2)}  ${t.models.display_name.padEnd(16)} ${labels.get(t.id)!.slice(5)}` +
        `      ${String(t.draft_slot).padStart(2)}  $${String(t.auction_bid ?? 0).padStart(3)}  ` +
        `${row.cumPts.toFixed(1).padStart(7)}  ${row.h2hW}-${row.h2hL}${row.h2hT ? '-' + row.h2hT : ''}` +
        `   ${row.allplayW}-${row.allplayL}`,
    );
  }

  // Did paying for a slot pay off?
  const withBids = teams.filter((t) => t.auction_bid !== null);
  if (withBids.length > 0) {
    const paired = withBids.map((t) => ({
      bid: t.auction_bid!,
      pts: totals.get(t.id) ?? 0,
    }));
    const meanBid = paired.reduce((s, p) => s + p.bid, 0) / paired.length;
    const meanPts = paired.reduce((s, p) => s + p.pts, 0) / paired.length;
    const cov = paired.reduce((s, p) => s + (p.bid - meanBid) * (p.pts - meanPts), 0) / paired.length;
    const sdBid = Math.sqrt(paired.reduce((s, p) => s + (p.bid - meanBid) ** 2, 0) / paired.length);
    const sdPts = Math.sqrt(paired.reduce((s, p) => s + (p.pts - meanPts) ** 2, 0) / paired.length);
    const r = sdBid && sdPts ? cov / (sdBid * sdPts) : 0;
    console.log(`\n  Auction bid vs season points: r = ${r.toFixed(3)}`);
    console.log(
      r > 0.3
        ? '  Paying for slot correlated with a better roster.'
        : r < -0.3
          ? '  Paying for slot correlated with a WORSE roster — the low bidders were right.'
          : '  No meaningful relationship — slot value is close to noise, as SPEC §4.2 measured.',
    );
  }
}

async function main() {
  const any = flag('ingest') || flag('verify') || flag('seed') || flag('auction') || flag('draft') || flag('score');
  if (!any) {
    console.log('Pick a stage: --ingest, --verify, --seed, --auction, --draft, --score');
    return;
  }
  if (flag('ingest')) await stageIngest();
  if (flag('verify')) await stageVerify();
  if (flag('seed')) await stageSeed();
  if (flag('auction')) await stageAuction();
  if (flag('draft')) await stageDraft();
  if (flag('score')) await stageScore();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
