/**
 * Which week a forward-looking job is actually deciding, and whether it is too early
 * to decide it.
 *
 * The scoring jobs look backwards and use `resolveScoringWeek`. The lineup job and the
 * weekend guide look forwards, and "forwards" has a trap in it: the next unplayed week
 * is Week 1 every day from the day the schedule is ingested until the season starts.
 * Left unguarded, the Thursday jobs would spend eight model calls in early August
 * setting a Week 1 lineup from projections that will have moved by September, and the
 * guide would publish an article headlined "this weekend" about games five weeks out.
 *
 * `assertBeforeKickoff` does not catch this. It refuses runs that are too LATE. A job
 * five weeks early has more slack than it will ever need, which is exactly the shape of
 * the bug — the guard reads healthiest at the moment it is most wrong.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { LEAGUE } from '@/lib/config/league';

/**
 * How far ahead of kickoff a weekly job may legitimately run.
 *
 * Seven days covers every real case with room to spare: the Tuesday waiver call is two
 * days out, the Thursday lineup call about eight hours, and a week whose earliest
 * fixture is Sunday rather than Thursday is three. Nothing legitimate is a week early,
 * and the preseason case this exists to block is five times over the line.
 */
export const MAX_LEAD_DAYS = 7;

export interface UpcomingWeek {
  week: number;
  firstKickoff: Date;
  /** Days from `now` to that kickoff. Negative never happens — the query excludes it. */
  leadDays: number;
}

/**
 * The next regular-season week with a kickoff still ahead of us.
 *
 * Read from the ingested schedule rather than counted from a season-start date, for
 * the same reason the scoring jobs do it: international games, the Thanksgiving slate
 * and the 1 November DST shift all break the arithmetic version.
 */
export async function upcomingWeek(
  db: SupabaseClient,
  season: number,
  now = new Date(),
): Promise<UpcomingWeek | null> {
  const { data, error } = await db
    .from('nfl_games')
    .select('week, kickoff_at')
    .eq('season', season)
    .eq('season_type', 'regular')
    .lte('week', LEAGUE.regularSeasonWeeks)
    .gt('kickoff_at', now.toISOString())
    .order('kickoff_at', { ascending: true })
    .limit(1);
  if (error) throw new Error(`nfl_games: ${error.message}`);

  const row = data?.[0];
  if (!row?.kickoff_at) return null;

  const firstKickoff = new Date(row.kickoff_at as string);
  return {
    week: row.week as number,
    firstKickoff,
    leadDays: Number(((firstKickoff.getTime() - now.getTime()) / 86_400_000).toFixed(2)),
  };
}

export interface LeadTimeCheck {
  ok: boolean;
  reason: string;
}

/** Pure form, so the preseason scenario is testable without a database. */
export function checkLeadTime(upcoming: UpcomingWeek, maxDays = MAX_LEAD_DAYS): LeadTimeCheck {
  if (upcoming.leadDays > maxDays) {
    return {
      ok: false,
      reason:
        `week ${upcoming.week} does not kick off for ${upcoming.leadDays.toFixed(1)} days, ` +
        `over the ${maxDays}-day limit. Running now would decide a week from data that ` +
        'will have moved by the time it is played.',
    };
  }
  return { ok: true, reason: `week ${upcoming.week} kicks off in ${upcoming.leadDays.toFixed(1)} days` };
}

// ---------------------------------------------------------------------------
// Multiple firings for one job
// ---------------------------------------------------------------------------

export interface Firing {
  /** UTC day of week, 0 = Sunday. */
  dow: number;
  /** UTC hour. */
  hour: number;
}

/**
 * Vercel Hobby starts a job anywhere inside its scheduled hour, so every deadline has
 * to be measured from the LATEST possible start.
 */
export const HOBBY_JITTER_HOURS = 59 / 60;

