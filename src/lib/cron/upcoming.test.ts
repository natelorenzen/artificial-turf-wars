import { describe, it, expect } from 'vitest';
import {
  checkLeadTime,
  defersToLaterFiring,
  LINEUP_FIRINGS,
  MAX_LEAD_DAYS,
  type UpcomingWeek,
} from './upcoming';

const upcoming = (leadDays: number, week = 1): UpcomingWeek => ({
  week,
  firstKickoff: new Date(Date.now() + leadDays * 86_400_000),
  leadDays,
});

describe('lead-time guard', () => {
  it('lets the Thursday lineup call through, ~8 hours before kickoff', () => {
    expect(checkLeadTime(upcoming(8 / 24, 5)).ok).toBe(true);
  });

  it('lets the Tuesday waiver call through, two days out', () => {
    expect(checkLeadTime(upcoming(2, 5)).ok).toBe(true);
  });

  it('lets a week whose earliest fixture is Sunday through', () => {
    // No Thursday game: the Thursday job is then three days from first kickoff.
    expect(checkLeadTime(upcoming(3, 12)).ok).toBe(true);
  });

  it('refuses the preseason case this guard exists for', () => {
    // Early August: `nextUnplayedWeek` answers "week 1" every day until September.
    const check = checkLeadTime(upcoming(34, 1));
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('week 1');
    expect(check.reason).toContain('34.0 days');
  });

  it('refuses a full week early, the nearest miss to a legitimate run', () => {
    expect(checkLeadTime(upcoming(MAX_LEAD_DAYS + 0.01)).ok).toBe(false);
    expect(checkLeadTime(upcoming(MAX_LEAD_DAYS)).ok).toBe(true);
  });

  it('does not fire on a kickoff already in the past — that is the other guard', () => {
    // `assertBeforeKickoff` owns lateness. This one must not double-refuse, or a job
    // that is merely late would report the wrong reason.
    expect(checkLeadTime(upcoming(-0.5)).ok).toBe(true);
  });
});

describe('two firings for one job', () => {
  // 2026 week 2 opens Thursday 20:15 ET = Fri 00:15 UTC. Normal week.
  const thursdayOpener = new Date('2026-09-18T00:15:00Z');
  // 2026 weeks 1 and 12 open WEDNESDAY 19:00 ET. The Thursday entry is a day too late.
  const wednesdayOpener = new Date('2026-11-26T00:00:00Z');

  const wed = (iso: string) => new Date(iso);

  it('stands down on Wednesday when Thursday still clears a Thursday opener', () => {
    const deferred = defersToLaterFiring(wed('2026-09-16T16:30:00Z'), thursdayOpener, LINEUP_FIRINGS);
    expect(deferred).toEqual({ dow: 4, hour: 16 });
  });

  it('runs on Thursday, because nothing later clears it', () => {
    expect(defersToLaterFiring(wed('2026-09-17T16:30:00Z'), thursdayOpener, LINEUP_FIRINGS)).toBeNull();
  });

  it('runs on Wednesday when the week opens that evening', () => {
    // The case that would otherwise set week 12's lineups six days early.
    expect(defersToLaterFiring(wed('2026-11-25T16:30:00Z'), wednesdayOpener, LINEUP_FIRINGS)).toBeNull();
  });

  it('measures from the latest moment a firing could start, not the nominal one', () => {
    // A Thursday 16:00 entry with Hobby jitter may not start until 16:59. Against a
    // kickoff at 21:00 that leaves 4.02h — just inside. Twenty minutes earlier a
    // kickoff at 20:50 does not, and the Wednesday run must not defer to it.
    expect(defersToLaterFiring(wed('2026-09-16T16:30:00Z'), new Date('2026-09-17T21:00:00Z'), LINEUP_FIRINGS)).toEqual({ dow: 4, hour: 16 });
    expect(defersToLaterFiring(wed('2026-09-16T16:30:00Z'), new Date('2026-09-17T20:50:00Z'), LINEUP_FIRINGS)).toBeNull();
  });
});
