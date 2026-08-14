/**
 * Scoring one week, and rebuilding the standings that follow from it (SPEC §5.5, §6.1).
 *
 * Shared by both scoring jobs, which differ in exactly two ways: the status they
 * write, and whether a stat-correction diff falls out of it. Everything else — lineup
 * scoring, the optimal-lineup benchmark, all-play, head-to-head, standings — is one
 * code path, because two copies that drift produce a provisional table and a final
 * table that disagree for reasons nobody can explain.
 *
 * SPEC §5.5's rule is never overwrite a published score. `lineup_scores` is keyed
 * `(lineup_id, status)`, so Tuesday's provisional row and Thursday's final row both
 * survive and the difference between them stays publicly checkable.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { LEAGUE, type Position } from '@/lib/config/league';
import { round2 } from '@/lib/scoring/engine';
import { ingestWeeklyStats } from '@/lib/sleeper/ingest';
import {
  evaluateLineup,
  scoreLineup,
  optimalLineup,
  type Lineup,
  type LineupPlayer,
} from '@/lib/engine/lineup';
import { allPlayWeek, h2hWeek, rankStandings, type StandingRow } from '@/lib/engine/allplay';
import { isPlayoffWeek, LAST_LEAGUE_WEEK } from '@/lib/engine/bracket';

export type ScoreStatus = 'provisional' | 'final';

/** The season row's id, or a loud failure — every write below is keyed on it. */
export async function seasonIdFor(db: SupabaseClient, season: number): Promise<string> {
  const { data, error } = await db.from('seasons').select('id').eq('year', season).single();
  if (error) throw new Error(`no season row for ${season}: ${error.message}`);
  return data.id as string;
}

export interface ScoreWeekInput {
  seasonId: string;
  season: number;
  week: number;
  status: ScoreStatus;
  /** Move evaluation runs on the Tuesday pass only — see the note at its call site. */
  evaluateMoves?: boolean;
}

export interface ScoreWeekResult {
  week: number;
  status: ScoreStatus;
  /** Playoff weeks score lineups but do not touch the regular-season standings. */
  playoff: boolean;
  ingest: { scored: number; skippedDefenses: number; backfilled: number; corrections: number };
  teamsScored: number;
  emptySlots: number;
  standings: StandingRow[];
  movesEvaluated: number;
}

interface TeamRow {
  id: string;
  faab_remaining: number | null;
}

export async function scoreWeek(db: SupabaseClient, input: ScoreWeekInput): Promise<ScoreWeekResult> {
  const { seasonId, season, week, status } = input;

  // 1. Pull the week's stats. `final` additionally writes the correction diff.
  const ingest = await ingestWeeklyStats(season, week, status, db);

  // 2. Everything else reads only from our own tables (CLAUDE.md rule 6).
  const teams = await loadTeams(db, seasonId);
  const points = await loadPoints(db, season, week, status);
  const byes = await loadByeTeams(db, season, week);
  const rosters = await loadRosters(db, teams.map((t) => t.id), points, byes);

  let teamsScored = 0;
  let emptySlots = 0;
  let movesEvaluated = 0;

  for (const team of teams) {
    const lineup = await loadLineup(db, team.id, week);
    // No lineup row means the Thursday job never ran for this team. That is a real
    // and publishable failure, not something to paper over with an optimal lineup:
    // scoring the best lineup they never set would hide the miss entirely.
    if (!lineup) continue;

    const roster = rosters.get(team.id) ?? [];
    const scored = scoreLineup(lineup.lineup, points);
    const best = optimalLineup(roster);

    emptySlots += scored.perSlot.filter((s) => s.empty).length;

    const { error } = await db.from('lineup_scores').upsert(
      {
        lineup_id: lineup.id,
        week,
        status,
        total_pts: scored.total,
        per_slot: scored.perSlot,
        optimal_pts: best.total,
        efficiency: best.total === 0 ? 1 : Number((scored.total / best.total).toFixed(4)),
      },
      { onConflict: 'lineup_id,status' },
    );
    if (error) throw new Error(`lineup_scores (team ${team.id}, week ${week}): ${error.message}`);
    teamsScored++;

    if (input.evaluateMoves) {
      const evaluation = evaluateLineup(lineup.lineup, roster);
      const { error: evalError } = await db.from('move_evaluations').upsert(
        {
          team_id: team.id,
          week,
          lineup_efficiency: evaluation.efficiency,
          pts_left_on_bench: evaluation.pointsLeftOnBench,
          flex_delta: evaluation.flexDelta,
          // The remaining columns belong to the waiver and gameplan jobs. Writing a
          // zero here would publish "no waiver value gained" for a week whose waivers
          // simply have not been graded yet.
        },
        { onConflict: 'team_id,week' },
      );
      if (evalError) throw new Error(`move_evaluations (team ${team.id}): ${evalError.message}`);
      movesEvaluated++;
    }
  }

  const standings = await rebuildStandings(db, seasonId, standingsThroughWeek(week));

  return {
    week,
    status,
    playoff: isPlayoffWeek(week),
    ingest,
    teamsScored,
    emptySlots,
    standings,
    movesEvaluated,
  };
}

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------

