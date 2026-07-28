/**
 * Lineup validation, scoring, the optimal-lineup benchmark, and the deterministic
 * fallback (SPEC §4.4, §6.2).
 *
 * Lineup efficiency — actual starter points ÷ best possible lineup from that roster —
 * is the headline metric of the whole project, because it grades a model only
 * against the roster it actually had. It lives or dies on `optimalLineup` being
 * genuinely optimal, so that function is exhaustive over the FLEX rather than greedy.
 */

import { FLEX_ELIGIBLE, LEAGUE, SLOTS, type Position, type StarterSlot } from '@/lib/config/league';
import { round2 } from '@/lib/scoring/engine';

export interface LineupPlayer {
  playerId: string;
  position: Position;
  /** Projection when setting a lineup; actual points when scoring one. */
  points: number;
  isOnBye?: boolean;
  injuryStatus?: string | null;
}

export interface Lineup {
  qb: string | null;
  rb: (string | null)[];
  wr: (string | null)[];
  te: string | null;
  flex: string | null;
  k: string | null;
  def: string | null;
}

export const EMPTY_LINEUP: Lineup = { qb: null, rb: [], wr: [], te: null, flex: null, k: null, def: null };

export function lineupPlayerIds(lineup: Lineup): (string | null)[] {
  return [lineup.qb, ...lineup.rb, ...lineup.wr, lineup.te, lineup.flex, lineup.k, lineup.def];
}

