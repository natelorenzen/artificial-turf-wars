/**
 * Anonymous analyst labels for a debate slate.
 *
 * Same principle as the league's opponent labels — judge the argument, not the arguer
 * — but the opposite stability rule, and the difference is deliberate.
 *
 * In the league, labels are STABLE all season, because the point is to let a model
 * build a picture of "Team C" over fourteen weeks.
 *
 * Here, labels are RESHUFFLED for every slate, because the point is the exact
 * opposite: we are trying to measure whether a model changes its mind in response to
 * an ARGUMENT. If labels persisted, a model could accumulate a reputation across
 * slates and defer to it, and "Analyst B was right last week" becomes a confound
 * sitting directly on top of the one number this product sells.
 *
 * The shuffle is seeded by slate id, so a slate replays exactly.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * FNV-1a. Small, dependency-free, and deterministic across runs and machines —
 * `Math.random()` would make a debate impossible to replay, and Node's hash of an
 * object is not stable across versions.
 */
function seedFrom(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Mulberry32: tiny seeded PRNG, uniform enough for a shuffle. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Assign `Analyst A`…`Analyst H` to model keys, shuffled deterministically per slate.
 *
 * Returns both directions: `byModel` to build a model's own view, and `byLabel` to
 * resolve a challenge target back to a real model when tallying.
 */
export function assignAnalystLabels(
  modelKeys: readonly string[],
  slateId: string,
): { byModel: Map<string, string>; byLabel: Map<string, string> } {
  if (modelKeys.length > ALPHABET.length) {
    throw new Error(`assignAnalystLabels: ${modelKeys.length} models exceeds ${ALPHABET.length} labels`);
  }
  if (new Set(modelKeys).size !== modelKeys.length) {
    throw new Error('assignAnalystLabels: duplicate model key');
  }

  const order = [...modelKeys];
  const rand = rng(seedFrom(slateId));
  // Fisher-Yates, seeded.
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }

  const byModel = new Map<string, string>();
  const byLabel = new Map<string, string>();
  order.forEach((modelKey, i) => {
    const label = `Analyst ${ALPHABET[i]}`;
    byModel.set(modelKey, label);
    byLabel.set(label, modelKey);
  });
  return { byModel, byLabel };
}

/**
 * Guard for anything about to be shown to a model. Lab names, display names and
 * OpenRouter ids must never reach a debate prompt — one leak and every measurement of
 * whether a model deferred to an ARGUMENT rather than to a BRAND is worthless.
 *
 * Deliberately a mirror of the league's `assertNoLabelLeak` rather than a shared
 * import: the firewall runs both ways, and a shared helper is one refactor away from
 * becoming a shared dependency.
 */
export function assertNoAnalystLeak(serialized: string, forbidden: readonly string[]): void {
  const hits = forbidden.filter((needle) => needle && serialized.includes(needle));
  if (hits.length > 0) {
    throw new Error(
      `Debate prompt leaks model identity: ${hits.join(', ')}. Rivals must appear only ` +
        'as anonymous analyst labels.',
    );
  }
}
