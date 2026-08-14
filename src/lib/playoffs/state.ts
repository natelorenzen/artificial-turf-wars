/**
 * Loading the bracket from what is already stored (SPEC §3.3, §14.5).
 *
 * The bracket is not a table. It is a function of two things the database already
 * holds — the week-14 standings and the playoff weeks' `lineup_scores` — and it is
 * derived on every read rather than written down. That is deliberate: a stored
 * `champion` column would be a second copy of a fact, free to disagree with the
 * scores under it, and this is the one fact of the season nobody would think to
 * re-check.
 *
 * The fixtures ARE persisted, into `h2h_schedule`, because a matchup is a fact about
 * what was scheduled rather than a derived result: the site shows week 15's pairings
 * the moment they are known, and the weekly context loader reads opponents from that
 * table for every other week of the season.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { LEAGUE } from '@/lib/config/league';
import {
  buildBracket,
  isPlayoffWeek,
  LAST_LEAGUE_WEEK,
  type BracketGame,
  type BracketState,
} from '@/lib/engine/bracket';
import type { StandingRow } from '@/lib/engine/allplay';
import { loadWeeklyTotals } from '@/lib/scoring/week';

/**
 * The standings as they stood at the end of the regular season.
 *
 * Read from the stored rows rather than recomputed, for one reason worth stating:
 * `rebuildStandings` WRITES, and half the callers of the bracket are read-only page
 * renders. A page that recomputes the season's official order as a side effect of
 * being viewed is a page that can change it.
 */
export async function loadFinalStandings(
  db: SupabaseClient,
  seasonId: string,
): Promise<StandingRow[]> {
  const { data: teams, error: teamError } = await db
    .from('teams')
    .select('id')
    .eq('season_id', seasonId);
  if (teamError) throw new Error(`teams: ${teamError.message}`);
  const teamIds = (teams ?? []).map((t) => t.id as string);
  if (teamIds.length === 0) return [];

  const { data, error } = await db
    .from('standings')
    .select('team_id, h2h_w, h2h_l, h2h_t, cum_allplay_w, cum_allplay_l, cum_pts, rank')
    .eq('week', LEAGUE.regularSeasonWeeks)
    .in('team_id', teamIds);
  if (error) throw new Error(`standings: ${error.message}`);
  if (!data || data.length === 0) return [];

  // `rank` is stamped on the latest scored week only, so a week-14 row without one
  // means week 14 was scored and then a later rebuild moved the stamp — which cannot
  // happen now that the standings stop at 14, but would silently seed a bracket from
  // nulls if it ever did.
  const rows = data.map((row) => ({
    teamId: row.team_id as string,
    h2hW: Number(row.h2h_w ?? 0),
    h2hL: Number(row.h2h_l ?? 0),
    h2hT: Number(row.h2h_t ?? 0),
    allplayW: Number(row.cum_allplay_w ?? 0),
    allplayL: Number(row.cum_allplay_l ?? 0),
    cumPts: Number(row.cum_pts ?? 0),
    rank: row.rank as number | null,
  }));

  const unranked = rows.filter((r) => r.rank === null);
  if (unranked.length > 0) {
    throw new Error(
      `week ${LEAGUE.regularSeasonWeeks} standings carry no rank for ${unranked.length} team(s). ` +
        'Re-score the final regular-season week before seeding the bracket.',
    );
  }

  const rankCounts = new Map<number, number>();
  for (const row of rows) rankCounts.set(row.rank!, (rankCounts.get(row.rank!) ?? 0) + 1);

  return rows.map((row) => ({
    ...row,
    rank: row.rank!,
    coRanked: (rankCounts.get(row.rank!) ?? 0) > 1,
  }));
}

/** Scores for the playoff weeks only, keyed the way `buildBracket` wants them. */
export async function loadPlayoffPoints(
  db: SupabaseClient,
  seasonId: string,
): Promise<Map<number, Map<string, number>>> {
  const { data: teams, error } = await db.from('teams').select('id').eq('season_id', seasonId);
  if (error) throw new Error(`teams: ${error.message}`);

  const totals = await loadWeeklyTotals(
    db,
    (teams ?? []).map((t) => t.id as string),
    LAST_LEAGUE_WEEK,
  );

  const byWeek = new Map<number, Map<string, number>>();
  for (const [teamId, weeks] of totals) {
    for (const [week, entry] of weeks) {
      if (!isPlayoffWeek(week)) continue;
      const inner = byWeek.get(week) ?? new Map<string, number>();
      inner.set(teamId, entry.total);
      byWeek.set(week, inner);
    }
  }
  return byWeek;
}

