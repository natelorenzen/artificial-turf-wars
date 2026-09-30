import { describe, expect, it } from 'vitest';
import { PICKS_SYSTEM, weeksLeftLine } from './run';

describe('the bankroll horizon', () => {
  it('counts the current week in the weeks left', () => {
    expect(weeksLeftLine(4, 18)).toContain('through week 18');
    expect(weeksLeftLine(4, 18)).toContain('15 weeks including this one');
  });

  it('says so plainly in the last week', () => {
    expect(weeksLeftLine(18, 18)).toContain('the last week of the regular season');
    expect(weeksLeftLine(18, 18)).not.toContain('weeks including');
  });

  it('does not claim the bankroll started with the season', () => {
    expect(PICKS_SYSTEM).not.toContain('started the season');
    expect(PICKS_SYSTEM).toMatch(/betting opened in week\s+4,/);
  });
});
