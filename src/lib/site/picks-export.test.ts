import { describe, expect, it } from 'vitest';
import type { PicksWeek } from '@/lib/site/picks';
import { PICKS_DISCLAIMER, shapePicksWeek } from '@/lib/site/picks-export';

const tally = { won: 1, lost: 0, push: 0, pending: 0, accuracy: 1, brier: 0.09, meanConfidence: 0.7 };
const bets = { balance: 10, atRisk: 0, available: 10, staked: 10, settledStake: 10, won: 1, lost: 0, push: 0, pending: 0 };

const set = (model: string, pick: string, winProb: number) => ({
  model,
  modelKey: model.toLowerCase(),
  headline: `${model} headline`,
  valid: true,
  providerFailure: false,
  validationError: null,
  rawResponse: null,
  contextHash: 'h',
  lockedAt: '2026-10-08T17:00:00Z',
  picks: new Map([['BAL@ATL', { gameKey: 'BAL@ATL', pick, winProb, reason: 'why', result: pick === 'ATL' ? 'won' : 'lost', bet: null }]]),
  tally,
  bankrollAvailable: 100,
  weekBets: bets,
});

const week = {
  week: 5,
  outcomes: [{ gameKey: 'BAL@ATL', away: 'BAL', home: 'ATL', awayScore: 17, homeScore: 24, winner: 'ATL' }],
  sets: [set('Zed', 'BAL', 0.55), set('Alpha', 'ATL', 0.7)],
  consensus: [{ gameKey: 'BAL@ATL', pick: 'ATL', winProb: 0.6, result: 'won' }],
  consensusTally: tally,
  homeTally: tally,
  marketTally: null,
  dissents: [],
  market: new Map([['BAL@ATL', new Map([['BAL', 0.39], ['ATL', 0.61]])]]),
  lines: new Map([['BAL@ATL', { away: 146, home: -172 }]]),
  contextHashes: ['h'],
  systemPrompt: null,
  userPrompt: null,
} as unknown as PicksWeek;

describe('shapePicksWeek', () => {
  const out = shapePicksWeek(week, 2026);

  it('lists every model’s pick per game, alphabetically, with the split and the line', () => {
    const game = out.games[0];
    expect(game.picks.map((p) => [p.model, p.pick, p.winProb])).toEqual([
      ['Alpha', 'ATL', 0.7],
      ['Zed', 'BAL', 0.55],
    ]);
    expect(game.split).toEqual({ BAL: 1, ATL: 1 });
    expect(game.market).toEqual({ americanOdds: { away: 146, home: -172 }, fairProb: { away: 0.39, home: 0.61 } });
    expect(game.result).toEqual({ awayScore: 17, homeScore: 24, winner: 'ATL' });
  });

  it('carries the disclaimer on every response', () => {
    expect(out.disclaimer).toBe(PICKS_DISCLAIMER);
  });
});
