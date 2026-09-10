/**
 * Scoring a week WHILE it is being played.
 *
 * This exists for one reader: somebody who opens the site on Sunday afternoon. The
 * official scoring jobs run on Tuesday and Thursday, which is right — a week is not a
 * result until it is over — but it left the site saying nothing at all for roughly
 * forty hours after the Sunday slate ended, which is the exact window in which anybody
 * actually cares.
 *
 * THE PROPERTY THAT MATTERS: nothing in here can change a result.
 *
 * It writes to `live_scores` and to no other table. It reads the locked lineups and
 * scores them with the same `scoreLineup` the official pass uses — so the numbers agree
 * with Tuesday's rather than being a second opinion — but it never writes a
 * `player_stats` row, never writes a `lineup_scores` row, never touches `standings`,
 * and never calls a model. See the header of `0011_live_scores.sql` for the trap that
 * shaped this: a third `status` on `player_stats` would have been read as `provisional`
 * by three separate consumers, one of which publishes the stat-correction diff.
 *
 * Safe to deliver twice, like the other scoring routes: no model is called, the write
 * is an upsert on a natural key, and a duplicate delivery re-derives the same numbers a
 * few minutes later. It therefore takes no `job_runs` claim.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { FANTASY_POSITIONS, fetchWeeklyStats } from '@/lib/sleeper/client';
import { scorePlayerWeek } from '@/lib/scoring/engine';
import { scoreLineup, type Lineup } from '@/lib/engine/lineup';
import { completedWeek } from '@/lib/scoring/week';
import { LAST_LEAGUE_WEEK } from '@/lib/engine/bracket';

export interface LiveTeamScore {
  teamId: string;
  total: number;
  startersPlayed: number;
  startersTotal: number;
}

export interface LiveWeekResult {
  week: number;
  teams: LiveTeamScore[];
  /** Players Sleeper returned a line for, across the whole league. */
  statLines: number;
  skippedDefenses: number;
  computedAt: string;
}

/**
 * Which week is worth showing live scores for, or null.
 *
 * Three conditions, and the third is the one that keeps this feature in its lane:
 *
 *   1. the league has acted on it — a lineup row exists, so there is something to score;
 *   2. it has kicked off, because a live score before kickoff is eight zeroes;
 *   3. it has NOT been officially scored yet.
 *
 * (3) is deliberately the stopping condition rather than "the week is over". The last
 * refresh after Monday night lands about eleven hours before Tuesday's job, so the
 * complete week is on the site overnight instead of the site being blank until 10am —
 * and the moment the real numbers exist, these stop being written and the site reads
 * `lineup_scores` like it always did. Two tables never disagree in public, because only
 * one of them is ever being shown.
 */
export async function resolveLiveWeek(
  db: SupabaseClient,
  seasonId: string,
  season: number,
  now = new Date(),
): Promise<number | null> {
  const { data: teamRows, error: teamError } = await db
    .from('teams')
    .select('id')
    .eq('season_id', seasonId);
  if (teamError) throw new Error(`teams: ${teamError.message}`);
  const teamIds = (teamRows ?? []).map((t) => t.id as string);
  if (teamIds.length === 0) return null;

  const { data: acted, error: lineupError } = await db
    .from('lineups')
    .select('id, week')
    .in('team_id', teamIds)
    .lte('week', LAST_LEAGUE_WEEK)
    .order('week', { ascending: false });
  if (lineupError) throw new Error(`lineups: ${lineupError.message}`);
  if (!acted || acted.length === 0) return null;

  const week = acted[0].week as number;

  // (3) Already scored for real? Then there is nothing for this job to add.
  const lineupIds = acted.filter((r) => r.week === week).map((r) => r.id as string);
  const { data: official, error: scoreError } = await db
    .from('lineup_scores')
    .select('id')
    .in('lineup_id', lineupIds)
    .limit(1);
  if (scoreError) throw new Error(`lineup_scores: ${scoreError.message}`);
  if ((official ?? []).length > 0) return null;

  // (2) Kicked off? Read every game of the week rather than the first, because
  // `kickoff_at` is MODELLED from a date (see src/lib/sleeper/kickoff.ts) and the
  // earliest one is the only one we can assert has happened.
  const { data: games, error: gameError } = await db
    .from('nfl_games')
    .select('kickoff_at')
    .eq('season', season)
    .eq('season_type', 'regular')
    .eq('week', week)
    .not('kickoff_at', 'is', null)
    .order('kickoff_at', { ascending: true })
    .limit(1);
  if (gameError) throw new Error(`nfl_games: ${gameError.message}`);

  const firstKickoff = games?.[0]?.kickoff_at as string | undefined;
  if (!firstKickoff) return null;
  if (new Date(firstKickoff) > now) return null;

  return week;
}

