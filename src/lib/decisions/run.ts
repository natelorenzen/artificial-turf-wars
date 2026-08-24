/**
 * The single path every model call takes (SPEC §7.1).
 *
 * Assemble → call → parse → record. Nothing calls OpenRouter directly except this
 * module, because the audit row is not optional: a decision that is not logged did
 * not happen, and the project's whole claim rests on the log being complete.
 *
 * `raw_response` is written BEFORE any parsing or repair, so a spectator sees
 * exactly what the model said — including when it emitted markdown fences or prose
 * it was told not to.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ZodType, ZodTypeDef } from 'zod';
import { LEAGUE, PROMPT_VERSION, RULEBOOK_VERSION } from '@/lib/config/league';
import { callModel, type CallResult } from '@/lib/openrouter/client';
import { assemblePrompt, assertContextCeiling } from '@/lib/prompt/assemble';
import { rulebook } from '@/lib/prompt/rulebook';
import { checkCitations } from '@/lib/prompt/cited';
import { reasoningSoftViolations } from '@/lib/schemas/decisions';
import type { DecisionType } from '@/lib/schemas/decisions';

export interface DecisionContext {
  seasonId: string;
  teamId: string | null;
  modelId: string | null;
  openrouterId: string;
  type: DecisionType;
  week?: number | null;
  round?: number | null;
  pickOverall?: number | null;
  dossierHash?: string | null;
  memoryBlock?: string | null;
}

export interface RunDecisionInput<T> extends DecisionContext {
  data: unknown;
  task: string;
  outputExample: unknown;
  // Same shape `callModel` takes. The lineup schema preprocesses empty-slot spellings,
  // which makes its INPUT type `unknown` while its output stays strict.
  schema: ZodType<T, ZodTypeDef, unknown>;
  /**
   * Optional relaxed schema applied ONLY when our own output ceiling truncated the
   * response mid-write. Strict on anything that changes the outcome.
   */
  salvageSchema?: ZodType<unknown>;
}

export interface DecisionRecord<T> {
  decisionId: string | null;
  parsed: T | null;
  valid: boolean;
  fallbackApplied: boolean;
  providerFailure: boolean;
  contextHash: string;
  estimatedTokens: number;
  call: CallResult<T>;
  softViolations: string[];
  citedFields: string[];
  unsupportedClaims: string[];
}

/** Reasoning fields exist on every decision type except the rules check. */
function extractReasoning(parsed: unknown): {
  headline: string | null;
  keyFactors: string[];
  closestCall: string | null;
  whatWouldChangeIt: string | null;
  confidence: number | null;
} {
  const p = (parsed ?? {}) as Record<string, unknown>;
  return {
    headline: typeof p.headline === 'string' ? p.headline : null,
    keyFactors: Array.isArray(p.key_factors) ? (p.key_factors as string[]) : [],
    closestCall: typeof p.closest_call === 'string' ? p.closest_call : null,
    whatWouldChangeIt: typeof p.what_would_change_it === 'string' ? p.what_would_change_it : null,
    confidence: typeof p.confidence === 'number' ? p.confidence : null,
  };
}

