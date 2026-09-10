import { assertCronAuth, cronErrorResponse } from '@/lib/cron/guard';
import { supabaseServer } from '@/lib/supabase-server';
import { seasonIdFor } from '@/lib/scoring/week';
import { liveWeekIsComplete, resolveLiveWeek, scoreLiveWeek } from '@/lib/scoring/live';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Live scores during a slate. Several entries a game day — see `vercel.json`.
 *
 * Deliberately NOT guarded by `assertBeforeKickoff`: like `score-provisional`, this job
 * exists to run after a kickoff rather than before one, and that guard would refuse
 * every single firing.
 *
 * Deliberately takes NO `job_runs` claim, for the same reason the other two scoring
 * routes take none. The claim exists to stop a duplicate cron delivery spending eight
 * more model calls; this job calls no model, upserts on `(team_id, week)`, and a
 * duplicate delivery simply recomputes the same eight numbers. Its work is readable in
 * `live_scores` rather than in a ledger row, and adding a claim would mean a firing
 * that died mid-flight blocked every later refresh of the afternoon.
 *
 * Nothing here is authoritative. `resolveLiveWeek` returns null the moment a week has a
 * real `lineup_scores` row, so this stops writing about a week as soon as Tuesday makes
 * it a result.
 */
export async function GET(request: Request) {
  try {
    assertCronAuth(request);

    const db = supabaseServer();
    const season = Number(process.env.SEASON_YEAR ?? '2026');
    const seasonId = await seasonIdFor(db, season);

    // Resolve BEFORE fetching anything. Most firings of the week have nothing to do —
    // there is no reason to spend six Sleeper requests to discover that.
    const week = await resolveLiveWeek(db, seasonId, season);
    if (week === null) {
      return Response.json({
        ok: true,
        season,
        skipped: 'no week is in progress and unscored',
      });
    }

    const result = await scoreLiveWeek(db, { seasonId, season, week });
    const complete = await liveWeekIsComplete(db, season, week);

    return Response.json({
      ok: true,
      season,
      week,
      // True means every game is over and these numbers will not move again — the
      // overnight state, waiting for Tuesday to make them official.
      complete,
      teamsScored: result.teams.length,
      statLines: result.statLines,
      skippedDefenses: result.skippedDefenses,
      computedAt: result.computedAt,
      leader: result.teams[0]?.total ?? null,
    });
  } catch (err) {
    return cronErrorResponse(err);
  }
}
