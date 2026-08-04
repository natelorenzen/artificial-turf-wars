/**
 * Sleeper's `proj` category and its `stat` category do not share a field vocabulary,
 * and the projection payload is missing fields our scoring engine needs. This module
 * maps projections onto canonical stat keys and fills the two documented gaps.
 *
 * Everything here is deterministic and disclosed on /methodology — it is our own
 * derivation, not Sleeper's, and it must never be confused with actual scoring.
 * Actual weekly scoring reads raw stat fields directly (src/lib/scoring/engine.ts).
 */

import { DEF_POINTS_ALLOWED_BANDS, type Position } from '@/lib/config/league';
import { n, round2, scorePlayerWeek, type RawStats } from '@/lib/scoring/engine';
import type { SleeperStatRecord } from './client';

/**
 * Gap 1 — DEF projections carry no `pts_allow` and use different TD field names:
 *   def_fum_td + pass_int_td → def_td       (defensive touchdowns)
 *   def_kr_td  + pr_td       → def_st_td    (special-teams touchdowns)
 *
 * Gap 2 — K projections carry no `fgm` total and omit every sub-40-yard field goal,
 * so subtracting the long bands yields zero short field goals. Left uncorrected,
 * every kicker in the dossier is understated by roughly a third.
 */
export interface ProjectionCalibration {
  /** Made FGs from 0-39 yards per made FG of 40+, league-wide, prior season. */
  shortFgPerLongFg: number;
  /** Fantasy points from the points-allowed band, per game, by NFL team, prior season. */
  defPointsAllowedPerGame: Record<string, number>;
  /** Used when a team has no prior-season row. */
  defPointsAllowedPerGameDefault: number;
  /** Games in a full season, used to scale the per-game DEF estimate. */
  gamesPerSeason: number;
  sourceSeason: number;
}

export const DEFAULT_CALIBRATION: ProjectionCalibration = {
  shortFgPerLongFg: 1.0,
  defPointsAllowedPerGame: {},
  defPointsAllowedPerGameDefault: 2.0,
  gamesPerSeason: 17,
  sourceSeason: 0,
};

/** Canonical stat keys, from a projection record's raw `stats` object. */
export function normalizeProjectionStats(
  position: Position,
  stats: RawStats,
  calibration: ProjectionCalibration = DEFAULT_CALIBRATION,
): RawStats {
  if (position === 'DEF') {
    return {
      ...stats,
      def_td: n(stats, 'def_fum_td') + n(stats, 'pass_int_td') + n(stats, 'def_td'),
      def_st_td: n(stats, 'def_kr_td') + n(stats, 'pr_td') + n(stats, 'def_st_td'),
    };
  }

  if (position === 'K') {
    const long = n(stats, 'fgm_40_49') + n(stats, 'fgm_50p');
    const projectedShort = long * calibration.shortFgPerLongFg;
    // Reconstruct the `fgm` total the engine derives the 0-39 band from.
    return { ...stats, fgm: long + projectedShort };
  }

  return stats;
}

/**
 * Projected season points under OUR scoring. For DEF this adds a points-allowed
 * estimate that Sleeper does not project; for K it reconstructs the missing short
 * field goals. Both adjustments are labelled in the returned `method`.
 */
export function projectSeasonPoints(
  position: Position,
  rec: SleeperStatRecord,
  calibration: ProjectionCalibration = DEFAULT_CALIBRATION,
): { points: number; method: string } {
  const stats = normalizeProjectionStats(position, rec.stats ?? {}, calibration);
  // Sleeper does not project `pts_allow`; an absent key would band as a shutout
  // worth +10, so the band is excluded here and estimated below instead.
  const base = scorePlayerWeek(position, stats, { includePointsAllowed: false }).points;

  if (position === 'DEF') {
    const team = rec.team ?? rec.player?.team ?? rec.player_id;
    const perGame =
      calibration.defPointsAllowedPerGame[team] ?? calibration.defPointsAllowedPerGameDefault;
    const ptsAllowed = perGame * calibration.gamesPerSeason;
    return {
      points: round2(base + ptsAllowed),
      method: `def_pts_allowed_estimate_from_${calibration.sourceSeason || 'default'}`,
    };
  }

  if (position === 'K') {
    return { points: base, method: `k_short_fg_ratio_${calibration.shortFgPerLongFg.toFixed(3)}` };
  }

  return { points: base, method: 'direct' };
}

