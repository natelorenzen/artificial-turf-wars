/**
 * Opponent-aware DATA block builders (SPEC §14.3).
 *
 * Everything here is DESCRIPTIVE — what has already happened. That line matters: §6.4
 * keeps our win probability out of every prompt, because a model reasoning from our
 * estimator is no longer reasoning from the shared data, and it would destroy the
 * calibration finding. We give a model its opponent's roster and scoring history and
 * let it form its own view. The gap between its view and ours is then measurable.
 *
 * Nothing here may contain a lab or model name — see `assertNoLabelLeak`.
 */

import { LEAGUE } from '@/lib/config/league';
import { round2 } from '@/lib/scoring/engine';
import { h2hScore, type StandingRow } from '@/lib/engine/allplay';

export interface RosterEntry {
  player_id: string;
  name: string;
  position: string;
  nfl_team: string | null;
  projection: number | null;
  season_ppg: number | null;
  last3_ppg: number | null;
  injury_status: string | null;
  is_on_bye: boolean;
}

export interface OpponentView {
  label: string;
  record: string;
  /** Their completed weekly totals. Volatility is the model's to interpret. */
  weekly_scores: number[];
  season_ppg: number | null;
  score_volatility: number | null;
  /**
   * Their roster. NOT their lineup for this week — that is not visible until it
   * locks, exactly as in a real league, and showing it would hand whoever decides
   * later a free informational edge.
   */
  roster: RosterEntry[];
}

export interface LookaheadOpponent {
  week: number;
  label: string;
  record: string;
  season_ppg: number | null;
}

export interface StandingView {
  your_label: string;
  your_record: string;
  your_rank: number;
  points_for: number;
  /** The playoff-race number: how many H2H wins behind the last playoff spot. */
  games_back_of_cutoff: number;
  weeks_remaining: number;
  playoff_spots: number;
  table: { label: string; record: string; points_for: number; rank: number }[];
}

/** Population standard deviation of completed weekly scores. */
export function volatility(scores: number[]): number | null {
  if (scores.length < 2) return null;
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length;
  return round2(Math.sqrt(variance));
}

export function mean(scores: number[]): number | null {
  if (scores.length === 0) return null;
  return round2(scores.reduce((a, b) => a + b, 0) / scores.length);
}

export function formatRecord(row: { h2hW: number; h2hL: number; h2hT: number }): string {
  return row.h2hT > 0 ? `${row.h2hW}-${row.h2hL}-${row.h2hT}` : `${row.h2hW}-${row.h2hL}`;
}

export function buildOpponentView(input: {
  label: string;
  standing: StandingRow;
  weeklyScores: number[];
  roster: RosterEntry[];
}): OpponentView {
  return {
    label: input.label,
    record: formatRecord(input.standing),
    weekly_scores: input.weeklyScores.map(round2),
    season_ppg: mean(input.weeklyScores),
    score_volatility: volatility(input.weeklyScores),
    roster: input.roster,
  };
}

/**
 * The next few opponents. Without this, "save it for a week you can win" has nothing
 * to point at — a model cannot conserve for next week if it does not know who next
 * week is (SPEC §14.4).
 */
export function buildLookahead(
  schedule: { week: number; homeTeamId: string; awayTeamId: string }[],
  teamId: string,
  fromWeek: number,
  labels: Map<string, string>,
  standings: Map<string, StandingRow>,
  weeklyScores: Map<string, number[]>,
  count = LEAGUE.lookaheadOpponents,
): LookaheadOpponent[] {
  return schedule
    .filter((m) => m.week > fromWeek && (m.homeTeamId === teamId || m.awayTeamId === teamId))
    .sort((a, b) => a.week - b.week)
    .slice(0, count)
    .map((m) => {
      const opponentId = m.homeTeamId === teamId ? m.awayTeamId : m.homeTeamId;
      const standing = standings.get(opponentId);
      return {
        week: m.week,
        label: labels.get(opponentId) ?? 'Unknown',
        record: standing ? formatRecord(standing) : '0-0',
        season_ppg: mean(weeklyScores.get(opponentId) ?? []),
      };
    });
}

/**
 * Playoff-race arithmetic. From roughly Week 10 the question stops being "score
 * points" and becomes "what do I need, and against whom" — which a model cannot ask
 * without knowing where the cutoff is.
 */
export function buildStandingView(
  standings: StandingRow[],
  teamId: string,
  labels: Map<string, string>,
  currentWeek: number,
): StandingView {
  const ranked = [...standings].sort((a, b) => a.rank - b.rank);
  const you = ranked.find((row) => row.teamId === teamId);
  if (!you) throw new Error(`buildStandingView: team ${teamId} not in standings`);

  const cutoff = ranked[LEAGUE.playoffTeams - 1];
  // A team already inside the cutoff is 0 back, never negative.
  const gamesBack = cutoff ? Math.max(0, round2(h2hScore(cutoff) - h2hScore(you))) : 0;

  return {
    your_label: labels.get(teamId) ?? 'Unknown',
    your_record: formatRecord(you),
    your_rank: you.rank,
    points_for: you.cumPts,
    games_back_of_cutoff: gamesBack,
    weeks_remaining: Math.max(0, LEAGUE.regularSeasonWeeks - currentWeek),
    playoff_spots: LEAGUE.playoffTeams,
    table: ranked.map((row) => ({
      label: labels.get(row.teamId) ?? 'Unknown',
      record: formatRecord(row),
      points_for: row.cumPts,
      rank: row.rank,
    })),
  };
}

// ---------------------------------------------------------------------------
// Draft board (SPEC §14.3)
// ---------------------------------------------------------------------------

export interface DraftBoardPick {
  pick_overall: number;
  round: number;
  team_label: string;
  player_id: string;
  name: string;
  position: string;
}

/**
 * Every pick made so far, by every team. The board is on the wall in a real draft;
 * withholding it was an accident of the original context object, not a design choice.
 * With it, a model can see positional runs, read what rivals still need, and reason
 * about who is likely to take what before its next pick comes round.
 */
export function buildDraftBoard(
  picks: { pickOverall: number; round: number; teamId: string; playerId: string; name: string; position: string }[],
  labels: Map<string, string>,
): DraftBoardPick[] {
  return [...picks]
    .sort((a, b) => a.pickOverall - b.pickOverall)
    .map((pick) => ({
      pick_overall: pick.pickOverall,
      round: pick.round,
      team_label: labels.get(pick.teamId) ?? 'Unknown',
      player_id: pick.playerId,
      name: pick.name,
      position: pick.position,
    }));
}

/** Roster counts per team, so a model can read need without recounting the board. */
export function draftBoardNeeds(board: DraftBoardPick[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const pick of board) {
    const team = (out[pick.team_label] ??= {});
    team[pick.position] = (team[pick.position] ?? 0) + 1;
  }
  return out;
}
