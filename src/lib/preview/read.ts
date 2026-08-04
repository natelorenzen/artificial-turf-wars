/**
 * Reading published weekend guides for the site.
 *
 * Only `published = true` rows are ever returned to a page. The cron job writes every
 * guide as a draft; a human flips the flag. Nothing auto-publishes under a byline.
 */

import { supabaseServer } from '@/lib/supabase-server';
import { LEAGUE } from '@/lib/config/league';

export interface WeekendGuideRow {
  week: number;
  headline: string;
  standfirst: string;
  columnMd: string;
  gameKeys: string[];
  createdAt: string;
}

export interface GuideTake {
  gameKey: string;
  modelName: string;
  novicePoint: string | null;
  expertPoint: string | null;
  swingFactor: string | null;
  confidence: number | null;
  unsupportedClaims: string[];
}

/**
 * Every table this reads may be absent — the migrations are applied by hand in the
 * Supabase editor, and a marketing page must not 500 because one has not been run
 * yet. A missing table reads as "nothing published", which is true.
 */
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export async function getPublishedGuides(season = Number(process.env.SEASON_YEAR ?? LEAGUE.season)) {
  return safe(async () => {
    const db = supabaseServer();
    const { data, error } = await db
      .from('weekend_guides')
      .select('week, headline, standfirst, column_md, game_keys, created_at, seasons!inner(year)')
      .eq('seasons.year', season)
      .eq('published', true)
      .order('week', { ascending: false });
    if (error) return [];
    return (data ?? []).map(toRow);
  }, [] as WeekendGuideRow[]);
}

export async function getGuide(
  week: number,
  season = Number(process.env.SEASON_YEAR ?? LEAGUE.season),
): Promise<WeekendGuideRow | null> {
  return safe(async () => {
    const db = supabaseServer();
    const { data, error } = await db
      .from('weekend_guides')
      .select('week, headline, standfirst, column_md, game_keys, created_at, seasons!inner(year)')
      .eq('seasons.year', season)
      .eq('week', week)
      .eq('published', true)
      .maybeSingle();
    if (error || !data) return null;
    return toRow(data);
  }, null);
}

/** The individual takes behind a published guide — the receipts under the article. */
export async function getGuideTakes(
  week: number,
  season = Number(process.env.SEASON_YEAR ?? LEAGUE.season),
): Promise<GuideTake[]> {
  return safe(async () => {
    const db = supabaseServer();
    const { data, error } = await db
      .from('game_takes')
      .select(
        'game_key, novice_point, expert_point, swing_factor, confidence, unsupported_claims, ' +
          'models(display_name), seasons!inner(year)',
      )
      .eq('seasons.year', season)
      .eq('week', week)
      .eq('valid', true);
    if (error) return [];
    // The nested `models(display_name)` embed defeats the client's row inference, so
    // the shape is asserted once here rather than fought field by field.
    const rows = (data ?? []) as unknown as TakeRow[];
    return rows.map((row) => ({
      gameKey: row.game_key,
      modelName: row.models?.display_name ?? 'unknown',
      novicePoint: row.novice_point,
      expertPoint: row.expert_point,
      swingFactor: row.swing_factor,
      confidence: row.confidence === null ? null : Number(row.confidence),
      unsupportedClaims: row.unsupported_claims ?? [],
    }));
  }, [] as GuideTake[]);
}

interface TakeRow {
  game_key: string;
  novice_point: string | null;
  expert_point: string | null;
  swing_factor: string | null;
  confidence: number | string | null;
  unsupported_claims: string[] | null;
  models: { display_name: string } | null;
}

function toRow(data: Record<string, unknown>): WeekendGuideRow {
  return {
    week: data.week as number,
    headline: data.headline as string,
    standfirst: data.standfirst as string,
    columnMd: data.column_md as string,
    gameKeys: (data.game_keys ?? []) as string[],
    createdAt: data.created_at as string,
  };
}
