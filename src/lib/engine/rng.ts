/**
 * Deterministic seeded RNG (SPEC §8.3).
 *
 * The seed is generated and its sha256 published BEFORE the auction, then revealed
 * afterwards so anyone can replay every tiebreak. Its whole remaining job is to
 * break equal bids and to place teams into the circle-method schedule — the draft
 * slot itself is earned at auction, not drawn.
 */

import { sha256 } from '@/lib/util/hash';

/** mulberry32 — small, fast, and identical across platforms. */
export function makeRng(seed: string): () => number {
  // Fold the seed hash into a 32-bit state so any string seed works.
  const hash = sha256(seed);
  let state = parseInt(hash.slice(0, 8), 16) >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates against a seeded RNG. Pure: the input array is not mutated. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const rng = makeRng(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * A stable per-id tiebreak order derived from the seed. Returns a map from id to
 * rank, lower wins. Published with the seed so every tiebreak is replayable.
 */
export function seededTiebreakOrder(ids: readonly string[], seed: string): Map<string, number> {
  const shuffled = seededShuffle([...ids].sort(), seed);
  return new Map(shuffled.map((id, index) => [id, index]));
}

export function commitHash(seed: string): string {
  return sha256(seed);
}
