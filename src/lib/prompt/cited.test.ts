import { describe, expect, it } from 'vitest';
import { checkCitations } from './cited';

const DATA = {
  week: 3,
  roster: [
    {
      player_id: '4034',
      name: 'Puka Nacua',
      position: 'WR',
      projection: 14.8,
      injury_status: 'Questionable',
      opp_position_rank_allowed: 28,
      last3_ppg: 16.4,
    },
  ],
};

describe('cited fields', () => {
  it('records a field the model named directly', () => {
    const { citedFields, unsupportedClaims } = checkCitations(
      ['opp_position_rank_allowed: 28 is a bottom-five matchup'],
      DATA,
    );
    expect(citedFields).toContain('opp_position_rank_allowed');
    expect(unsupportedClaims).toEqual([]);
  });

  it('records a field the model wrote in prose', () => {
    const { citedFields } = checkCitations(['His last3 ppg of 16.4 leads my flex options'], DATA);
    expect(citedFields).toContain('last3_ppg');
  });

  it('flags a number that appears nowhere in the DATA block', () => {
    const { unsupportedClaims } = checkCitations(
      ['Nacua is projected for 22.5 points this week'],
      DATA,
    );
    expect(unsupportedClaims).toHaveLength(1);
    expect(unsupportedClaims[0]).toContain('22.5');
  });

  it('flags a bullet that grounds itself in nothing', () => {
    const { unsupportedClaims } = checkCitations(['He always shows up in prime time'], DATA);
    expect(unsupportedClaims).toHaveLength(1);
    expect(unsupportedClaims[0]).toContain('cites no DATA field');
  });

  it('accepts a player name quoted from the data as grounding', () => {
    const { unsupportedClaims } = checkCitations(['Puka Nacua is the safest floor here'], DATA);
    expect(unsupportedClaims).toEqual([]);
  });

  it('does not flag small integers used as prose', () => {
    const { unsupportedClaims } = checkCitations(['Two of my three WRs are on bye'], DATA);
    // "Two"/"three" are words, and any small digits would be below the claim floor.
    expect(unsupportedClaims[0]).toContain('cites no DATA field');
    expect(unsupportedClaims.some((c) => c.includes('not in DATA'))).toBe(false);
  });
});
