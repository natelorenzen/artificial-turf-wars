import { assertBeforeKickoff, assertCronAuth, cronErrorResponse } from '@/lib/cron/guard';
import { claimJobRun, completeJobRun, failJobRun } from '@/lib/cron/job-run';
import { supabaseServer } from '@/lib/supabase-server';
import { LEAGUE } from '@/lib/config/league';
import { resolveScoringWeek, seasonIdFor } from '@/lib/scoring/week';
import { buildWeeklyContext } from '@/lib/weekly/context';
import {
  assertWaiverContexts,
  decideAllWaivers,
  loadFreeAgents,
  storeWaiverBids,
} from '@/lib/weekly/waivers';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Tuesday 12:00 ET — every team submits its sealed FAAB claims (SPEC §4.5).
 *
 * Bids are FILED under the week just played and TRANSACT into the next one, which is
 * the convention `waiver-resolve` reads them back with on Wednesday. The DATA block is
 * built for the week the added players will actually play, because a bid on a player
 * whose team is on bye next week is a bid on nothing.
 *
 * Eight model calls, so a `job_runs` row is claimed before the first of them and this
 * job is NOT resumable. The reason is specific to waivers: re-calling a model at
 * temperature 0.2 can produce different players, whose rows collide with nothing, and
 * FAAB cannot be un-spent. A run stuck in `running` stays stuck until a human looks —
 * which, unlike the lineup job, is the safe direction to fail in, because a team that
 * files no claims has simply stood pat.
 */
export async function GET(request: Request) {
  try {
    assertCronAuth(request);

    const db = supabaseServer();
    const season = Number(process.env.SEASON_YEAR ?? LEAGUE.season);
    const seasonId = await seasonIdFor(db, season);

    // No week has been played yet: there is nothing to react to and no waiver run.
    // This is also what keeps the job silent all through August.
    const bidWeek = await resolveScoringWeek(db, season);
    if (bidWeek === null) {
      return Response.json({ ok: true, skipped: 'season has not started', season });
    }

    const effectiveWeek = bidWeek + 1;
    if (effectiveWeek > LEAGUE.regularSeasonWeeks) {
      return Response.json({
        ok: true,
        skipped: 'regular season is over — the playoff pool runs separately (SPEC §14.5)',
        season,
        bidWeek,
      });
    }

    // The claims transact before the week they are for. After kickoff they would
    // change a roster underneath a lineup that is already locked.
    const kickoff = await assertBeforeKickoff(db, season, effectiveWeek);

    const claim = await claimJobRun(db, { job: 'waiver-bids', seasonId, week: bidWeek });
    if (!claim.claimed) {
      return Response.json({ ok: true, skipped: claim.reason, season, week: bidWeek });
    }

    try {
      const context = await buildWeeklyContext(db, {
        seasonId,
        season,
        week: effectiveWeek,
        memoryType: 'waiver',
      });
      const freeAgents = await loadFreeAgents(db, context);
      if (freeAgents.length === 0) {
        await completeJobRun(db, { runId: claim.runId!, detail: 'no free agents with projections' });
        return Response.json({ ok: true, skipped: 'no free agents with projections', season, bidWeek });
      }

      const input = { context, freeAgents, bidWeek };
      assertWaiverContexts(input);

      const { decisions, failures } = await decideAllWaivers(input, db);
      for (const decision of decisions) {
        await storeWaiverBids(db, bidWeek, decision);
      }

      const cost = decisions.reduce((sum, d) => sum + d.costUsd, 0);
      const totalClaims = decisions.reduce((sum, d) => sum + d.claims.length, 0);
      const stoodPat = decisions.filter((d) => d.valid && d.claims.length === 0);
      const rejected = decisions.filter((d) => d.fallbackApplied);

      await completeJobRun(db, {
        runId: claim.runId!,
        modelCalls: decisions.length,
        costUsd: cost,
        detail:
          `${totalClaims} claims from ${decisions.length - rejected.length - stoodPat.length} teams, ` +
          `${stoodPat.length} stood pat, ${rejected.length} rejected` +
          (failures.length > 0 ? `; errors: ${failures.map((f) => f.error).join(' | ')}` : ''),
      });

      return Response.json({
        ok: true,
        season,
        bidWeek,
        effectiveWeek,
        kickoffAt: kickoff.kickoffAt,
        pool: freeAgents.length,
        claims: totalClaims,
        teams: decisions.map((d) => ({
          label: d.team.label,
          model: d.team.displayName,
          claims: d.claims.length,
          spend: d.claims.reduce((sum, c) => sum + c.bid, 0),
          faabRemaining: d.team.faabRemaining,
          valid: d.valid,
          // "Stood pat" and "we threw its answer away" are the same zero in
          // `waiver_bids` and must never read as the same thing here.
          stoodPat: d.valid && d.claims.length === 0,
          rejected: d.fallbackApplied,
          problem: d.problem,
          headline: d.headline,
          confidence: d.confidence,
        })),
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
