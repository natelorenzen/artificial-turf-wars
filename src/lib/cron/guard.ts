/**
 * Cron auth and the DST guard (SPEC §5.5).
 *
 * Vercel Cron runs on UTC. US daylight saving ends 1 November 2026 — in the middle
 * of Week 9 — so every job pinned to a fixed UTC hour silently moves an hour
 * relative to kickoff at that point. A Thursday lineup job that drifts the wrong way
 * would run AFTER kickoff and invalidate the week.
 *
 * Two defenses, both required: schedule with at least four hours of slack, and have
 * each job assert the current time is before the week's first kickoff and refuse to
 * run if it is not. A job that would produce an invalid week must fail loudly rather
 * than quietly write a bad lineup.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export const REQUIRED_SLACK_HOURS = 4;

export class CronGuardError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'CronGuardError';
  }
}

/** `Authorization: Bearer <CRON_SECRET>`, per STACK.md. */
export function assertCronAuth(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new CronGuardError('CRON_SECRET is not configured', 500);

  const header = request.headers.get('authorization') ?? request.headers.get('x-cron-secret') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : header;
  if (token !== secret) throw new CronGuardError('unauthorized', 401);
}

export interface KickoffCheck {
  ok: boolean;
  hoursOfSlack: number | null;
  kickoffAt: string | null;
  reason: string;
}

/** Pure form, so the DST scenarios are testable without a database. */
export function checkKickoff(now: Date, firstKickoff: Date | null, slackHours = REQUIRED_SLACK_HOURS): KickoffCheck {
  if (!firstKickoff) {
    return {
      ok: false,
      hoursOfSlack: null,
      kickoffAt: null,
      reason: 'no kickoff time known for this week — refusing to run on an unknown schedule',
    };
  }

  const hours = (firstKickoff.getTime() - now.getTime()) / 3_600_000;
  if (hours <= 0) {
    return {
      ok: false,
      hoursOfSlack: Number(hours.toFixed(2)),
      kickoffAt: firstKickoff.toISOString(),
      reason: `kickoff was ${Math.abs(hours).toFixed(1)}h ago — this job would produce an invalid week`,
    };
  }
  if (hours < slackHours) {
    return {
      ok: false,
      hoursOfSlack: Number(hours.toFixed(2)),
      kickoffAt: firstKickoff.toISOString(),
      reason: `only ${hours.toFixed(1)}h before kickoff, below the ${slackHours}h slack requirement (DST drift)`,
    };
  }
  return {
    ok: true,
    hoursOfSlack: Number(hours.toFixed(2)),
    kickoffAt: firstKickoff.toISOString(),
    reason: `${hours.toFixed(1)}h before kickoff`,
  };
}

export async function firstKickoffOfWeek(
  db: SupabaseClient,
  season: number,
  week: number,
): Promise<Date | null> {
  const { data, error } = await db
    .from('nfl_games')
    .select('kickoff_at')
    .eq('season', season)
    .eq('week', week)
    .not('kickoff_at', 'is', null)
    .order('kickoff_at', { ascending: true })
    .limit(1);

  if (error) throw new Error(`kickoff lookup: ${error.message}`);
  const value = data?.[0]?.kickoff_at as string | undefined;
  return value ? new Date(value) : null;
}

/** Throws with a loud, specific message rather than writing a bad week. */
export async function assertBeforeKickoff(
  db: SupabaseClient,
  season: number,
  week: number,
  now = new Date(),
) {
  const check = checkKickoff(now, await firstKickoffOfWeek(db, season, week), REQUIRED_SLACK_HOURS);
  if (!check.ok) {
    throw new CronGuardError(`week ${week}: ${check.reason}`, 409);
  }
  return check;
}

/**
 * One-shot irreversible jobs (the auction, the draft) refuse to run unless
 * explicitly unlocked. There is no undo for either (SPEC §4.2, §4.3).
 */
export function assertIrreversibleAllowed(job: string) {
  if (process.env.ALLOW_IRREVERSIBLE !== '1') {
    throw new CronGuardError(
      `${job} is irreversible and ALLOW_IRREVERSIBLE is not set to 1`,
      423,
    );
  }
}

export function cronErrorResponse(err: unknown): Response {
  if (err instanceof CronGuardError) {
    return Response.json({ ok: false, error: err.message }, { status: err.status });
  }
  const message = err instanceof Error ? err.message : String(err);
  return Response.json({ ok: false, error: message }, { status: 500 });
}