export async function runDecision<T>(
  input: RunDecisionInput<T>,
  db: SupabaseClient | null,
): Promise<DecisionRecord<T>> {
  const prompt = assemblePrompt({
    data: input.data,
    memoryBlock: input.memoryBlock ?? undefined,
    task: input.task,
    outputExample: input.outputExample,
  });

  // Asserted, not assumed: no model may be truncated where others are not.
  assertContextCeiling(prompt.estimatedTokens, `${input.type} for ${input.openrouterId}`);

  const call = await callModel({
    openrouterId: input.openrouterId,
    systemPrompt: prompt.systemPrompt,
    userPrompt: prompt.userPrompt,
    schema: input.schema,
    salvageSchema: input.salvageSchema,
  });

  const reasoning = extractReasoning(call.parsed);
  const citations =
    reasoning.keyFactors.length > 0
      ? checkCitations(reasoning.keyFactors, input.data, rulebook())
      : { citedFields: [], unsupportedClaims: [] };
  const softViolations = call.parsed ? safeSoftViolations(call.parsed) : [];
  if (call.salvagedFromTruncation) {
    // Recorded against OUR ceiling, not the model. Shown publicly alongside the pick so
    // a reader can see exactly which fields the truncation cost.
    const p = (call.parsed ?? {}) as Record<string, unknown>;
    const missing = ['headline', 'key_factors', 'closest_call', 'what_would_change_it', 'confidence'].filter(
      (f) => p[f] === undefined,
    );
    softViolations.push(
      `response hit our output ceiling and was closed at the last complete field` +
        (missing.length > 0 ? `; missing ${missing.join(', ')}` : ''),
    );
  }

  const row = {
    season_id: input.seasonId,
    team_id: input.teamId,
    model_id: input.modelId,
    type: input.type,
    week: input.week ?? null,
    round: input.round ?? null,
    pick_overall: input.pickOverall ?? null,
    prompt_version: PROMPT_VERSION,
    rulebook_version: RULEBOOK_VERSION,
    dossier_hash: input.dossierHash ?? null,
    memory_block: input.memoryBlock ?? null,
    system_prompt: prompt.systemPrompt,
    user_prompt: prompt.userPrompt,
    context_hash: prompt.contextHash,
    raw_response: call.rawResponse,
    parsed_json: (call.parsed ?? null) as Record<string, unknown> | null,
    valid: call.ok,
    validation_error: call.validationError,
    // The caller decides whether a deterministic fallback was applied downstream;
    // an invalid response always means one will be.
    fallback_applied: !call.ok && !call.providerFailure,
    provider_failure: call.providerFailure,
    retry_count: call.retryCount,
    temperature_requested: call.temperatureRequested,
    temperature_honored: call.temperatureHonored,
    reasoning_tokens: call.usage.reasoningTokens,
    latency_ms: call.latencyMs,
    tokens_in: call.usage.tokensIn,
    tokens_out: call.usage.tokensOut,
    cost_usd: call.usage.costUsd,
    headline: reasoning.headline,
    key_factors: reasoning.keyFactors,
    closest_call: reasoning.closestCall,
    what_would_change_it: reasoning.whatWouldChangeIt,
    confidence: reasoning.confidence,
    cited_fields: citations.citedFields,
    // Kept apart deliberately: "made something up" and "wrote 25 words instead of 20"
    // are different findings, and merging them publishes the second as the first.
    unsupported_claims: citations.unsupportedClaims,
    soft_violations: softViolations,
  };

  let decisionId: string | null = null;
  if (db) {
    const { data, error } = await db.from('decisions').insert(row).select('id').single();
    if (error) throw new Error(`decision insert: ${error.message}`);
    decisionId = data.id as string;
  }

  return {
    decisionId,
    parsed: call.parsed,
    valid: call.ok,
    fallbackApplied: row.fallback_applied,
    providerFailure: call.providerFailure,
    contextHash: prompt.contextHash,
    estimatedTokens: prompt.estimatedTokens,
    call,
    softViolations,
    citedFields: citations.citedFields,
    unsupportedClaims: citations.unsupportedClaims,
  };
}

/**
 * Record that a schema-valid response was rejected by the ENGINE and replaced.
 *
 * `runDecision` can only set `fallback_applied` from what it knows at the time, which is
 * whether the response parsed. Legality is decided afterwards and elsewhere —
 * `validateWaiverClaims` for a claim set, `lineupProblem` for a lineup — and until this
 * existed, none of it reached the audit row.
 *
 * The 2025 rehearsal showed exactly what that costs. Grok 4.5's waiver claims were
 * rejected in full and it made no moves; Qwen3.7 Plus's lineup was thrown away and
 * replaced by the deterministic one. Both were stored `valid: true,
 * fallback_applied: false`, and `fallback_applied` is the flag the site renders as the
 * public "fallback" tag. Two models were shown as having decided cleanly when their
 * answers had been discarded.
 *
 * `valid` is deliberately left alone. It means the model returned well-formed,
 * schema-conforming JSON, and that stays true. "Answered properly and was still
 * unusable" is a different and more interesting failure than "returned garbage", and
 * collapsing them would throw away the distinction the whole validation policy rests on.
 */
export async function recordEngineRejection(
  db: SupabaseClient | null,
  decisionId: string | null,
  reason: string,
): Promise<void> {
  if (!db || !decisionId) return;

  const { error } = await db
    .from('decisions')
    .update({ fallback_applied: true, validation_error: `engine rejected: ${reason}` })
    .eq('id', decisionId);

  // Never throw. The caller has already applied the fallback and the season continues;
  // losing the annotation must not turn a handled rejection into a failed job.
  if (error) console.error(`decision ${decisionId} rejection note: ${error.message}`);
}

function safeSoftViolations(parsed: unknown): string[] {
  const p = parsed as Record<string, unknown>;
  if (!Array.isArray(p?.key_factors) || typeof p?.headline !== 'string') return [];
  return reasoningSoftViolations(p as never);
}

/**
 * Estimated cost of a full season, from the pinned prices (SPEC §9).
 * 24 pre-season calls + 120 draft picks + 8 × 14 × 2 weekly + 14 wraps = 382.
 */
export const SEASON_CALL_COUNT =
  LEAGUE.teams * 3 + LEAGUE.teams * LEAGUE.draftRounds + LEAGUE.teams * LEAGUE.regularSeasonWeeks * 2 + LEAGUE.regularSeasonWeeks;
