/**
 * Prompt assembly and the fairness assertions that go with it (SPEC §8.1).
 *
 * Every call carries three blocks in this order: system prompt, League Rulebook,
 * decision-specific DATA block. The first two are byte-identical for all eight
 * models all season; within a week the DATA block is identical too, which is what
 * the published `context_hash` proves.
 */

import { LEAGUE } from '@/lib/config/league';
import { stableHash, stableStringify } from '@/lib/util/hash';
import { rulebook } from './rulebook';
import { SYSTEM_PROMPT } from './system';

export interface AssembleInput {
  /** Decision-specific DATA object. Identical across all eight models in a week. */
  data: unknown;
  /** Per-team continuity block (SPEC §4.1b). Identical in structure, not content. */
  memoryBlock?: string;
  /** Short instruction naming the decision and the exact output schema. */
  task: string;
  /** JSON schema example the model must match, rendered into the prompt. */
  outputExample: unknown;
}

export interface AssembledPrompt {
  systemPrompt: string;
  userPrompt: string;
  /** sha256 of the DATA block alone — the shared-context proof (SPEC §7.2). */
  contextHash: string;
  estimatedTokens: number;
}

/**
 * Character-based token estimate. Deliberately conservative (over-counts) because
 * it guards a ceiling: 3.5 chars/token sits below the ~4.0 typical of English JSON,
 * so a prompt that passes this check passes the real one. Logged on every call.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

export function assemblePrompt(input: AssembleInput): AssembledPrompt {
  const dataBlock = stableStringify(input.data);

  const userPrompt = [
    rulebook(),
    input.memoryBlock ?? '',
    '=== DATA ===',
    dataBlock,
    '=== END DATA ===',
    '',
    input.task,
    '',
    'Return exactly this JSON shape and nothing else:',
    JSON.stringify(input.outputExample, null, 2),
  ]
    .filter(Boolean)
    .join('\n\n');

  const estimatedTokens = estimateTokens(SYSTEM_PROMPT) + estimateTokens(userPrompt);

  return {
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    contextHash: stableHash(input.data),
    estimatedTokens,
  };
}

/**
 * SPEC §8.1 #11: the total prompt is capped below the smallest context window in the
 * cohort so no model is truncated where others are not. Asserted in code, never
 * assumed.
 */
export function assertContextCeiling(estimatedTokens: number, label: string) {
  if (estimatedTokens > LEAGUE.contextCeilingTokens) {
    throw new Error(
      `${label}: prompt is ~${estimatedTokens} tokens, over the ${LEAGUE.contextCeilingTokens} ceiling. ` +
        'Shrink the DATA block rather than raising the ceiling — the ceiling exists so ' +
        'no model truncates before the others.',
    );
  }
}

/**
 * SPEC §7.2: all eight decisions in a week must share one context hash. If they do
 * not, the week is flagged — that is the machine-checkable proof that no model got
 * different data.
 */
export function assertSharedContext(hashes: string[], label: string) {
  const unique = [...new Set(hashes)];
  if (unique.length > 1) {
    throw new Error(
      `${label}: ${unique.length} distinct context hashes across ${hashes.length} calls. ` +
        'Every model must receive a byte-identical DATA block.',
    );
  }
}
