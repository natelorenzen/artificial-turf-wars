/**
 * Snake draft mechanics (SPEC §4.3).
 *
 * 15 rounds × 8 teams = 120 picks, one model call each. Draft order comes from the
 * §4.2 auction, not from a random seed.
 */

import { LEAGUE, REQUIRED_POSITIONS, SLOTS, type Position } from '@/lib/config/league';

export interface DraftPick {
  round: number;
  pickOverall: number;
  /** 1-based draft slot won at auction. */
  slot: number;
}

export function snakeOrder(teams = LEAGUE.teams, rounds = LEAGUE.draftRounds): DraftPick[] {
  const picks: DraftPick[] = [];
  for (let round = 1; round <= rounds; round++) {
    for (let i = 0; i < teams; i++) {
      const slot = round % 2 === 1 ? i + 1 : teams - i;
      picks.push({ round, pickOverall: (round - 1) * teams + i + 1, slot });
    }
  }
  return picks;
}

/**
 * `slot_pick_numbers` for the auction DATA block. This is load-bearing: handing
 * models the actual pick numbers for every slot is what lets them work out that a
 * 15-round snake equalises slot value, instead of reasoning from a half-remembered
 * notion of how snake drafts work (SPEC §4.2).
 */
export function slotPickNumbers(
  teams = LEAGUE.teams,
  rounds = LEAGUE.draftRounds,
): Record<number, number[]> {
  const out: Record<number, number[]> = {};
  for (const pick of snakeOrder(teams, rounds)) {
    (out[pick.slot] ??= []).push(pick.pickOverall);
  }
  return out;
}

export interface RosterPlayer {
  playerId: string;
  position: Position;
}

/** "1/2" style slot fill counts for the draft DATA block. */
export function rosterNeeds(roster: RosterPlayer[]): Record<string, string> {
  const counts: Record<Position, number> = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 };
  for (const p of roster) counts[p.position]++;

  const flexUsed = Math.min(
    SLOTS.FLEX,
    Math.max(0, counts.RB - SLOTS.RB) + Math.max(0, counts.WR - SLOTS.WR) + Math.max(0, counts.TE - SLOTS.TE),
  );

  return {
    QB: `${Math.min(counts.QB, SLOTS.QB)}/${SLOTS.QB}`,
    RB: `${Math.min(counts.RB, SLOTS.RB)}/${SLOTS.RB}`,
    WR: `${Math.min(counts.WR, SLOTS.WR)}/${SLOTS.WR}`,
    TE: `${Math.min(counts.TE, SLOTS.TE)}/${SLOTS.TE}`,
    FLEX: `${flexUsed}/${SLOTS.FLEX}`,
    K: `${Math.min(counts.K, SLOTS.K)}/${SLOTS.K}`,
    DEF: `${Math.min(counts.DEF, SLOTS.DEF)}/${SLOTS.DEF}`,
    BENCH: `${Math.max(0, roster.length - 9)}/${LEAGUE.benchSize}`,
  };
}

export function missingRequiredPositions(roster: RosterPlayer[]): Position[] {
  const held = new Set(roster.map((p) => p.position));
  return REQUIRED_POSITIONS.filter((pos) => !held.has(pos));
}

export interface AvailablePlayer {
  playerId: string;
  name: string;
  position: Position;
  projSeasonPoints: number;
  adp?: number | null;
}

/**
 * Round-13 soft cap (SPEC §4.3). Rounds 1-12 are unconstrained — bad roster
 * construction is a real reasoning failure and we want it visible. From round 13, a
 * team still missing a required starting position has its pool narrowed to only the
 * positions it needs, and is TOLD that this happened.
 *
 * The constraint is identical for all eight teams and fires only on a team's own
 * earlier choices, so it advantages nobody.
 */
export function narrowAvailable(
  available: AvailablePlayer[],
  roster: RosterPlayer[],
  round: number,
): { pool: AvailablePlayer[]; narrowed: boolean; missing: Position[] } {
  const missing = missingRequiredPositions(roster);
  if (round < LEAGUE.softCapRound || missing.length === 0) {
    return { pool: available, narrowed: false, missing };
  }
  const pool = available.filter((p) => missing.includes(p.position));
  return { pool: pool.length > 0 ? pool : available, narrowed: pool.length > 0, missing };
}

/**
 * SPEC §8.2 — LLMs measurably favour items earlier in a list, so the `available`
 * array is a real bias vector. Order it deterministically by projection, identically
 * for all eight models: equal treatment beats randomisation, and it keeps every pick
 * reproducible. Disclosed on /methodology.
 */
export function orderAvailable(available: AvailablePlayer[]): AvailablePlayer[] {
  return [...available].sort(
    (a, b) => b.projSeasonPoints - a.projSeasonPoints || (a.playerId < b.playerId ? -1 : 1),
  );
}

/** Send roughly the top N per position to keep the prompt small (SPEC §4.3). */
export function topPerPosition(available: AvailablePlayer[], perPosition = 8): AvailablePlayer[] {
  const byPosition = new Map<Position, AvailablePlayer[]>();
  for (const player of orderAvailable(available)) {
    const list = byPosition.get(player.position) ?? [];
    if (list.length < perPosition) {
      list.push(player);
      byPosition.set(player.position, list);
    }
  }
  return orderAvailable([...byPosition.values()].flat());
}

/**
 * Deterministic fallback for an invalid or missing pick: the highest-projected
 * player that fits an open slot. Flagged publicly as a model error — never repaired
 * quietly (SPEC §4.3, §8.1 #6).
 */
export function fallbackPick(
  available: AvailablePlayer[],
  roster: RosterPlayer[],
  round: number,
): AvailablePlayer {
  const { pool } = narrowAvailable(available, roster, round);
  const ordered = orderAvailable(pool);
  if (ordered.length === 0) throw new Error('fallbackPick: empty available pool');

  const missing = missingRequiredPositions(roster);
  if (missing.length > 0) {
    const needed = ordered.find((p) => missing.includes(p.position));
    if (needed) return needed;
  }
  return ordered[0];
}

/** Was this pick legal? Used to decide whether the fallback fires. */
export function isLegalPick(playerId: string, available: AvailablePlayer[]): boolean {
  return available.some((p) => p.playerId === playerId);
}
