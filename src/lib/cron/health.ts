/**
 * Did the jobs that should have run, run?
 *
 * Nothing answered this before. Vercel never retries a failed cron and does not tell
 * anyone it failed, so the only evidence a job ever ran is the row it left behind —
 * and the one failure mode this project has already lived through left no row at all.
 * `CCRON_SECRET`, a one-character typo in a Vercel environment variable, meant every
 * single cron route 500'd before doing any work from the first deploy onwards. The
 * daily ingest included. It was silent for weeks, and it was found by accident.
 *
 * A watchdog that re-derives the schedule would be the same bug wearing a hat: it
 * would drift from the jobs it watches and then agree with them for the wrong reason.
 * So this module does two things and nothing else.
 *
 *   1. It holds the cron expressions VERBATIM from `vercel.json`, and
 *      `health.test.ts` fails if the two ever disagree. That is the same trick the
 *      rulebook uses against `league.ts`: one source, checked mechanically.
 *
 *   2. It asks the SAME resolvers the jobs ask — `resolveScoringWeek`,
 *      `resolveUpcomingWeek`, `resolveLiveWeek` — what week each job was due to act
 *      on. A job that correctly stood down (preseason, a bye in the schedule, a
 *      Wednesday opener deferring to Thursday) must never be reported as late, or the
 *      watchdog becomes the thing everybody learns to ignore, which is precisely how
 *      the typo survived.
 *
 * Evidence differs by job, because the jobs differ. The seven that spend money claim a
 * `job_runs` row before the first model call, so their evidence is exact. The
 * deterministic ones leave a timestamp on the work itself: the ingest writes
 * `snapshots.snapshot_at`, the live scorer writes `live_scores.computed_at`. The
 * social job is the honest exception — see `SOCIAL_NOTE`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { LAST_LEAGUE_WEEK } from '@/lib/engine/bracket';
import { resolveScoringWeek } from '@/lib/scoring/week';
import { resolveLiveWeek } from '@/lib/scoring/live';
import {
  HOBBY_JITTER_HOURS,
  LINEUP_FIRINGS,
  WEEKEND_GUIDE_FIRINGS,
  resolveUpcomingWeek,
  type Firing,
} from '@/lib/cron/upcoming';

/**
 * How long after a scheduled hour a job is still allowed to be silent.
 *
 * Hobby starts a job anywhere inside its hour (`HOBBY_JITTER_HOURS`), the weekend
 * guide runs for nearly three minutes short of the 300s ceiling, and a route that
 * finishes at 16:58 writes its row at 16:58. Two hours covers all of it with room
 * over. Being generous here is deliberate: a watchdog that cries late at 16:03 every
 * week is worse than no watchdog, because it trains the reader to skim.
 */
export const GRACE_HOURS = 2;

/** The ingest is daily and slower; give it a wider window before calling it stale. */
export const INGEST_GRACE_HOURS = 4;

/**
 * A draft cleared to send that is still sitting there after this long means the
 * release half of the social job has stopped, even though composing still works.
 */
export const SOCIAL_STUCK_HOURS = 36;

export const SOCIAL_NOTE =
  'composing nothing is the correct outcome on most days, so a quiet day and a dead ' +
  'job look identical from the outside; only a stuck release queue is detectable';

export type HealthState =
  /** Ran, and left the evidence it was supposed to leave. */
  | 'ok'
  /** Was due, the grace window has passed, and there is no evidence it ran. */
  | 'late'
  /** Claimed a run and never finished it. Blocks the job until a human clears it. */
  | 'stuck'
  /** Correctly had nothing to do — preseason, week not over, deferred to a later firing. */
  | 'idle'
  /** Cannot be proven either way by design. Only the social job. */
  | 'unverifiable';

export interface JobHealth {
  /** The cron path, so a reader can match this against `vercel.json` directly. */
  job: string;
  state: HealthState;
  /** The week the job was due to act on, or null when it had no duty. */
  week: number | null;
  /** When it should have run by, grace included. Null when it was not due. */
  dueBy: string | null;
  /** The timestamp of the evidence that it did. */
  evidenceAt: string | null;
  detail: string;
}

export interface HealthReport {
  checkedAt: string;
  season: number;
  /** True when nothing is `late` or `stuck`. The one line a pager needs. */
  healthy: boolean;
  jobs: JobHealth[];
}

