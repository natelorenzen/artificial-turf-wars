/**
 * Build the anonymised grading board.
 *
 * Two decisions in here do more work than the rest of the module put together.
 *
 * ---------------------------------------------------------------------------
 * 1. NO ROSTER TOTALS
 * ---------------------------------------------------------------------------
 * Every player carries our projection, because that is the number the models drafted
 * from and withholding it would make them grade blind. But the board does NOT carry
 * the sum, the best-legal-lineup projection, or any other aggregate.
 *
 * If it did, this measures nothing. Eight models handed a column of totals will all
 * sort by the column, agreement will come out near 1.0, and we will have published a
 * finding about addition. Withholding the aggregate is what makes a ranking a
 * judgement — about roster construction, positional scarcity, injury risk, bench
 * value, what a bye-week collision costs — rather than a lookup. The totals still get
 * computed, by us, deterministically, and the tally asks afterwards how much of the
 * consensus was just the arithmetic after all. That is the interesting version of the
 * question and it needs the models not to have been given the answer.
 *
 * ---------------------------------------------------------------------------
 * 2. PICKS ONLY, NO REASONING
 * ---------------------------------------------------------------------------
 * We publish every model's stated reasoning for all 120 picks, and it is tempting to
 * show it here — "grade the argument, not just the outcome". It is left out for a
 * reason that is not about length: prose is a fingerprint. Eight frontier models have
 * distinguishable house styles, and a grader shown 120 rationales is being handed a
 * much easier self-recognition task and a channel through which brand preference can
 * re-enter through the back door. The board is picks, prices and player facts — all of
 * it derivable by anyone from the published results.
 */

import { LEAGUE, type Position } from '@/lib/config/league';
import { stableHash } from '@/lib/util/hash';
import type { BoardPlayer, BoardTeam, GradingBoard } from '@/lib/grades/types';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Draft slot 1 -> "Team A".
 *
 * Deliberately a copy of `src/lib/engine/labels.ts` rather than an import of it. The
 * firewall runs both ways, and a shared helper is one refactor away from becoming a
 * shared dependency between the league and a module that shows models each other's
 * work. Nine lines of duplication is the cheaper of the two risks. The scheme is
 * identical on purpose: a grader looking at "Team C" is looking at the same Team C the
 * league has shown it all season.
 */
export function labelForSlot(slot: number): string {
  if (!Number.isInteger(slot) || slot < 1 || slot > ALPHABET.length) {
    throw new Error(`labelForSlot: slot ${slot} out of range`);
  }
  return `Team ${ALPHABET[slot - 1]}`;
}

export interface TeamRow {
  teamId: string;
  modelKey: string;
  draftSlot: number;
  auctionBid: number;
  faabRemaining: number;
}

export interface PickRow {
  teamId: string;
  playerId: string;
  pickOverall: number;
  round: number;
  name: string;
  position: Position;
  nflTeam: string | null;
  projectedPoints: number | null;
  adp: number | null;
}

