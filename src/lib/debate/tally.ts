/**
 * The tally. Deterministic TypeScript, never a model call.
 *
 * Same rule as the league commissioner, for the same reason: the whole value
 * proposition is "we measured this," and a measurement produced by a model judging
 * other models is not a measurement, it is a ninth opinion.
 *
 * The headline number is `herdRate`. Everything else is supporting detail.
 */

import type { AnalystTranscript, Call, Slate, Stance } from '@/lib/debate/types';

export interface PlayerTally {
  playerId: string;
  name: string;
  /** CHALK votes in the blind round. */
  chalkR0: number;
  walkR0: number;
  chalkR3: number;
  walkR3: number;
  /** The blind-round majority. `null` on an exact tie. */
  majorityR0: Stance | null;
  /** The final majority. `null` on an exact tie. */
  majorityR3: Stance | null;
  /** Analysts who changed stance on this player between R0 and R3. */
  flips: number;
  /** Unanimous after the debate but not before — the signature of a herd. */
  convergedToUnanimous: boolean;
  /** Mean confidence across all analysts, R0 → R3. */
  meanConfidenceR0: number;
  meanConfidenceR3: number;
}

export interface AnalystTally {
  modelKey: string;
  label: string;
  /** Calls unchanged between R0 and R3. */
  held: number;
  /** Calls changed between R0 and R3. */
  flipped: number;
  /** Of the flips, how many landed on the R0 majority side. */
  flippedToMajority: number;
  /** Of the flips, how many landed AWAY from the R0 majority side. */
  flippedFromMajority: number;
  /** Challenges issued. Zero is a legitimate and interesting result. */
  challengesIssued: number;
  challengesReceived: number;
  /** Self-reported concessions in R2. */
  concessions: number;
  /** Mean confidence R0 → R3. A model that folds usually loses confidence first. */
  meanConfidenceR0: number;
  meanConfidenceR3: number;
  /** How often this analyst was in the R0 minority — i.e. willing to be alone. */
  minorityPositionsR0: number;
  /** Of those minority positions, how many survived to R3. */
  minorityPositionsHeld: number;
}

export interface DebateTally {
  slateId: string;
  players: PlayerTally[];
  analysts: AnalystTally[];

  /**
   * THE GO/NO-GO NUMBER.
   *
   * Of all stance changes across the debate, the share that moved TOWARD the blind
   * majority. Read it like this:
   *
   *   ~1.0  Everyone who moved moved toward the crowd. That is herding, and there is
   *         no product here — the debate manufactures consensus rather than testing it.
   *   ~0.5  Movement is idiosyncratic; models are responding to arguments rather than
   *         to headcount. This is the result that makes the product real.
   *   <0.5  Models actively move away from consensus, which is its own bias and
   *         equally worth knowing about.
   *
   * `null` when nobody moved at all — which is itself a clean result (total
   * intransigence) and must not be reported as 0.
   */
  herdRate: number | null;

  totalFlips: number;
  flipsToMajority: number;
  flipsFromMajority: number;

  /**
   * Share of blind-round minority positions still held at the end. The mirror of the
   * herd rate — high dissent survival is what a subscriber is actually buying.
   */
  dissentSurvival: number | null;
  minorityPositionsR0: number;
  minorityPositionsHeld: number;

  /** Players unanimous before the debate, and after. */
  unanimousR0: number;
  unanimousR3: number;

  totalChallenges: number;
  /** Analysts who challenged nobody at all. */
  silentAnalysts: number;
}

function stanceOf(calls: Call[] | undefined, playerId: string): Call | null {
  return calls?.find((c) => c.playerId === playerId) ?? null;
}

function majority(chalk: number, walk: number): Stance | null {
  if (chalk === walk) return null;
  return chalk > walk ? 'CHALK' : 'WALK';
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(3));
}

