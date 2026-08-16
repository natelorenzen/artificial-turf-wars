/**
 * Getting the dossier to the models that draft from it.
 *
 * ---------------------------------------------------------------------------
 * Why this file exists at all
 * ---------------------------------------------------------------------------
 * `buildDossier` had exactly one caller — `scripts/dossier.ts`, which built it,
 * hashed it, stored it and exited. Nothing ever read it back into a prompt. So the
 * dossier was built, published on `/preseason` under the words "sent byte-identically
 * to all eight", and sent to nobody.
 *
 * That mattered more than an unused function usually would, because `/backtest`
 * already diagnosed the 2025 draft's worst failure — five of the first eight picks
 * being quarterbacks in a league that starts one — and concluded: "the fix is not a
 * better model. It is the dossier we had not built yet." It had been built. It was
 * not wired in. The 2026 draft would have reproduced the exact condition those pages
 * blame.
 *
 * ---------------------------------------------------------------------------
 * Read the STORED dossier, never rebuild at decision time
 * ---------------------------------------------------------------------------
 * Hard rule 6: decision-time code reads only from our own snapshots, so every past
 * decision replays exactly. `buildDossier` queries live tables that the daily ingest
 * moves underneath it — rebuilding mid-draft would mean pick 4 and pick 104 reasoning
 * from different data with the same published hash on both. This loads the row that
 * `scripts/dossier.ts` wrote and returns its hash with it.
 *
 * ---------------------------------------------------------------------------
 * Two different shapes, on purpose
 * ---------------------------------------------------------------------------
 * The AUCTION gets the whole dossier. It is eight calls, it is where a model decides
 * what a draft slot is worth for the entire season, and scarcity across every position
 * is exactly the question in front of it.
 *
 * Each PICK gets the scouting merged onto the players actually shown, plus the
 * scarcity curves. Shipping all ~330 dossier players into all 120 pick prompts would
 * be roughly 2.3M tokens of mostly irrelevant players — the model is choosing among
 * the handful on its board, and the fields that matter are the ones attached to those
 * names.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Dossier, DossierPlayer, PreseasonLine, ScarcityCurve } from './dossier';

export interface StoredDossier {
  dossier: Dossier;
  hash: string;
  tokenCount: number | null;
  /**
   * When it was built. Load-bearing rather than informational: the dossier is a
   * snapshot and callers serve whatever is stored, so a rebuild that never happened
   * is invisible without this. `scripts/draft.ts` refuses to commit a draft from a
   * briefing older than its limit.
   */
  builtAt: string | null;
}

/**
 * The most recently built dossier for a season, or null if none has been built.
 *
 * Null is a hard failure at the call sites rather than a silent degrade. A draft that
 * quietly runs without the dossier is the bug this whole file exists to fix, and it
 * would look identical in the logs to one that ran with it.
 */
export async function loadStoredDossier(
  db: SupabaseClient,
  seasonId: string,
): Promise<StoredDossier | null> {
  const { data, error } = await db
    .from('dossiers')
    .select('content, content_hash, token_count, built_at')
    .eq('season_id', seasonId)
    .order('built_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`dossiers: ${error.message}`);

  const row = data?.[0];
  if (!row?.content) return null;

  const content = typeof row.content === 'string' ? JSON.parse(row.content) : row.content;
  return {
    dossier: content as Dossier,
    hash: row.content_hash as string,
    tokenCount: row.token_count === null ? null : Number(row.token_count),
    builtAt: (row.built_at as string | null) ?? null,
  };
}

/**
 * What a model gets about one player at the moment it is choosing him.
 *
 * `scouted` is not decoration. The dossier covers the top players per position by
 * projection, so a late-round name can fall outside it — and without this flag a
 * missing `preseason` would be indistinguishable from a player who did not take a
 * preseason snap. Those are opposite facts, and this project has already published
 * three model decisions as failures that were really our schema giving a model no way
 * to express the situation it was in.
 */
export interface ScoutingLine {
  scouted: boolean;
  last_season_points: number | null;
  bye_week: number | null;
  depth_chart_order: number | null;
  injury_status: string | null;
  positional_rank: number | null;
  preseason: PreseasonLine | null;
}

export const UNSCOUTED: ScoutingLine = {
  scouted: false,
  last_season_points: null,
  bye_week: null,
  depth_chart_order: null,
  injury_status: null,
  positional_rank: null,
  preseason: null,
};

export function scoutingLine(player: DossierPlayer): ScoutingLine {
  return {
    scouted: true,
    last_season_points: player.last_season_points,
    bye_week: player.bye_week,
    depth_chart_order: player.depth_chart_order,
    injury_status: player.injury_status,
    positional_rank: player.positional_rank,
    preseason: player.preseason,
  };
}

export interface ScoutingIndex {
  byPlayerId: Map<string, ScoutingLine>;
  curves: ScarcityCurve[];
  notes: string[];
  hash: string;
  /** How many players the dossier covers, so the DATA block can say so honestly. */
  covered: number;
}

export function buildScoutingIndex(stored: StoredDossier): ScoutingIndex {
  const byPlayerId = new Map<string, ScoutingLine>();
  for (const player of stored.dossier.players ?? []) {
    byPlayerId.set(player.player_id, scoutingLine(player));
  }
  return {
    byPlayerId,
    curves: stored.dossier.scarcity_curves ?? [],
    notes: stored.dossier.notes ?? [],
    hash: stored.hash,
    covered: byPlayerId.size,
  };
}

export function lookupScouting(index: ScoutingIndex | null, playerId: string): ScoutingLine {
  if (!index) return UNSCOUTED;
  return index.byPlayerId.get(playerId) ?? UNSCOUTED;
}

/**
 * How old a stored dossier is, in hours.
 *
 * A missing or unparseable `built_at` returns Infinity rather than 0. The safe default
 * for "how stale is this?" is "unusably", because the alternative reads a broken
 * timestamp as a brand-new briefing — which is the failure this measurement exists to
 * catch, arriving through the measurement itself.
 */
export function dossierAgeHours(builtAt: string | null, now: Date = new Date()): number {
  if (!builtAt) return Number.POSITIVE_INFINITY;
  const built = new Date(builtAt).getTime();
  if (!Number.isFinite(built)) return Number.POSITIVE_INFINITY;
  return (now.getTime() - built) / 3_600_000;
}

/**
 * Whether a dossier is too old to decide a draft from.
 *
 * A dossier built in the future is NOT stale — clock skew between this machine and
 * Postgres would otherwise refuse a briefing built seconds ago, which turns a safety
 * guard into an outage on the one day it must not fail.
 */
export function isDossierStale(
  builtAt: string | null,
  maxAgeHours: number,
  now: Date = new Date(),
): boolean {
  return dossierAgeHours(builtAt, now) > maxAgeHours;
}

/**
 * The one extra note the per-pick block needs that the dossier's own notes do not
 * cover, because it describes this narrowing rather than the data.
 */
export function scoutingCoverageNote(index: ScoutingIndex): string {
  return (
    `scouted is false for players outside the ${index.covered}-player scouting set, which covers the ` +
    'highest projected players at each position. scouted:false means "not in that set", NOT "did not play" — ' +
    'a scouted player who took no preseason snaps has scouted:true and preseason:null.'
  );
}
