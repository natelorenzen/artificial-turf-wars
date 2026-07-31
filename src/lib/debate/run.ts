/**
 * The four-round runner.
 *
 * Round order is the whole design, so it is worth restating where it is enforced:
 *
 *   R0 is BLIND. No transcript is passed. This is the control.
 *   R1 challenges are built from R0 ONLY, for every analyst, before any of them are
 *      recorded — that is what makes them simultaneous. Building them incrementally
 *      would let analyst H answer analyst A's challenge, and the run would measure
 *      turn order rather than reasoning.
 *   R2 shows an analyst only the challenges aimed at it.
 *   R3 shows everyone the full debate.
 *
 * `callFn` is injected so the dry run can substitute synthetic responses and exercise
 * the identical code path without spending anything.
 */

import type { ZodType, ZodTypeDef } from 'zod';
import { COHORT } from '@/lib/config/league';
import { assertNoAnalystLeak, assignAnalystLabels } from '@/lib/debate/labels';
import {
  DEBATE_SYSTEM_PROMPT,
  buildRoundOne,
  buildRoundThree,
  buildRoundTwo,
  buildRoundZero,
} from '@/lib/debate/prompts';
import { roundOneSchema, roundThreeSchema, roundTwoSchema, roundZeroSchema } from '@/lib/debate/schemas';
import type { AnalystTranscript, DebateRun, Slate } from '@/lib/debate/types';

export interface DebateCallResult<T> {
  ok: boolean;
  parsed: T | null;
  rawResponse: string | null;
  validationError: string | null;
  costUsd: number | null;
}

/**
 * The debate schemas coerce their input — `"chalk"` becomes `CHALK`, `"yes"` becomes
 * `true` — so each one's INPUT type differs from its OUTPUT type. `ZodType<T>` defaults
 * the input to the output and would reject every one of them, so the input parameter is
 * widened here. `T` still binds to the parsed output, which is the type that matters to
 * every caller.
 */
export type DebateSchema<T> = ZodType<T, ZodTypeDef, unknown>;

export type DebateCallFn = <T>(args: {
  openrouterId: string;
  systemPrompt: string;
  userPrompt: string;
  schema: DebateSchema<T>;
  round: string;
  modelKey: string;
}) => Promise<DebateCallResult<T>>;

export interface RunOptions {
  slate: Slate;
  call: DebateCallFn;
  live: boolean;
  /** Restrict the cohort, for a cheaper pilot. Defaults to all eight. */
  modelKeys?: string[];
  onEvent?: (message: string) => void;
}

/**
 * Everything that must never appear in a debate prompt. Display names AND lab names —
 * "Anthropic" identifies a model just as precisely as "Claude Opus 5" does.
 */
function forbiddenStrings(): string[] {
  return COHORT.flatMap((m) => [m.displayName, m.lab, m.openrouterId]);
}

export async function runDebate(options: RunOptions): Promise<DebateRun> {
  const { slate, call, live, onEvent = () => {} } = options;
  const cohort = COHORT.filter((m) => !options.modelKeys || options.modelKeys.includes(m.key));
  if (cohort.length === 0) throw new Error('runDebate: no models selected');

  const { byModel } = assignAnalystLabels(cohort.map((m) => m.key), slate.slateId);
  const forbidden = forbiddenStrings();

  const transcripts: AnalystTranscript[] = cohort.map((m) => ({
    modelKey: m.key,
    label: byModel.get(m.key)!,
    r0: null,
    r1: null,
    r2: null,
    r3: null,
  }));

  let costUsd = 0;
  let calls = 0;

  const guardedCall = async <T>(
    modelKey: string,
    openrouterId: string,
    userPrompt: string,
    schema: DebateSchema<T>,
    round: string,
  ): Promise<T | null> => {
    // Guard EVERY prompt, every round. The leak that matters most is the one in a
    // later round, where a rival's rationale could quote a lab name back at us.
    assertNoAnalystLeak(userPrompt, forbidden);
    const result = await call({ openrouterId, systemPrompt: DEBATE_SYSTEM_PROMPT, userPrompt, schema, round, modelKey });
    calls++;
    costUsd += result.costUsd ?? 0;
    if (!result.ok) {
      onEvent(`  ${round} ${modelKey}: FAILED — ${result.validationError ?? 'unknown'}`);
      return null;
    }
    return result.parsed;
  };

  // ---- R0: blind ----------------------------------------------------------
  onEvent(`R0 blind opening — ${cohort.length} analysts, ${slate.players.length} players`);
  const r0Prompt = buildRoundZero(slate);
  for (const t of transcripts) {
    const model = cohort.find((m) => m.key === t.modelKey)!;
    t.r0 = await guardedCall(t.modelKey, model.openrouterId, r0Prompt, roundZeroSchema, 'R0');
  }

  // ---- R1: simultaneous challenges ---------------------------------------
  // Prompts are built from a SNAPSHOT of R0 taken before any R1 result is recorded.
  onEvent('R1 challenges (simultaneous)');
  const boardSnapshot = transcripts.map((t) => ({ ...t }));
  const r1Prompts = new Map(
    transcripts.map((t) => [t.modelKey, buildRoundOne(slate, boardSnapshot, t.label)]),
  );
  for (const t of transcripts) {
    const model = cohort.find((m) => m.key === t.modelKey)!;
    t.r1 = await guardedCall(t.modelKey, model.openrouterId, r1Prompts.get(t.modelKey)!, roundOneSchema, 'R1');
  }

  // ---- R2: rebuttals ------------------------------------------------------
  onEvent('R2 rebuttals');
  const challengeSnapshot = transcripts.map((t) => ({ ...t }));
  for (const t of transcripts) {
    const prompt = buildRoundTwo(slate, challengeSnapshot, t.label);
    if (prompt === null) {
      // Nobody challenged this analyst. Skipping saves a call and, more importantly,
      // avoids prompting for a rebuttal to nothing — which invites invention.
      t.r2 = { rebuttals: [] };
      continue;
    }
    const model = cohort.find((m) => m.key === t.modelKey)!;
    t.r2 = await guardedCall(t.modelKey, model.openrouterId, prompt, roundTwoSchema, 'R2');
  }

  // ---- R3: final chalk or walk -------------------------------------------
  onEvent('R3 final chalk or walk');
  const debateSnapshot = transcripts.map((t) => ({ ...t }));
  for (const t of transcripts) {
    const model = cohort.find((m) => m.key === t.modelKey)!;
    const prompt = buildRoundThree(slate, debateSnapshot, t.label);
    t.r3 = await guardedCall(t.modelKey, model.openrouterId, prompt, roundThreeSchema, 'R3');
  }

  return { slate, transcripts, costUsd: Number(costUsd.toFixed(4)), calls, live };
}