/** Roster display order. Not the lineup — just a stable reading order for the prompt. */
const POSITION_ORDER: Position[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

export interface BuildBoardResult {
  board: GradingBoard;
  /** modelKey -> the label of the team that model actually drafted. The answer key. */
  ownTeamByModel: Map<string, string>;
}

export function buildGradingBoard(
  teams: TeamRow[],
  picks: PickRow[],
  season: number,
): BuildBoardResult {
  if (teams.length !== LEAGUE.teams) {
    throw new Error(`buildGradingBoard: expected ${LEAGUE.teams} teams, got ${teams.length}`);
  }

  const expectedPicks = LEAGUE.teams * LEAGUE.draftRounds;
  if (picks.length !== expectedPicks) {
    // A partial board would still grade, and the grades would be garbage in a way no
    // reader could see. Refuse rather than publish a ranking of eight rosters where
    // one of them is missing its last four rounds.
    throw new Error(`buildGradingBoard: ${picks.length}/${expectedPicks} picks — refusing a partial board`);
  }

  const slots = new Set<number>();
  const ownTeamByModel = new Map<string, string>();
  const boardTeams: BoardTeam[] = [];

  for (const team of [...teams].sort((a, b) => a.draftSlot - b.draftSlot)) {
    if (slots.has(team.draftSlot)) {
      throw new Error(`buildGradingBoard: draft slot ${team.draftSlot} assigned twice`);
    }
    slots.add(team.draftSlot);
    const label = labelForSlot(team.draftSlot);
    ownTeamByModel.set(team.modelKey, label);

    const roster: BoardPlayer[] = picks
      .filter((p) => p.teamId === team.teamId)
      .sort((a, b) => {
        const byPos = POSITION_ORDER.indexOf(a.position) - POSITION_ORDER.indexOf(b.position);
        return byPos !== 0 ? byPos : a.pickOverall - b.pickOverall;
      })
      .map((p) => ({
        playerId: p.playerId,
        name: p.name,
        position: p.position,
        nflTeam: p.nflTeam,
        pick: p.pickOverall,
        round: p.round,
        projectedPoints: p.projectedPoints,
        adp: p.adp,
      }));

    if (roster.length !== LEAGUE.draftRounds) {
      throw new Error(`buildGradingBoard: ${label} has ${roster.length} players, expected ${LEAGUE.draftRounds}`);
    }

    boardTeams.push({
      label,
      draftSlot: team.draftSlot,
      auctionBid: team.auctionBid,
      faabRemaining: team.faabRemaining,
      players: roster,
    });
  }

  const board: GradingBoard = {
    boardId: '',
    season,
    teams: boardTeams,
    pickCount: picks.length,
    createdAt: new Date().toISOString(),
  };

  // Hash the material, not the wrapper: `createdAt` changes on every build and would
  // make an identical board look like a different one. The id is what lets a reader
  // check that all eight graders answered the same question.
  board.boardId = stableHash({ season, teams: boardTeams }).slice(0, 16);

  return { board, ownTeamByModel };
}

/**
 * Deterministic roster arithmetic — computed by us, never shown to a grader.
 *
 * This exists so the tally can ask the question the board deliberately refuses to
 * answer for the models: once the consensus ranking is in, how much of it is explained
 * by simply adding up the projections? A consensus that reproduces the totals column
 * is a much weaker finding than one that departs from it, and we should be able to
 * tell the difference before we write either sentence down.
 */
export function projectedTotals(team: BoardTeam): { roster: number; starters: number } {
  const roster = team.players.reduce((sum, p) => sum + (p.projectedPoints ?? 0), 0);

  // Best legal starting lineup by projection: fill each required slot with the highest
  // projected player at that position, then FLEX from what is left.
  const pool = [...team.players].sort((a, b) => (b.projectedPoints ?? 0) - (a.projectedPoints ?? 0));
  const used = new Set<string>();
  let starters = 0;

  for (const [slot, count] of Object.entries(LEAGUE.slots)) {
    if (slot === 'FLEX') continue;
    let filled = 0;
    for (const p of pool) {
      if (filled >= count) break;
      if (used.has(p.playerId) || p.position !== slot) continue;
      used.add(p.playerId);
      starters += p.projectedPoints ?? 0;
      filled++;
    }
  }
  let flexFilled = 0;
  for (const p of pool) {
    if (flexFilled >= LEAGUE.slots.FLEX) break;
    if (used.has(p.playerId) || !LEAGUE.flexEligible.includes(p.position)) continue;
    used.add(p.playerId);
    starters += p.projectedPoints ?? 0;
    flexFilled++;
  }

  return { roster: Number(roster.toFixed(1)), starters: Number(starters.toFixed(1)) };
}

/**
 * Guard for anything about to be sent to a grader. Display names, lab names and
 * OpenRouter ids must never reach a grading prompt.
 *
 * The stake is higher here than in a league DATA block. A grader that can see which
 * lab drafted Team C is no longer grading a roster; it is expressing a view about a
 * competitor's brand, and both headline numbers — the agreement between graders and
 * the gap between how a model rates its own draft and how everyone else rates it —
 * would be measuring that instead, with nothing in the output to show it.
 */
export function assertNoIdentityLeak(serialized: string, forbidden: readonly string[]): void {
  const hits = forbidden.filter((needle) => needle && serialized.includes(needle));
  if (hits.length > 0) {
    throw new Error(
      `Grading prompt leaks model identity: ${hits.join(', ')}. Drafters must appear ` +
        'only as anonymous team labels.',
    );
  }
}