/**
 * One WEEK's projected points, for the Thursday weekend guide.
 *
 * Not a wrapper around `projectSeasonPoints` with a divide: that function multiplies
 * the estimated points-allowed by `gamesPerSeason`, so reusing it for a single week
 * would hand every defence roughly seventeen games of scoring. The K short-FG
 * reconstruction is unchanged — it is a ratio, so it applies at any granularity.
 */
export function projectWeekPoints(
  position: Position,
  rec: SleeperStatRecord,
  calibration: ProjectionCalibration = DEFAULT_CALIBRATION,
): { points: number; method: string } {
  const stats = normalizeProjectionStats(position, rec.stats ?? {}, calibration);
  const base = scorePlayerWeek(position, stats, { includePointsAllowed: false }).points;

  if (position === 'DEF') {
    const team = rec.team ?? rec.player?.team ?? rec.player_id;
    const perGame =
      calibration.defPointsAllowedPerGame[team] ?? calibration.defPointsAllowedPerGameDefault;
    // Exactly one game's worth — the whole reason this function exists.
    return {
      points: round2(base + perGame),
      method: `def_pts_allowed_per_game_from_${calibration.sourceSeason || 'default'}`,
    };
  }

  if (position === 'K') {
    return { points: base, method: `k_short_fg_ratio_${calibration.shortFgPerLongFg.toFixed(3)}` };
  }

  return { points: base, method: 'direct' };
}

/**
 * Build the calibration from a completed season's DEF and K season-total records.
 *
 * This is the ONE place `pts_allow_*` indicator fields may be read: aggregating a
 * finished season to build a projection input, never to score a week. Absent keys
 * still read as 0 via `n()`.
 */
export function buildCalibration(
  sourceSeason: number,
  defSeasonTotals: SleeperStatRecord[],
  kSeasonTotals: SleeperStatRecord[],
): ProjectionCalibration {
  const defPointsAllowedPerGame: Record<string, number> = {};
  const perGameValues: number[] = [];

  for (const rec of defSeasonTotals) {
    const s = rec.stats ?? {};
    const games = n(s, 'gp');
    if (games <= 0) continue;

    let points = 0;
    for (const band of DEF_POINTS_ALLOWED_BANDS) {
      points += n(s, bandFieldName(band.label)) * band.points;
    }
    const perGame = points / games;
    const team = rec.team ?? rec.player?.team ?? rec.player_id;
    defPointsAllowedPerGame[team] = round2(perGame);
    perGameValues.push(perGame);
  }

  let longFg = 0;
  let shortFg = 0;
  for (const rec of kSeasonTotals) {
    const s = rec.stats ?? {};
    const long = n(s, 'fgm_40_49') + n(s, 'fgm_50p');
    const short = Math.max(0, n(s, 'fgm') - long);
    longFg += long;
    shortFg += short;
  }

  return {
    shortFgPerLongFg: longFg > 0 ? shortFg / longFg : DEFAULT_CALIBRATION.shortFgPerLongFg,
    defPointsAllowedPerGame,
    defPointsAllowedPerGameDefault:
      perGameValues.length > 0
        ? round2(perGameValues.reduce((a, b) => a + b, 0) / perGameValues.length)
        : DEFAULT_CALIBRATION.defPointsAllowedPerGameDefault,
    gamesPerSeason: 17,
    sourceSeason,
  };
}

/** '1-6' → 'pts_allow_1_6', '35+' → 'pts_allow_35p', '0' → 'pts_allow_0'. */
function bandFieldName(label: string): string {
  return `pts_allow_${label.replace('+', 'p').replace('-', '_')}`;
}

/** Derive bye weeks: any of the 32 teams absent from a week's games is on bye. */
export function deriveByeWeeks(
  games: { week: number; home: string | null; away: string | null }[],
): { byes: Record<string, number>; weeks: number[]; teams: string[] } {
  const weeks = [...new Set(games.map((g) => g.week))].sort((a, b) => a - b);
  const teams = [
    ...new Set(games.flatMap((g) => [g.home, g.away]).filter((t): t is string => Boolean(t))),
  ].sort();

  const byes: Record<string, number> = {};
  for (const week of weeks) {
    const playing = new Set(
      games.filter((g) => g.week === week).flatMap((g) => [g.home, g.away]),
    );
    for (const team of teams) {
      if (!playing.has(team) && byes[team] === undefined) byes[team] = week;
    }
  }
  return { byes, weeks, teams };
}
