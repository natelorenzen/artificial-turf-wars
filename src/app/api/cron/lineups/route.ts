import { assertBeforeKickoff, assertCronAuth, cronErrorResponse } from '@/lib/cron/guard';
import { defersToLaterFiring, LINEUP_FIRINGS, resolveUpcomingWeek } from '@/lib/cron/upcoming';
import { claimJobRun, completeJobRun, failJobRun } from '@/lib/cron/job-run';
import { supabaseServer } from '@/lib/supabase-server';
import { LEAGUE } from '@/lib/config/league';
import { seasonIdFor } from '@/lib/scoring/week';
import { buildWeeklyContext } from '@/lib/weekly/context';
import {
  assertLineupContexts,
  decideLineups,
  seedFallbackLineups,
  storeLineup,
} from '@/lib/weekly/lineups';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Thursday 12:00 ET — every team sets its lineup for the week about to start, and the
 * lineups lock (SPEC §4.4).
 *
 * The highest-consequence job in the season. A lineup that is never set scores zero
 * and cannot be set later, so this route is built to degrade rather than to fail:
 *
 *   - the deterministic best-projection lineup is written for every team BEFORE the
 *     first model call, so a function killed at the 300s ceiling still leaves eight
 *     legal lineups on the board;
 *   - the eight calls run in parallel and settle independently, so one provider outage
 *     costs one team its choice, not the league its week;
 *   - a model that answers with an illegal lineup gets the deterministic one, flagged
 *     publicly as a fallback rather than quietly repaired.
 *
 * It claims a `job_runs` row before the first call and is NOT resumable. A stuck run
 * blocks until a human looks at it — and thanks to the seeded lineups, a blocked run
 * is a week decided by code, not a week of zeros.
 */
export async function GET(request: Request) {
  try {
    assertCronAuth(request);

    const db = supabaseServer();
    const season = Number(process.env.SEASON_YEAR ?? LEAGUE.season);
    const seasonId = await seasonIdFor(db, season);

    // The week about to be played, with the too-early guard. Without it this job would
    // set Week 1 lineups every Thursday of August from projections five weeks stale.
    const upcoming = await resolveUpcomingWeek(db, season);
    if (!upcoming.ok) {
      return Response.json({ ok: true, skipped: upcoming.reason, season });
    }
    const week = upcoming.week;

    // And the too-late guard: after kickoff this job would write a lineup for a week
    // already in progress, which is worse than not writing one at all.
    const kickoff = await assertBeforeKickoff(db, season, week);

    // This job has two cron entries. Stand down if the later one still clears kickoff,
    // so a normal week is decided on Thursday with that morning's injury news rather
    // than on Wednesday because the Wednesday entry happened to fire first.
    const later = defersToLaterFiring(new Date(), upcoming.firstKickoff, LINEUP_FIRINGS);
    if (later) {
      return Response.json({
        ok: true,
        skipped: `a later firing (${DAY_NAMES[later.dow]} ${later.hour}:00 UTC) still clears kickoff — leaving week ${week} to it`,
        season,
        week,
      });
    }

    const claim = await claimJobRun(db, { job: 'lineups', seasonId, week });
    if (!claim.claimed) {
      return Response.json({ ok: true, skipped: claim.reason, season, week });
    }

    try {
      const context = await buildWeeklyContext(db, { seasonId, season, week, memoryType: 'lineup' });

      // Free, and it fails before anything has been paid for.
      assertLineupContexts(context);

      const seeded = await seedFallbackLineups(db, context);

      const { decisions, failures } = await decideLineups(context, db);

      const lockedAt = new Date();
      for (const decision of decisions) {
        await storeLineup(db, week, decision, lockedAt);
      }

      const cost = decisions.reduce((sum, d) => sum + d.costUsd, 0);
      const fallbacks = decisions.filter((d) => d.fallbackApplied);
      // A team the loop never reached at all keeps its seeded lineup. Counted apart
      // from `fallbacks`, because "the model answered badly" and "the model was never
      // successfully asked" are different findings about a week.
      const undecided = context.teams.filter(
        (team) => !decisions.some((d) => d.team.teamId === team.teamId),
      );

      await completeJobRun(db, {
        runId: claim.runId!,
        modelCalls: decisions.length,
        costUsd: cost,
        detail:
          `${decisions.length - fallbacks.length}/${context.teams.length} model lineups, ` +
          `${fallbacks.length} fallback, ${undecided.length} left on the seeded lineup` +
          (failures.length > 0 ? `; errors: ${failures.map((f) => f.error).join(' | ')}` : ''),
      });

      return Response.json({
        ok: true,
        season,
        week,
        kickoffAt: kickoff.kickoffAt,
        hoursOfSlack: kickoff.hoursOfSlack,
        lockedAt: lockedAt.toISOString(),
        seeded: seeded.seeded.length,
        teams: decisions.map((d) => ({
          label: d.team.label,
          model: d.team.displayName,
          valid: d.valid,
          fallback: d.fallbackApplied,
          providerFailure: d.providerFailure,
          problem: d.problem,
          headline: d.headline,
          confidence: d.confidence,
        })),
        fallbacks: fallbacks.length,
        undecided: undecided.map((t) => t.label),
        errors: failures.map((f) => ({ label: f.team.label, error: f.error })),
        costUsd: Number(cost.toFixed(4)),
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