/**
 * How far the standings run after scoring `week`. The regular season, and no further.
 *
 * Standings are a regular-season table. Accumulating a playoff week through the same
 * path would fold four teams' scores into an eight-team all-play record, hand every
 * survivor another head-to-head win, and MOVE THE RANKING THE BRACKET WAS SEEDED FROM
 * — retroactively changing who should have been playing that very week. The bracket's
 * results live in `lineup_scores`, and `buildBracket` derives them against the frozen
 * week-14 order.
 *
 * Named and exported rather than inlined because the whole property is one `Math.min`
 * at one call site, which is exactly the kind of line a later edit drops.
 */
export function standingsThroughWeek(week: number): number {
  return Math.min(week, LEAGUE.regularSeasonWeeks);
}

/**
 * Recompute weeks 1..throughWeek from stored lineup scores rather than incrementing
 * last week's row.
 *
 * Costs nothing at this size (8 teams × 14 weeks) and buys the property that matters:
 * a Thursday stat correction to week 3 propagates into every later cumulative total
 * automatically. An incremental standings table would keep the corrected week and the
 * stale cumulative side by side forever.
 */
export async function rebuildStandings(
  db: SupabaseClient,
  seasonId: string,
  throughWeek: number,
): Promise<StandingRow[]> {
  const teams = await loadTeams(db, seasonId);
  const weekly = await loadWeeklyTotals(db, teams.map((t) => t.id), throughWeek);

  const { data: schedule, error } = await db
    .from('h2h_schedule')
    .select('week, home_team_id, away_team_id')
    .eq('season_id', seasonId)
    .lte('week', throughWeek);
  if (error) throw new Error(`h2h_schedule: ${error.message}`);

  const { rows, standings } = accumulateStandings({
    teams: teams.map((t) => ({ teamId: t.id, faabRemaining: t.faab_remaining })),
    weekly,
    matchups: (schedule ?? []).map((m) => ({
      week: m.week as number,
      homeTeamId: m.home_team_id as string,
      awayTeamId: m.away_team_id as string,
    })),
    throughWeek,
  });

  if (rows.length > 0) {
    const { error: upsertError } = await db.from('standings').upsert(rows, { onConflict: 'team_id,week' });
    if (upsertError) throw new Error(`standings: ${upsertError.message}`);
  }

  return standings;
}

export interface AccumulateInput {
  teams: { teamId: string; faabRemaining: number | null }[];
  /** teamId → week → that week's scored total. */
  weekly: Map<string, Map<number, WeeklyTotal>>;
  matchups: { week: number; homeTeamId: string; awayTeamId: string }[];
  throughWeek: number;
}

/**
 * The whole standings computation, with no database in it.
 *
 * Pulled out as a pure function because this is where the season's official order
 * comes from, and an off-by-one in the cumulative carry would be invisible in
 * production until it had already been published for several weeks.
 */
