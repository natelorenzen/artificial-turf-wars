import { describe, expect, it } from 'vitest';
import { generateRulebook } from './rulebook';
import { assemblePrompt, assertSharedContext, estimateTokens } from './assemble';
import { buildMemoryBlock, ordinal, seasonSummary } from './memory';
import { LEAGUE, OFFENSE_SCORING } from '@/lib/config/league';

describe('generated rulebook', () => {
  const text = generateRulebook();

  it('states the objective as all-play, not head-to-head', () => {
    expect(text).toContain('Maximize your cumulative ALL-PLAY record');
    expect(text).toContain('A head-to-head record is also published, but it does NOT determine rank');
  });

  it('carries the exact scoring values the engine uses', () => {
    expect(text).toContain(`Passing yards ........... ${OFFENSE_SCORING.pass_yd} each`);
    expect(text).toContain(`Interception thrown ..... ${OFFENSE_SCORING.pass_int}`);
    expect(text).toContain('Reception ............... 1.0        (FULL PPR)');
  });

  it('names the all-play range from the team count', () => {
    expect(text).toContain(`0-${LEAGUE.teams - 1}`);
    expect(text).toContain(`${LEAGUE.teams - 1}-0`);
  });

  it('resolves the return-TD owner explicitly so the models cannot double-count', () => {
    expect(text).toContain('credited to the DEF/ST unit');
    expect(text).toContain('NOT to the individual returner');
  });

  it('states the shared-budget tradeoff and the round-13 soft cap', () => {
    expect(text).toContain(`You start with $${LEAGUE.budgetTotal}`);
    expect(text).toContain(`From round ${LEAGUE.softCapRound}`);
  });

  it('states the exact-tie rule', () => {
    expect(text).toContain('An exact scoring tie awards half a win to each team');
  });

  it('lists the full Yahoo starting nine in printed order', () => {
    expect(text).toContain('Starters (9): 1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX, 1 K, 1 DEF');
  });
});

describe('prompt assembly', () => {
  const base = {
    task: 'Set your lineup.',
    outputExample: { qb: 'player_id', confidence: 0.5 },
  };

  it('hashes the DATA block only, so memory differences do not break shared context', () => {
    const data = { week: 3, roster: [{ id: 'a', proj: 12.1 }] };
    const a = assemblePrompt({ ...base, data, memoryBlock: 'team A memory' });
    const b = assemblePrompt({ ...base, data, memoryBlock: 'team B memory' });
    expect(a.contextHash).toBe(b.contextHash);
    expect(a.userPrompt).not.toBe(b.userPrompt);
  });

  it('hashes independently of key order', () => {
    const a = assemblePrompt({ ...base, data: { week: 3, scoring: 'PPR' } });
    const b = assemblePrompt({ ...base, data: { scoring: 'PPR', week: 3 } });
    expect(a.contextHash).toBe(b.contextHash);
  });

  it('changes the hash when any datum changes', () => {
    const a = assemblePrompt({ ...base, data: { week: 3, proj: 12.1 } });
    const b = assemblePrompt({ ...base, data: { week: 3, proj: 12.2 } });
    expect(a.contextHash).not.toBe(b.contextHash);
  });

  it('flags a week where the eight models did not share one context', () => {
    expect(() => assertSharedContext(['a', 'a', 'a'], 'week 3 lineups')).not.toThrow();
    expect(() => assertSharedContext(['a', 'a', 'b'], 'week 3 lineups')).toThrow(
      /distinct context hashes/,
    );
  });

  it('over-counts tokens rather than under-counting', () => {
    // ~4 chars/token is typical; our 3.5 estimate must sit above that.
    const text = 'a'.repeat(3500);
    expect(estimateTokens(text)).toBe(1000);
  });
});

describe('memory block', () => {
  const input = {
    gameplan: {
      positional_strategy: 'Anchor RB early.',
      auction_stance: 'Bid low, keep FAAB.',
      scarcity_read: 'TE cliff after rank 6.',
      risk_posture: 'Consistency over upside.',
      waiver_philosophy: 'Save for a league winner.',
    },
    roster: [{ name: 'Bijan Robinson', position: 'RB' }],
    faabRemaining: 78,
    record: { allplayW: 12.5, allplayL: 8.5, cumPts: 612.4, rank: 4 },
    recent: [
      { week: 3, headline: 'Started the higher floor.', closest_call: 'WR2 versus FLEX.' },
      { week: 2, headline: 'Chased the matchup.', closest_call: 'TE against a top-5 defense.' },
      { week: 1, headline: 'Played the projections.', closest_call: 'Kicker on the road.' },
      { week: 0, headline: 'should be dropped', closest_call: 'should be dropped' },
    ],
    seasonSummary: seasonSummary(3, 4, 8, 12.5, 8.5, 612.4),
  };

  it('carries the gameplan verbatim and the last N decisions only', () => {
    const block = buildMemoryBlock(input);
    expect(block).toContain('Anchor RB early.');
    expect(block).toContain('Week 3');
    expect(block).not.toContain('should be dropped');
  });

  it('is bounded: a rambling gameplan cannot inflate one team’s block', () => {
    const long = buildMemoryBlock({
      ...input,
      gameplan: { ...input.gameplan, positional_strategy: 'x'.repeat(5000) },
    });
    const normal = buildMemoryBlock(input);
    expect(long.length - normal.length).toBeLessThan(500);
  });

  it('renders ordinals correctly', () => {
    expect([1, 2, 3, 4, 11, 21].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '21st']);
  });
});
