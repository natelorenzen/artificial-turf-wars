import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  WATCHED,
  decidingFiring,
  firingsFor,
  firstFiringAtOrAfter,
  lastFiringAtOrBefore,
  parseCron,
} from './health';
import { LINEUP_FIRINGS } from './upcoming';

/**
 * The whole point of the watchdog is that it watches the real schedule. A copy that
 * silently drifts from `vercel.json` would report a job it no longer has as healthy,
 * and miss one it gained entirely.
 */
describe('WATCHED matches vercel.json', () => {
  const vercel = JSON.parse(
    readFileSync(join(process.cwd(), 'vercel.json'), 'utf8'),
  ) as { crons: { path: string; schedule: string }[] };

  const actual = new Map<string, string[]>();
  for (const entry of vercel.crons) {
    actual.set(entry.path, [...(actual.get(entry.path) ?? []), entry.schedule]);
  }

  it('covers every path deployed, and invents none', () => {
    expect(Object.keys(WATCHED).sort()).toEqual([...actual.keys()].sort());
  });

  it('has the same schedules, per path', () => {
    for (const [path, schedules] of actual) {
      expect(WATCHED[path]?.slice().sort(), `schedules for ${path}`).toEqual(
        schedules.slice().sort(),
      );
    }
  });

  it('can parse every schedule actually deployed', () => {
    for (const entry of vercel.crons) {
      expect(() => parseCron(entry.schedule), entry.schedule).not.toThrow();
    }
  });
});

describe('parseCron', () => {
  it('expands a daily schedule to all seven weekdays', () => {
    expect(parseCron('0 10 * * *')).toHaveLength(7);
    expect(parseCron('0 10 * * *').every((f) => f.hour === 10)).toBe(true);
  });

  it('reads a single weekday', () => {
    expect(parseCron('0 14 * * 2')).toEqual([{ dow: 2, hour: 14 }]);
  });

  it('reads midnight, which is falsy and easy to drop', () => {
    expect(parseCron('0 0 * * 1')).toEqual([{ dow: 1, hour: 0 }]);
  });

  it('throws rather than guessing at a schedule it does not model', () => {
    expect(() => parseCron('*/5 * * * *')).toThrow();
    expect(() => parseCron('30 14 * * 2')).toThrow();
    expect(() => parseCron('0 14 1 * 2')).toThrow();
  });
});

describe('firing arithmetic', () => {
  const tuesday14 = firingsFor('/api/cron/score-provisional');

  it('finds the most recent firing at or before a moment', () => {
    // Friday 11 Sept 2026 -> the Tuesday just gone, the 8th.
    const at = lastFiringAtOrBefore(new Date('2026-09-11T18:00:00Z'), tuesday14);
    expect(at?.toISOString()).toBe('2026-09-08T14:00:00.000Z');
  });

  it('treats the firing hour itself as at-or-before, not before', () => {
    const at = lastFiringAtOrBefore(new Date('2026-09-08T14:00:00Z'), tuesday14);
    expect(at?.toISOString()).toBe('2026-09-08T14:00:00.000Z');
  });

  it('finds the first firing at or after a moment', () => {
    const at = firstFiringAtOrAfter(new Date('2026-09-11T18:00:00Z'), tuesday14);
    expect(at?.toISOString()).toBe('2026-09-15T14:00:00.000Z');
  });

  it('picks the earliest across several firings of one job', () => {
    // score-live fires Sunday 18:00 and 21:00; from Sunday noon the next is 18:00.
    const at = firstFiringAtOrAfter(new Date('2026-09-13T12:00:00Z'), firingsFor('/api/cron/score-live'));
    expect(at?.toISOString()).toBe('2026-09-13T18:00:00.000Z');
  });
});

/**
 * The Wednesday-opener trap, from the watchdog's side.
 *
 * Weeks 1 and 12 of 2026 open on a Wednesday evening. The lineup job fires Wednesday
 * AND Thursday and stands down on the earlier one whenever the later still clears
 * kickoff. A watchdog that assumed Thursday would call week 1 late on Wednesday night
 * — while the job had in fact already done exactly the right thing that afternoon.
 */
describe('decidingFiring', () => {
  // Every kickoff below is the value actually stored in `nfl_games` for 2026, not a
  // constructed one. A fixture invented in UTC is how this test first went wrong: ET
  // 20:15 on Thursday is 00:15 UTC on FRIDAY, and a plausible-looking '20:15Z' is a
  // Thursday afternoon game that the NFL does not play.

  it('names Thursday for a normal Thursday-opener week', () => {
    // Week 2 opens Thu 17 Sept, 20:15 ET.
    const kickoff = new Date('2026-09-18T00:15:00Z');
    expect(decidingFiring(kickoff, LINEUP_FIRINGS)?.toISOString()).toBe('2026-09-17T16:00:00.000Z');
  });

  it('names WEDNESDAY for week 1, a Wednesday opener', () => {
    // Week 1 opened Wed 9 Sept, 19:00 ET.
    const kickoff = new Date('2026-09-09T23:00:00Z');
    expect(decidingFiring(kickoff, LINEUP_FIRINGS)?.toISOString()).toBe('2026-09-09T16:00:00.000Z');
  });

  it('names WEDNESDAY for week 12, the season\'s other one', () => {
    // Week 12 opens Wed 25 Nov, 19:00 ET — and by then DST has ended, which is the
    // whole reason the slack margin exists rather than a tighter one.
    const kickoff = new Date('2026-11-26T00:00:00Z');
    expect(decidingFiring(kickoff, LINEUP_FIRINGS)?.toISOString()).toBe('2026-11-25T16:00:00.000Z');
  });

  it('falls back a day when the later firing does not clear the margin', () => {
    // A Sunday-only week: nothing on Thursday night, so the Thursday firing is the
    // last one that counts and Wednesday is not needed.
    const kickoff = new Date('2026-09-20T17:00:00Z');
    expect(decidingFiring(kickoff, LINEUP_FIRINGS)?.toISOString()).toBe('2026-09-17T16:00:00.000Z');
  });
});
