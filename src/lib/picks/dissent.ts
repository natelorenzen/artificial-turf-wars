/**
 * Dissents: a pick against the rest of the panel.
 *
 * Week 4 showed why this is the part worth surfacing. The moneyline is in the prompt,
 * and 120 of 128 picks were the market favourite at a probability a few points from
 * the line — the grid mostly restates the market. The eight that broke from it were
 * all lone or minority picks, and every one carried an underdog bet. That is where a
 * model is actually claiming to know something.
 *
 * Everything here is descriptive. `claimedEdge` is the model's OWN probability minus
 * the market's margin-free one for the same team: what the model asserted, not our
 * view of the game. We do not forecast (hard rule 10, and the picks page is not a
 * tipsheet), so nothing here ranks which bet is likely to pay.
 *
 * Pure: no I/O, so the strip replays from stored rows like the grid does.
 */
import type { Pick } from './grade';

export interface DissentInput<T extends Pick = Pick> {
  model: string;
  modelKey: string;
  picks: Map<string, T>;
}

export interface Dissent<T extends Pick = Pick> {
  model: string;
  modelKey: string;
  pick: T;
  /** The panel's majority side, which this pick went against. */
  majority: string;
  /** Models on the majority side, out of all that picked the game. */
  agree: number;
  of: number;
  /** The market's margin-free probability for the team this model picked; null without a line. */
  marketProb: number | null;
  /** `pick.winProb - marketProb`: how far above the price the model put its own side. */
  claimedEdge: number | null;
}

/**
 * Every pick on the minority side of a game. A game the panel split evenly has no
 * majority to dissent from, so it contributes nothing — calling either half the
 * dissenters would be the tiebreak talking, not the panel.
 *
 * Ordered boldest first: largest claimed edge, then games without a line, then by
 * game and model so the order replays exactly.
 */
export function dissents<T extends Pick>(
  sets: DissentInput<T>[],
  /** gameKey → team → margin-free market probability. */
  market: Map<string, Map<string, number>>,
): Dissent<T>[] {
  const games = new Map<string, { set: DissentInput<T>; pick: T }[]>();
  for (const set of sets) {
    for (const pick of set.picks.values()) {
      const list = games.get(pick.gameKey) ?? [];
      list.push({ set, pick });
      games.set(pick.gameKey, list);
    }
  }

  const out: Dissent<T>[] = [];
  for (const [gameKey, entries] of games) {
    const counts = new Map<string, number>();
    for (const e of entries) counts.set(e.pick.pick, (counts.get(e.pick.pick) ?? 0) + 1);
    const [majority, agree] = [...counts].sort((a, b) => b[1] - a[1])[0];
    if (agree * 2 <= entries.length) continue; // even split: no majority

    for (const { set, pick } of entries) {
      if (pick.pick === majority) continue;
      const marketProb = market.get(gameKey)?.get(pick.pick) ?? null;
      out.push({
        model: set.model,
        modelKey: set.modelKey,
        pick,
        majority,
        agree,
        of: entries.length,
        marketProb,
        claimedEdge: marketProb === null ? null : pick.winProb - marketProb,
      });
    }
  }

  return out.sort((a, b) => {
    const ea = a.claimedEdge ?? -Infinity;
    const eb = b.claimedEdge ?? -Infinity;
    if (ea !== eb) return eb - ea;
    return a.pick.gameKey.localeCompare(b.pick.gameKey) || a.model.localeCompare(b.model);
  });
}

/** `gameKey|modelKey` for every dissent, so the grid can mark the same cells. */
export function dissentKeys(list: Dissent[]): Set<string> {
  return new Set(list.map((d) => `${d.pick.gameKey}|${d.modelKey}`));
}
