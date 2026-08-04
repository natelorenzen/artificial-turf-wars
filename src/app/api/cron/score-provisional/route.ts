import { assertCronAuth, cronErrorResponse } from '@/lib/cron/guard';
import { supabaseServer } from '@/lib/supabase-server';
import { resolveScoringWeek, scoreWeek, seasonIdFor } from '@/lib/scoring/week';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Tuesday 10:00 ET — provisional scoring, all-play, standings, move evaluation.
 *
 * Deliberately NOT guarded by `assertBeforeKickoff`: that guard exists to stop a job
 * running after the games it must precede, and this job runs after the slate by
 * design. Its own safety property is different — it never overwrites a final score,
 * because `lineup_scores` is keyed on `(lineup_id, status)`.
 *
 * Safe to deliver twice: every write is an upsert on a natural key and no model is
 * called, so a duplicate re-derives identical numbers. No `job_runs` claim needed.
 */
export async function GET(request: Request) {
  try {
    assertCronAuth(request);

    const db = supabaseServer();
    const season = Number(process.env.SEASON_YEAR ?? '2026');
    const week = await resolveScoringWeek(db, season);

    if (week === null) {
      return Response.json({ ok: true, skipped: 'no completed week yet', season });
    }

    const result = await scoreWeek(db, {
      seasonId: await seasonIdFor(db, season),
      season,
      week,
      status: 'provisional',
      // Tuesday is where move evaluation belongs: it grades the lineup a model set
      // against the best it could have set, and both are known once the slate ends.
      evaluateMoves: true,
    });

    return Response.json({
      ok: true,
      season,
      week,
      status: result.status,
      statLines: result.ingest.scored,
      teamsScored: result.teamsScored,
      emptySlots: result.emptySlots,
      movesEvaluated: result.movesEvaluated,
      leader: result.standings[0]?.teamId ?? null,
    });
  } catch (err) {
    return cronErrorResponse(err);
  }
}