/**
 * Fetch the week's stats and score the eight locked lineups against them.
 *
 * The per-player numbers are built in memory and thrown away. That is the whole
 * isolation story in one sentence, and it is why this function takes no `status`.
 */
export async function scoreLiveWeek(
  db: SupabaseClient,
  input: { seasonId: string; season: number; week: number },
): Promise<LiveWeekResult> {
  const { seasonId, season, week } = input;

  const points = new Map<string, number>();
  let skippedDefenses = 0;

  // Sequential, with the client's own delay between calls (CLAUDE.md rule 5). Six
  // requests, and this job runs while nothing else is talking to Sleeper.
  for (const position of FANTASY_POSITIONS) {
    const result = await fetchWeeklyStats(season, week, position);
    for (const rec of result.data) {
      const stats = rec.stats ?? {};
      // The single most dangerous absent-key case, and MORE likely here than in the
      // official pass rather than less: a defense whose game is in the first quarter
      // may have a stat line with no `pts_allow` yet, and banding an absent key would
      // pay it the +10 shutout bonus on live television. Refuse the row instead.
      if (position === 'DEF' && !('pts_allow' in stats)) {
        skippedDefenses++;
        continue;
      }
      if (Object.keys(stats).length === 0) continue;
      points.set(rec.player_id, scorePlayerWeek(position, stats).points);
    }
  }

  const { data: teamRows, error: teamError } = await db
    .from('teams')
    .select('id')
    .eq('season_id', seasonId);
  if (teamError) throw new Error(`teams: ${teamError.message}`);
  const teamIds = (teamRows ?? []).map((t) => t.id as string);

  const { data: lineupRows, error: lineupError } = await db
    .from('lineups')
    .select('team_id, qb, rb, wr, te, flex, k, def')
    .eq('week', week)
    .in('team_id', teamIds);
  if (lineupError) throw new Error(`lineups: ${lineupError.message}`);

  const computedAt = new Date().toISOString();
  const teams: LiveTeamScore[] = [];
  const rows: Record<string, unknown>[] = [];

  for (const row of lineupRows ?? []) {
    const lineup: Lineup = {
      qb: row.qb as string | null,
      rb: (row.rb ?? []) as string[],
      wr: (row.wr ?? []) as string[],
      te: row.te as string | null,
      flex: row.flex as string | null,
      k: row.k as string | null,
      def: row.def as string | null,
    };

    const scored = scoreLineup(lineup, points);
    const filled = scored.perSlot.filter((s) => !s.empty);
    // Presence of a Sleeper line is the test for "has played". A starter who took the
    // field and scored nothing counts as played; one whose game has not begun does not.
    const played = filled.filter((s) => s.playerId !== null && points.has(s.playerId)).length;

    teams.push({
      teamId: row.team_id as string,
      total: scored.total,
      startersPlayed: played,
      startersTotal: scored.perSlot.length,
    });

    rows.push({
      season_id: seasonId,
      team_id: row.team_id as string,
      week,
      total_pts: scored.total,
      per_slot: scored.perSlot,
      starters_played: played,
      starters_total: scored.perSlot.length,
      computed_at: computedAt,
    });
  }

  if (rows.length > 0) {
    const { error } = await db.from('live_scores').upsert(rows, { onConflict: 'team_id,week' });
    if (error) throw new Error(`live_scores: ${error.message}`);
  }

  return {
    week,
    teams: teams.sort((a, b) => b.total - a.total),
    statLines: points.size,
    skippedDefenses,
    computedAt,
  };
}

