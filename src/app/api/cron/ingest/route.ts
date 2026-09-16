import { assertCronAuth, cronErrorResponse } from '@/lib/cron/guard';
import {
  ingestPlayers,
  ingestProjections,
  ingestSchedule,
  ingestWeekProjections,
} from '@/lib/sleeper/ingest';
import { supabaseServer } from '@/lib/supabase-server';
import { LAST_LEAGUE_WEEK } from '@/lib/engine/bracket';

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

/**
 * The next league week with a kickoff still ahead AND no locked lineups — the one to project.
 *
 * Bounded by the last PLAYOFF week, not the last regular-season one. Capped at 14 this
 * stopped fetching weekly projections the moment the regular season ended, so there
 * would have been nothing to set a week-15 lineup from even once something asked for
 * one — a December failure with a September cause.
 *
 * A locked week is skipped. "Kickoff still ahead" alone kept naming the week in
 * progress from Friday to Monday night, and this job replaces a week's rows wholesale,
 * so week 1 of 2026 — locked 9 September — had every projection rewritten on the 14th.
 * Anything that read them afterwards was grading a decision against numbers published
 * after it was made (CLAUDE.md rule 6). Skipping it moves the job on to the week the
 * Tuesday waiver call actually needs.
 */
async function upcomingWeek(season: number): Promise<number | null> {
  const db = supabaseServer();
  const { data, error } = await db
    .from('nfl_games')
    .select('week')
    .eq('season', season)
    .eq('season_type', 'regular')
    .lte('week', LAST_LEAGUE_WEEK)
    .gt('kickoff_at', new Date().toISOString())
    .order('week', { ascending: true });
  if (error) throw new Error(`nfl_games: ${error.message}`);

  const locked = await lockedWeeks(season);
  const ahead = [...new Set((data ?? []).map((row) => row.week as number))];
  return ahead.find((week) => !locked.has(week)) ?? null;
}

async function lockedWeeks(season: number): Promise<Set<number>> {
  const db = supabaseServer();
  const { data: seasonRow } = await db.from('seasons').select('id').eq('year', season).maybeSingle();
  if (!seasonRow) return new Set();
  const { data: teams } = await db.from('teams').select('id').eq('season_id', seasonRow.id);
  const teamIds = (teams ?? []).map((t) => t.id as string);
  if (teamIds.length === 0) return new Set();

  const { data, error } = await db
    .from('lineups')
    .select('week')
    // Any row, not just rows with `locked_at`: a seeded fallback that no model replaced
    // never gets one, and its week is just as decided.
    .in('team_id', teamIds);
  if (error) throw new Error(`lineups: ${error.message}`);
  return new Set((data ?? []).map((row) => row.week as number));
}
