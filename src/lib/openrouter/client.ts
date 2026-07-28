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

import type { ZodType } from 'zod';
import { COHORT, LEAGUE } from '@/lib/config/league';
import { extractJson } from '@/lib/schemas/decisions';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const REQUEST_TIMEOUT_MS = 300_000;

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
  retryCount: number;
  latencyMs: number;
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

async function postOnce(
  openrouterId: string,
  systemPrompt: string,
  userPrompt: string,
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
        max_tokens: LEAGUE.maxOutputTokens,
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
      throw new Error(`OpenRouter ${res.status}: non-JSON body ${text.slice(0, 300)}`);
    }
    if (!res.ok || body.error) {
      throw new Error(`OpenRouter ${res.status}: ${body.error?.message ?? text.slice(0, 300)}`);
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
  schema: ZodType<T>;
  /** Extra parse retries on malformed JSON. Identical for everyone (SPEC §8.1 #5). */
  parseRetries?: number;
  /** Retries on provider outage, with exponential backoff (SPEC §5.6). */
  providerRetries?: number;
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
    providerRetries = 3,
  } = options;

  const started = Date.now();
  let retryCount = 0;
  let lastRaw: string | null = null;
  let lastValidationError: string | null = null;
  let usage: CallUsage = { tokensIn: null, tokensOut: null, reasoningTokens: null, costUsd: null };

  for (let attempt = 0; attempt <= parseRetries; attempt++) {
    if (attempt > 0) retryCount++;

    let body: OpenRouterResponse | null = null;
    let providerError: unknown = null;

    for (let providerAttempt = 0; providerAttempt <= providerRetries; providerAttempt++) {
      if (providerAttempt > 0) {
        retryCount++;
        await sleep(1000 * 2 ** providerAttempt);
      }
      try {
        body = (await postOnce(openrouterId, systemPrompt, userPrompt)).body;
        providerError = null;
        break;
      } catch (err) {
        providerError = err;
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
        temperatureRequested: LEAGUE.temperature,
        temperatureHonored: null,
        usage,
      };
    } catch (err) {
      lastValidationError = err instanceof Error ? err.message : String(err);
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
