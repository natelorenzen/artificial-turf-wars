/**
 * OpenRouter adapter (SPEC §5.1, §8.1, §5.6). One key, all eight competitors plus
 * the non-competing beat writer.
 *
 * Identical treatment is enforced here, not hoped for: same temperature request,
 * same max_tokens, same retry policy, no tools, no web search, no function calling
 * for anyone. Provider failures are recorded as `provider_failure` and kept distinct
 * from `fallback_applied` — a model must not be blamed in the standings for its
 * provider's outage.
 */

import type { ZodType, ZodTypeDef } from 'zod';
import { COHORT, LEAGUE } from '@/lib/config/league';
import { extractJson, salvageTruncatedJson } from '@/lib/schemas/decisions';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Per-request ceiling. Raised from 300_000 on draft day, 24 August 2026, mid-draft.
 *
 * The old value silently converted "reasons slowly" into "failed", which is the one
 * mistake this adapter exists to prevent. Qwen3.8 Max was cut off four times on draft
 * pick 4, recorded as a `provider_failure`, and replaced by a deterministic fallback.
 * Replaying that exact stored prompt with a longer ceiling returned HTTP 200 and a
 * perfectly good pick — in **364 seconds**. The model was never failing; we were
 * hanging up on it at 300, four times, and then filing it against the provider.
 *
 * A timeout is identical for all eight in the rule and unequal in its effect: it only
 * ever binds on the models that think longest, which in a league whose product is the
 * reasoning means it deletes exactly the thing being measured. 900s is ~2.5x the
 * measured need, so a slow reasoner finishes on its FIRST attempt rather than racing
 * a stopwatch.
 *
 * Raising this was safe to do mid-draft precisely because it had never bound on the
 * picks already made — picks 1, 2, 3 and 5 completed in 21-105s, so a higher ceiling
 * cannot retroactively change what they did. That is not true of retry counts or
 * scoring, which is why only this moved.
 *
 * Raised again to 1,500s at pick 52, because `maxOutputTokens` went to 20,000 and
 * 20,000 tokens at the ~20 tok/s Qwen sustains is about 17 minutes. A ceiling that
 * cannot accommodate the budget underneath it is the same bug in a different place.
 */
const REQUEST_TIMEOUT_MS = 1_500_000;

/**
 * Total wall clock for ONE `callModel`, across every retry.
 *
 * Without it, raising the per-request ceiling multiplies straight through the retry
 * matrix: `parseRetries` (3 attempts) x `providerRetries` (4 attempts) is 12 requests,
 * so 900s each would let a single pick run for three hours and a bad night could eat
 * the week. The budget keeps the generous ceiling for the case that matters — one slow
 * honest answer — while a model that is never going to reply stops re-costing it.
 *
 * Checked before each retry, never mid-flight: an answer already being generated is
 * always allowed to land.
 */
const CALL_BUDGET_MS = 2_400_000;

export interface CallUsage {
  tokensIn: number | null;
  tokensOut: number | null;
  reasoningTokens: number | null;
  costUsd: number | null;
}

export interface CallResult<T> {
  ok: boolean;
  parsed: T | null;
  rawResponse: string | null;
  validationError: string | null;
  /** True when the provider never gave us a usable response (outage, 5xx, timeout). */
  providerFailure: boolean;
  /**
   * True when the response hit our output ceiling mid-write and was closed at the last
   * complete property. The decision is the model's; the missing fields are ours to own,
   * and are published as such rather than counted against it.
   */
  salvagedFromTruncation?: boolean;
  retryCount: number;
  latencyMs: number;
  /**
   * Why generation stopped. `length` means the model hit max_tokens — for a reasoning
   * model that can mean it spent the entire budget thinking and returned empty
   * content, which looks identical to a refusal unless this is captured.
   */
  finishReason: string | null;
  temperatureRequested: number;
  temperatureHonored: number | null;
  usage: CallUsage;
}

interface OpenRouterChoice {
  message?: { content?: string | null; reasoning?: string | null };
  finish_reason?: string;
}

interface OpenRouterResponse {
  choices?: OpenRouterChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
  error?: { message?: string; code?: number };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function priceFor(openrouterId: string) {
  return COHORT.find((m) => m.openrouterId === openrouterId) ?? null;
}

function estimateCost(openrouterId: string, tokensIn: number | null, tokensOut: number | null) {
  const model = priceFor(openrouterId);
  if (!model || tokensIn === null) return null;
  const inCost = (tokensIn / 1_000_000) * model.priceIn;
  const outCost = model.priceOut !== null && tokensOut !== null ? (tokensOut / 1_000_000) * model.priceOut : 0;
  return Number((inCost + outCost).toFixed(6));
}

/**
 * An HTTP error from OpenRouter, carrying the status so the retry loop can tell a
 * transient outage from a permanent refusal.
 */
class OpenRouterHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'OpenRouterHttpError';
  }
}

