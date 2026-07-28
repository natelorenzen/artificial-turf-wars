/**
 * Sleeper HTTP client (SPEC §5.2). All endpoints are auth-free.
 *
 * Two rules this file exists to enforce:
 *  1. Sleeper 403s on default programmatic User-Agents. Every request carries a
 *     browser-like UA.
 *  2. Sequential + delay, never `Promise.all()` fan-out (LESSONS.md, non-negotiable
 *     #1). A module-level queue serialises every call regardless of caller.
 */

import { sha256 } from '@/lib/util/hash';

const PLAYER_HOST = 'https://api.sleeper.app';
/** Undocumented and unofficial — can change without notice (SPEC §5.2 gotcha 3). */
const STATS_HOST = 'https://api.sleeper.com';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const MIN_INTERVAL_MS = 400;
const REQUEST_TIMEOUT_MS = 60_000;

export type SleeperPosition = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DEF';
export const FANTASY_POSITIONS: SleeperPosition[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

export interface SleeperFetchResult<T> {
  data: T;
  url: string;
  contentHash: string;
  bytes: number;
  fetchedAt: string;
}

/** A single promise chain every request awaits — serialises the whole process. */
let queue: Promise<unknown> = Promise.resolve();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request<T>(url: string): Promise<SleeperFetchResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    });
    const text = await res.text();
    if (!res.ok) {
      // Expose the third-party error body in our own error — it is the difference
      // between a 10-second and a 2-hour debug (LESSONS.md).
      throw new Error(`Sleeper ${res.status} ${res.statusText} for ${url}: ${text.slice(0, 300)}`);
    }
    return {
      data: JSON.parse(text) as T,
      url,
      contentHash: sha256(text),
      bytes: text.length,
      fetchedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Every Sleeper call goes through here. Serialised, spaced, retried. */
export function sleeperFetch<T>(url: string, retries = 3): Promise<SleeperFetchResult<T>> {
  const run = queue.then(async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await sleep(MIN_INTERVAL_MS * 2 ** attempt);
      try {
        const result = await request<T>(url);
        await sleep(MIN_INTERVAL_MS);
        return result;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError;
  });
  // Keep the chain alive even when a caller's request rejects.
  queue = run.catch(() => undefined);
  return run as Promise<SleeperFetchResult<T>>;
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export interface SleeperPlayerRecord {
  player_id: string;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  position?: string | null;
  fantasy_positions?: string[] | null;
  team?: string | null;
  active?: boolean | null;
  depth_chart_order?: number | null;
  injury_status?: string | null;
  years_exp?: number | null;
}

/** 14.6 MB. Ingest daily, never per request. */
export function fetchPlayerPool() {
  return sleeperFetch<Record<string, SleeperPlayerRecord>>(`${PLAYER_HOST}/v1/players/nfl`);
}

export interface SleeperGame {
  week: number;
  home: string | null;
  away: string | null;
  date?: string | null;
  status?: string | null;
  game_id?: string | null;
}

/** The only source of bye weeks — no bye field exists on player records (SPEC §5.3). */
export function fetchSchedule(season: number) {
  return sleeperFetch<SleeperGame[]>(`${PLAYER_HOST}/schedule/nfl/regular/${season}`);
}

export interface SleeperStatRecord {
  player_id: string;
  week: number | null;
  season: string;
  team: string | null;
  opponent: string | null;
  category: string;
  stats: Record<string, number> | null;
  player: {
    first_name?: string | null;
    last_name?: string | null;
    position?: string | null;
    team?: string | null;
    injury_status?: string | null;
    years_exp?: number | null;
  } | null;
}

function projectionUrl(season: number, position: SleeperPosition, week?: number) {
  const base = week
    ? `${STATS_HOST}/projections/nfl/${season}/${week}`
    : `${STATS_HOST}/projections/nfl/${season}`;
  return `${base}?season_type=regular&position[]=${position}&order_by=pts_ppr`;
}

/** Season-long projections. NOTE: `adp` is null here — see `fetchAdp`. */
export function fetchSeasonProjections(season: number, position: SleeperPosition) {
  return sleeperFetch<SleeperStatRecord[]>(projectionUrl(season, position));
}

/**
 * ADP lives only on the WEEK-1 projections endpoint, as `adp_dd_ppr`
 * (SPEC §5.2 gotcha 1). A value of 1000.0 means "unranked", not ADP 1000.
 */
export function fetchAdp(season: number, position: SleeperPosition) {
  return sleeperFetch<SleeperStatRecord[]>(projectionUrl(season, position, 1));
}

export function fetchWeeklyProjections(season: number, week: number, position: SleeperPosition) {
  return sleeperFetch<SleeperStatRecord[]>(projectionUrl(season, position, week));
}

export function fetchWeeklyStats(season: number, week: number, position: SleeperPosition) {
  return sleeperFetch<SleeperStatRecord[]>(
    `${STATS_HOST}/stats/nfl/${season}/${week}?season_type=regular&position[]=${position}&order_by=pts_ppr`,
  );
}

export function fetchSeasonStats(season: number, position: SleeperPosition) {
  return sleeperFetch<SleeperStatRecord[]>(
    `${STATS_HOST}/stats/nfl/${season}?season_type=regular&position[]=${position}&order_by=pts_ppr`,
  );
}

/** 1000.0 is Sleeper's "unranked" sentinel, not a real ADP. */
export function cleanAdp(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value >= 999) return null;
  return value;
}

export function playerDisplayName(rec: SleeperPlayerRecord): string {
  if (rec.full_name) return rec.full_name;
  return [rec.first_name, rec.last_name].filter(Boolean).join(' ').trim() || rec.player_id;
}
