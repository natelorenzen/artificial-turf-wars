import { assertCronAuth, cronErrorResponse } from '@/lib/cron/guard';
import { ingestPlayers, ingestProjections, ingestSchedule } from '@/lib/sleeper/ingest';

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

    return Response.json({
      ok: true,
      season,
      players: players.players,
      games: schedule.games,
      byeTeams: Object.keys(schedule.byes).length,
      projections: projections.projections,
      withAdp: projections.withAdp,
      calibrationSource: projections.calibration.sourceSeason,
    });
  } catch (err) {
    return cronErrorResponse(err);
  }
}
