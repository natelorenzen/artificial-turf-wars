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
import type { ZodType } from 'zod';
import { LEAGUE, PROMPT_VERSION, RULEBOOK_VERSION } from '@/lib/config/league';
import { callModel, type CallResult } from '@/lib/openrouter/client';
import { assemblePrompt, assertContextCeiling } from '@/lib/prompt/assemble';
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
  schema: ZodType<T>;
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
  });

  const reasoning = extractReasoning(call.parsed);
  const citations =
    reasoning.keyFactors.length > 0
      ? checkCitations(reasoning.keyFactors, input.data)
      : { citedFields: [], unsupportedClaims: [] };
  const softViolations = call.parsed ? safeSoftViolations(call.parsed) : [];

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
    unsupported_claims: [...citations.unsupportedClaims, ...softViolations],
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