/**
 * The frozen field, if it has been decided. Seed order, seed 1 first.
 *
 * Empty until the playoff pool runs — that job is what decides the field, because the
 * four survivors have to know they are in before they bid.
 */
export async function loadStoredSeeds(
  db: SupabaseClient,
  seasonId: string,
): Promise<string[]> {
  const { data, error } = await db
    .from('playoff_seeds')
    .select('team_id, seed')
    .eq('season_id', seasonId)
    .order('seed', { ascending: true });
  if (error) throw new Error(`playoff_seeds: ${error.message}`);
  return (data ?? []).map((row) => row.team_id as string);
}

/**
 * Write the field, once. Refuses to change one that already exists.
 *
 * Not an upsert. If this ever runs twice against a season whose bracket has already
 * been decided, the correct behaviour is to keep the first answer and say so — the
 * second call is either a duplicate cron delivery or a correction trying to re-seed a
 * bracket that has already been played.
 */
export async function freezeSeeds(
  db: SupabaseClient,
  seasonId: string,
  seeds: { teamId: string; h2hRecord: string; cumPts: number }[],
): Promise<{ frozen: boolean; seeds: string[] }> {
  const existing = await loadStoredSeeds(db, seasonId);
  if (existing.length > 0) return { frozen: false, seeds: existing };

  const { error } = await db.from('playoff_seeds').insert(
    seeds.map((entry, i) => ({
      season_id: seasonId,
      team_id: entry.teamId,
      seed: i + 1,
      h2h_record: entry.h2hRecord,
      cum_pts: entry.cumPts,
    })),
  );
  if (error) throw new Error(`playoff_seeds insert: ${error.message}`);

  return { frozen: true, seeds: seeds.map((s) => s.teamId) };
}

/**
 * The bracket, or null when the regular season has not finished.
 *
 * Null rather than a throw: every forward-looking job asks this question all season
 * long, and "week 14 has not been scored yet" is the correct state of the world for
 * three and a half months.
 *
 * Prefers the FROZEN seeds over the live standings wherever they exist. The two agree
 * on the day the pool runs and can disagree afterwards, because Thursday's final pass
 * may correct a week-14 stat line. When they disagree the frozen order wins: the teams
 * spent their remaining FAAB on Tuesday's answer, and seed order still decides an exact
 * tie in a game being played that weekend.
 */
export async function loadBracket(
  db: SupabaseClient,
  seasonId: string,
): Promise<BracketState | null> {
  const standings = await loadFinalStandings(db, seasonId);
  if (standings.length < LEAGUE.teams) return null;

  const frozen = await loadStoredSeeds(db, seasonId);
  const pointsByWeek = await loadPlayoffPoints(db, seasonId);

  if (frozen.length === LEAGUE.playoffTeams) {
    return buildBracket({ standings, pointsByWeek, seeds: frozen });
  }
  return buildBracket({ standings, pointsByWeek });
}

/**
 * Write the week's fixtures into `h2h_schedule`, if they are not already there.
 *
 * Idempotent by the table's own `unique (season_id, week, home_team_id)`, so a second
 * cron delivery re-derives identical rows and writes nothing new. Nothing here can
 * change a result — these are the pairings the seeds already imply.
 */
export async function persistBracketWeek(
  db: SupabaseClient,
  seasonId: string,
  games: BracketGame[],
): Promise<{ written: number }> {
  if (games.length === 0) return { written: 0 };

  const { error } = await db.from('h2h_schedule').upsert(
    games.map((game) => ({
      season_id: seasonId,
      week: game.week,
      home_team_id: game.homeTeamId,
      away_team_id: game.awayTeamId,
    })),
    { onConflict: 'season_id,week,home_team_id' },
  );
  if (error) throw new Error(`h2h_schedule (playoffs): ${error.message}`);

  return { written: games.length };
}
