import { assertCronAuth, cronErrorResponse } from '@/lib/cron/guard';
import { supabaseServer } from '@/lib/supabase-server';
import { resolveScoringWeek, scoreWeek, seasonIdFor } from '@/lib/scoring/week';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Thursday 11:00 ET — final re-score, and publish the stat-correction diff (SPEC §5.5).
 *
 * The diff is the point. Tuesday's provisional numbers stay exactly where they are;
 * Thursday writes a second `lineup_scores` row at status `final` and every player
 * whose points moved gets a `stat_corrections` row. A league that silently swapped
 * the numbers would be indistinguishable from one that got them right first time.
 *
 * Runs before the Thursday lineup job, so a correction lands in the standings a model
 * sees before it sets next week's lineup.
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
      status: 'final',
      // Already done on Tuesday against the same lineups. Re-running it would only
      // change the numbers if a stat correction moved them — which the corrections
      // table reports directly and more legibly.
      evaluateMoves: false,
    });

    return Response.json({
      ok: true,
      season,
      week,
      status: result.status,
      statLines: result.ingest.scored,
      corrections: result.ingest.corrections,
      teamsScored: result.teamsScored,
      leader: result.standings[0]?.teamId ?? null,
    });
  } catch (err) {
    return cronErrorResponse(err);
  }
}
