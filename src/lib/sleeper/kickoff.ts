/**
 * Turning a game DATE into the earliest instant that game could kick off.
 *
 * ---------------------------------------------------------------------------
 * Why this file has to exist
 * ---------------------------------------------------------------------------
 * Sleeper's schedule feed carries no kickoff time. Every one of the 273 records for
 * 2026 looks like this, and there is no time field anywhere in it:
 *
 *     {"status":"pre_game","date":"2026-09-13","home":"CAR","week":1,"game_id":"...","away":"CHI"}
 *
 * Verified 6 August 2026 against `api.sleeper.app` and `api.sleeper.com`, the season
 * projections feed, and `/v1/state/nfl`. None of them has one.
 *
 * The ingest was storing `new Date("2026-09-13").toISOString()`, which JavaScript reads
 * as UTC midnight — 8pm ET on the twelfth, the evening BEFORE the games. So every guard
 * that asks "are we before kickoff?" was comparing against an instant 17 to 24 hours too
 * early, and the failure was invisible because being too early looks like having plenty
 * of slack.
 *
 * ---------------------------------------------------------------------------
 * What this models, and what it deliberately does not
 * ---------------------------------------------------------------------------
 * It answers ONE question: what is the earliest kickoff the NFL schedules on a day like
 * this? Not "when does this game start" — we do not know that and must not pretend to.
 *
 * That is the right question for every caller we have. The guards need a deadline, and
 * a deadline has to be the earliest thing it could be racing. Being early here costs a
 * little slack; being late invalidates a week.
 *
 * The slots below are the earliest the league has used on each weekday, not the typical
 * one. A Sunday is treated as 09:30 because of the London games even though most Sundays
 * start at 13:00, because the whole point is the earliest.
 */

/** Earliest kickoff by day of week, US Eastern. */
const EARLIEST_BY_WEEKDAY: Record<number, { hour: number; minute: number; note: string }> = {
  0: { hour: 9, minute: 30, note: 'Sunday — international games kick at 09:30 ET' },
  1: { hour: 19, minute: 0, note: 'Monday night' },
  2: { hour: 19, minute: 0, note: 'Tuesday — rare, weather-moved games' },
  3: { hour: 19, minute: 0, note: 'Wednesday — rare season openers' },
  4: { hour: 20, minute: 15, note: 'Thursday night' },
  5: { hour: 15, minute: 0, note: 'Friday — the Black Friday game' },
  6: { hour: 13, minute: 0, note: 'Saturday — late-season doubleheaders' },
};

/** Thanksgiving is the fourth Thursday of November, and its first game is 12:30 ET. */
export function isThanksgiving(year: number, month: number, day: number, weekday: number): boolean {
  if (month !== 11 || weekday !== 4) return false;
  return day >= 22 && day <= 28;
}

export function isChristmas(month: number, day: number): boolean {
  return month === 12 && day === 25;
}

/**
 * Hours to ADD to a US Eastern wall-clock time to get UTC. 4 under EDT, 5 under EST.
 *
 * Read from the platform time-zone database rather than reimplementing the rule.
 * Hand-rolling "second Sunday in March to first Sunday in November" is exactly the sort
 * of thing that is correct for three years and then silently is not — and this project
 * already has one DST hazard it is watching (SPEC §5.5, the 1 November 2026 shift lands
 * mid-Week 9).
 *
 * Probed at 12:00 UTC on the date, which is far from the 02:00 local transition in both
 * directions, so the answer is never the ambiguous hour.
 */
export function easternOffsetHours(isoDate: string): number {
  const probe = new Date(`${isoDate}T12:00:00Z`);
  const name =
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      timeZoneName: 'shortOffset',
    })
      .formatToParts(probe)
      .find((part) => part.type === 'timeZoneName')?.value ?? 'GMT-5';

  const match = name.match(/GMT([+-]\d{1,2})/);
  // Standard time is the safe default: it makes the UTC instant EARLIER, so a guard
  // reading it refuses sooner rather than running past a kickoff.
  return match ? -Number(match[1]) : 5;
}

export interface EarliestKickoff {
  at: Date;
  /** Which rule produced it, for the ingest log and for anyone auditing a refusal. */
  note: string;
}

/**
 * The earliest instant a game on `isoDate` (YYYY-MM-DD) could kick off.
 *
 * Holiday rules win over the weekday table: Thanksgiving is a Thursday whose first game
 * is at lunchtime rather than at night, and treating it as a normal Thursday would put
 * the deadline nearly eight hours after the real one — on the one week of the season
 * where the margin is thinnest.
 */
export function earliestKickoff(isoDate: string): EarliestKickoff {
  const [year, month, day] = isoDate.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) throw new Error(`earliestKickoff: cannot read a date from "${isoDate}"`);

  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  let slot: { hour: number; minute: number; note: string };
  if (isThanksgiving(year, month, day, weekday)) {
    slot = { hour: 12, minute: 30, note: 'Thanksgiving — first game 12:30 ET' };
  } else if (isChristmas(month, day)) {
    slot = { hour: 13, minute: 0, note: 'Christmas Day — first game 13:00 ET' };
  } else {
    slot = EARLIEST_BY_WEEKDAY[weekday];
  }

  const offset = easternOffsetHours(isoDate);
  return {
    at: new Date(Date.UTC(year, month - 1, day, slot.hour + offset, slot.minute)),
    note: slot.note,
  };
}

/** Convenience for the ingest, which only wants the timestamp. */
export function earliestKickoffIso(isoDate: string | null | undefined): string | null {
  if (!isoDate) return null;
  return earliestKickoff(isoDate).at.toISOString();
}
