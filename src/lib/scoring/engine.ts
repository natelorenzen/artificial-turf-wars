/**
 * The commissioner's scoring engine (SPEC §3.2, §8.4).
 *
 * Deterministic TypeScript, never a model call. Computes points from Sleeper's RAW
 * stat fields — never from Sleeper's precomputed `pts_ppr`, whose interception and
 * fumble values differ from ours.
 *
 * The single most likely source of a wrong score is Sleeper OMITTING a stat key
 * instead of returning zero (SPEC §5.2 #7). Every read here goes through `n()`,
 * which coerces undefined/null/NaN to 0.
 */

import {
  DEF_POINTS_ALLOWED_BANDS,
  DEF_SCORING,
  KICKER_SCORING,
  OFFENSE_SCORING,
  type Position,
} from '@/lib/config/league';

export type RawStats = Record<string, unknown>;

export interface ScoreLine {
  label: string;
  stat: number;
  points: number;
}

export interface ScoreResult {
  points: number;
  lines: ScoreLine[];
}

/** Absent-is-not-zero guard. Every raw stat read in this file goes through here. */
export function n(stats: RawStats, key: string): number {
  const v = stats?.[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const parsed = Number(v);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/** Money-safe rounding to 2dp; fantasy points are compared for exact ties (SPEC §6.1). */
export function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

function push(lines: ScoreLine[], label: string, stat: number, points: number) {
  if (stat !== 0 || points !== 0) lines.push({ label, stat, points: round2(points) });
}

function scoreOffense(stats: RawStats): ScoreResult {
  const lines: ScoreLine[] = [];
  let total = 0;

  for (const [field, value] of Object.entries(OFFENSE_SCORING)) {
    const stat = n(stats, field);
    const points = stat * value;
    total += points;
    push(lines, field, stat, points);
  }

  // `st_td` is intentionally NOT scored here. A special-teams touchdown belongs to
  // the DEF/ST unit via `def_st_td`; crediting the individual returner too would
  // pay 12 points league-wide for one return (SPEC §3.2).

  return { points: round2(total), lines };
}

/** FG 0-39 derived by subtraction — Sleeper has no `fgm_0_19` key (SPEC §3.2). */
export function fieldGoalBands(stats: RawStats): {
  fg0_39: number;
  fg40_49: number;
  fg50p: number;
} {
  const fgm = n(stats, 'fgm');
  const fg40_49 = n(stats, 'fgm_40_49');
  const fg50p = n(stats, 'fgm_50p');
  // Clamp: a malformed feed must never produce negative made field goals.
  const fg0_39 = Math.max(0, fgm - fg40_49 - fg50p);
  return { fg0_39, fg40_49, fg50p };
}

function scoreKicker(stats: RawStats): ScoreResult {
  const lines: ScoreLine[] = [];
  const { fg0_39, fg40_49, fg50p } = fieldGoalBands(stats);
  const xpm = n(stats, 'xpm');

  let total = 0;
  for (const [label, stat, value] of [
    ['fg_0_39', fg0_39, KICKER_SCORING.fg_0_39],
    ['fg_40_49', fg40_49, KICKER_SCORING.fg_40_49],
    ['fg_50p', fg50p, KICKER_SCORING.fg_50p],
    ['xpm', xpm, KICKER_SCORING.xpm],
  ] as const) {
    const points = stat * value;
    total += points;
    push(lines, label, stat, points);
  }

  return { points: round2(total), lines };
}

/** Band the raw `pts_allow` integer. Indicator fields are never consulted. */
export function pointsAllowedPoints(ptsAllow: number): { points: number; label: string } {
  for (const band of DEF_POINTS_ALLOWED_BANDS) {
    if (ptsAllow <= band.max) return { points: band.points, label: band.label };
  }
  const last = DEF_POINTS_ALLOWED_BANDS[DEF_POINTS_ALLOWED_BANDS.length - 1];
  return { points: last.points, label: last.label };
}

function scoreDefense(stats: RawStats, includePointsAllowed: boolean): ScoreResult {
  const lines: ScoreLine[] = [];
  let total = 0;

  for (const [field, value] of Object.entries(DEF_SCORING)) {
    const stat = n(stats, field);
    const points = stat * value;
    total += points;
    push(lines, field, stat, points);
  }

  if (includePointsAllowed) {
    const ptsAllow = n(stats, 'pts_allow');
    const band = pointsAllowedPoints(ptsAllow);
    total += band.points;
    lines.push({ label: `pts_allow (${band.label})`, stat: ptsAllow, points: band.points });
  }

  return { points: round2(total), lines };
}

export interface ScoreOptions {
  /**
   * Defaults to true. Set false ONLY for projections: Sleeper does not project
   * `pts_allow`, and an absent key reads as 0, which would band as a shutout worth
   * +10. Never set false when scoring an actual week.
   */
  includePointsAllowed?: boolean;
}

/**
 * Score one player's week. `position` decides which table applies — a DEF record and
 * a WR record share stat key names (`int`, `fum_rec`) with different meanings.
 */
export function scorePlayerWeek(
  position: Position,
  stats: RawStats | null | undefined,
  options: ScoreOptions = {},
): ScoreResult {
  const s = stats ?? {};
  switch (position) {
    case 'K':
      return scoreKicker(s);
    case 'DEF':
      return scoreDefense(s, options.includePointsAllowed !== false);
    default:
      return scoreOffense(s);
  }
}