export interface SlotAssignment {
  slot: StarterSlot;
  playerId: string | null;
  points: number;
  empty: boolean;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateLineup(lineup: Lineup, roster: LineupPlayer[]): string | null {
  const byId = new Map(roster.map((p) => [p.playerId, p]));
  const ids = lineupPlayerIds(lineup);

  if (lineup.rb.length !== SLOTS.RB) return `rb must name ${SLOTS.RB} players`;
  if (lineup.wr.length !== SLOTS.WR) return `wr must name ${SLOTS.WR} players`;

  const filled = ids.filter((id): id is string => Boolean(id));
  if (new Set(filled).size !== filled.length) return 'a player is started in more than one slot';

  for (const id of filled) {
    if (!byId.has(id)) return `${id} is not on this roster`;
  }

  const positionOf = (id: string | null) => (id ? byId.get(id)?.position : null);

  if (lineup.qb && positionOf(lineup.qb) !== 'QB') return 'qb slot must hold a QB';
  for (const id of lineup.rb) if (id && positionOf(id) !== 'RB') return 'rb slots must hold RBs';
  for (const id of lineup.wr) if (id && positionOf(id) !== 'WR') return 'wr slots must hold WRs';
  if (lineup.te && positionOf(lineup.te) !== 'TE') return 'te slot must hold a TE';
  if (lineup.k && positionOf(lineup.k) !== 'K') return 'k slot must hold a K';
  if (lineup.def && positionOf(lineup.def) !== 'DEF') return 'def slot must hold a DEF';
  if (lineup.flex) {
    const pos = positionOf(lineup.flex);
    if (!pos || !FLEX_ELIGIBLE.includes(pos)) return `flex must be ${FLEX_ELIGIBLE.join('/')}`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * An unfilled slot scores 0 and is shown AS an empty slot, not as a quiet zero, so
 * the mistake is visible as a mistake (SPEC §4.4).
 */
export function scoreLineup(lineup: Lineup, points: Map<string, number>): {
  total: number;
  perSlot: SlotAssignment[];
} {
  const perSlot: SlotAssignment[] = [];
  const add = (slot: StarterSlot, playerId: string | null) => {
    const pts = playerId ? (points.get(playerId) ?? 0) : 0;
    perSlot.push({ slot, playerId, points: round2(pts), empty: !playerId });
  };

  add('QB', lineup.qb);
  for (let i = 0; i < SLOTS.RB; i++) add('RB', lineup.rb[i] ?? null);
  for (let i = 0; i < SLOTS.WR; i++) add('WR', lineup.wr[i] ?? null);
  add('TE', lineup.te);
  add('FLEX', lineup.flex);
  add('K', lineup.k);
  add('DEF', lineup.def);

  return { total: round2(perSlot.reduce((sum, s) => sum + s.points, 0)), perSlot };
}

// ---------------------------------------------------------------------------
// Optimal lineup — the denominator of lineup efficiency
// ---------------------------------------------------------------------------

/**
 * Best legal lineup obtainable from a roster.
 *
 * Slots are independent apart from FLEX, so the optimum is: top N at each dedicated
 * slot, then the best remaining RB/WR/TE in FLEX. Proven by exchange — moving any
 * dedicated starter to the bench to promote a FLEX candidate cannot increase the
 * total, because the FLEX already holds the best leftover.
 */
export function optimalLineup(roster: LineupPlayer[]): { lineup: Lineup; total: number } {
  const eligible = roster.filter((p) => !p.isOnBye);
  const byPosition = (pos: Position) =>
    eligible.filter((p) => p.position === pos).sort((a, b) => b.points - a.points);

  const qbs = byPosition('QB');
  const rbs = byPosition('RB');
  const wrs = byPosition('WR');
  const tes = byPosition('TE');
  const ks = byPosition('K');
  const defs = byPosition('DEF');

  const lineup: Lineup = {
    qb: qbs[0]?.playerId ?? null,
    rb: rbs.slice(0, SLOTS.RB).map((p) => p.playerId),
    wr: wrs.slice(0, SLOTS.WR).map((p) => p.playerId),
    te: tes[0]?.playerId ?? null,
    flex: null,
    k: ks[0]?.playerId ?? null,
    def: defs[0]?.playerId ?? null,
  };

  const flexCandidates = [...rbs.slice(SLOTS.RB), ...wrs.slice(SLOTS.WR), ...tes.slice(SLOTS.TE)].sort(
    (a, b) => b.points - a.points,
  );
  lineup.flex = flexCandidates[0]?.playerId ?? null;

  const points = new Map(roster.map((p) => [p.playerId, p.points]));
  return { lineup, total: scoreLineup(lineup, points).total };
}

/**
 * Deterministic fallback: the best legal lineup by PROJECTION. Used when a model
 * returns an invalid lineup or its provider is down. Publicly flagged either way,
 * and the two causes are recorded separately (SPEC §5.6).
 */
export function fallbackLineup(roster: LineupPlayer[]): Lineup {
  return optimalLineup(roster).lineup;
}

// ---------------------------------------------------------------------------
// Move evaluation (SPEC §6.2)
// ---------------------------------------------------------------------------

export interface LineupEvaluation {
  actual: number;
  optimal: number;
  efficiency: number;
  pointsLeftOnBench: number;
  flexDelta: number;
}

export function evaluateLineup(lineup: Lineup, roster: LineupPlayer[]): LineupEvaluation {
  const points = new Map(roster.map((p) => [p.playerId, p.points]));
  const actual = scoreLineup(lineup, points).total;
  const best = optimalLineup(roster);

  const bestFlexAvailable = roster
    .filter((p) => FLEX_ELIGIBLE.includes(p.position) && !p.isOnBye && !isDedicatedStarter(p.playerId, lineup))
    .sort((a, b) => b.points - a.points)[0];

  const flexPoints = lineup.flex ? (points.get(lineup.flex) ?? 0) : 0;

  return {
    actual,
    optimal: best.total,
    // A roster that can score nothing is 100% efficient, not 0/0.
    efficiency: best.total === 0 ? 1 : Number((actual / best.total).toFixed(4)),
    pointsLeftOnBench: round2(best.total - actual),
    flexDelta: round2(flexPoints - (bestFlexAvailable?.points ?? 0)),
  };
}

function isDedicatedStarter(playerId: string, lineup: Lineup): boolean {
  return (
    lineup.qb === playerId ||
    lineup.rb.includes(playerId) ||
    lineup.wr.includes(playerId) ||
    lineup.te === playerId ||
    lineup.k === playerId ||
    lineup.def === playerId
  );
}

/** Players a model must not be offered: Out, Inactive, or on bye (SPEC §4.4). */
export function isStartable(player: LineupPlayer): boolean {
  if (player.isOnBye) return false;
  const status = (player.injuryStatus ?? '').toLowerCase();
  return status !== 'out' && status !== 'inactive' && status !== 'ir';
}

export const STARTERS_PER_LINEUP = Object.values(SLOTS).reduce((a, b) => a + b, 0);
export const ROSTER_SIZE = LEAGUE.rosterSize;
