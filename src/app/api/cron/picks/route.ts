import { assertBeforeKickoff, assertCronAuth, cronErrorResponse } from '@/lib/cron/guard';
import { defersToLaterFiring, PICKS_FIRINGS, resolveUpcomingWeek } from '@/lib/cron/upcoming';
import { supabaseServer } from '@/lib/supabase-server';
import { LEAGUE } from '@/lib/config/league';
import { seasonIdFor } from '@/lib/scoring/week';
import { runPicks } from '@/lib/picks/run';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Thursday 13:00 ET — every model picks the winner of every game this week, and may bet
 * its play-money bankroll on the moneylines (snapshotted here, before the first call).
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

    const result = await runPicks(db, {
      season,
      seasonId,
      week,
      oddsApiKey: process.env.ODDS_API_KEY,
    });
    if (result.skipped) {
      return Response.json({ ok: true, skipped: result.skipped, season, week });
    }

    return Response.json({
      ok: true,
      season,
      week,
      games: result.games,
      gamesWithOdds: result.gamesWithOdds,
      odds: result.oddsNote,
      contextHash: result.contextHash,
      kickoffAt: kickoff.kickoffAt,
      hoursOfSlack: kickoff.hoursOfSlack,
      alreadyStored: result.alreadyStored,
      sets: result.sets.map((o) => ({
        model: o.entrant.displayName,
        valid: o.valid,
        providerFailure: o.providerFailure,
        error: o.error,
        headline: o.headline,
        available: o.available,
        staked: o.staked,
      })),
      errors: result.errors,
      costUsd: Number(result.costUsd.toFixed(4)),
    });
  } catch (err) {
    return cronErrorResponse(err);
  }
}
