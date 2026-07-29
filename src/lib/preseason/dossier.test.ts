import { describe, expect, it } from 'vitest';
import { replacementRank } from './dossier';
import { LEAGUE, SLOTS } from '@/lib/config/league';

describe('replacement level', () => {
  it('puts QB replacement at one per team, since only one starts', () => {
    expect(replacementRank('QB')).toBe(LEAGUE.teams * SLOTS.QB);
    expect(replacementRank('K')).toBe(LEAGUE.teams);
    expect(replacementRank('DEF')).toBe(LEAGUE.teams);
  });

  it('pushes flex-eligible positions deeper, because the flex consumes them too', () => {
    // 2 RB per team = 16, plus a share of the 8 flex slots.
    expect(replacementRank('RB')).toBeGreaterThan(LEAGUE.teams * SLOTS.RB);
    expect(replacementRank('WR')).toBeGreaterThan(LEAGUE.teams * SLOTS.WR);
    expect(replacementRank('TE')).toBeGreaterThan(LEAGUE.teams * SLOTS.TE);
  });

  it('ranks scarcity the way the position actually behaves', () => {
    // The whole point: RB replacement is far deeper than QB replacement, which is
    // why a QB's raw projection overstates what he is worth.
    expect(replacementRank('RB')).toBeGreaterThan(replacementRank('QB'));
    expect(replacementRank('WR')).toBeGreaterThan(replacementRank('QB'));
  });

  it('never returns a rank below 1', () => {
    for (const pos of ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const) {
      expect(replacementRank(pos)).toBeGreaterThanOrEqual(1);
    }
  });
});