/**
 * The lineup job's cron entries.
 *
 * TWO of them, and the second is not redundant. Most weeks open with a Thursday night
 * game, and Thursday noon ET is the right time to set a lineup — it is the last moment
 * before kickoff with that morning's injury news in it.
 *
 * But not every week opens on Thursday. In 2026, weeks 1 and 12 both open on a WEDNESDAY
 * evening, and for those the Thursday job is not late by an hour, it is late by a day:
 * the last Thursday firing before a Wednesday kickoff is the Thursday of the week
 * BEFORE, so those weeks would have had their lineups set six days early on projections
 * with no injury report attached to them.
 *
 * So the job also fires Wednesday, and stands down when it can — see
 * `defersToLaterFiring`. In a normal week the Wednesday run does nothing and Thursday
 * sets the lineups; in a Wednesday-opener week the Wednesday run is the one that counts.
 */
export const LINEUP_FIRINGS: Firing[] = [
  { dow: 3, hour: 16 },
  { dow: 4, hour: 16 },
];

/**
 * The weekend guide's entries, for the same reason and with less at stake.
 *
 * A guide written six days early is not a scored decision, only a wasted $1 and an
 * article headlined "this weekend" about games a week out — and it is stored
 * `published = false`, so a human would catch it. Fixed anyway: leaving one job right
 * and its neighbour wrong, when they fail identically and the mechanism is already
 * here, is how the next person learns the wrong lesson from the code.
 */
export const WEEKEND_GUIDE_FIRINGS: Firing[] = [
  { dow: 3, hour: 18 },
  { dow: 4, hour: 18 },
];

/** The next firing strictly after `now`. */
function nextFiringAfter(now: Date, firing: Firing): Date {
  const next = new Date(now);
  next.setUTCHours(firing.hour, 0, 0, 0);
  while (next.getUTCDay() !== firing.dow || next <= now) {
    next.setUTCDate(next.getUTCDate() + 1);
    next.setUTCHours(firing.hour, 0, 0, 0);
  }
  return next;
}

/**
 * Should this invocation stand down and leave the work to a later firing?
 *
 * A job with more than one cron entry has to answer this, or the earliest entry claims
 * every week and the later ones — the ones chosen because their timing is better — never
 * run at all. `job_runs` makes the first firing win, so without this the Wednesday entry
 * would quietly take over the whole season.
 *
 * Returns the firing to defer to, or null to proceed. Deferring requires that the later
 * firing STILL clears the kickoff by the full slack margin, measured from the latest
 * moment it could start. If nothing later qualifies, this invocation is the last chance
 * and it runs.
 */
export function defersToLaterFiring(
  now: Date,
  kickoff: Date,
  firings: Firing[],
  slackHours = 4,
): Firing | null {
  const deadline = new Date(
    kickoff.getTime() - (slackHours + HOBBY_JITTER_HOURS) * 3_600_000,
  );

  let best: { firing: Firing; at: Date } | null = null;
  for (const firing of firings) {
    const at = nextFiringAfter(now, firing);
    if (at > deadline) continue;
    if (!best || at > best.at) best = { firing, at };
  }
  return best?.firing ?? null;
}

export type UpcomingWeekResult =
  | ({ ok: true } & UpcomingWeek)
  | { ok: false; reason: string };

/**
 * Resolve the week a forward-looking job should act on, or say why it should not act.
 *
 * Reports "too early" as a SKIP rather than an error, deliberately. Between February
 * and September, and again after Week 14, having nothing to do is the correct state of
 * the world — a 4xx every Thursday for seven months trains whoever watches the cron
 * log to ignore it, which is how the `CCRON_SECRET` typo went unnoticed for weeks.
 */
export async function resolveUpcomingWeek(
  db: SupabaseClient,
  season: number,
  options: { maxLeadDays?: number; now?: Date } = {},
): Promise<UpcomingWeekResult> {
  const upcoming = await upcomingWeek(db, season, options.now ?? new Date());
  if (!upcoming) {
    return { ok: false, reason: 'no regular-season week has a kickoff still ahead of it' };
  }

  const check = checkLeadTime(upcoming, options.maxLeadDays ?? MAX_LEAD_DAYS);
  if (!check.ok) return { ok: false, reason: check.reason };

  return { ok: true, ...upcoming };
}
