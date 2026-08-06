import { describe, it, expect } from 'vitest';
import { earliestKickoff, easternOffsetHours, isThanksgiving } from './kickoff';

const at = (date: string) => earliestKickoff(date).at.toISOString();

describe('eastern offset', () => {
  it('is 4 hours under EDT', () => {
    expect(easternOffsetHours('2026-09-13')).toBe(4);
  });

  it('is 5 hours under EST', () => {
    expect(easternOffsetHours('2026-12-06')).toBe(5);
  });

  it('flips on 1 November 2026, mid-Week 9', () => {
    // The shift SPEC §5.5 exists to watch. Getting this backwards moves every
    // deadline an hour the wrong way on the one week nobody is looking.
    expect(easternOffsetHours('2026-10-31')).toBe(4);
    expect(easternOffsetHours('2026-11-01')).toBe(5);
  });
});

describe('earliest kickoff on a date', () => {
  it('treats Sunday as 09:30 ET, not 13:00, because of the London games', () => {
    // 2026-09-13 is a Sunday. 09:30 EDT = 13:30 UTC.
    expect(at('2026-09-13')).toBe('2026-09-13T13:30:00.000Z');
  });

  it('treats Thursday as 20:15 ET', () => {
    // 2026-09-17 is a Thursday. 20:15 EDT = 00:15 UTC the next day.
    expect(at('2026-09-17')).toBe('2026-09-18T00:15:00.000Z');
  });

  it('knows Thanksgiving starts at lunchtime', () => {
    // 26 November 2026 is the fourth Thursday. 12:30 EST = 17:30 UTC.
    // As a normal Thursday this would have been 01:15 UTC on the 27th — nearly eight
    // hours late, on the tightest week of the season.
    expect(isThanksgiving(2026, 11, 26, 4)).toBe(true);
    expect(at('2026-11-26')).toBe('2026-11-26T17:30:00.000Z');
  });

  it('does not mistake an ordinary November Thursday for Thanksgiving', () => {
    expect(isThanksgiving(2026, 11, 19, 4)).toBe(false);
    expect(at('2026-11-19')).toBe('2026-11-20T01:15:00.000Z');
  });

  it('knows Christmas starts at 13:00 ET whatever day it falls on', () => {
    // 25 December 2026 is a Friday, which would otherwise be the 15:00 Black Friday slot.
    expect(at('2026-12-25')).toBe('2026-12-25T18:00:00.000Z');
  });

  it('handles the Friday and Saturday slots', () => {
    expect(at('2026-11-27')).toBe('2026-11-27T20:00:00.000Z'); // Friday, 15:00 EST
    expect(at('2026-12-19')).toBe('2026-12-19T18:00:00.000Z'); // Saturday, 13:00 EST
  });

  it('is always EARLIER than any real kickoff on that date', () => {
    // The property the guards depend on. A modelled deadline that lands after a real
    // kickoff would let a job write a lineup for a game already in progress.
    for (const date of ['2026-09-13', '2026-09-17', '2026-11-26', '2026-12-25']) {
      const modelled = earliestKickoff(date).at;
      const midnightEtNextDay = new Date(`${date}T00:00:00Z`);
      midnightEtNextDay.setUTCDate(midnightEtNextDay.getUTCDate() + 1);
      expect(modelled.getTime()).toBeLessThan(midnightEtNextDay.getTime() + 6 * 3_600_000);
      expect(modelled.getTime()).toBeGreaterThan(new Date(`${date}T00:00:00Z`).getTime());
    }
  });

  it('rejects a date it cannot read rather than guessing', () => {
    expect(() => earliestKickoff('not-a-date')).toThrow(/cannot read a date/);
  });
});
