import { assertBeforeKickoff, assertCronAuth, cronErrorResponse } from '@/lib/cron/guard';
import { defersToLaterFiring, PICKS_FIRINGS, resolveUpcomingWeek } from '@/lib/cron/upcoming';
import { claimJobRun, completeJobRun, failJobRun } from '@/lib/cron/job-run';
import { supabaseServer } from '@/lib/supabase-server';
import { COHORT, LEAGUE } from '@/lib/config/league';
import { seasonIdFor } from '@/lib/scoring/week';
import { buildPicksData, decideAndStore, type PickEntrant } from '@/lib/picks/run';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Thursday 13:00 ET — every model picks the winner of every game this week.
 *
 * Same guards as `lineups`, for the same reasons: too early (a week that does not kick
 * off within seven days), too late (after the week's first kickoff, when a pick would
 * be made knowing a result), and the Wednesday/Thursday pair for weeks that open on a
 * Wednesday. Every pick in a week locks before its FIRST game, Thursday night included.
 *
 * Resumable, because the unit of spend is idempotent: one `pick_sets` row per model per
 * week, each stored the moment it lands. A re-invocation calls only the models with no
 * row yet — or whose provider failed, which is an outage and not the model's answer.
 */
export async function GET(request: Request) {
  try {
    assertCronAuth(request);

    const db = supabaseServer();
    const season = Number(process.env.SEASON_YEAR ?? LEAGUE.season);
    const seasonId = await seasonIdFor(db, season);

    const upcoming = await resolveUpcomingWeek(db, season);
    if (!upcoming.ok) {
      return Response.json({ ok: true, skipped: upcoming.reason, season });
    }
    const week = upcoming.week;

    const kickoff = await assertBeforeKickoff(db, season, week);

    const later = defersToLaterFiring(new Date(), upcoming.firstKickoff, PICKS_FIRINGS);
    if (later) {
      return Response.json({
        ok: true,
        skipped: `a later firing (${DAY_NAMES[later.dow]} ${later.hour}:00 UTC) still clears kickoff — leaving week ${week} to it`,
        season,
        week,
      });
    }

    const claim = await claimJobRun(db, { job: 'picks', seasonId, week, resumable: true });
    if (!claim.claimed) {
      return Response.json({ ok: true, skipped: claim.reason, season, week });
    }

    try {
      // Built, hashed and leak-checked BEFORE the first call: a block that fails costs
      // nothing.
      const input = await buildPicksData(db, season, week);

      const { data: modelRows, error: modelError } = await db.from('models').select('id, key');
      if (modelError) throw new Error(`models: ${modelError.message}`);
      const idOf = new Map((modelRows ?? []).map((m) => [m.key as string, m.id as string]));

      const { data: existing, error: existingError } = await db
        .from('pick_sets')
        .select('model_id, provider_failure')
        .eq('season_id', seasonId)
        .eq('week', week);
      if (existingError) throw new Error(`pick_sets read: ${existingError.message}`);
      const done = new Set(
        (existing ?? []).filter((row) => !row.provider_failure).map((row) => row.model_id as string),
      );

      const entrants: PickEntrant[] = COHORT.flatMap((m) => {
        const modelId = idOf.get(m.key);
        return modelId && !done.has(modelId)
          ? [{ key: m.key, displayName: m.displayName, openrouterId: m.openrouterId, modelId }]
          : [];
      });

      const settled = await Promise.allSettled(
        entrants.map((entrant) => decideAndStore(db, seasonId, input, entrant)),
      );
      const outcomes = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
      const errors = settled.flatMap((s, i) =>
        s.status === 'rejected'
          ? [`${entrants[i].displayName}: ${s.reason instanceof Error ? s.reason.message : String(s.reason)}`]
          : [],
      );
      const cost = outcomes.reduce((sum, o) => sum + o.costUsd, 0);
      const valid = outcomes.filter((o) => o.valid).length;

      await completeJobRun(db, {
        runId: claim.runId!,
        modelCalls: entrants.length,
        costUsd: cost,
        detail:
          `${valid}/${entrants.length} valid pick sets for ${input.fixtures.length} games` +
          (done.size > 0 ? `, ${done.size} already stored` : '') +
          (errors.length > 0 ? `; errors: ${errors.join(' | ')}` : ''),
      });

      return Response.json({
        ok: true,
        season,
        week,
        games: input.fixtures.length,
        contextHash: input.contextHash,
        kickoffAt: kickoff.kickoffAt,
        hoursOfSlack: kickoff.hoursOfSlack,
        alreadyStored: done.size,
        sets: outcomes.map((o) => ({
          model: o.entrant.displayName,
          valid: o.valid,
          providerFailure: o.providerFailure,
          error: o.error,
          headline: o.headline,
        })),
        errors,
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
