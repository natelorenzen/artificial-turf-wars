/**
 * Chalk or Walk — types.
 *
 * ============================ FIREWALL ============================
 * This module is NOT part of the league and must never touch it.
 *
 * The league measures eight models reasoning INDEPENDENTLY. The moment a model's
 * league decisions are informed by having watched seven rivals argue, the season stops
 * measuring independent fantasy reasoning and the central claim of the project is
 * gone. So: separate slate, separate storage, separate prompts, and nothing produced
 * here may ever enter a league prompt, memory block, or DATA block.
 *
 * Concretely — no import in `src/lib/debate/**` may reach into league decision
 * assembly, and nothing in `src/lib/prompt/**` may import from here. There is a test
 * asserting the second direction.
 * ==================================================================
 *
 * The mechanic, in four rounds:
 *
 *   R0  BLIND     Each model takes a CHALK/WALK position on every slate player with
 *                 no knowledge of any other model. This is the control, and it is the
 *                 entire scientific value of the exercise — without an independent
 *                 prior you cannot tell later whether a model reasoned its way to a
 *                 position or simply followed the room.
 *   R1  CHALLENGE Each model sees the pooled board under anonymous labels and issues
 *                 bounded challenges. Generated in parallel and revealed at once: run
 *                 sequentially, whoever speaks last has outsized influence and you are
 *                 measuring turn order rather than reasoning.
 *   R2  REBUTTAL  Challenged models answer. One round only — this is where cost and
 *                 context growth would otherwise run away.
 *   R3  FINAL     Each model restates CHALK or WALK having seen the debate.
 *
 * The product is not the verdict. It is the delta between R0 and R3: who held, who
 * folded, and whether holding predicts being right.
 */

import type { Position } from '@/lib/config/league';

/**
 * The proposition under debate for one player, stated so that it has a truth value.
 *
 * CHALK = the market is right about this player at this price; ride it.
 * WALK  = the market is wrong; fade it.
 *
 * Binary on purpose. A three-way stance with a "hold" option would let a model avoid
 * committing, and an uncommitted model cannot herd, hold, or be scored — it would
 * quietly drain every metric this thing exists to produce.
 */
export type Stance = 'CHALK' | 'WALK';

export interface SlatePlayer {
  playerId: string;
  name: string;
  position: Position;
  team: string | null;
  /** Our projected season points under league scoring. */
  projectedPoints: number;
  /** Rank at the position by our projection. 1 = best. */
  projectionRank: number;
  /** Real ADP from the week-1 endpoint. Never 1000.0 — that means unranked. */
  adp: number;
  /** Rank at the position by ADP. 1 = drafted earliest. */
  adpRank: number;
  /**
   * projectionRank - adpRank. Negative means we like the player more than the market
   * does; positive means the market likes them more than we do. This is the number
   * that makes the player worth arguing about at all.
   */
  divergence: number;
}

export interface Slate {
  /** Stable id; also the shuffle seed for analyst labels. */
  slateId: string;
  season: number;
  createdAt: string;
  players: SlatePlayer[];
}

/** One model's position on one player. Used identically in R0 and R3. */
export interface Call {
  playerId: string;
  stance: Stance;
  confidence: number;
  rationale: string;
}

export interface RoundZero {
  calls: Call[];
}

export interface Challenge {
  /** The player whose treatment is being challenged. */
  playerId: string;
  /** The anonymous analyst being challenged, e.g. "Analyst C". */
  target: string;
  claim: string;
  evidence: string;
  confidence: number;
}

export interface RoundOne {
  challenges: Challenge[];
}

export interface Rebuttal {
  playerId: string;
  /** The analyst who raised the challenge being answered. */
  challenger: string;
  response: string;
  /** Whether this rebuttal concedes the point. Self-reported; not used for scoring. */
  concedes: boolean;
}

export interface RoundTwo {
  rebuttals: Rebuttal[];
}

export interface RoundThree {
  calls: Call[];
}

/** Everything one model produced across the four rounds. */
export interface AnalystTranscript {
  /** Cohort key, e.g. `claude-opus-5`. Never shown to another model. */
  modelKey: string;
  /** Anonymous per-slate label, e.g. "Analyst C". This is what rivals see. */
  label: string;
  r0: RoundZero | null;
  r1: RoundOne | null;
  r2: RoundTwo | null;
  r3: RoundThree | null;
}

export interface DebateRun {
  slate: Slate;
  transcripts: AnalystTranscript[];
  /** Wall-clock and spend, for the unit economics this has to justify. */
  costUsd: number;
  calls: number;
  live: boolean;
}
