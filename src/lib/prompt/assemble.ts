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
 *
 * Still used for decisions with no per-team component: the rules check, the gameplan,
 * and the auction all send a genuinely byte-identical DATA block.
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

// ---------------------------------------------------------------------------
// Split context (SPEC §14.6 cost 2)
// ---------------------------------------------------------------------------

/**
 * Opponent awareness means the eight DATA blocks differ by construction, so the old
 * "byte-identical for all eight" claim is no longer true and must not be quietly kept.
 *
 * What replaces it is weaker but still machine-checkable:
 *   - the BASE block (all league-wide data) is hashed and must be identical across
 *     all eight calls — published exactly as `context_hash` was;
 *   - each per-team OVERLAY is hashed separately, and must be reproducible by
 *     replaying the generator against `(base, teamId)`.
 *
 * The methodology page must state the weaker claim rather than the old one.
 */
export interface SplitContext {
  base: unknown;
  overlay: unknown;
}

export interface SplitHashes {
  baseHash: string;
  overlayHash: string;
  combinedHash: string;
}

export function hashSplitContext(context: SplitContext): SplitHashes {
  const baseHash = stableHash(context.base);
  const overlayHash = stableHash(context.overlay);
  return {
    baseHash,
    overlayHash,
    combinedHash: stableHash({ base: baseHash, overlay: overlayHash }),
  };
}

/** All eight must agree on the base, and no two teams may share an overlay. */
export function assertSharedBase(hashes: SplitHashes[], label: string) {
  const bases = [...new Set(hashes.map((h) => h.baseHash))];
  if (bases.length > 1) {
    throw new Error(
      `${label}: ${bases.length} distinct BASE context hashes across ${hashes.length} calls. ` +
        'The league-wide half of the DATA block must be identical for every model.',
    );
  }

  const overlays = new Set(hashes.map((h) => h.overlayHash));
  if (overlays.size !== hashes.length) {
    throw new Error(
      `${label}: ${hashes.length} calls produced only ${overlays.size} distinct overlays. ` +
        'Two teams received the same per-team block, which means one of them got the ' +
        "wrong team's data.",
    );
  }
}

/**
 * Replay check: rebuild each team's overlay from the base and confirm it matches what
 * was actually sent. This is what keeps the per-team half honest — without it,
 * "deterministic function of (base, teamId)" is an assertion rather than a fact.
 */
export function assertOverlayReproducible(
  sent: { teamId: string; overlayHash: string }[],
  rebuild: (teamId: string) => unknown,
  label: string,
) {
  for (const record of sent) {
    const expected = stableHash(rebuild(record.teamId));
    if (expected !== record.overlayHash) {
      throw new Error(
        `${label}: team ${record.teamId}'s overlay does not replay. Sent ${record.overlayHash}, ` +
          `regenerated ${expected}. The DATA block was not a deterministic function of the snapshot.`,
      );
    }
  }
}