// ---------------------------------------------------------------------------
// The schedule, verbatim
// ---------------------------------------------------------------------------

/**
 * Every cron entry in `vercel.json`, copied exactly.
 *
 * Copied rather than imported because `vercel.json` is deployment configuration and
 * bundling it into the app to read at runtime would make the watchdog depend on the
 * file surviving a build. The test asserts the copy is faithful in both directions —
 * an entry added to `vercel.json` and not here fails, and so does the reverse.
 */
export const WATCHED: Record<string, string[]> = {
  '/api/cron/ingest': ['0 10 * * *'],
  '/api/cron/score-provisional': ['0 14 * * 2'],
  '/api/cron/wrap': ['0 15 * * 2'],
  '/api/cron/waiver-bids': ['0 16 * * 2'],
  '/api/cron/waiver-resolve': ['0 16 * * 3'],
  '/api/cron/score-final': ['0 15 * * 4'],
  '/api/cron/lineups': ['0 16 * * 3', '0 16 * * 4'],
  '/api/cron/weekend-guide': ['0 18 * * 3', '0 18 * * 4'],
  '/api/cron/social': ['0 20 * * *'],
  '/api/cron/score-live': [
    '0 18 * * 0',
    '0 21 * * 0',
    '0 0 * * 1',
    '0 5 * * 1',
    '0 5 * * 2',
    '0 5 * * 4',
    '0 5 * * 5',
  ],
};

/**
 * Parse the subset of cron this project uses: minute 0, a fixed UTC hour, and either
 * one weekday or every day. Throws on anything else rather than guessing, because a
 * schedule this misread would produce a confidently wrong "late".
 */
export function parseCron(expr: string): Firing[] {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`unsupported cron (want 5 fields): ${expr}`);
  const [minute, hour, dom, month, dow] = parts;
  if (minute !== '0') throw new Error(`unsupported cron (minute must be 0): ${expr}`);
  if (dom !== '*' || month !== '*') throw new Error(`unsupported cron (day/month): ${expr}`);

  const h = Number(hour);
  if (!Number.isInteger(h) || h < 0 || h > 23) throw new Error(`unsupported cron hour: ${expr}`);

  if (dow === '*') return Array.from({ length: 7 }, (_, d) => ({ dow: d, hour: h }));
  const d = Number(dow);
  if (!Number.isInteger(d) || d < 0 || d > 6) throw new Error(`unsupported cron weekday: ${expr}`);
  return [{ dow: d, hour: h }];
}

export function firingsFor(job: string): Firing[] {
  const exprs = WATCHED[job];
  if (!exprs) throw new Error(`not a watched job: ${job}`);
  return exprs.flatMap(parseCron);
}

// ---------------------------------------------------------------------------
// Pure firing arithmetic
// ---------------------------------------------------------------------------

/** The most recent firing at or before `at`, or null if none within a week. */
export function lastFiringAtOrBefore(at: Date, firings: Firing[]): Date | null {
  let best: Date | null = null;
  for (const firing of firings) {
    const candidate = new Date(at);
    candidate.setUTCHours(firing.hour, 0, 0, 0);
    while (candidate.getUTCDay() !== firing.dow || candidate > at) {
      candidate.setUTCDate(candidate.getUTCDate() - 1);
      candidate.setUTCHours(firing.hour, 0, 0, 0);
    }
    if (!best || candidate > best) best = candidate;
  }
  return best;
}

/** The first firing at or after `at`. */
export function firstFiringAtOrAfter(at: Date, firings: Firing[]): Date | null {
  let best: Date | null = null;
  for (const firing of firings) {
    const candidate = new Date(at);
    candidate.setUTCHours(firing.hour, 0, 0, 0);
    while (candidate.getUTCDay() !== firing.dow || candidate < at) {
      candidate.setUTCDate(candidate.getUTCDate() + 1);
      candidate.setUTCHours(firing.hour, 0, 0, 0);
    }
    if (!best || candidate < best) best = candidate;
  }
  return best;
}

