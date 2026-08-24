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

// ---------------------------------------------------------------------------
// Salvage: a response WE cut off, not one the model got wrong
// ---------------------------------------------------------------------------

/**
 * Close a JSON object that our own output ceiling truncated mid-write.
 *
 * This is the same principle as normalising `null` vs `"null"` above, and it is not
 * repair in the sense §4.1a forbids. The decision is unchanged — the model named its
 * pick and we cut the message off afterwards. What differs is only whether the closing
 * brace arrived, and grading a model on whether our token budget outlasted its sentence
 * measures our budget rather than its reasoning.
 *
 * It earned its place on draft day. Qwen3.8 Max, pick 45: `"pick": "LAR"` with all four
 * key_factors, the closest_call and the what_would_change_it present, cut off inside the
 * word `"confidence`. The deterministic fallback then handed it Jayden Daniels — the
 * exact player whose 5.30 points over replacement its own key_factors had rejected in
 * favour of the Rams' 22.94. A complete argument was discarded over a missing float.
 *
 * Deliberately conservative. It never invents a value and never completes a partial one:
 * it rewinds to the last property that finished cleanly and closes the object there, so
 * a half-written field is dropped rather than guessed. Returns null when there is no
 * complete property to rewind to — an empty or barely-started response is a real
 * failure and still gets the fallback.
 */
export function salvageTruncatedJson(raw: string): unknown | null {
  const text = raw.trim();
  const start = text.indexOf('{');
  if (start < 0) return null;

  let inString = false;
  let escaped = false;
  const depth: string[] = [];
  /** Index to cut at: the end of the last property that completed at the top level. */
  let lastComplete = -1;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      if (inString) escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === '{' || ch === '[') {
      depth.push(ch);
    } else if (ch === '}' || ch === ']') {
      depth.pop();
      // A nested value (an array of key_factors, say) just closed at the top level.
      if (depth.length === 1) lastComplete = i + 1;
    } else if (ch === ',' && depth.length === 1) {
      // A scalar property just ended. Cut BEFORE the comma so nothing dangles.
      lastComplete = i;
    }
  }

  if (lastComplete < 0) return null;
  try {
    return JSON.parse(text.slice(start, lastComplete) + '}');
  } catch {
    return null;
  }
}

/**
 * What a truncated draft pick must STILL contain to be honoured.
 *
 * Strict on the outcome, absent-tolerant on the reasoning — the policy stated at the
 * top of this file, applied to a case it did not anticipate. `pick` decides who joins
 * a roster for the season and is non-negotiable; `confidence` is a self-report, and a
 * decision missing it is worth publishing with the gap shown. Every consumer of these
 * fields already null-guards them (`extractReasoning`).
 */
export const draftPickSalvageSchema = z.object({
  pick: z.string().min(1),
  headline: z.string().min(1).optional(),
  key_factors: z.array(z.string().min(1)).optional(),
  closest_call: z.string().min(1).optional(),
  what_would_change_it: z.string().min(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

/**
 * Salvage schemas for the two weekly decisions, same policy as `draftPickSalvageSchema`:
 * strict on everything that changes the outcome, absent-tolerant on the reasoning.
 *
 * These matter more than the draft one, not less. A draft pick is one of fifteen and a
 * bad one is survivable; a truncated LINEUP hands a whole week to deterministic code,
 * and week 12 with playoff seeding live is exactly the hard decision that drives a model
 * to spend its budget thinking. The draft proved the failure is not hypothetical and not
 * confined to one model — Claude Opus 5 used 187 reasoning tokens on pick 2 and 12,130
 * later in the same draft.
 *
 * The lineup slots stay STRICT, including the array lengths: a lineup missing its second
 * receiver is not a lineup, and starting a partial one would silently forfeit points. If
 * a lineup truncates before the slots are complete, the fallback is correct.
 */
export const lineupSalvageSchema = z.object({
  qb: lineupSlot,
  rb: z.array(lineupSlot).length(LEAGUE.slots.RB),
  wr: z.array(lineupSlot).length(LEAGUE.slots.WR),
  te: lineupSlot,
  flex: lineupSlot,
  k: lineupSlot,
  def: lineupSlot,
  headline: z.string().min(1).optional(),
  key_factors: z.array(z.string().min(1)).optional(),
  closest_call: z.string().min(1).optional(),
  what_would_change_it: z.string().min(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

/**
 * Waivers salvage with one deliberate difference: `claims` is REQUIRED even though an
 * empty array is a valid answer.
 *
 * Absent and empty are not the same statement here. An empty array means "I looked and I
 * am standing pat"; an absent one means we cut the model off before it said anything at
 * all, and silently recording that as standing pat would put words in its mouth on a
 * decision that spends money.
 */
export const waiverSalvageSchema = z.object({
  claims: z.array(
    z.object({
      add_player_id: z.string().min(1),
      drop_player_id: z.string().min(1),
      bid: z.number().int().min(0).max(LEAGUE.budgetTotal),
      reasoning: z.string().min(1),
    }),
  ),
  headline: z.string().min(1).optional(),
  key_factors: z.array(z.string().min(1)).optional(),
  closest_call: z.string().min(1).optional(),
  what_would_change_it: z.string().min(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
});
