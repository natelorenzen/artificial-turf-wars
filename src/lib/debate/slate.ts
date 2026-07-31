/**
 * Slate selection.
 *
 * The slate is the product's raw material, and picking it well is most of the work.
 * A slate of obvious calls produces eight identical answers and measures nothing; a
 * slate of noise produces eight coin flips and measures nothing either.
 *
 * The rule: pick players where OUR projection and THE MARKET most disagree.
 *
 * That gets a genuinely contested board for free, and it has a property no hand-picked
 * slate has — it is deterministic. The same season data always yields the same slate,
 * so a debate replays exactly and nobody can accuse us of choosing players after
 * seeing which way the models leaned.
 *
 * Note this is the one part of the whole product that is NOT constrained by the
 * league's 120 rostered players. The debate track chooses its own board, which is
 * what makes it sellable to someone whose league looks nothing like ours.
 */

import type { Position } from '@/lib/config/league';
import type { Slate, SlatePlayer } from '@/lib/debate/types';

/** A row as it comes back from `player_projections` joined to `players`. */
export interface ProjectionRow {
  playerId: string;
  name: string;
  position: Position;
  nflTeam: string | null;
  projPts: number;
  adp: number;
}

export interface SlateOptions {
  season: number;
  /** Positions to draw from. */
  positions?: Position[];
  /** Players per position on the final slate. */
  perPosition?: number;
  /**
   * Only consider players inside the top N at their position by EITHER measure.
   *
   * Without this the slate fills with deep bench players whose projection rank is 60
   * and whose ADP rank is 140 — a divergence of 80 that means nothing, because nobody
   * has an opinion about either number. The cap keeps the board to players a drafter
   * would actually have to decide about.
   */
  draftableDepth?: number;
  /**
   * Skip the N most divergent players at each position before selecting.
   *
   * This is how additional slates are produced. One slate is an anecdote; the point of
   * running several is to see whether a result repeats. Re-running the same board would
   * only measure temperature noise, and hand-picking a second board would let us choose
   * players after seeing which way the models leaned. Stepping down the same ranked list
   * gives a genuinely different, non-overlapping board from the same principled rule.
   */
  skip?: number;
}

export const DEFAULT_POSITIONS: Position[] = ['QB', 'RB', 'WR', 'TE'];

function rankBy<T>(items: T[], value: (t: T) => number, ascending: boolean): Map<T, number> {
  const sorted = [...items].sort((a, b) => (ascending ? value(a) - value(b) : value(b) - value(a)));
  const ranks = new Map<T, number>();
  sorted.forEach((item, i) => ranks.set(item, i + 1));
  return ranks;
}

/**
 * Build a slate from projection rows. Pure — no database, no clock — so it is
 * testable and so the same rows always produce the same slate.
 */
export function buildSlate(rows: ProjectionRow[], options: SlateOptions): Slate {
  const {
    season,
    positions = DEFAULT_POSITIONS,
    perPosition = 2,
    draftableDepth = 30,
    skip = 0,
  } = options;

  const picked: SlatePlayer[] = [];

  for (const position of positions) {
    const pool = rows.filter((r) => r.position === position && Number.isFinite(r.adp) && r.adp > 0);
    if (pool.length === 0) continue;

    const projRank = rankBy(pool, (r) => r.projPts, false); // higher points = rank 1
    const adpRank = rankBy(pool, (r) => r.adp, true); // lower ADP = rank 1

    const scored = pool
      .map((r) => {
        const pr = projRank.get(r) ?? pool.length;
        const ar = adpRank.get(r) ?? pool.length;
        return { row: r, projectionRank: pr, adpRank: ar, divergence: pr - ar };
      })
      .filter((s) => s.projectionRank <= draftableDepth || s.adpRank <= draftableDepth);

    // Take the strongest disagreement in BOTH directions rather than simply the
    // largest absolute divergence. A slate that is all "the market is too high on
    // these" invites the same answer every time and would let a model score well by
    // always saying WALK.
    const overvaluedByMarket = [...scored].sort((a, b) => b.divergence - a.divergence).slice(skip);
    const undervaluedByMarket = [...scored].sort((a, b) => a.divergence - b.divergence).slice(skip);

    const half = Math.max(1, Math.floor(perPosition / 2));
    const chosen: typeof scored = [];
    const seen = new Set<string>();
    const take = (list: typeof scored, n: number) => {
      for (const s of list) {
        if (chosen.length >= perPosition) return;
        if (seen.has(s.row.playerId)) continue;
        if (n-- <= 0) return;
        seen.add(s.row.playerId);
        chosen.push(s);
      }
    };
    take(overvaluedByMarket, half);
    take(undervaluedByMarket, perPosition - half);

    for (const s of chosen) {
      picked.push({
        playerId: s.row.playerId,
        name: s.row.name,
        position: s.row.position,
        team: s.row.nflTeam,
        projectedPoints: s.row.projPts,
        projectionRank: s.projectionRank,
        adp: s.row.adp,
        adpRank: s.adpRank,
        divergence: s.divergence,
      });
    }
  }

  // Stable order: position order as configured, then by player id. Never by
  // divergence — a board sorted by how contested it is telegraphs the answer.
  picked.sort((a, b) => {
    const pa = positions.indexOf(a.position);
    const pb = positions.indexOf(b.position);
    return pa !== pb ? pa - pb : a.playerId.localeCompare(b.playerId);
  });

  return {
    slateId: slateIdFor(season, picked),
    season,
    createdAt: new Date().toISOString(),
    players: picked,
  };
}

/**
 * Slate id derived from its contents, so it is reproducible and doubles as the
 * analyst-label shuffle seed. A timestamp would reshuffle labels on every rerun of
 * the same board and make two runs incomparable.
 */
export function slateIdFor(season: number, players: { playerId: string }[]): string {
  const key = players.map((p) => p.playerId).join(',');
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${season}-${(h >>> 0).toString(16).padStart(8, '0')}`;
}