/**
 * The last firing that still clears a kickoff by the full slack margin — the one that
 * actually does the work for a forward-looking job.
 *
 * This is `defersToLaterFiring` read from the other end. That function asks "is there a
 * better firing after me?"; this asks "which firing was the one that counted?", which
 * is the question a watchdog has to answer to know when evidence became overdue. The
 * deadline arithmetic is identical and deliberately shares `HOBBY_JITTER_HOURS`.
 */
export function decidingFiring(
  kickoff: Date,
  firings: Firing[],
  slackHours = 4,
): Date | null {
  const deadline = new Date(kickoff.getTime() - (slackHours + HOBBY_JITTER_HOURS) * 3_600_000);
  return lastFiringAtOrBefore(deadline, firings);
}

function hoursAfter(at: Date, hours: number): Date {
  return new Date(at.getTime() + hours * 3_600_000);
}

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

interface JobRunRow {
  job: string;
  week: number | null;
  status: string;
  started_at: string;
  finished_at: string | null;
}

/**
 * Judge one model-calling job against its `job_runs` row.
 *
 * `running` is reported as `stuck` rather than late, and the distinction matters more
 * than it reads. `claimJobRun` deliberately has no lease timeout: a row left `running`
 * blocks that job until a human clears it, because a waiver run that died halfway has
 * already spent part of a budget that cannot be refunded. So `stuck` means "this will
 * never run again on its own", which is a different instruction to the reader than
 * "this has not run yet".
 */
