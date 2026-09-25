import { describe, expect, it } from 'vitest';
import {
  americanToDecimal,
  decimalToAmerican,
  fairProbs,
  parseOdds,
  winProfit,
  type OddsEvent,
} from './odds';
import { bankroll, betPnl, stakeLimit, type Bet } from './bankroll';
import { gameIsOpen, picksSchema } from './run';
import type { GameOutcome } from './grade';

const outcome = (away: string, home: string, awayScore: number, homeScore: number): GameOutcome => ({
  gameKey: `${away}@${home}`,
  away,
  home,
  awayScore,
  homeScore,
  winner: homeScore > awayScore ? home : awayScore > homeScore ? away : 'TIE',
});

describe('prices', () => {
  it('pays +150 at 1.5 to 1 and -150 at 1 to 1.5', () => {
    expect(winProfit(150, 10)).toBeCloseTo(15);
    expect(winProfit(-150, 15)).toBeCloseTo(10);
  });

  it('round-trips American and decimal on both sides of evens', () => {
    for (const p of [-400, -150, -110, 100, 120, 350]) {
      expect(decimalToAmerican(americanToDecimal(p))).toBe(p);
    }
  });

  it('refuses a price inside (-100, 100), which no American line can be', () => {
    expect(() => americanToDecimal(50)).toThrow();
  });

  it('removes the margin so the two sides sum to 1', () => {
    const f = fairProbs({ away: -110, home: -110 });
    expect(f.away).toBeCloseTo(0.5);
    expect(f.away + f.home).toBeCloseTo(1);
  });
});

describe('parseOdds', () => {
  const event = (books: [number, number][], away = 'Kansas City Chiefs', home = 'Miami Dolphins'): OddsEvent => ({
    commence_time: '2026-09-27T17:00:00Z',
    away_team: away,
    home_team: home,
    bookmakers: books.map(([a, h], i) => ({
      key: `book${i}`,
      markets: [{ key: 'h2h', outcomes: [{ name: away, price: a }, { name: home, price: h }] }],
    })),
  });

  it('maps full team names onto our codes and takes the median across books', () => {
    const lines = parseOdds([event([[-150, 130], [-160, 135], [-155, 128]])], ['KC@MIA']);
    const l = lines.get('KC@MIA')!;
    expect(l.away).toBe(-155);
    expect(l.home).toBe(130);
    expect(l.books).toBe(3);
    expect(l.commenceTime).toBe('2026-09-27T17:00:00Z');
  });

  it('takes the median in decimal, so a line straddling evens is not averaged into nonsense', () => {
    // -105 and +105 average to 0 in American terms; in decimal they meet near evens.
    const l = parseOdds([event([[-105, -115], [105, -125]])], ['KC@MIA']).get('KC@MIA')!;
    expect(Math.abs(l.away)).toBeGreaterThanOrEqual(100);
  });

  it('ignores games that are not in the week and books quoting one side only', () => {
    const oneSided: OddsEvent = {
      ...event([]),
      bookmakers: [{ key: 'x', markets: [{ key: 'h2h', outcomes: [{ name: 'Kansas City Chiefs', price: -150 }] }] }],
    };
    expect(parseOdds([oneSided], ['KC@MIA']).size).toBe(0);
    expect(parseOdds([event([[-150, 130]])], ['BUF@NYJ']).size).toBe(0);
  });
});

describe('settling bets', () => {
  const bet = (team: string, stake: number, price: number): Bet => ({ gameKey: 'KC@MIA', team, stake, price });

  it('wins the profit, loses the stake, and refunds a tie', () => {
    expect(betPnl(bet('MIA', 10, 150), outcome('KC', 'MIA', 17, 24))).toBeCloseTo(15);
    expect(betPnl(bet('KC', 10, -150), outcome('KC', 'MIA', 17, 24))).toBe(-10);
    expect(betPnl(bet('KC', 10, -150), outcome('KC', 'MIA', 20, 20))).toBe(0);
  });

  it('holds money on an unscored game at risk rather than available', () => {
    const pending: GameOutcome = { gameKey: 'KC@MIA', away: 'KC', home: 'MIA', awayScore: null, homeScore: null, winner: null };
    const b = bankroll([bet('KC', 30, -150)], new Map([['KC@MIA', pending]]));
    expect(b.balance).toBe(100);
    expect(b.atRisk).toBe(30);
    expect(b.available).toBe(70);
    expect(b.roi).toBeNull();
  });

  it('carries wins and losses into the balance', () => {
    const bets: Bet[] = [
      { gameKey: 'KC@MIA', team: 'MIA', stake: 20, price: 150 },
      { gameKey: 'BUF@NYJ', team: 'NYJ', stake: 10, price: 200 },
    ];
    const outcomes = new Map([
      ['KC@MIA', outcome('KC', 'MIA', 10, 13)],
      ['BUF@NYJ', outcome('BUF', 'NYJ', 31, 3)],
    ]);
    const b = bankroll(bets, outcomes);
    expect(b.balance).toBe(120); // +30 − 10
    expect(b.roi).toBeCloseTo(20 / 30);
  });

  it('allows whole dollars only, and nothing under the $1 minimum', () => {
    expect(stakeLimit(57.8)).toBe(57);
    expect(stakeLimit(0.6)).toBe(0);
  });
});

