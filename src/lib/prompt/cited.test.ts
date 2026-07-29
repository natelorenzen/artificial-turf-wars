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

describe('rulebook grounding', () => {
  const RULEBOOK = 'Passing yards ... 0.04 each\nPassing TD ... 4\nInterception thrown ... -1';

  it('accepts a bullet grounded in the rulebook rather than the DATA block', () => {
    const { citedFields, unsupportedClaims } = checkCitations(
      ['Scoring awards 4 per pass TD and 0.04 per pass yard'],
      DATA,
      RULEBOOK,
    );
    expect(citedFields).toContain('RULEBOOK');
    expect(unsupportedClaims).toEqual([]);
  });

  it('still flags an invented number when the rulebook does not contain it', () => {
    const { unsupportedClaims } = checkCitations(
      ['Scoring awards 9 per pass TD'],
      DATA,
      RULEBOOK,
    );
    expect(unsupportedClaims).toHaveLength(1);
  });

  it('does not let a real field name license an invented value beside it', () => {
    // Cites a genuine field AND a number that appears nowhere.
    const { unsupportedClaims } = checkCitations(
      ['projection for Puka Nacua is 99.7 this week'],
      DATA,
      RULEBOOK,
    );
    expect(unsupportedClaims.some((c) => c.includes('99.7'))).toBe(true);
  });
});

describe('one finding per bullet', () => {
  it('does not report the same sentence twice', () => {
    // Cites an invented number AND grounds itself in nothing else. That is one
    // problem, not two, and counting it twice inflates every published total.
    const { unsupportedClaims } = checkCitations(['He put up 70 last year in a different system'], DATA);
    expect(unsupportedClaims).toHaveLength(1);
    expect(unsupportedClaims[0]).toContain('not in DATA');
  });
});