function judgeRun(
  job: string,
  week: number | null,
  dueBy: Date,
  now: Date,
  run: JobRunRow | undefined,
): JobHealth {
  const base = { job, week, dueBy: iso(dueBy) };

  if (run?.status === 'completed') {
    return {
      ...base,
      state: 'ok',
      evidenceAt: run.finished_at ?? run.started_at,
      detail: `week ${week} completed`,
    };
  }
  if (run?.status === 'running') {
    return {
      ...base,
      state: 'stuck',
      evidenceAt: run.started_at,
      detail:
        `week ${week} claimed at ${run.started_at} and never finished. The claim is not ` +
        'leased, so this job stays blocked until the row is cleared by hand.',
    };
  }
  if (run?.status === 'failed') {
    return {
      ...base,
      state: 'stuck',
      evidenceAt: run.finished_at ?? run.started_at,
      detail: `week ${week} recorded as failed; it will resume only if the route is invoked again`,
    };
  }
  if (now <= dueBy) {
    return { ...base, state: 'idle', evidenceAt: null, detail: `week ${week} not due until ${iso(dueBy)}` };
  }
  return {
    ...base,
    state: 'late',
    evidenceAt: null,
    detail: `week ${week} was due by ${iso(dueBy)} and has left no job_runs row at all`,
  };
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

/** Backward-looking jobs: keyed to the latest week that is OVER. */
const BACKWARD: { job: string; ledger: string }[] = [
  { job: '/api/cron/score-provisional', ledger: 'score-provisional' },
  { job: '/api/cron/wrap', ledger: 'wrap' },
  { job: '/api/cron/waiver-bids', ledger: 'waiver-bids' },
  { job: '/api/cron/waiver-resolve', ledger: 'waiver-resolve' },
  { job: '/api/cron/score-final', ledger: 'score-final' },
];

/** Forward-looking jobs: keyed to the next week with a kickoff still ahead. */
const FORWARD: { job: string; ledger: string; firings: Firing[] }[] = [
  { job: '/api/cron/lineups', ledger: 'lineups', firings: LINEUP_FIRINGS },
  { job: '/api/cron/weekend-guide', ledger: 'weekend-guide', firings: WEEKEND_GUIDE_FIRINGS },
];

export async function checkHealth(
  db: SupabaseClient,
  seasonId: string,
  season: number,
  now = new Date(),
): Promise<HealthReport> {
  const jobs: JobHealth[] = [];

  const { data: runRows, error: runError } = await db
    .from('job_runs')
    .select('job, week, status, started_at, finished_at')
    .eq('season_id', seasonId);
  if (runError) throw new Error(`job_runs: ${runError.message}`);
  const runs = (runRows ?? []) as JobRunRow[];
  const runFor = (ledger: string, week: number | null) =>
    runs.find((r) => r.job === ledger && r.week === week);

  // --- ingest -------------------------------------------------------------
  jobs.push(await checkIngest(db, now));

  // --- backward-looking ---------------------------------------------------
  const scoredWeek = await resolveScoringWeek(db, season, now);
  const weekOverAt = scoredWeek === null ? null : await weekCompletedAt(db, season, scoredWeek);

  for (const { job, ledger } of BACKWARD) {
    if (scoredWeek === null || weekOverAt === null) {
      jobs.push({
        job,
        state: 'idle',
        week: null,
        dueBy: null,
        evidenceAt: null,
        detail: 'no league week is over yet, so there is nothing to score',
      });
      continue;
    }
    const firing = firstFiringAtOrAfter(weekOverAt, firingsFor(job));
    if (!firing) {
      jobs.push({ job, state: 'idle', week: scoredWeek, dueBy: null, evidenceAt: null, detail: 'no firing scheduled' });
      continue;
    }
    jobs.push(judgeRun(job, scoredWeek, hoursAfter(firing, GRACE_HOURS), now, runFor(ledger, scoredWeek)));
  }

  // --- forward-looking ----------------------------------------------------
  const upcoming = await resolveUpcomingWeek(db, season, { now });

  for (const { job, ledger, firings } of FORWARD) {
    if (!upcoming.ok) {
      jobs.push({
        job,
        state: 'idle',
        week: null,
        dueBy: null,
        evidenceAt: null,
        detail: upcoming.reason,
      });
      continue;
    }
    // NOT `upcoming.firstKickoff`. That field is the next kickoff ahead of NOW, which
    // is the week's opener only while the week has not started. Asked on a Friday it
    // returns Sunday's games, and anchoring the deadline there walks the deciding
    // firing forward a day — it reported week 1, a Wednesday opener, as having been
    // decided on the Thursday. The job itself never sees this because it only ever
    // runs before the week starts; the watchdog runs at arbitrary times and has to ask
    // for the week's FIRST kickoff explicitly.
    const opener = await weekFirstKickoff(db, season, upcoming.week);
    const firing = opener ? decidingFiring(opener, firings) : null;
    if (!firing) {
      jobs.push({
        job,
        state: 'idle',
        week: upcoming.week,
        dueBy: null,
        evidenceAt: null,
        detail: `no firing clears week ${upcoming.week}'s kickoff by the slack margin`,
      });
      continue;
    }
    jobs.push(judgeRun(job, upcoming.week, hoursAfter(firing, GRACE_HOURS), now, runFor(ledger, upcoming.week)));
  }

  // --- live scores --------------------------------------------------------
  jobs.push(await checkLive(db, seasonId, season, now));

  // --- social -------------------------------------------------------------
  jobs.push(await checkSocial(db, seasonId, now));

  const healthy = !jobs.some((j) => j.state === 'late' || j.state === 'stuck');
  return { checkedAt: now.toISOString(), season, healthy, jobs };
}

/** The week's opening kickoff — the anchor every forward-looking deadline hangs on. */
async function weekFirstKickoff(
  db: SupabaseClient,
  season: number,
  week: number,
): Promise<Date | null> {
  const { data, error } = await db
    .from('nfl_games')
    .select('kickoff_at')
    .eq('season', season)
    .eq('season_type', 'regular')
    .eq('week', week)
    .not('kickoff_at', 'is', null)
    .order('kickoff_at', { ascending: true })
    .limit(1);
  if (error) throw new Error(`nfl_games: ${error.message}`);
  const first = data?.[0]?.kickoff_at as string | undefined;
  return first ? new Date(first) : null;
}

/**
 * When the given week stopped having games in it.
 *
 * The week's LAST kickoff plus a game's length, matching `completedWeek`. Taking the
 * first kickoff here would make every backward-looking deadline land a weekend early.
 */
async function weekCompletedAt(
  db: SupabaseClient,
  season: number,
  week: number,
): Promise<Date | null> {
  const { data, error } = await db
    .from('nfl_games')
    .select('kickoff_at')
    .eq('season', season)
    .eq('season_type', 'regular')
    .eq('week', week)
    .not('kickoff_at', 'is', null)
    .order('kickoff_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`nfl_games: ${error.message}`);
  const last = data?.[0]?.kickoff_at as string | undefined;
  return last ? hoursAfter(new Date(last), 4) : null;
}

const INGEST = '/api/cron/ingest';

async function checkIngest(db: SupabaseClient, now: Date): Promise<JobHealth> {
  const { data, error } = await db
    .from('snapshots')
    .select('snapshot_at')
    .order('snapshot_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`snapshots: ${error.message}`);

  const latest = data?.[0]?.snapshot_at as string | undefined;
  const firing = lastFiringAtOrBefore(now, firingsFor(INGEST));
  const dueBy = firing ? hoursAfter(firing, INGEST_GRACE_HOURS) : null;

  if (!latest) {
    return { job: INGEST, state: 'late', week: null, dueBy: iso(dueBy), evidenceAt: null, detail: 'no snapshot has ever been written' };
  }
  // Ingest is idempotent and unweeked, so the only question is freshness: is the most
  // recent snapshot newer than the last firing that has had time to finish?
  if (dueBy && now > dueBy && new Date(latest) < firing!) {
    return {
      job: INGEST,
      state: 'late',
      week: null,
      dueBy: iso(dueBy),
      evidenceAt: latest,
      detail: `newest snapshot is ${latest}, older than the ${iso(firing)} firing. The daily ingest has stopped.`,
    };
  }
  return { job: INGEST, state: 'ok', week: null, dueBy: iso(dueBy), evidenceAt: latest, detail: `newest snapshot ${latest}` };
}

const LIVE = '/api/cron/score-live';

async function checkLive(
  db: SupabaseClient,
  seasonId: string,
  season: number,
  now: Date,
): Promise<JobHealth> {
  // The live job's own stopping condition, asked the same way it asks it. A week that
  // has been officially scored returns null here, and that is `idle`, not late.
  const week = await resolveLiveWeek(db, seasonId, season, now);
  if (week === null) {
    return {
      job: LIVE,
      state: 'idle',
      week: null,
      dueBy: null,
      evidenceAt: null,
      detail: 'no week is both under way and unscored',
    };
  }

  const firing = lastFiringAtOrBefore(now, firingsFor(LIVE));
  const dueBy = firing ? hoursAfter(firing, GRACE_HOURS) : null;

  const { data, error } = await db
    .from('live_scores')
    .select('computed_at')
    .eq('week', week)
    .order('computed_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`live_scores: ${error.message}`);
  const latest = data?.[0]?.computed_at as string | undefined;

  if (!dueBy || now <= dueBy) {
    return { job: LIVE, state: 'idle', week, dueBy: iso(dueBy), evidenceAt: latest ?? null, detail: `week ${week} under way; next deadline ${iso(dueBy)}` };
  }
  if (latest && new Date(latest) >= firing!) {
    return { job: LIVE, state: 'ok', week, dueBy: iso(dueBy), evidenceAt: latest, detail: `week ${week} refreshed at ${latest}` };
  }
  return {
    job: LIVE,
    state: 'late',
    week,
    dueBy: iso(dueBy),
    evidenceAt: latest ?? null,
    detail:
      `week ${week} is under way but live_scores has nothing since the ${iso(firing)} firing. ` +
      'Nothing authoritative depends on this — the site just stops moving.',
  };
}

const SOCIAL = '/api/cron/social';

async function checkSocial(db: SupabaseClient, seasonId: string, now: Date): Promise<JobHealth> {
  const { data, error } = await db
    .from('social_posts')
    .select('dedupe_key, status, auto_eligible, updated_at')
    .eq('season_id', seasonId)
    .eq('status', 'draft')
    .eq('auto_eligible', true)
    .order('updated_at', { ascending: true });
  if (error) throw new Error(`social_posts: ${error.message}`);

  const stale = (data ?? []).filter(
    (r) => now.getTime() - new Date(r.updated_at as string).getTime() > SOCIAL_STUCK_HOURS * 3_600_000,
  );

  if (stale.length > 0) {
    return {
      job: SOCIAL,
      state: 'stuck',
      week: null,
      dueBy: null,
      evidenceAt: stale[0].updated_at as string,
      detail:
        `${stale.length} post(s) cleared to send have sat undelivered for over ` +
        `${SOCIAL_STUCK_HOURS}h, oldest ${stale[0].dedupe_key}. Composing works; releasing does not.`,
    };
  }
  return { job: SOCIAL, state: 'unverifiable', week: null, dueBy: null, evidenceAt: null, detail: SOCIAL_NOTE };
}
