import { assertCronAuth, cronErrorResponse } from '@/lib/cron/guard';
import {
  ingestPlayers,
  ingestProjections,
  ingestSchedule,
  ingestWeekProjections,
} from '@/lib/sleeper/ingest';
import { supabaseServer } from '@/lib/supabase-server';
import { LEAGUE } from '@/lib/config/league';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Daily ingest: player pool, schedule and derived byes, season projections and ADP.
 * Everything is snapshotted with a content hash; decision-time code reads only from
 * these tables, never from a live Sleeper fetch (SPEC §5.2).
 */
export async function GET(request: Request) {
  try {
    assertCronAuth(request);

    const season = Number(process.env.SEASON_YEAR ?? '2026');

    // Sequential by design — never Promise.all() against Sleeper.
    const players = await ingestPlayers();
    const schedule = await ingestSchedule(season);
    const projections = await ingestProjections(season);

    // The upcoming week's per-player projections, which the Thursday weekend guide
    // reads. Done here rather than in that job: six more sequential Sleeper fetches
    // inside a route that already has to fit thirty-three model calls under the 300s
    // function ceiling is exactly the wrong place for them.
    const week = await upcomingWeek(season);
    const weekly = week === null ? null : await ingestWeekProjections(season, week, { db: supabaseServer() });

    return Response.json({
      ok: true,
      season,
      players: players.players,
      games: schedule.games,
      byeTeams: Object.keys(schedule.byes).length,
      projections: projections.projections,
      withAdp: projections.withAdp,
      calibrationSource: projections.calibration.sourceSeason,
      weeklyWeek: week,
      weeklyProjections: weekly?.projections ?? 0,
    });
  } catch (err) {
    return cronErrorResponse(err);
  }
}

/** The next regular-season week with a kickoff still ahead — the one to project. */
async function upcomingWeek(season: number): Promise<number | null> {
  const { data, error } = await supabaseServer()
    .from('nfl_games')
    .select('week')
    .eq('season', season)
    .eq('season_type', 'regular')
    .lte('week', LEAGUE.regularSeasonWeeks)
    .gt('kickoff_at', new Date().toISOString())
    .order('week', { ascending: true })
    .limit(1);
  if (error) throw new Error(`nfl_games: ${error.message}`);
  return (data?.[0]?.week as number | undefined) ?? null;
}