/**
 * Statuses where retrying cannot possibly help.
 *
 * 402 is the one that matters in practice. OpenRouter reserves the FULL `max_tokens`
 * you request up front, so once the key's remaining budget is worth less than that
 * ceiling every call is refused — even with real credit left. Retrying that four times
 * with exponential backoff, as this client used to, spends about fifteen seconds per
 * call to be told the same thing four times.
 */
const NON_RETRYABLE_STATUSES = new Set([400, 401, 402, 403, 404, 422]);

async function postOnce(
  openrouterId: string,
  systemPrompt: string,
  userPrompt: string,
  maxOutputTokens: number,
): Promise<{ body: OpenRouterResponse; status: number }> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.OPENROUTER_SITE_URL ?? '',
        'X-Title': process.env.OPENROUTER_APP_NAME ?? 'Gridiron Gauntlet',
      },
      body: JSON.stringify({
        model: openrouterId,
        // Identical for all eight (SPEC §8.1 #3, #12).
        temperature: LEAGUE.temperature,
        max_tokens: maxOutputTokens,
        // Reserves answer space out of the shared allowance so no model can think its
        // way past the point of being able to reply. See LEAGUE.reasoningMaxTokens.
        reasoning: { max_tokens: LEAGUE.reasoningMaxTokens },
        // No tools, no web search, no function calling for anyone (SPEC §8.1 #4).
        tools: undefined,
        usage: { include: true },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });

    const text = await res.text();
    let body: OpenRouterResponse;
    try {
      body = JSON.parse(text) as OpenRouterResponse;
    } catch {
      throw new OpenRouterHttpError(`OpenRouter ${res.status}: non-JSON body ${text.slice(0, 300)}`, res.status);
    }
    if (!res.ok || body.error) {
      throw new OpenRouterHttpError(
        `OpenRouter ${res.status}: ${body.error?.message ?? text.slice(0, 300)}`,
        body.error?.code ?? res.status,
      );
    }
    return { body, status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

export interface CallOptions<T> {
  openrouterId: string;
  systemPrompt: string;
  userPrompt: string;
  /**
   * Input is widened to `unknown` because several of our schemas COERCE — the rules
   * check accepts `20.2` as well as `"20.2"`, and a model answering with a JSON number
   * has answered correctly. A coercing schema's input type differs from its output
   * type, and the default `ZodType<T>` (which assumes they are the same) would reject
   * exactly the schemas we most want to pass. Type-only change: `T` still binds to the
   * parsed output.
   */
  schema: ZodType<T, ZodTypeDef, unknown>;
  /** Extra parse retries on malformed JSON. Identical for everyone (SPEC §8.1 #5). */
  parseRetries?: number;
  /**
   * Optional relaxed schema, used ONLY when our own ceiling truncated the response.
   * Must be strict about anything that changes the outcome; see `draftPickSalvageSchema`.
   */
  salvageSchema?: ZodType<unknown>;
  /** Retries on provider outage, with exponential backoff (SPEC §5.6). */
  providerRetries?: number;
  /**
   * Output ceiling. Defaults to the league's value, which must not be lowered — it was
   * raised from 4,000 after the 2025 backtest because reasoning-tier models spent the
   * entire budget thinking and returned EMPTY CONTENT, indistinguishable from a refusal.
   *
   * Non-league callers with small, bounded outputs can pass something lower. That is
   * worth doing: OpenRouter reserves the whole ceiling against your balance for the
   * duration of the call, so an unnecessarily large one fails on a key that could
   * comfortably have afforded the actual usage.
   */
  maxOutputTokens?: number;
}

/**
 * One model call, fully instrumented. Never throws for a model's own bad output —
 * that comes back as `ok: false` with the raw response intact so the caller can
 * apply the deterministic fallback and flag it publicly.
 */
export async function callModel<T>(options: CallOptions<T>): Promise<CallResult<T>> {
  const {
    openrouterId,
    systemPrompt,
    userPrompt,
    schema,
    parseRetries = LEAGUE.maxRetries,
    salvageSchema,
    providerRetries = 3,
    maxOutputTokens = LEAGUE.maxOutputTokens,
  } = options;

  const started = Date.now();
  let retryCount = 0;
  let lastRaw: string | null = null;
  let lastValidationError: string | null = null;
  let finishReason: string | null = null;
  let usage: CallUsage = { tokensIn: null, tokensOut: null, reasoningTokens: null, costUsd: null };

  /** True once this call has spent its whole wall-clock budget. Never interrupts a
   *  request already in flight — only stops another one being started. */
  const outOfBudget = () => Date.now() - started > CALL_BUDGET_MS;

  for (let attempt = 0; attempt <= parseRetries; attempt++) {
    if (attempt > 0) {
      if (outOfBudget()) break;
      retryCount++;
    }

    let body: OpenRouterResponse | null = null;
    let providerError: unknown = null;

    for (let providerAttempt = 0; providerAttempt <= providerRetries; providerAttempt++) {
      if (providerAttempt > 0) {
        if (outOfBudget()) break;
        retryCount++;
        await sleep(1000 * 2 ** providerAttempt);
      }
      try {
        body = (await postOnce(openrouterId, systemPrompt, userPrompt, maxOutputTokens)).body;
        providerError = null;
        break;
      } catch (err) {
        providerError = err;
        // A refusal is not an outage. Retrying a 402 or a 401 only spends wall-clock
        // to be told the same thing again, and on a budget error it delays the moment
        // the operator finds out.
        if (err instanceof OpenRouterHttpError && NON_RETRYABLE_STATUSES.has(err.status)) break;
      }
    }

    if (!body) {
      return {
        ok: false,
        parsed: null,
        rawResponse: lastRaw,
        validationError: providerError instanceof Error ? providerError.message : String(providerError),
        providerFailure: true,
        retryCount,
        latencyMs: Date.now() - started,
        finishReason,
        temperatureRequested: LEAGUE.temperature,
        temperatureHonored: null,
        usage,
      };
    }

    const tokensIn = body.usage?.prompt_tokens ?? null;
    const tokensOut = body.usage?.completion_tokens ?? null;
    usage = {
      tokensIn,
      tokensOut,
      reasoningTokens: body.usage?.completion_tokens_details?.reasoning_tokens ?? null,
      costUsd: body.usage?.cost ?? estimateCost(openrouterId, tokensIn, tokensOut),
    };

    const content = body.choices?.[0]?.message?.content ?? '';
    finishReason = body.choices?.[0]?.finish_reason ?? null;
    lastRaw = content;

    try {
      const parsed = schema.parse(extractJson(content));
      return {
        ok: true,
        parsed,
        rawResponse: content,
        validationError: null,
        providerFailure: false,
        retryCount,
        latencyMs: Date.now() - started,
        finishReason,
        temperatureRequested: LEAGUE.temperature,
        temperatureHonored: null,
        usage,
      };
    } catch (err) {
      /*
       * Salvage, and ONLY for a response we cut off ourselves.
       *
       * The gate is `finish_reason === 'length'`, which is the provider telling us the
       * message ended because it hit our ceiling rather than because the model stopped.
       * Malformed JSON for any other reason is the model's own failure and still earns
       * the deterministic fallback — this path exists to undo our constraint, not to
       * paper over theirs.
       */
      if (salvageSchema && finishReason === 'length' && content.trim().length > 0) {
        const closed = salvageTruncatedJson(content);
        if (closed !== null) {
          const rescued = salvageSchema.safeParse(closed);
          if (rescued.success) {
            return {
              ok: true,
              // The salvage schema guarantees every outcome-critical field; the reasoning
              // fields it allows to be absent are null-guarded by every consumer.
              parsed: rescued.data as T,
              rawResponse: content,
              validationError: null,
              providerFailure: false,
              salvagedFromTruncation: true,
              retryCount,
              latencyMs: Date.now() - started,
              finishReason,
              temperatureRequested: LEAGUE.temperature,
              temperatureHonored: null,
              usage,
            };
          }
        }
      }

      lastValidationError =
        content.trim().length === 0
          ? `model returned empty content (finish_reason=${finishReason ?? 'unknown'}` +
            `, ${body.usage?.completion_tokens ?? '?'} completion tokens of which ` +
            `${body.usage?.completion_tokens_details?.reasoning_tokens ?? 0} were reasoning) — ` +
            'it most likely spent the whole output budget thinking'
          : err instanceof Error ? err.message : String(err);
    }
  }

  return {
    ok: false,
    parsed: null,
    rawResponse: lastRaw,
    validationError: lastValidationError,
    providerFailure: false,
    retryCount,
    latencyMs: Date.now() - started,
    finishReason,
    temperatureRequested: LEAGUE.temperature,
    temperatureHonored: null,
    usage,
  };
}

/**
 * Fan out one decision to all eight models.
 *
 * Deliberately sequential. OpenRouter is not the constraint — reproducibility is:
 * a serialised run gives every model the same upstream conditions, and the whole
 * league's weekly volume is 16 calls.
 */
export async function callCohort<T>(
  teams: { teamId: string; openrouterId: string; userPrompt: string }[],
  shared: { systemPrompt: string; schema: ZodType<T> },
): Promise<Map<string, CallResult<T>>> {
  const results = new Map<string, CallResult<T>>();
  for (const team of teams) {
    results.set(
      team.teamId,
      await callModel({
        openrouterId: team.openrouterId,
        systemPrompt: shared.systemPrompt,
        userPrompt: team.userPrompt,
        schema: shared.schema,
      }),
    );
  }
  return results;
}