export function tallyDebate(slate: Slate, transcripts: AnalystTranscript[]): DebateTally {
  const players: PlayerTally[] = [];

  // Pass 1: per-player counts and the blind majority every movement is measured against.
  const majorityByPlayer = new Map<string, Stance | null>();

  for (const player of slate.players) {
    const r0 = transcripts.map((t) => stanceOf(t.r0?.calls, player.playerId)).filter((c): c is Call => c !== null);
    const r3 = transcripts.map((t) => stanceOf(t.r3?.calls, player.playerId)).filter((c): c is Call => c !== null);

    const chalkR0 = r0.filter((c) => c.stance === 'CHALK').length;
    const walkR0 = r0.length - chalkR0;
    const chalkR3 = r3.filter((c) => c.stance === 'CHALK').length;
    const walkR3 = r3.length - chalkR3;

    let flips = 0;
    for (const t of transcripts) {
      const a = stanceOf(t.r0?.calls, player.playerId);
      const b = stanceOf(t.r3?.calls, player.playerId);
      if (a && b && a.stance !== b.stance) flips++;
    }

    const majR0 = majority(chalkR0, walkR0);
    majorityByPlayer.set(player.playerId, majR0);

    const wasUnanimous = r0.length > 0 && (chalkR0 === 0 || walkR0 === 0);
    const isUnanimous = r3.length > 0 && (chalkR3 === 0 || walkR3 === 0);

    players.push({
      playerId: player.playerId,
      name: player.name,
      chalkR0,
      walkR0,
      chalkR3,
      walkR3,
      majorityR0: majR0,
      majorityR3: majority(chalkR3, walkR3),
      flips,
      convergedToUnanimous: isUnanimous && !wasUnanimous,
      meanConfidenceR0: mean(r0.map((c) => c.confidence)),
      meanConfidenceR3: mean(r3.map((c) => c.confidence)),
    });
  }

  // Pass 2: per-analyst movement, measured against the blind majority.
  const challengesReceived = new Map<string, number>();
  for (const t of transcripts) {
    for (const c of t.r1?.challenges ?? []) {
      challengesReceived.set(c.target, (challengesReceived.get(c.target) ?? 0) + 1);
    }
  }

  const analysts: AnalystTally[] = transcripts.map((t) => {
    let held = 0;
    let flipped = 0;
    let flippedToMajority = 0;
    let flippedFromMajority = 0;
    let minorityR0 = 0;
    let minorityHeld = 0;

    for (const player of slate.players) {
      const a = stanceOf(t.r0?.calls, player.playerId);
      const b = stanceOf(t.r3?.calls, player.playerId);
      if (!a || !b) continue;

      const maj = majorityByPlayer.get(player.playerId) ?? null;

      // A position is "minority" only when there IS a majority to be in the minority
      // of. On a 4-4 tie nobody is in the minority, and counting one side as such
      // would inflate dissent survival with what is really an even split.
      if (maj !== null && a.stance !== maj) {
        minorityR0++;
        if (b.stance === a.stance) minorityHeld++;
      }

      if (a.stance === b.stance) {
        held++;
        continue;
      }
      flipped++;
      if (maj === null) continue; // moved, but there was no crowd to move toward
      if (b.stance === maj) flippedToMajority++;
      else flippedFromMajority++;
    }

    return {
      modelKey: t.modelKey,
      label: t.label,
      held,
      flipped,
      flippedToMajority,
      flippedFromMajority,
      challengesIssued: t.r1?.challenges.length ?? 0,
      challengesReceived: challengesReceived.get(t.label) ?? 0,
      concessions: (t.r2?.rebuttals ?? []).filter((r) => r.concedes).length,
      meanConfidenceR0: mean((t.r0?.calls ?? []).map((c) => c.confidence)),
      meanConfidenceR3: mean((t.r3?.calls ?? []).map((c) => c.confidence)),
      minorityPositionsR0: minorityR0,
      minorityPositionsHeld: minorityHeld,
    };
  });

  const flipsToMajority = analysts.reduce((a, x) => a + x.flippedToMajority, 0);
  const flipsFromMajority = analysts.reduce((a, x) => a + x.flippedFromMajority, 0);
  const decisiveFlips = flipsToMajority + flipsFromMajority;
  const totalFlips = analysts.reduce((a, x) => a + x.flipped, 0);

  const minorityPositionsR0 = analysts.reduce((a, x) => a + x.minorityPositionsR0, 0);
  const minorityPositionsHeld = analysts.reduce((a, x) => a + x.minorityPositionsHeld, 0);

  return {
    slateId: slate.slateId,
    players,
    analysts,
    // Denominator is flips where a majority existed — a flip on a 4-4 tie has no
    // "toward the crowd" direction and including it would drag the rate toward 0 and
    // read as evidence against herding that we did not actually observe.
    herdRate: decisiveFlips === 0 ? null : Number((flipsToMajority / decisiveFlips).toFixed(3)),
    totalFlips,
    flipsToMajority,
    flipsFromMajority,
    dissentSurvival:
      minorityPositionsR0 === 0 ? null : Number((minorityPositionsHeld / minorityPositionsR0).toFixed(3)),
    minorityPositionsR0,
    minorityPositionsHeld,
    unanimousR0: players.filter((p) => p.chalkR0 === 0 || p.walkR0 === 0).length,
    unanimousR3: players.filter((p) => p.chalkR3 === 0 || p.walkR3 === 0).length,
    totalChallenges: analysts.reduce((a, x) => a + x.challengesIssued, 0),
    silentAnalysts: analysts.filter((x) => x.challengesIssued === 0).length,
  };
}

/**
 * The reading. Deliberately blunt — the point of the pilot is a go/no-go, and a
 * hedged summary would let a dead result look survivable.
 */
export function readTally(tally: DebateTally): string {
  if (tally.herdRate === null) {
    return 'NO MOVEMENT — not one analyst changed a position. The debate rounds changed nothing, so there is no consensus signal to sell, only eight independent opinions.';
  }
  if (tally.herdRate >= 0.85) {
    return `HERDING (${tally.herdRate}) — almost every change moved toward the crowd. The debate manufactures consensus rather than testing it. No product here as designed.`;
  }
  if (tally.herdRate >= 0.65) {
    return `LEANS HERD (${tally.herdRate}) — movement is biased toward consensus. Salvageable, but the dissent is soft and the anti-herding levers need tightening before this is sellable.`;
  }
  return `VIABLE (${tally.herdRate}) — movement is not simply toward the crowd, so analysts are responding to arguments rather than headcount. This is the result the product needs.`;
}
