/**
 * All-play, head-to-head, and the standings order (SPEC §6.1).
 *
 * All-play is the OFFICIAL ranking: every team is compared against all seven others
 * each week, which removes both strength-of-schedule luck and timing luck. H2H is
 * published as a co-headline but never ranks.
 *
 * Exact ties are not rare — kicker and DEF/ST outputs are small integers — so the
 * rule is stated rather than left to whatever `>` happens to do: an all-play tie
 * awards HALF A WIN to each team, and a H2H tie is recorded as a tie.
 */

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

export interface StandingRow {
  teamId: string;
  allplayW: number;
  allplayL: number;
  cumPts: number;
  rank: number;
  /** True when this team shares its rank with another — no coin flip is used. */
  coRanked: boolean;
}

/**
 * Season rank: cumulative all-play, tiebreak cumulative points. If both are exactly
 * equal the teams are declared CO-RANKED. No coin flip, no seed tiebreak — leaving
 * it undefined would be worse than an outcome nobody will see.
 */
export function rankStandings(
  rows: { teamId: string; allplayW: number; allplayL: number; cumPts: number }[],
): StandingRow[] {
  const sorted = [...rows].sort((a, b) => {
    const w = cmp(b.allplayW, a.allplayW);
    if (w !== 0) return w;
    const p = cmp(b.cumPts, a.cumPts);
    if (p !== 0) return p;
    // Stable, deterministic display order for genuinely co-ranked teams.
    return a.teamId < b.teamId ? -1 : a.teamId > b.teamId ? 1 : 0;
  });

  const isTied = (a: (typeof sorted)[number], b: (typeof sorted)[number]) =>
    cmp(a.allplayW, b.allplayW) === 0 && cmp(a.cumPts, b.cumPts) === 0;

  const out: StandingRow[] = [];
  let rank = 0;
  for (let i = 0; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    if (i === 0 || !prev || !isTied(sorted[i], prev)) rank = i + 1;
    const next = sorted[i + 1];
    const coRanked = Boolean((prev && isTied(sorted[i], prev)) || (next && isTied(sorted[i], next)));
    out.push({
      teamId: sorted[i].teamId,
      allplayW: sorted[i].allplayW,
      allplayL: sorted[i].allplayL,
      cumPts: round2(sorted[i].cumPts),
      rank,
      coRanked,
    });
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
