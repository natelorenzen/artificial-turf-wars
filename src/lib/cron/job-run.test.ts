import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { claimJobRun, completeJobRun } from './job-run';

/**
 * A fake `job_runs` table that enforces the real unique index, so these tests
 * exercise the branch that actually protects the budget rather than a mock that
 * agrees with us.
 */
function fakeDb(rows: Record<string, unknown>[] = []) {
  const inserts: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];

  const key = (r: Record<string, unknown>) => `${r.job}|${r.season_id}|${r.week ?? 'null'}`;
  const stored = [...rows];

  const db = {
    from(table: string) {
      expect(table).toBe('job_runs');
      return {
        insert(row: Record<string, unknown>) {
          return {
            select() {
              return {
                single() {
                  if (stored.some((r) => key(r) === key(row))) {
                    return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key' } });
                  }
                  const created = { id: `run-${stored.length + 1}`, ...row };
                  stored.push(created);
                  inserts.push(created);
                  return Promise.resolve({ data: created, error: null });
                },
              };
            },
          };
        },
        select() {
          const filters: Record<string, unknown> = {};
          const chain = {
            eq(col: string, value: unknown) {
              filters[col] = value;
              return chain;
            },
            is(col: string, value: unknown) {
              filters[col] = value;
              return chain;
            },
            single() {
              const found = stored.find((r) =>
                Object.entries(filters).every(([c, v]) => (r[c] ?? null) === v),
              );
              return Promise.resolve({ data: found ?? null, error: null });
            },
          };
          return chain;
        },
        update(row: Record<string, unknown>) {
          return {
            eq(_col: string, id: string) {
              updates.push({ id, ...row });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;

  return { db, inserts, updates, stored };
}

const input = { job: 'waiver-bids' as const, seasonId: 'season-1', week: 5 };

describe('claiming a job run', () => {
  it('grants the claim to the first delivery', async () => {
    const { db } = fakeDb();
    const claim = await claimJobRun(db, input);
    expect(claim.claimed).toBe(true);
    expect(claim.runId).toBe('run-1');
  });

  it('refuses the second delivery of the same job and week', async () => {
    const { db, inserts } = fakeDb();
    const first = await claimJobRun(db, input);
    const second = await claimJobRun(db, input);

    expect(first.claimed).toBe(true);
    expect(second.claimed).toBe(false);
    expect(second.runId).toBeNull();
    // The point of the whole module: exactly one row, so exactly one set of calls.
    expect(inserts).toHaveLength(1);
  });

  it('still allows a different week of the same job', async () => {
    const { db } = fakeDb();
    await claimJobRun(db, input);
    const nextWeek = await claimJobRun(db, { ...input, week: 6 });
    expect(nextWeek.claimed).toBe(true);
  });

  it('allows a different job in the same week', async () => {
    const { db } = fakeDb();
    await claimJobRun(db, input);
    const other = await claimJobRun(db, { ...input, job: 'lineups' });
    expect(other.claimed).toBe(true);
  });

  it('treats a season-scoped job (week null) as its own key', async () => {
    const { db } = fakeDb();
    const first = await claimJobRun(db, { job: 'wrap', seasonId: 'season-1', week: null });
    const second = await claimJobRun(db, { job: 'wrap', seasonId: 'season-1', week: null });
    expect(first.claimed).toBe(true);
    expect(second.claimed).toBe(false);
  });

  it('refuses to re-run a job that died mid-flight, and says why', async () => {
    const { db } = fakeDb([
      { id: 'run-0', job: 'waiver-bids', season_id: 'season-1', week: 5, status: 'running', started_at: '2026-10-06T16:00:00Z' },
    ]);
    const claim = await claimJobRun(db, input);
    expect(claim.claimed).toBe(false);
    // A half-spent budget must summon a human, not a retry.
    expect(claim.reason).toMatch(/never finished/);
    expect(claim.reason).toMatch(/by hand/);
  });

  it('reports what the completed run already spent', async () => {
    const { db } = fakeDb([
      {
        id: 'run-0', job: 'waiver-bids', season_id: 'season-1', week: 5,
        status: 'completed', finished_at: '2026-10-06T16:04:00Z', model_calls: 8, cost_usd: 0.42,
      },
    ]);
    const claim = await claimJobRun(db, input);
    expect(claim.claimed).toBe(false);
    expect(claim.reason).toMatch(/8 model calls/);
    expect(claim.reason).toMatch(/Duplicate delivery ignored/);
  });

  it('throws rather than proceeding when the database fails for any other reason', async () => {
    const db = {
      from: () => ({
        insert: () => ({
          select: () => ({
            single: () => Promise.resolve({ data: null, error: { code: '08006', message: 'connection failure' } }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    // Not a duplicate — an unknown state. Spending money into it is the one
    // unacceptable outcome, so this must not return `claimed: false` either.
    await expect(claimJobRun(db, input)).rejects.toThrow(/connection failure/);
  });
});

describe('finishing a run', () => {
  it('records calls and cost against the claim', async () => {
    const { db, updates } = fakeDb();
    const claim = await claimJobRun(db, input);
    await completeJobRun(db, { runId: claim.runId!, modelCalls: 8, costUsd: 0.42 });

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ id: 'run-1', status: 'completed', model_calls: 8, cost_usd: 0.42 });
  });

  it('never throws when the bookkeeping update fails — the work is already committed', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = {
      from: () => ({
        update: () => ({ eq: () => Promise.resolve({ error: { message: 'write timeout' } }) }),
      }),
    } as unknown as SupabaseClient;

    await expect(completeJobRun(db, { runId: 'run-1' })).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
