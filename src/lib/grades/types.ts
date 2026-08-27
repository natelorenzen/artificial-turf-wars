/**
 * Draft report cards — types.
 *
 * ============================ FIREWALL ============================
 * This module is NOT part of the league and must never touch it.
 *
 * The league measures eight models reasoning INDEPENDENTLY from a common DATA block.
 * Here we hand every model the finished draft board — including, unlabelled, its own
 * roster — and ask it to grade all eight. That is a fine thing to publish and a
 * catastrophic thing to leak: a model that has been told its own draft was graded
 * seventh has been handed a motive for every waiver claim it makes afterwards, and no
 * later week could be read as independent reasoning again.
 *
 * So, exactly as with `src/lib/debate/**`: separate module, separate storage, separate
 * prompts, nothing written to a league table, and nothing produced here may ever enter
 * a league prompt, memory block, or DATA block. There is a test asserting both
 * directions of the import boundary.
 * ==================================================================
 *
 * The mechanic, in two calls per model:
 *
 *   R1  GRADE     Each model sees the identical anonymised board — 120 picks, eight
 *                 rosters as Team A..H — and grades and ranks all eight. It is NOT
 *                 told that one of them is its own. That silence is the design: a
 *                 grader told to look for itself grades differently, and the whole
 *                 self-preference measurement would be an artefact of our prompt.
 *   R2  IDENTIFY  Same board, one question: which of these eight did you draft? Asked
 *                 second and in a separate call so it cannot colour the grades.
 *
 * What comes out is three findings from one $2 run:
 *   1. CONSENSUS. Kendall's W over eight independent rankings of the same eight
 *      rosters. Do frontier models agree on what a good draft looks like?
 *   2. SELF-PREFERENCE. The rank a model gave its own roster, against the mean rank
 *      the other seven gave it, while none of them knew whose was whose.
 *   3. SELF-RECOGNITION. Can a model pick its own draft out of a lineup of eight?
 *
 * None of the three needs the season to finish, and all three get better when it does:
 * the grades are on the record before a single game is played, so in January we can
 * ask which grader was right rather than which one sounded confident.
 */

import type { Position } from '@/lib/config/league';

/** One drafted player as a grader sees them. */
export interface BoardPlayer {
  playerId: string;
  name: string;
  position: Position;
  nflTeam: string | null;
  /** Overall pick number, 1..120. */
  pick: number;
  round: number;
  /**
   * Our season projection and the real market ADP — the same two numbers that were in
   * the dossier every model drafted from, so a grader is second-guessing the board
   * with the information the board was built from and nothing extra.
   */
  projectedPoints: number | null;
  adp: number | null;
}

/**
 * One team as a grader sees them: a label, what the slot cost at auction, and fifteen
 * players. No model name, no lab, and deliberately NO ROSTER TOTALS — see `board.ts`.
 */
export interface BoardTeam {
  /** `Team A`..`Team H`, derived from draft slot exactly as the league does it. */
  label: string;
  draftSlot: number;
  /** Auction price paid for the slot, out of a $100 budget shared with season FAAB. */
  auctionBid: number;
  faabRemaining: number;
  players: BoardPlayer[];
}

export interface GradingBoard {
  /** Hash of the serialized board. All eight prompts are byte-identical; this proves it. */
  boardId: string;
  season: number;
  teams: BoardTeam[];
  /** Total picks on the board, asserted against teams x rounds before anything is sent. */
  pickCount: number;
  createdAt: string;
}

/** The letter grades a model may award, best to worst. Index is the numeric value. */
export const GRADE_SCALE = [
  'F', 'D-', 'D', 'D+', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A', 'A+',
] as const;

export type Grade = (typeof GRADE_SCALE)[number];

/** F = 0, A+ = 12. Averaging letters requires a number; this is that number. */
export function gradeValue(grade: Grade): number {
  return GRADE_SCALE.indexOf(grade);
}

export interface TeamGrade {
  team: string;
  grade: Grade;
  verdict: string;
  /** Player id from that team's roster. Validated against the board, not just parsed. */
  bestPick: string;
  bestPickWhy: string;
  worstPick: string;
  worstPickWhy: string;
}

export interface GradeCard {
  /**
   * The one thing this grader says it weighted most heavily. Free text, never
   * constrained, and the reason a disagreement can be diagnosed rather than just
   * counted: two models can rank the same board differently because they answered
   * different questions, and without this we could not tell that from a genuine
   * disagreement about the same question.
   */
  criterion: string;
  /** All eight labels, best draft first. Strictly a permutation — no ties, no omissions. */
  ranking: string[];
  grades: TeamGrade[];
}

export interface SelfGuess {
  team: string;
  confidence: number;
  why: string;
}

/** Everything one model produced. */
export interface GraderTranscript {
  /** Cohort key, e.g. `claude-opus-5`. Never shown to any model, including this one. */
  modelKey: string;
  /** The label of the team this model actually drafted. The answer key, never sent. */
  ownTeam: string;
  card: GradeCard | null;
  guess: SelfGuess | null;
  /** Non-fatal deviations — long verdicts and the like. Published, not penalised. */
  softViolations: string[];
}

export interface GradesRun {
  board: GradingBoard;
  transcripts: GraderTranscript[];
  costUsd: number;
  calls: number;
  live: boolean;
  /** Set when a failure that affects every remaining call cut the run short. */
  aborted?: string | null;
}
