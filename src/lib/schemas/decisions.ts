/**
 * Strict zod schemas for every model response (SPEC §4.1a, §4.2–§4.5).
 *
 * Validation policy, stated once: we are STRICT about anything that changes the
 * outcome — player ids, bids, slot permutations, lineup legality — because a wrong
 * value there corrupts the season. We are LENIENT about cosmetics — a fifth
 * key_factor, a 23-word bullet — because triggering a deterministic fallback over a
 * formatting slip would misreport a model as having failed when it reasoned fine.
 * Cosmetic violations are recorded on the decision and shown publicly instead.
 */

import { z } from 'zod';
import { LEAGUE } from '@/lib/config/league';

export const KEY_FACTOR_WORD_LIMIT = 20;
export const KEY_FACTOR_MIN = 2;
export const KEY_FACTOR_MAX = 4;

/** Shared structured reasoning — the product (SPEC §4.1a). */
export const reasoningSchema = z.object({
  headline: z.string().min(1),
  key_factors: z.array(z.string().min(1)).min(1).max(12),
  closest_call: z.string().min(1),
  what_would_change_it: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

export type Reasoning = z.infer<typeof reasoningSchema>;

/** Non-fatal deviations from the bounded schema, surfaced on the site. */
export function reasoningSoftViolations(r: Reasoning): string[] {
  const notes: string[] = [];
  if (r.key_factors.length < KEY_FACTOR_MIN) notes.push(`key_factors: ${r.key_factors.length} (min ${KEY_FACTOR_MIN})`);
  if (r.key_factors.length > KEY_FACTOR_MAX) notes.push(`key_factors: ${r.key_factors.length} (max ${KEY_FACTOR_MAX})`);
  r.key_factors.forEach((f, i) => {
    const words = f.trim().split(/\s+/).length;
    if (words > KEY_FACTOR_WORD_LIMIT) notes.push(`key_factors[${i}]: ${words} words (max ${KEY_FACTOR_WORD_LIMIT})`);
  });
  return notes;
}

// ---------------------------------------------------------------------------
// Pre-season
// ---------------------------------------------------------------------------

/**
 * Step 2, the fairness gate. Answers are scored deterministically (SPEC §4.1b).
 *
 * `answer` accepts a number as well as a string. Several questions ask for "a number
 * only", and a model that replies `20.2` rather than `"20.2"` has answered correctly —
 * arguably more correctly. Rejecting it would fail a model on JSON typing and report
 * it publicly as not understanding the scoring table, which is exactly the
 * misattribution the strict-on-outcomes/lenient-on-cosmetics policy exists to prevent.
 *
 * Caught by the very first full-cohort run: one model returned every numeric answer
 * as a JSON number and scored 0 despite getting the answers right.
 */
const answerValue = z
  .union([z.string().min(1), z.number(), z.boolean()])
  .transform((v) => String(v));

export const rulesCheckSchema = z.object({
  answers: z.array(
    z.object({
      id: z.string().min(1),
      answer: answerValue,
    }),
  ),
});

export const gameplanSchema = z
  .object({
    positional_strategy: z.string().min(1),
    auction_stance: z.string().min(1),
    scarcity_read: z.string().min(1),
    risk_posture: z.string().min(1),
    waiver_philosophy: z.string().min(1),
  })
  .merge(reasoningSchema.pick({ key_factors: true, confidence: true }));

// ---------------------------------------------------------------------------
// Auction (SPEC §4.2)
// ---------------------------------------------------------------------------

const slotPermutation = z
  .array(z.number().int())
  .length(LEAGUE.teams)
  .refine(
    (slots) => {
      const sorted = [...slots].sort((a, b) => a - b);
      return sorted.every((v, i) => v === i + 1);
    },
    { message: `slot_preference must be a permutation of 1..${LEAGUE.teams} with no repeats or omissions` },
  );

export const auctionSchema = reasoningSchema.extend({
  bid: z.number().int().min(0).max(LEAGUE.budgetTotal),
  slot_preference: slotPermutation,
});

// ---------------------------------------------------------------------------
// Draft (SPEC §4.3)
// ---------------------------------------------------------------------------

export const draftPickSchema = reasoningSchema.extend({
  pick: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Lineup (SPEC §4.4)
// ---------------------------------------------------------------------------

/**
 * Ways a model says "I have nobody eligible for this slot".
 *
 * The 2025 week-6 rehearsal produced both spellings in one run: GPT-5.6 Sol sent JSON
 * `null` for `te` and `k`, and Qwen3.7 Plus sent the STRING "null" for `def` while
 * explaining, correctly, that its only defence was on bye. Both were recorded as
 * failures and given a deterministic fallback for being right.
 *
 * Normalising these is not repair in the sense §4.1a forbids. The decision is
 * unchanged — the model said the slot is empty and the slot is empty. What differs is
 * only how it spelled it, and grading a model on JSON spelling measures our schema.
 */
const EMPTY_SLOT_TOKENS = new Set(['null', 'none', 'empty', 'n/a', '-', '']);

/**
 * One starting slot. Nullable, because an empty slot is a legal outcome the rules
 * anticipate: SPEC §4.4 requires an unfilled slot to score 0 and be SHOWN as empty
 * rather than as a quiet zero, so the mistake stays visible as a mistake.
 *
 * A roster genuinely cannot always fill nine. In 2025 week 6, with Houston and
 * Minnesota on bye, three of eight teams had no legal option somewhere — and the
 * deterministic fallback left those slots empty too. A schema that forbade what the
 * engine produces would fail every model that noticed.
 *
 * Whether the empty slot was AVOIDABLE is a separate question, and a real one. That is
 * checked against the roster in `lineupProblem`, not here.
 */
const lineupSlot = z.preprocess(
  (value) =>
    typeof value === 'string' && EMPTY_SLOT_TOKENS.has(value.trim().toLowerCase()) ? null : value,
  z.string().min(1).nullable(),
);

export const lineupSchema = reasoningSchema.extend({
  qb: lineupSlot,
  rb: z.array(lineupSlot).length(LEAGUE.slots.RB),
  wr: z.array(lineupSlot).length(LEAGUE.slots.WR),
  te: lineupSlot,
  flex: lineupSlot,
  k: lineupSlot,
  def: lineupSlot,
});

// ---------------------------------------------------------------------------
// Waivers (SPEC §4.5)
// ---------------------------------------------------------------------------

export const waiverSchema = reasoningSchema.extend({
  /** An empty array is a valid, meaningful answer: standing pat is a decision. */
  claims: z.array(
    z.object({
      add_player_id: z.string().min(1),
      drop_player_id: z.string().min(1),
      bid: z.number().int().min(0).max(LEAGUE.budgetTotal),
      reasoning: z.string().min(1),
    }),
  ),
});

// ---------------------------------------------------------------------------
// Weekly wrap — written by a NON-COMPETING model (SPEC §7.5)
// ---------------------------------------------------------------------------

export const recapSchema = z.object({
  headline: z.string().min(1),
  short_post: z.string().min(1),
  column_md: z.string().min(1),
});

export type AuctionResponse = z.infer<typeof auctionSchema>;
export type DraftPickResponse = z.infer<typeof draftPickSchema>;
export type LineupResponse = z.infer<typeof lineupSchema>;
export type WaiverResponse = z.infer<typeof waiverSchema>;
export type GameplanResponse = z.infer<typeof gameplanSchema>;
export type RulesCheckResponse = z.infer<typeof rulesCheckSchema>;
export type RecapResponse = z.infer<typeof recapSchema>;

export const SCHEMAS = {
  rules_check: rulesCheckSchema,
  gameplan: gameplanSchema,
  auction: auctionSchema,
  draft_pick: draftPickSchema,
  lineup: lineupSchema,
  waiver: waiverSchema,
  recap: recapSchema,
} as const;

export type DecisionType = keyof typeof SCHEMAS;

/**
 * Models are told to return bare JSON. They sometimes wrap it in fences or prose
 * anyway. `raw_response` is stored before this runs, so the public log shows exactly
 * what the model emitted — this only affects whether we can parse it.
 */
export function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    // Fall back to the outermost balanced {...} in the response.
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error('no JSON object found in response');
  }
}
