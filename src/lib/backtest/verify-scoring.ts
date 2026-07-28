/**
 * Scoring verification against a completed season (SPEC §9, Phase 4).
 *
 * Why this exists: the draft is one-shot and irreversible. A bug in the scoring
 * constants discovered in Week 3 is unfixable without invalidating the season. 2025
 * is complete and available from the same endpoints, so the engine can be run against
 * it before anything is frozen.
 *
 * The core check is INTERNAL CONSISTENCY: for offensive players, scoring each week
 * separately and summing must equal scoring the season-total stat line in one go.
 * Both come from the same engine but from completely different Sleeper payloads, so
 * a disagreement means either a stat key is being read wrong or the absent-key
 * default is masking something.
 *
 * DEF and K are deliberately excluded from that identity, and the reason is itself
 * worth asserting: the points-allowed band is a PER-GAME step function. A defense
 * allowing 20 points a week for 17 weeks earns 17 × 1 = 17 points, while its
 * season-total `pts_allow` of 340 would band to −4. Those must differ, and a
 * verification that expected them to match would be wrong, not the engine.
 */

import { n, round2, scorePlayerWeek, type RawStats } from '@/lib/scoring/engine';
import type { Position } from '@/lib/config/league';

export interface WeeklyRow {
  playerId: string;
  week: number;
  stats: RawStats;
  computedPts: number;
}

export interface SeasonRow {
  playerId: string;
  position: Position;
  name: string;
  stats: RawStats;
}

export interface Discrepancy {
  playerId: string;
  name: string;
  position: Position;
  weeklySum: number;
  seasonTotal: number;
  delta: number;
  weeks: number;
}

export interface VerificationResult {
  compared: number;
  matched: number;
  discrepancies: Discrepancy[];
  /** Largest absolute delta seen, in points. */
  worstDelta: number;
}

/** Points can legitimately drift by rounding across 14 weeks of 2dp arithmetic. */
const TOLERANCE = 0.05;

export function verifyWeeklyAgainstSeason(
  weekly: WeeklyRow[],
  seasonTotals: SeasonRow[],
): VerificationResult {
  const byPlayer = new Map<string, WeeklyRow[]>();
  for (const row of weekly) {
    const list = byPlayer.get(row.playerId) ?? [];
    list.push(row);
    byPlayer.set(row.playerId, list);
  }

  const discrepancies: Discrepancy[] = [];
  let compared = 0;
  let matched = 0;
  let worstDelta = 0;

  for (const season of seasonTotals) {
    // The per-game band makes this identity false by construction for DEF, and K
    // season totals omit the band fields the weekly rows carry.
    if (season.position === 'DEF' || season.position === 'K') continue;

    const weeks = byPlayer.get(season.playerId);
    if (!weeks || weeks.length === 0) continue;

    const weeklySum = round2(weeks.reduce((sum, w) => sum + w.computedPts, 0));
    const seasonTotal = scorePlayerWeek(season.position, season.stats).points;
    const delta = round2(weeklySum - seasonTotal);

    compared++;
    worstDelta = Math.max(worstDelta, Math.abs(delta));

    if (Math.abs(delta) <= TOLERANCE) {
      matched++;
    } else {
      discrepancies.push({
        playerId: season.playerId,
        name: season.name,
        position: season.position,
        weeklySum,
        seasonTotal,
        delta,
        weeks: weeks.length,
      });
    }
  }

  discrepancies.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return { compared, matched, discrepancies, worstDelta };
}

/**
 * The per-game band identity, asserted rather than assumed. If this ever stops being
 * true, `verifyWeeklyAgainstSeason` excluding DEF is hiding a real bug.
 */
export function defenceBandIsPerGame(): { weekly: number; seasonTotal: number } {
  const oneWeek = { pts_allow: 20 };
  const weekly = round2(scorePlayerWeek('DEF', oneWeek).points * 17);
  const seasonTotal = scorePlayerWeek('DEF', { pts_allow: 20 * 17 }).points;
  return { weekly, seasonTotal };
}

/**
 * Spot-check a handful of known lines. Catches a whole-table error that internal
 * consistency cannot — if a scoring constant were wrong, weekly and season totals
 * would agree with each other and both be wrong.
 */
export interface SpotCheck {
  label: string;
  position: Position;
  stats: RawStats;
  expected: number;
}

export function runSpotChecks(checks: SpotCheck[]) {
  return checks.map((check) => {
    const actual = scorePlayerWeek(check.position, check.stats).points;
    return { ...check, actual, ok: Math.abs(actual - check.expected) < 0.005 };
  });
}

/** Sum our own points for a player across a set of weekly rows. */
export function seasonPointsFromWeeks(rows: WeeklyRow[]): number {
  return round2(rows.reduce((sum, r) => sum + r.computedPts, 0));
}

/** Games a player actually recorded a stat line in — the denominator for PPG. */
export function gamesPlayed(rows: WeeklyRow[]): number {
  return rows.filter((r) => Object.keys(r.stats).length > 0 && n(r.stats, 'gp') > 0).length;
}
