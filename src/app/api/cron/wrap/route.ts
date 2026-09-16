import { assertCronAuth, cronErrorResponse } from '@/lib/cron/guard';
import { claimJobRun, completeJobRun, failJobRun } from '@/lib/cron/job-run';
import { supabaseServer } from '@/lib/supabase-server';
import { LEAGUE } from '@/lib/config/league';
import { resolveScoringWeek, seasonIdFor } from '@/lib/scoring/week';
import { buildWrapFacts, recordRecapDecision, storeRecap, writeRecap } from '@/lib/weekly/wrap';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Tuesday 11:00 ET — the weekly column, written by the non-competing beat writer
 * (SPEC §7.5).
 *
 * Runs an hour after `score-provisional`, so the facts packet is built from scores that
 * exist. It reads them rather than computing them: a column that derived its own totals
 * could print a number the standings page disagrees with, and there would be no way to
 * tell which was right.
 *
 * One model call, but it still claims a `job_runs` row — not for the money, for the
 * article. A duplicate delivery would overwrite a released column with a differently
 * worded one, and `recaps` is keyed `(season_id, week)`, so the first version would be
 * gone. It is not resumable: there is nothing partial to resume.
 *
 * The draft is stored with `published = false`. Nothing auto-publishes under a byline.
 */
export async function GET(request: Request) {
  try {
    assertCronAuth(request);

    const db = supabaseServer();
    const season = Number(process.env.SEASON_YEAR ?? LEAGUE.season);
    const seasonId = await seasonIdFor(db, season);

    const week = await resolveScoringWeek(db, season);
    if (week === null) {
      return Response.json({ ok: true, skipped: 'season has not started', season });
    }

    const claim = await claimJobRun(db, { job: 'wrap', seasonId, week });
    if (!claim.claimed) {
      return Response.json({ ok: true, skipped: claim.reason, season, week });
    }

    try {
      const facts = await buildWrapFacts(db, { seasonId, season, week });
      if (facts.teams.length === 0) {
        await completeJobRun(db, { runId: claim.runId!, detail: `week ${week} has no scored lineups` });
        return Response.json({ ok: true, skipped: 'no scored lineups', season, week });
      }

      const result = await writeRecap(facts);
      const decisionId = await recordRecapDecision(db, seasonId, week, result);

      if (!result.recap) {
        await failJobRun(db, {
          runId: claim.runId!,
          modelCalls: 1,
          costUsd: result.costUsd,
          detail: `beat writer returned no usable column: ${result.validationError ?? 'unknown'}`,
        });
        return Response.json(
          { ok: false, error: 'writer failed', season, week, decisionId },
          { status: 502 },
        );
      }

      await storeRecap(db, { seasonId, week, result, decisionId });

      await completeJobRun(db, {
        runId: claim.runId!,
        modelCalls: 1,
        costUsd: result.costUsd,
        detail: result.numbers.passed
          ? `week ${week} column stored, every figure checked out`
          : `week ${week} column stored, ${result.numbers.notes.length} unverified figure(s)`,
      });

      return Response.json({
        ok: true,
        season,
        week,
        scoringStatus: facts.scoring_status,
        headline: result.recap.headline,
        numberCheckPassed: result.numbers.passed,
        numberCheckNotes: result.numbers.notes,
        luck: facts.luck,
        costUsd: Number(result.costUsd.toFixed(4)),
        published: false,
      });
    } catch (err) {
      await failJobRun(db, {
        runId: claim.runId!,
        detail: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  } catch (err) {
    return cronErrorResponse(err);
  }
}
