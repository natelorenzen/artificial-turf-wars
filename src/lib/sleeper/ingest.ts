/**
 * Sleeper → Supabase ingest (SPEC §5.2, Phase 1).
 *
 * Every pull is snapshotted with a content hash before anything downstream reads it.
 * Decision-time code reads ONLY from these tables, never from a live Sleeper fetch,
 * which is what makes every past decision exactly reproducible (SPEC §5.2 gotcha 4).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  FANTASY_POSITIONS,
  cleanAdp,
  fetchAdp,
  fetchPlayerPool,
  fetchSchedule,
  fetchSeasonProjections,
  fetchSeasonStats,
  fetchWeeklyStats,
  playerDisplayName,
  type SleeperFetchResult,
  type SleeperPosition,
  type SleeperStatRecord,
} from './client';
import { buildCalibration, deriveByeWeeks, projectSeasonPoints, type ProjectionCalibration } from './normalize';
import { scorePlayerWeek } from '@/lib/scoring/engine';
import { supabaseServer } from '@/lib/supabase-server';

const CHUNK = 500;

async function upsertChunked(
  db: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    // Always await every Supabase mutation — fire-and-forget silently drops writes.
    const { error } = await db.from(table).upsert(rows.slice(i, i + CHUNK), { onConflict });
    if (error) throw new Error(`upsert ${table}: ${error.message}`);
  }
}

async function recordSnapshot(
  db: SupabaseClient,
  result: SleeperFetchResult<unknown>,
  meta: { source: string; season?: number; week?: number; position?: string; rowCount: number },
): Promise<string> {
  const { data, error } = await db
    .from('snapshots')
    .insert({
      source: meta.source,
      season: meta.season ?? null,
      week: meta.week ?? null,
      position: meta.position ?? null,
      url: result.url,
      content_hash: result.contentHash,
      row_count: meta.rowCount,
      snapshot_at: result.fetchedAt,
    })
    .select('id')
    .single();
  if (error) throw new Error(`snapshot insert: ${error.message}`);
  return data.id as string;
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

export async function ingestPlayers(db = supabaseServer()) {
  const result = await fetchPlayerPool();
  const pool = result.data;

  const rows = Object.values(pool)
    .filter((p) => {
      const pos = p.position ?? p.fantasy_positions?.[0];
      return pos && (FANTASY_POSITIONS as string[]).includes(pos);
    })
    .map((p) => ({
      sleeper_id: p.player_id,
      name: playerDisplayName(p),
      position: (p.position ?? p.fantasy_positions![0])!,
      nfl_team: p.team ?? null,
      active: p.active ?? true,
      depth_chart_order: p.depth_chart_order ?? null,
      injury_status: p.injury_status ?? null,
      years_exp: p.years_exp ?? null,
      updated_at: new Date().toISOString(),
    }));

  await recordSnapshot(db, result, { source: 'players', rowCount: rows.length });
  await upsertChunked(db, 'players', rows, 'sleeper_id');
  return { players: rows.length, bytes: result.bytes, hash: result.contentHash };
}

// ---------------------------------------------------------------------------
// Schedule and byes
// ---------------------------------------------------------------------------

export async function ingestSchedule(season: number, db = supabaseServer()) {
  const result = await fetchSchedule(season);
  const games = result.data.filter((g) => g.home && g.away);

  await recordSnapshot(db, result, { source: 'schedule', season, rowCount: games.length });

  await upsertChunked(
    db,
    'nfl_games',
    games.map((g) => ({
      season,
      week: g.week,
      season_type: 'regular',
      home: g.home!,
      away: g.away!,
      kickoff_at: g.date ? new Date(g.date).toISOString() : null,
    })),
    'season,season_type,week,home,away',
  );

  const { byes, teams } = deriveByeWeeks(
    games.map((g) => ({ week: g.week, home: g.home, away: g.away })),
  );

  // Validated for 2026: all 32 teams resolve to exactly one bye each. A feed that
  // fails this would silently corrupt every lineup, so fail loudly instead.
  if (teams.length !== 32) {
    throw new Error(`schedule ${season}: expected 32 teams, found ${teams.length}`);
  }
  const missing = teams.filter((t) => byes[t] === undefined);
  if (missing.length > 0) {
    throw new Error(`schedule ${season}: no bye derived for ${missing.join(', ')}`);
  }

  await upsertChunked(
    db,
    'team_byes',
    Object.entries(byes).map(([nfl_team, week]) => ({ season, nfl_team, week })),
    'season,nfl_team',
  );

  return { games: games.length, teams: teams.length, byes };
}

// ---------------------------------------------------------------------------
// Projections + ADP
// ---------------------------------------------------------------------------

/** Build the projection calibration from the completed prior season (§normalize). */
export async function fetchCalibration(priorSeason: number): Promise<ProjectionCalibration> {
  const def = await fetchSeasonStats(priorSeason, 'DEF');
  const k = await fetchSeasonStats(priorSeason, 'K');
  return buildCalibration(priorSeason, def.data, k.data);
}

