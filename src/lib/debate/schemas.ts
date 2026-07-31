/**
 * Strict zod schemas for every debate response.
 *
 * Same policy as the league schemas: STRICT on anything that changes a measurement —
 * stance, player id, the analyst being challenged — and LENIENT on cosmetics. A model
 * that writes a slightly long rationale has still taken a position, and failing it
 * would misreport a reasoning result as a formatting result.
 *
 * One deliberate leniency: `stance` and `concedes` accept loose casing and the obvious
 * boolean spellings. A model answering `"chalk"` has answered; rejecting it would
 * record a refusal that did not happen. Anything genuinely ambiguous still fails.
 */

import { z } from 'zod';

export const MAX_CHALLENGES = 3;
export const RATIONALE_WORD_LIMIT = 60;

const stance = z
  .union([z.string(), z.boolean()])
  .transform((v) => String(v).trim().toUpperCase())
  .pipe(z.enum(['CHALK', 'WALK']));

const confidence = z.coerce.number().min(0).max(1);

const looseBool = z
  .union([z.boolean(), z.string(), z.number()])
  .transform((v) => {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    return ['true', 'yes', 'y', '1'].includes(v.trim().toLowerCase());
  })
  .pipe(z.boolean());

export const callSchema = z.object({
  playerId: z.string().min(1),
  stance,
  confidence,
  rationale: z.string().min(1),
});

export const roundZeroSchema = z.object({
  calls: z.array(callSchema).min(1),
});

export const challengeSchema = z.object({
  playerId: z.string().min(1),
  target: z.string().min(1),
  claim: z.string().min(1),
  evidence: z.string().min(1),
  confidence,
});

/**
 * Challenges are capped but NOT floored.
 *
 * It is tempting to require at least one, so every round produces content. That would
 * be a serious mistake: forcing dissent manufactures disagreement that the model does
 * not hold, and disagreement is precisely the quantity being sold. A model that
 * challenges nobody is a finding, and it must be allowed to say so.
 */
export const roundOneSchema = z.object({
  challenges: z.array(challengeSchema).max(12),
});

export const rebuttalSchema = z.object({
  playerId: z.string().min(1),
  challenger: z.string().min(1),
  response: z.string().min(1),
  concedes: looseBool,
});

export const roundTwoSchema = z.object({
  rebuttals: z.array(rebuttalSchema).max(24),
});

export const roundThreeSchema = z.object({
  calls: z.array(callSchema).min(1),
});

/** Non-fatal deviations, surfaced alongside the result rather than failing the model. */
export function callSoftViolations(calls: { rationale: string }[], expected: number): string[] {
  const notes: string[] = [];
  if (calls.length !== expected) {
    notes.push(`calls: ${calls.length} (expected ${expected})`);
  }
  calls.forEach((c, i) => {
    const words = c.rationale.trim().split(/\s+/).length;
    if (words > RATIONALE_WORD_LIMIT) {
      notes.push(`calls[${i}].rationale: ${words} words (max ${RATIONALE_WORD_LIMIT})`);
    }
  });
  return notes;
}

export function challengeSoftViolations(challenges: unknown[]): string[] {
  return challenges.length > MAX_CHALLENGES
    ? [`challenges: ${challenges.length} (max ${MAX_CHALLENGES})`]
    : [];
}

export const DEBATE_SCHEMAS = {
  r0: roundZeroSchema,
  r1: roundOneSchema,
  r2: roundTwoSchema,
  r3: roundThreeSchema,
} as const;