export function accumulateStandings(input: AccumulateInput): {
  rows: Record<string, unknown>[];
  standings: StandingRow[];
} {
  const { teams, weekly, matchups, throughWeek } = input;

  const cum = new Map(
    teams.map((t) => [t.teamId, { allplayW: 0, allplayL: 0, h2hW: 0, h2hL: 0, h2hT: 0, pts: 0 }]),
  );
  const rows: Record<string, unknown>[] = [];

  for (let week = 1; week <= throughWeek; week++) {
    const scored = teams
      .map((t) => ({ teamId: t.teamId, entry: weekly.get(t.teamId)?.get(week) }))
      .filter((s): s is { teamId: string; entry: WeeklyTotal } => s.entry !== undefined);

    // A week nobody has scored yet contributes nothing — it is not a week of zeros.
    if (scored.length === 0) continue;

    const weekScores = scored.map((s) => ({ teamId: s.teamId, points: s.entry.total }));
    const perWeekAllPlay = allPlayWeek(weekScores);

    for (const record of perWeekAllPlay) {
      const c = cum.get(record.teamId)!;
      c.allplayW += record.wins;
      c.allplayL += record.losses;
    }

    const games = matchups.filter((m) => m.week === week);
    for (const [teamId, outcome] of h2hWeek(games, weekScores)) {
      const c = cum.get(teamId)!;
      if (outcome === 'W') c.h2hW++;
      else if (outcome === 'L') c.h2hL++;
      else c.h2hT++;
    }

    for (const s of scored) cum.get(s.teamId)!.pts += s.entry.total;

    // Snapshot the cumulative state as it stood after this week.
    for (const s of scored) {
      const c = cum.get(s.teamId)!;
      const perWeek = perWeekAllPlay.find((r) => r.teamId === s.teamId)!;
      rows.push({
        team_id: s.teamId,
        week,
        allplay_w: perWeek.wins,
        allplay_l: perWeek.losses,
        cum_allplay_w: c.allplayW,
        cum_allplay_l: c.allplayL,
        h2h_w: c.h2hW,
        h2h_l: c.h2hL,
        h2h_t: c.h2hT,
        week_pts: s.entry.total,
        cum_pts: round2(c.pts),
        k_pts: s.entry.kickerPts,
      });
    }
  }

  const standings = rankStandings(
    teams.map((t) => {
      const c = cum.get(t.teamId)!;
      return {
        teamId: t.teamId,
        h2hW: c.h2hW,
        h2hL: c.h2hL,
        h2hT: c.h2hT,
        allplayW: c.allplayW,
        allplayL: c.allplayL,
        cumPts: c.pts,
      };
    }),
  );

  // Rank and FAAB belong to the latest week's row only — an earlier week's rank is
  // whatever it was at the time, and recomputing it from today's data would rewrite
  // history rather than record it.
  const rankOf = new Map(standings.map((s) => [s.teamId, s.rank]));
  const faabOf = new Map(teams.map((t) => [t.teamId, t.faabRemaining]));
  for (const row of rows) {
    if (row.week === throughWeek) {
      row.rank = rankOf.get(row.team_id as string) ?? null;
      row.faab_remaining = faabOf.get(row.team_id as string) ?? null;
    }
  }

  return { rows, standings };
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

async function loadTeams(db: SupabaseClient, seasonId: string): Promise<TeamRow[]> {
  const { data, error } = await db
    .from('teams')
    .select('id, faab_remaining')
    .eq('season_id', seasonId);
  if (error) throw new Error(`teams: ${error.message}`);
  return (data ?? []) as TeamRow[];
}

/**
 * Actual points for the week, keyed by player.
 *
 * A `final` pass reads final rows but falls back to the provisional value where
 * Sleeper did not re-emit a player. Without the fallback a player present on Tuesday
 * and absent on Thursday silently scores 0 in the official table — which looks
 * exactly like a bad week rather than like missing data.
 */
async function loadPoints(
  db: SupabaseClient,
  season: number,
  week: number,
  status: ScoreStatus,
): Promise<Map<string, number>> {
  const provisional = new Map<string, number>();
  const final = new Map<string, number>();

  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('player_stats')
      .select('player_id, computed_pts, status')
      .eq('season', season)
      .eq('week', week)
      .range(from, from + 999);
    if (error) throw new Error(`player_stats: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      const target = row.status === 'final' ? final : provisional;
      target.set(row.player_id as string, Number(row.computed_pts));
    }
    if (data.length < 1000) break;
  }

  if (status === 'provisional') return provisional;
  return new Map([...provisional, ...final]);
}

async function loadByeTeams(db: SupabaseClient, season: number, week: number): Promise<Set<string>> {
  const { data, error } = await db
    .from('team_byes')
    .select('nfl_team')
    .eq('season', season)
    .eq('week', week);
  if (error) throw new Error(`team_byes: ${error.message}`);
  return new Set((data ?? []).map((r) => r.nfl_team as string));
}

async function loadRosters(
  db: SupabaseClient,
  teamIds: string[],
  points: Map<string, number>,
  byeTeams: Set<string>,
): Promise<Map<string, LineupPlayer[]>> {
  const { data, error } = await db
    .from('rosters')
    .select('team_id, player_id, players!inner(position, nfl_team)')
    .in('team_id', teamIds)
    .eq('active', true);
  if (error) throw new Error(`rosters: ${error.message}`);

  const out = new Map<string, LineupPlayer[]>();
  for (const row of data ?? []) {
    const player = row.players as unknown as { position: Position; nfl_team: string | null };
    const list = out.get(row.team_id as string) ?? [];
    list.push({
      playerId: row.player_id as string,
      position: player.position,
      points: points.get(row.player_id as string) ?? 0,
      // Matters for the optimal-lineup DENOMINATOR: a bye player is not a lineup a
      // model could have set, so counting them would grade teams against an
      // unreachable benchmark.
      isOnBye: player.nfl_team ? byeTeams.has(player.nfl_team) : false,
    });
    out.set(row.team_id as string, list);
  }
  return out;
}

async function loadLineup(
  db: SupabaseClient,
  teamId: string,
  week: number,
): Promise<{ id: string; lineup: Lineup } | null> {
  const { data, error } = await db
    .from('lineups')
    .select('id, qb, rb, wr, te, flex, k, def')
    .eq('team_id', teamId)
    .eq('week', week)
    .maybeSingle();
  if (error) throw new Error(`lineups: ${error.message}`);
  if (!data) return null;

  return {
    id: data.id as string,
    lineup: {
      qb: data.qb as string | null,
      rb: (data.rb ?? []) as string[],
      wr: (data.wr ?? []) as string[],
      te: data.te as string | null,
      flex: data.flex as string | null,
      k: data.k as string | null,
      def: data.def as string | null,
    },
  };
}

export interface WeeklyTotal {
  total: number;
  kickerPts: number;
}

/**
 * Best available score per team per week: final where it exists, else provisional.
 *
 * Exported because the bracket needs exactly this and a second copy of "final beats
 * provisional" is a copy that eventually disagrees about who won a semifinal.
 */
export async function loadWeeklyTotals(
  db: SupabaseClient,
  teamIds: string[],
  throughWeek: number,
): Promise<Map<string, Map<number, WeeklyTotal>>> {
  const { data, error } = await db
    .from('lineup_scores')
    .select('week, status, total_pts, per_slot, lineups!inner(team_id)')
    .lte('week', throughWeek)
    .in('lineups.team_id', teamIds);
  if (error) throw new Error(`lineup_scores: ${error.message}`);

  const out = new Map<string, Map<number, WeeklyTotal>>();
  const seenStatus = new Map<string, string>();

  for (const row of data ?? []) {
    const teamId = (row.lineups as unknown as { team_id: string }).team_id;
    const week = row.week as number;
    const key = `${teamId}:${week}`;

    // Final always wins; provisional only fills a gap.
    if (seenStatus.get(key) === 'final' && row.status !== 'final') continue;
    seenStatus.set(key, row.status as string);

    const perSlot = (row.per_slot ?? []) as { slot: string; points: number }[];
    const byWeek = out.get(teamId) ?? new Map<number, WeeklyTotal>();
    byWeek.set(week, {
      total: Number(row.total_pts),
      kickerPts: round2(
        perSlot.filter((s) => s.slot === 'K').reduce((sum, s) => sum + Number(s.points ?? 0), 0),
      ),
    });
    out.set(teamId, byWeek);
  }
  return out;
}

/**
 * Which week a scoring job should operate on.
 *
 * Derived from the ingested schedule, not from date arithmetic against a hardcoded
 * season start. Cron paths cannot carry a query string (Vercel distinguishes
 * schedules by header), so the job has to work this out for itself — and the
 * arithmetic version breaks on exactly the weeks that matter: the international
 * games, the Thanksgiving slate, and the 1 November DST shift mid-Week 9.
 *
 * The answer is the latest week whose first kickoff has already happened. On the
 * Tuesday and Thursday after a slate, that is the week just played.
 *
 * Bounded by the last PLAYOFF week. Capped at 14 this returned 14 forever from mid
 * December onwards, so the semifinals and the final would never have been scored and
 * the season's result would have been the week-14 standings.
 */
export async function resolveScoringWeek(
  db: SupabaseClient,
  season: number,
  now = new Date(),
): Promise<number | null> {
  const { data, error } = await db
    .from('nfl_games')
    .select('week')
    .eq('season', season)
    .lte('week', LAST_LEAGUE_WEEK)
    .lt('kickoff_at', now.toISOString())
    .order('week', { ascending: false })
    .limit(1);
  if (error) throw new Error(`nfl_games: ${error.message}`);

  const week = data?.[0]?.week as number | undefined;
  return week ?? null;
}