describe('picksSchema with bets', () => {
  const fixtures = [
    { gameKey: 'KC@MIA', away: 'KC', home: 'MIA', kickoffAt: '2026-09-27T13:30:00Z' },
    { gameKey: 'BUF@NYJ', away: 'BUF', home: 'NYJ', kickoffAt: '2026-09-27T13:30:00Z' },
  ];
  const lines = new Map([['KC@MIA', { gameKey: 'KC@MIA', away: -150, home: 130, books: 5, commenceTime: '2026-09-27T17:00:00Z' }]]);
  const pick = (game_key: string, extra: Record<string, unknown> = {}) => ({
    game_key,
    pick: game_key.split('@')[1],
    win_prob: 0.6,
    reason: 'r',
    ...extra,
  });

  it('accepts a bet on the team the model did NOT pick', () => {
    const r = picksSchema(fixtures, lines, 100).safeParse({
      headline: 'h',
      picks: [pick('KC@MIA', { pick: 'KC', bet_team: 'MIA', stake: 10 }), pick('BUF@NYJ')],
    });
    expect(r.success).toBe(true);
  });

  it('treats a missing bet as no bet', () => {
    const r = picksSchema(fixtures, lines, 100).safeParse({ headline: 'h', picks: [pick('KC@MIA'), pick('BUF@NYJ')] });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.picks[0]).toMatchObject({ bet_team: null, stake: 0 });
  });

  it('rejects stakes over the limit, a bet with no line, and a stake with no team', () => {
    const over = picksSchema(fixtures, lines, 20).safeParse({
      headline: 'h',
      picks: [pick('KC@MIA', { bet_team: 'MIA', stake: 21 }), pick('BUF@NYJ')],
    });
    expect(over.success).toBe(false);
    const noLine = picksSchema(fixtures, lines, 100).safeParse({
      headline: 'h',
      picks: [pick('KC@MIA'), pick('BUF@NYJ', { bet_team: 'NYJ', stake: 5 })],
    });
    expect(noLine.success).toBe(false);
    const noTeam = picksSchema(fixtures, lines, 100).safeParse({
      headline: 'h',
      picks: [pick('KC@MIA', { stake: 5 }), pick('BUF@NYJ')],
    });
    expect(noTeam.success).toBe(false);
  });

  it('rejects fractional dollars', () => {
    const r = picksSchema(fixtures, lines, 100).safeParse({
      headline: 'h',
      picks: [pick('KC@MIA', { bet_team: 'MIA', stake: 2.5 }), pick('BUF@NYJ')],
    });
    expect(r.success).toBe(false);
  });
});

describe('gameIsOpen', () => {
  const f = { gameKey: 'KC@MIA', away: 'KC', home: 'MIA', kickoffAt: '2026-09-27T13:30:00Z' };
  const line = { gameKey: 'KC@MIA', away: -150, home: 130, books: 5, commenceTime: '2026-09-27T17:00:00Z' };

  it("trusts the feed's reported start over our modelled earliest kickoff", () => {
    // After the modelled 09:30 ET slot, before the real 13:00 ET start: still open.
    expect(gameIsOpen(f, line, new Date('2026-09-27T15:00:00Z'))).toBe(true);
    expect(gameIsOpen(f, undefined, new Date('2026-09-27T15:00:00Z'))).toBe(false);
  });

  it('closes a game once it has started', () => {
    expect(gameIsOpen(f, line, new Date('2026-09-27T17:00:01Z'))).toBe(false);
  });
});