/**
 * Every id in `players`, paged. Supabase caps a select at 1000 rows by default, and
 * silently returning the first 1000 here would make the FK filter below drop most of
 * the league.
 */
async function fetchAllPlayerIds(db: SupabaseClient): Promise<Set<string>> {
  const ids = new Set<string>();
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await db
      .from('players')
      .select('sleeper_id')
      .range(from, from + page - 1);
    if (error) throw new Error(`player id scan: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) ids.add(row.sleeper_id as string);
    if (data.length < page) break;
  }
  return ids;
}

export async function ingestProjections(
  season: number,
  opts: { calibration?: ProjectionCalibration; db?: SupabaseClient } = {},
) {
  const db = opts.db ?? supabaseServer();
  const calibration = opts.calibration ?? (await fetchCalibration(season - 1));
  // Sleeper's projections host and its player pool do not agree on position:
  // `position[]=RB` on the projections feed returns FULLBACKS, which the pool lists
  // as `FB` — a position our fantasy filter excludes. Verified 2026-07-28: all 74
  // dropped players are fullbacks and special-teamers, the best of them projecting
  // 19.9 points against a 120th-pick draftable floor of 165, so none would ever be
  // drafted. `scripts/skipped-check.ts` re-verifies this and fails loudly if a drop
  // ever lands inside draftable range.
  //
  // Dropping is the right call over inventing player rows from the projection
  // payload: a player the pool has never heard of has no depth chart, no injury
  // status, and no bye week, so he could not be reasoned about anyway.
  const knownPlayers = await fetchAllPlayerIds(db);
  const skipped: Record<string, number> = {};

  // ADP comes from the WEEK-1 endpoint; the season-long endpoint returns adp: null.
  const adpByPlayer = new Map<string, { adp: number | null; posAdp: number | null }>();
  for (const position of FANTASY_POSITIONS) {
    const result = await fetchAdp(season, position);
    await recordSnapshot(db, result, {
      source: 'adp',
      season,
      week: 1,
      position,
      rowCount: result.data.length,
    });
    for (const rec of result.data) {
      adpByPlayer.set(rec.player_id, {
        adp: cleanAdp(rec.stats?.adp_dd_ppr),
        posAdp: cleanAdp(rec.stats?.pos_adp_dd_ppr),
      });
    }
  }

  const rows: Record<string, unknown>[] = [];
  let withAdp = 0;

  for (const position of FANTASY_POSITIONS) {
    const result = await fetchSeasonProjections(season, position);
    await recordSnapshot(db, result, {
      source: 'projections',
      season,
      position,
      rowCount: result.data.length,
    });

    for (const rec of result.data) {
      if (!knownPlayers.has(rec.player_id)) {
        skipped[position] = (skipped[position] ?? 0) + 1;
        continue;
      }
      const { points } = projectSeasonPoints(position, rec, calibration);
      const adp = adpByPlayer.get(rec.player_id);
      if (adp?.adp != null) withAdp++;
      rows.push({
        player_id: rec.player_id,
        season,
        week: null,
        proj_pts: points,
        raw_projection: rec.stats ?? {},
        adp: adp?.adp ?? null,
        pos_adp: adp?.posAdp ?? null,
      });
    }
  }

  await upsertChunked(db, 'player_projections', rows, 'player_id,season,week');
  return { projections: rows.length, withAdp, skipped, calibration };
}

// ---------------------------------------------------------------------------
// Weekly stats
// ---------------------------------------------------------------------------

/**
 * Score one NFL week. `status` is 'provisional' on Tuesday and 'final' on Thursday.
 * Both rows are kept — a published score is never overwritten silently (SPEC §5.5),
 * and any difference is written to `stat_corrections` for the public diff.
 */
/**
 * Historical stat feeds reference players the CURRENT pool no longer contains —
 * retirees, cuts, anyone off an active roster. Dropping their rows would silently
 * corrupt a backtest, so they are backfilled from the stat payload's own embedded
 * player object and marked inactive.
 *
 * Marking them inactive matters: the draft board is built from season projections,
 * which they do not have, so they can never leak into a live draft pool.
 */
async function backfillMissingPlayers(
  db: SupabaseClient,
  records: SleeperStatRecord[],
  known: Set<string>,
  position: SleeperPosition,
): Promise<number> {
  const missing = records.filter((rec) => !known.has(rec.player_id));
  if (missing.length === 0) return 0;

  const rows = missing.map((rec) => ({
    sleeper_id: rec.player_id,
    name:
      [rec.player?.first_name, rec.player?.last_name].filter(Boolean).join(' ').trim() ||
      rec.player_id,
    position: rec.player?.position ?? position,
    nfl_team: rec.team ?? rec.player?.team ?? null,
    active: false,
    years_exp: rec.player?.years_exp ?? null,
    updated_at: new Date().toISOString(),
  }));

  await upsertChunked(db, 'players', rows, 'sleeper_id');
  rows.forEach((r) => known.add(r.sleeper_id));
  return rows.length;
}

export async function ingestWeeklyStats(
  season: number,
  week: number,
  status: 'provisional' | 'final',
  db = supabaseServer(),
) {
  const rows: Record<string, unknown>[] = [];
  let skippedDefenses = 0;
  let backfilled = 0;
  const known = await fetchAllPlayerIds(db);

  for (const position of FANTASY_POSITIONS) {
    const result = await fetchWeeklyStats(season, week, position);
    const snapshotId = await recordSnapshot(db, result, {
      source: 'stats',
      season,
      week,
      position,
      rowCount: result.data.length,
    });

    backfilled += await backfillMissingPlayers(db, result.data, known, position);

    for (const rec of result.data) {
      const stats = rec.stats ?? {};
      // A DEF row with no pts_allow key would band as a shutout worth +10. That is
      // the single most dangerous absent-key case, so refuse the row instead.
      if (position === 'DEF' && !('pts_allow' in stats)) {
        skippedDefenses++;
        continue;
      }
      if (Object.keys(stats).length === 0) continue;

      // Do NOT filter on `gp`. Sleeper omits the key entirely on some scoring lines,
      // and `n()` reads an absent key as 0 — so a `gp` filter discards real points.
      //
      // Caught by the 2025 backtest: Jelani Woods' week 18 line is
      // {"pts_ppr":2,"rec_2pt":1} with no `gp`. A two-point conversion, dropped
      // silently. Two points decides head-to-head matchups, and under the v3
      // objective a single matchup decides playoff qualification.
      //
      // This is the §5.2 absent-key trap appearing in our own filter rather than in
      // the scoring engine it was written to protect.

      rows.push({
        player_id: rec.player_id,
        season,
        week,
        raw_stats: stats,
        computed_pts: scorePlayerWeek(position, stats).points,
        status,
        snapshot_id: snapshotId,
        updated_at: new Date().toISOString(),
      });
    }
  }

  await upsertChunked(db, 'player_stats', rows, 'player_id,season,week,status');

  const corrections = status === 'final' ? await writeCorrections(db, season, week) : 0;
  return { scored: rows.length, skippedDefenses, backfilled, corrections };
}

/** Compare final against provisional and publish the diff rather than hiding it. */
async function writeCorrections(db: SupabaseClient, season: number, week: number) {
  const { data, error } = await db
    .from('player_stats')
    .select('player_id, computed_pts, status')
    .eq('season', season)
    .eq('week', week);
  if (error) throw new Error(`corrections read: ${error.message}`);

  const provisional = new Map<string, number>();
  const final = new Map<string, number>();
  for (const row of data ?? []) {
    const target = row.status === 'final' ? final : provisional;
    target.set(row.player_id as string, Number(row.computed_pts));
  }

  const corrections: Record<string, unknown>[] = [];
  for (const [playerId, finalPts] of final) {
    const prior = provisional.get(playerId);
    if (prior === undefined || Math.abs(prior - finalPts) < 0.005) continue;
    corrections.push({
      player_id: playerId,
      season,
      week,
      provisional_pts: prior,
      final_pts: finalPts,
      delta: Number((finalPts - prior).toFixed(2)),
    });
  }

  if (corrections.length > 0) {
    const { error: insertError } = await db.from('stat_corrections').insert(corrections);
    if (insertError) throw new Error(`corrections insert: ${insertError.message}`);
  }
  return corrections.length;
}

// ---------------------------------------------------------------------------
// Dry run — verifies the live feed end to end without touching Supabase
// ---------------------------------------------------------------------------

export async function dryRunSleeper(season: number) {
  const players = await fetchPlayerPool();
  const schedule = await fetchSchedule(season);
  const games = schedule.data.filter((g) => g.home && g.away);
  const { byes, teams, weeks } = deriveByeWeeks(
    games.map((g) => ({ week: g.week, home: g.home, away: g.away })),
  );

  const calibration = await fetchCalibration(season - 1);

  const perPosition: Record<string, { records: number; withAdp: number; top: string }> = {};
  for (const position of FANTASY_POSITIONS as SleeperPosition[]) {
    const proj = await fetchSeasonProjections(season, position);
    const adp = await fetchAdp(season, position);
    const adpMap = new Map(adp.data.map((r) => [r.player_id, cleanAdp(r.stats?.adp_dd_ppr)]));
    const scored = proj.data
      .map((rec: SleeperStatRecord) => ({
        name: [rec.player?.first_name, rec.player?.last_name].filter(Boolean).join(' '),
        points: projectSeasonPoints(position, rec, calibration).points,
      }))
      .sort((a, b) => b.points - a.points);
    perPosition[position] = {
      records: proj.data.length,
      withAdp: [...adpMap.values()].filter((v) => v != null).length,
      top: scored[0] ? `${scored[0].name} ${scored[0].points}` : '—',
    };
  }

  return {
    poolSize: Object.keys(players.data).length,
    poolBytes: players.bytes,
    games: games.length,
    weeks: weeks.length,
    teams: teams.length,
    byeWeekCounts: countByWeek(byes),
    calibration: {
      shortFgPerLongFg: Number(calibration.shortFgPerLongFg.toFixed(3)),
      defDefault: calibration.defPointsAllowedPerGameDefault,
    },
    perPosition,
  };
}

function countByWeek(byes: Record<string, number>): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const week of Object.values(byes)) counts[week] = (counts[week] ?? 0) + 1;
  return counts;
}
