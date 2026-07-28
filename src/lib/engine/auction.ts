/**
 * The sealed-bid draft-slot auction (SPEC §4.2).
 *
 * Single round. Teams sort by bid, highest first; ties break on the pre-registered
 * seed. Working down that order, each team takes its highest-ranked slot still
 * available and pays what it bid (first price). Whatever is left becomes its FAAB
 * budget for all 14 weeks — that shared budget is the entire mechanism, because a
 * dollar spent on draft position is a dollar unavailable in Week 9.
 *
 * A $0 bid is legal: it means "I would rather keep the money".
 */

import { LEAGUE } from '@/lib/config/league';
import { seededTiebreakOrder } from './rng';

export interface AuctionEntry {
  teamId: string;
  /** Null when the model failed validation or its provider was down (SPEC §5.6). */
  bid: number | null;
  slotPreference: number[] | null;
}

export interface AuctionAward {
  teamId: string;
  bid: number;
  slotPreference: number[];
  assignedSlot: number;
  faabRemaining: number;
  /** Bid tied with another team and the seed decided the order. */
  tiebroken: boolean;
  /** No valid response: $0 bid and a seed-ordered slot, flagged publicly. */
  fallbackApplied: boolean;
  waiverPriority: number;
}

export interface AuctionResult {
  awards: AuctionAward[];
  /** Bid dispersion — the Phase 4 gate. A cluster means the auction is not discriminating. */
  dispersion: { min: number; max: number; mean: number; stdev: number; distinct: number };
}

export function resolveAuction(entries: AuctionEntry[], seed: string): AuctionResult {
  const teams = entries.length;
  if (teams !== LEAGUE.teams) {
    throw new Error(`auction: expected ${LEAGUE.teams} entries, got ${teams}`);
  }

  const tiebreak = seededTiebreakOrder(entries.map((e) => e.teamId), `${seed}:auction`);

  const normalized = entries.map((entry) => {
    const invalid =
      entry.bid === null ||
      !Number.isInteger(entry.bid) ||
      entry.bid < 0 ||
      entry.bid > LEAGUE.budgetTotal ||
      !isSlotPermutation(entry.slotPreference);
    return {
      teamId: entry.teamId,
      bid: invalid ? 0 : entry.bid!,
      // Fallback preference is the seed-ordered natural order, not "everyone wants slot 1".
      slotPreference: invalid ? defaultPreference(teams) : entry.slotPreference!,
      fallbackApplied: invalid,
    };
  });

  const order = [...normalized].sort((a, b) => {
    if (a.bid !== b.bid) return b.bid - a.bid;
    return (tiebreak.get(a.teamId) ?? 0) - (tiebreak.get(b.teamId) ?? 0);
  });

  const bidCounts = new Map<number, number>();
  for (const entry of normalized) bidCounts.set(entry.bid, (bidCounts.get(entry.bid) ?? 0) + 1);

  const available = new Set(Array.from({ length: teams }, (_, i) => i + 1));
  const awards: AuctionAward[] = [];

  for (const entry of order) {
    const slot =
      entry.slotPreference.find((s) => available.has(s)) ?? Math.min(...available);
    available.delete(slot);
    awards.push({
      teamId: entry.teamId,
      bid: entry.bid,
      slotPreference: entry.slotPreference,
      assignedSlot: slot,
      faabRemaining: LEAGUE.budgetTotal - entry.bid,
      tiebroken: (bidCounts.get(entry.bid) ?? 0) > 1,
      fallbackApplied: entry.fallbackApplied,
      waiverPriority: 0, // filled in below
    });
  }

  // Waiver priority is seeded in REVERSE draft-slot order: the last pick gets first
  // claim (SPEC §4.5 rule 3, matching Yahoo).
  const bySlotDesc = [...awards].sort((a, b) => b.assignedSlot - a.assignedSlot);
  bySlotDesc.forEach((award, index) => {
    award.waiverPriority = index + 1;
  });

  return { awards: awards.sort((a, b) => a.assignedSlot - b.assignedSlot), dispersion: dispersionOf(normalized.map((e) => e.bid)) };
}

function isSlotPermutation(slots: number[] | null | undefined): boolean {
  if (!slots || slots.length !== LEAGUE.teams) return false;
  const sorted = [...slots].sort((a, b) => a - b);
  return sorted.every((v, i) => v === i + 1);
}

function defaultPreference(teams: number): number[] {
  return Array.from({ length: teams }, (_, i) => i + 1);
}

function dispersionOf(bids: number[]) {
  const mean = bids.reduce((a, b) => a + b, 0) / bids.length;
  const variance = bids.reduce((a, b) => a + (b - mean) ** 2, 0) / bids.length;
  return {
    min: Math.min(...bids),
    max: Math.max(...bids),
    mean: Number(mean.toFixed(2)),
    stdev: Number(Math.sqrt(variance).toFixed(2)),
    distinct: new Set(bids).size,
  };
}

/**
 * SPEC §4.2: "If the backtest shows all eight models clustering at the same bid, the
 * auction is not discriminating and should be reconsidered before it runs for real."
 * This is the Phase 4 gate, expressed as code so it cannot be waved through.
 */
export function auctionDiscriminates(result: AuctionResult): { ok: boolean; reason: string } {
  const { distinct, stdev, min, max } = result.dispersion;
  if (distinct <= 2) {
    return { ok: false, reason: `only ${distinct} distinct bid(s) across ${LEAGUE.teams} teams` };
  }
  if (stdev < 5) {
    return { ok: false, reason: `bid stdev ${stdev} is below 5 — the field is clustered` };
  }
  return { ok: true, reason: `${distinct} distinct bids, range $${min}-$${max}, stdev ${stdev}` };
}
