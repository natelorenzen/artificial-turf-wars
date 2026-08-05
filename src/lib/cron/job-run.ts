/**
 * The idempotency claim for cron jobs that spend money.
 *
 * Vercel cron delivery is best effort — it may miss a run and it may deliver one
 * twice, and it never retries a failure. The deterministic jobs are safe to repeat.
 * The model-calling ones are not: a second `waiver-bids` delivery means eight more
 * model calls and a second set of FAAB claims against a budget that cannot be
 * refunded.
 *
 * The rule this module exists to enforce: CLAIM BEFORE YOU SPEND. The claim is an
 * insert against a unique index, so atomicity is the database's problem rather than
 * ours — two concurrent deliveries both insert, exactly one wins, and the loser
 * returns `already` without calling a single model.
 *
 * Deliberately not a lease with a timeout. A row stuck in `running` blocks the job
 * until a human clears it, which is the behaviour we want: a waiver job that died
 * halfway has already spent part of a budget, and re-running it would spend the rest
 * against a state nobody has looked at.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** Postgres unique_violation. The whole mechanism rests on this code. */
const UNIQUE_VIOLATION = '23505';

export type JobName =
  | 'waiver-bids'
  | 'waiver-resolve'
  | 'lineups'
  | 'wrap'
  | 'weekend-guide'
  | 'score-provisional'
  | 'score-final';

export interface JobClaim {
  /** False when this delivery is a duplicate and must do nothing. */
  claimed: boolean;
  /** Null when the claim was lost. */
  runId: string | null;
  /** Why the claim was refused, for the response body and the log. */
  reason: string;
}

export interface ClaimInput {
  job: JobName;
  seasonId: string;
  /** Null for jobs that run once per season rather than once per week. */
  week?: number | null;
  /**
   * Allow re-entering a run still marked `running`.
   *
   * Only safe when the job's UNIT OF SPEND is individually idempotent. The weekend
   * guide qualifies: each take is keyed `(season_id, week, game_key, model_id)`, so a
   * second pass skips whatever already landed and pays only for what is missing. That
   * makes resuming strictly better than blocking, because the alternative is a job
   * killed by the 300s function ceiling that can then never finish.
   *
   * `waiver-bids` does NOT qualify and must never set this. Re-calling a model there
   * can yield different players, which collide with nothing and spend the budget a
   * second time. For those, a stuck row must keep blocking until a human looks.
   */
  resumable?: boolean;
}

/**
 * Claim the right to run. Call this BEFORE the first model call — after it, the
 * claim proves nothing.
 */
export async function claimJobRun(db: SupabaseClient, input: ClaimInput): Promise<JobClaim> {
  const week = input.week ?? null;

  const { data, error } = await db
    .from('job_runs')
    .insert({ job: input.job, season_id: input.seasonId, week, status: 'running' })
    .select('id')
    .single();

  if (!error) {
    return { claimed: true, runId: data.id as string, reason: 'claimed' };
  }

  if (error.code === UNIQUE_VIOLATION) {
    if (input.resumable) {
      const resumed = await resumeExisting(db, input.job, input.seasonId, week);
      if (resumed) return resumed;
    }
    const existing = await describeExisting(db, input.job, input.seasonId, week);
    return { claimed: false, runId: null, reason: existing };
  }

  // Any other failure is not a duplicate — it is a broken database, and refusing to
  // spend money on an unknown state is the only safe reading of it.
  throw new Error(`job_runs claim (${input.job}): ${error.message}`);
}

/**
 * Hand back the existing run when it is still `running` and the caller declared the
 * job resumable. A `completed` run is never resumed — that would redo finished work.
 */
async function resumeExisting(
  db: SupabaseClient,
  job: JobName,
  seasonId: string,
  week: number | null,
): Promise<JobClaim | null> {
  const query = db.from('job_runs').select('id, status, started_at').eq('job', job).eq('season_id', seasonId);
  const { data } = await (week === null ? query.is('week', null) : query.eq('week', week)).single();

  if (!data || data.status !== 'running') return null;
  return {
    claimed: true,
    runId: data.id as string,
    reason: `resuming the run started at ${data.started_at}; work already stored is skipped`,
  };
}

async function describeExisting(
  db: SupabaseClient,
  job: JobName,
  seasonId: string,
  week: number | null,
): Promise<string> {
  const query = db
    .from('job_runs')
    .select('status, started_at, finished_at, model_calls, cost_usd')
    .eq('job', job)
    .eq('season_id', seasonId);

  const { data } = await (week === null ? query.is('week', null) : query.eq('week', week)).single();

  const where = week === null ? job : `${job} week ${week}`;
  if (!data) return `${where} is already claimed`;

  if (data.status === 'running') {
    return (
      `${where} has been running since ${data.started_at} and never finished. ` +
      'Refusing to re-run: it may have spent part of a budget. Inspect the run and clear the row by hand.'
    );
  }
  return (
    `${where} already ran (${data.status} at ${data.finished_at}, ` +
    `${data.model_calls} model calls, $${data.cost_usd}). Duplicate delivery ignored.`
  );
}

export interface FinishInput {
  runId: string;
  modelCalls?: number;
  costUsd?: number;
  detail?: string;
}

export async function completeJobRun(db: SupabaseClient, input: FinishInput) {
  await finish(db, input, 'completed');
}

/**
 * Mark a run failed. This does NOT release the claim — see the module note. It
 * records what happened so the human clearing the row can see it.
 */
export async function failJobRun(db: SupabaseClient, input: FinishInput) {
  await finish(db, input, 'failed');
}

async function finish(db: SupabaseClient, input: FinishInput, status: 'completed' | 'failed') {
  const { error } = await db
    .from('job_runs')
    .update({
      status,
      detail: input.detail ?? null,
      model_calls: input.modelCalls ?? 0,
      cost_usd: input.costUsd ?? 0,
      finished_at: new Date().toISOString(),
    })
    .eq('id', input.runId);

  // Never throw: the work is already done and committed. Losing the bookkeeping
  // update must not turn a successful run into a 500 that invites a retry.
  if (error) console.error(`job_runs finish (${status}): ${error.message}`);
}
