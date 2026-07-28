import { afterEach, describe, expect, it } from 'vitest';
import { assertCronAuth, assertIrreversibleAllowed, checkKickoff, CronGuardError } from './guard';

const originalEnv = { ...process.env };
afterEach(() => {
  process.env = { ...originalEnv };
});

describe('cron auth', () => {
  const request = (header?: string) =>
    new Request('https://example.test/api/cron/lineups', {
      headers: header ? { authorization: header } : {},
    });

  it('accepts the configured bearer secret', () => {
    process.env.CRON_SECRET = 's3cret';
    expect(() => assertCronAuth(request('Bearer s3cret'))).not.toThrow();
  });

  it('rejects a wrong or missing secret with 401', () => {
    process.env.CRON_SECRET = 's3cret';
    expect(() => assertCronAuth(request('Bearer nope'))).toThrow(CronGuardError);
    expect(() => assertCronAuth(request())).toThrow(/unauthorized/);
  });

  it('fails closed when CRON_SECRET is unset', () => {
    delete process.env.CRON_SECRET;
    expect(() => assertCronAuth(request('Bearer anything'))).toThrow(/not configured/);
  });
});

describe('kickoff guard across the DST boundary', () => {
  // Thursday lineup job pinned to 16:00 UTC. TNF kicks off ~20:15 ET.
  const octoberKickoff = new Date('2026-10-16T00:15:00Z'); // 20:15 EDT, Thu 15 Oct
  const novemberKickoff = new Date('2026-11-13T01:15:00Z'); // 20:15 EST, Thu 12 Nov

  it('passes in October with hours to spare', () => {
    const check = checkKickoff(new Date('2026-10-15T16:00:00Z'), octoberKickoff);
    // 16:00 UTC Thu is 12:00 ET; kickoff is 20:15 ET the same evening.
    expect(check.ok).toBe(true);
    expect(check.hoursOfSlack).toBeGreaterThan(4);
  });

  it('still passes after DST ends, because the job keeps 4h+ of slack', () => {
    const check = checkKickoff(new Date('2026-11-12T16:00:00Z'), novemberKickoff);
    expect(check.ok).toBe(true);
    expect(check.hoursOfSlack).toBeGreaterThan(4);
  });

  it('refuses to run once kickoff has passed', () => {
    const check = checkKickoff(new Date('2026-11-13T02:00:00Z'), novemberKickoff);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/kickoff was/);
  });

  it('refuses inside the slack window — the drift case this guard exists for', () => {
    const check = checkKickoff(new Date('2026-11-12T23:00:00Z'), novemberKickoff);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/below the 4h slack requirement/);
  });

  it('refuses when the schedule has no kickoff time at all', () => {
    const check = checkKickoff(new Date(), null);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/unknown schedule/);
  });
});

describe('irreversible jobs', () => {
  it('are locked by default', () => {
    delete process.env.ALLOW_IRREVERSIBLE;
    expect(() => assertIrreversibleAllowed('draft')).toThrow(/irreversible/);
  });

  it('run only when explicitly unlocked', () => {
    process.env.ALLOW_IRREVERSIBLE = '1';
    expect(() => assertIrreversibleAllowed('draft')).not.toThrow();
  });
});
