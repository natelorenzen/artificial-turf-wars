/**
 * Head-to-head schedule generation (SPEC §6.1).
 *
 * Circle method: fix one position, rotate the rest, produce 7 unique rounds. Weeks
 * 8-14 repeat those rounds with home and away swapped, giving a perfectly balanced
 * DOUBLE ROUND-ROBIN — every team plays every other exactly twice, so there is zero
 * strength-of-schedule luck, only timing luck.
 *
 * Which team occupies which circle position is drawn from the pre-registered seed
 * and generated BEFORE the auction, so results cannot shape who plays whom when.
 */

import { LEAGUE } from '@/lib/config/league';
import { seededShuffle } from './rng';

export interface Matchup {
  week: number;
  homeTeamId: string;
  awayTeamId: string;
}

export function generateH2HSchedule(teamIds: readonly string[], seed: string): Matchup[] {
  const teams = teamIds.length;
  if (teams % 2 !== 0) {
    throw new Error(`circle method needs an even team count, got ${teams}`);
  }

  // Seeded placement into circle positions, committed before the auction.
  const positions = seededShuffle(teamIds, `${seed}:h2h-positions`);

  const roundsPerRobin = teams - 1;
  const half = teams / 2;
  const matchups: Matchup[] = [];

  // Position 0 is fixed; the remaining positions rotate.
  const rotating = positions.slice(1);

  for (let round = 0; round < roundsPerRobin; round++) {
    const order = [positions[0], ...rotating];
    for (let i = 0; i < half; i++) {
      const a = order[i];
      const b = order[teams - 1 - i];
      // Alternate home/away by round so the fixed team is not always at home.
      const homeFirst = (round + i) % 2 === 0;
      const first = { week: round + 1, homeTeamId: homeFirst ? a : b, awayTeamId: homeFirst ? b : a };
      matchups.push(first);
      // Second round-robin: same pairing, sides swapped.
      matchups.push({
        week: round + 1 + roundsPerRobin,
        homeTeamId: first.awayTeamId,
        awayTeamId: first.homeTeamId,
      });
    }
    rotating.unshift(rotating.pop()!);
  }

  assertBalancedSchedule(matchups, teamIds);
  return matchups.sort((a, b) => a.week - b.week);
}

/**
 * Cheap check, expensive bug: a silent schedule error would corrupt a headline
 * number all season (SPEC §6.1).
 */
export function assertBalancedSchedule(matchups: Matchup[], teamIds: readonly string[]) {
  const weeks = new Set(matchups.map((m) => m.week));
  const expectedWeeks = (teamIds.length - 1) * 2;

  if (weeks.size !== expectedWeeks) {
    throw new Error(`schedule: expected ${expectedWeeks} weeks, got ${weeks.size}`);
  }
  if (expectedWeeks !== LEAGUE.regularSeasonWeeks) {
    throw new Error(
      `schedule: ${teamIds.length} teams produce ${expectedWeeks} weeks, but the season is ${LEAGUE.regularSeasonWeeks}`,
    );
  }

  const pairCounts = new Map<string, number>();
  for (const week of weeks) {
    const inWeek = matchups.filter((m) => m.week === week);
    if (inWeek.length !== teamIds.length / 2) {
      throw new Error(`schedule: week ${week} has ${inWeek.length} matchups`);
    }
    const seen = new Set<string>();
    for (const m of inWeek) {
      if (seen.has(m.homeTeamId) || seen.has(m.awayTeamId)) {
        throw new Error(`schedule: a team appears twice in week ${week}`);
      }
      seen.add(m.homeTeamId);
      seen.add(m.awayTeamId);
      const key = [m.homeTeamId, m.awayTeamId].sort().join('|');
      pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
    }
  }

  for (let i = 0; i < teamIds.length; i++) {
    for (let j = i + 1; j < teamIds.length; j++) {
      const key = [teamIds[i], teamIds[j]].sort().join('|');
      const count = pairCounts.get(key) ?? 0;
      if (count !== 2) {
        throw new Error(`schedule: ${teamIds[i]} plays ${teamIds[j]} ${count} times, expected 2`);
      }
    }
  }
}
