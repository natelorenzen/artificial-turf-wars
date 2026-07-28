/**
 * All-play, head-to-head, and the standings order (SPEC §6.1).
 *
 * SPEC §14.2 reversed which of these ranks. HEAD-TO-HEAD is now official: it is what
 * makes the opponent matter, and therefore what makes punting, variance-seeking, and
 * cross-week budgeting into real decisions instead of noise. ALL-PLAY is still
 * computed and published every week as the timing-luck-free read on who actually
 * managed best, and where the two disagree the site leads with the disagreement.
 *
 * Exact ties are not rare — kicker and DEF/ST outputs are small integers — so the
 * rule is stated rather than left to whatever `>` happens to do: an all-play tie
 * awards HALF A WIN to each team, and a H2H tie is recorded as a tie.
 */

import { RANKING_BASIS } from '@/lib/config/league';
import { round2 } from '@/lib/scoring/engine';

export interface WeekScore {
  teamId: string;
  points: number;
}

export interface AllPlayRecord {
  teamId: string;
  wins: number;
  losses: number;
  points: number;
}

/** Compare on cents, not floats: 112.30 and 112.3 are the same score. */
function cmp(a: number, b: number): number {
  const ca = Math.round(a * 100);
  const cb = Math.round(b * 100);
  return ca === cb ? 0 : ca > cb ? 1 : -1;
}

export function allPlayWeek(scores: WeekScore[]): AllPlayRecord[] {
  return scores.map((team) => {
    let wins = 0;
    let losses = 0;
    for (const other of scores) {
      if (other.teamId === team.teamId) continue;
      const c = cmp(team.points, other.points);
      if (c > 0) wins += 1;
      else if (c < 0) losses += 1;
      else {
        wins += 0.5;
        losses += 0.5;
      }
    }
    return { teamId: team.teamId, wins, losses, points: round2(team.points) };
  });
}

export type H2HOutcome = 'W' | 'L' | 'T';

export function h2hWeek(
  matchups: { homeTeamId: string; awayTeamId: string }[],
  scores: WeekScore[],
): Map<string, H2HOutcome> {
  const byTeam = new Map(scores.map((s) => [s.teamId, s.points]));
  const out = new Map<string, H2HOutcome>();
  for (const m of matchups) {
    const home = byTeam.get(m.homeTeamId);
    const away = byTeam.get(m.awayTeamId);
    if (home === undefined || away === undefined) continue;
    const c = cmp(home, away);
    out.set(m.homeTeamId, c > 0 ? 'W' : c < 0 ? 'L' : 'T');
    out.set(m.awayTeamId, c < 0 ? 'W' : c > 0 ? 'L' : 'T');
  }
  return out;
}

export interface StandingInput {
  teamId: string;
  /** Head-to-head — the official basis since the v3 amendment (SPEC §14.2). */
  h2hW: number;
  h2hL: number;
  h2hT: number;
  /** All-play — still computed and published, no longer ranks. */
  allplayW: number;
  allplayL: number;
  cumPts: number;
}

export interface StandingRow extends StandingInput {
  rank: number;
  /** True when this team shares its rank with another — no coin flip is used. */
  coRanked: boolean;
}

/** A tie is half a win for ordering purposes; the schedule is balanced so games are equal. */
export function h2hScore(row: { h2hW: number; h2hT: number }): number {
  return row.h2hW + row.h2hT * 0.5;
}

/**
 * Season rank. Basis is head-to-head record, tiebreak cumulative points (SPEC §14.2).
 * If both are exactly equal the teams are declared CO-RANKED — no coin flip, no seed
 * tiebreak. Leaving it undefined would be worse than an outcome nobody will see.
 *
 * All-play ranking is retained behind `basis` because the site publishes that table
 * too, and where the two disagree is meant to be led with, not buried.
 */
export function rankStandings(
  rows: StandingInput[],
  basis: 'h2h' | 'allplay' = RANKING_BASIS,
): StandingRow[] {
  const primary = (row: StandingInput) => (basis === 'h2h' ? h2hScore(row) : row.allplayW);

  const sorted = [...rows].sort((a, b) => {
    const w = cmp(primary(b), primary(a));
    if (w !== 0) return w;
    const p = cmp(b.cumPts, a.cumPts);
    if (p !== 0) return p;
    // Stable, deterministic display order for genuinely co-ranked teams.
    return a.teamId < b.teamId ? -1 : a.teamId > b.teamId ? 1 : 0;
  });

  const isTied = (a: (typeof sorted)[number], b: (typeof sorted)[number]) =>
    cmp(primary(a), primary(b)) === 0 && cmp(a.cumPts, b.cumPts) === 0;

  const out: StandingRow[] = [];
  let rank = 0;
  for (let i = 0; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    if (i === 0 || !prev || !isTied(sorted[i], prev)) rank = i + 1;
    const next = sorted[i + 1];
    const coRanked = Boolean((prev && isTied(sorted[i], prev)) || (next && isTied(sorted[i], next)));
    out.push({ ...sorted[i], cumPts: round2(sorted[i].cumPts), rank, coRanked });
  }
  return out;
}

/** Playoff seeding uses the same order the site has shown all season (SPEC §3.3). */
export function playoffSeeds(standings: StandingRow[], teams: number): string[] {
  return standings.slice(0, teams).map((row) => row.teamId);
}

/** Week 15: 1v4 and 2v3. Week 16: winners meet, losers play for third. */
export function semifinalMatchups(seeds: string[]): { homeTeamId: string; awayTeamId: string }[] {
  if (seeds.length < 4) throw new Error('playoffs need four seeds');
  return [
    { homeTeamId: seeds[0], awayTeamId: seeds[3] },
    { homeTeamId: seeds[1], awayTeamId: seeds[2] },
  ];
}