/**
 * Whether the week's games are all finished, for labelling only.
 *
 * A complete-but-unscored week is the overnight case: every game is over, the numbers
 * will not move again, and Tuesday has not run yet. Worth saying so on the page,
 * because "under way" beside a total that has stopped changing is misleading.
 */
export async function liveWeekIsComplete(
  db: SupabaseClient,
  season: number,
  week: number,
  now = new Date(),
): Promise<boolean> {
  const { data, error } = await db
    .from('nfl_games')
    .select('week, kickoff_at')
    .eq('season', season)
    .eq('season_type', 'regular')
    .lte('week', LAST_LEAGUE_WEEK);
  if (error) throw new Error(`nfl_games: ${error.message}`);

  const complete = completedWeek(
    (data ?? []).map((row) => ({
      week: row.week as number,
      kickoffAt: new Date(row.kickoff_at as string),
    })),
    now,
  );
  return complete !== null && complete >= week;
}

// ---------------------------------------------------------------------------
// What the live week would do to the table
// ---------------------------------------------------------------------------

export interface ProjectionTeam {
  teamId: string;
  h2hW: number;
  h2hT: number;
  cumPts: number;
  /** Rank in the last table that was published, which the delta is measured against. */
  rank: number;
}

export interface ProjectionFixture {
  homeTeamId: string;
  awayTeamId: string;
}

export interface ProjectedPlace {
  rank: number;
  /** Positive is a climb. Zero means the live week does not move this team. */
  delta: number;
}

/**
 * Fold a live week into the standings and re-rank, without writing anything.
 *
 * Pure, and separated from the loader for one reason: this is the only part of the
 * live feature with a rule in it that can be WRONG rather than merely absent, so it is
 * the part that has to be testable without a database.
 *
 * Ranked exactly the way the engine ranks — head-to-head, a tie worth half a win,
 * points-for as the tiebreak — because a projection ordered on a different basis would
 * move teams for reasons the real table never would, and the reader would have no way
 * to tell that apart from a genuine swing.
 *
 * A fixture where only one side has a live score yet is SKIPPED rather than awarded.
 * Being ahead 40–0 because the opponent's players kick off tomorrow is not leading,
 * and handing out that win would make the projection swing wildly through Sunday
 * morning for reasons that have nothing to do with football.
 */
export function projectTable(input: {
  teams: ProjectionTeam[];
  fixtures: ProjectionFixture[];
  live: Map<string, number>;
}): Map<string, ProjectedPlace> {
  const { teams, fixtures, live } = input;

  const working = new Map(
    teams.map((t) => [
      t.teamId,
      { w: t.h2hW, t: t.h2hT, pts: t.cumPts + (live.get(t.teamId) ?? 0), was: t.rank },
    ]),
  );

  for (const fixture of fixtures) {
    const home = live.get(fixture.homeTeamId);
    const away = live.get(fixture.awayTeamId);
    if (home === undefined || away === undefined) continue;

    const h = working.get(fixture.homeTeamId);
    const a = working.get(fixture.awayTeamId);
    if (!h || !a) continue;

    // Matches `h2hWeek`: an exact tie is a tie, worth half a win to each side.
    if (Math.abs(home - away) < 0.005) {
      h.t += 1;
      a.t += 1;
    } else if (home > away) {
      h.w += 1;
    } else {
      a.w += 1;
    }
  }

  const order = [...working.entries()]
    .map(([teamId, row]) => ({ teamId, key: row.w + row.t * 0.5, pts: row.pts, was: row.was }))
    .sort((x, y) => y.key - x.key || y.pts - x.pts);

  const out = new Map<string, ProjectedPlace>();
  let lastRank = 0;
  order.forEach((row, i) => {
    // Standard competition ranking. Teams level on BOTH keys share a rank, matching
    // §14.2's refusal to separate co-ranked teams with a coin flip.
    const tied = i > 0 && order[i - 1].key === row.key && order[i - 1].pts === row.pts;
    const rank = tied ? lastRank : i + 1;
    lastRank = rank;
    out.set(row.teamId, { rank, delta: (row.was || i + 1) - rank });
  });

  return out;
}
