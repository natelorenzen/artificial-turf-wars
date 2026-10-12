import { describe, expect, it } from 'vitest';
import type { StandingsRow } from '@/lib/site/results';
import { betOfTheWeek, briefCutoff, playoffStakes, quote, topPicks, upsetOfTheWeek } from '@/lib/site/video-brief';

describe('briefCutoff — 11:00 AM Pacific on the week’s Thursday', () => {
  it('is the same day for a Thursday opener (20:15 ET kickoff)', () => {
    // Week 5, 2026: Thu 8 Oct, 20:15 EDT.
    expect(briefCutoff(new Date('2026-10-09T00:15:00Z')).toISOString()).toBe('2026-10-08T18:00:00.000Z');
  });

  it('is the next day for a Wednesday opener', () => {
    // Week 1, 2026: Wed 9 Sep, 20:15 EDT.
    expect(briefCutoff(new Date('2026-09-10T00:15:00Z')).toISOString()).toBe('2026-09-10T18:00:00.000Z');
  });

  it('follows the Pacific clock across the 1 Nov DST change', () => {
    // Thu 5 Nov, 20:15 EST — 11:00 PST is 19:00 UTC, an hour later than in October.
    expect(briefCutoff(new Date('2026-11-06T01:15:00Z')).toISOString()).toBe('2026-11-05T19:00:00.000Z');
  });
});

describe('quote', () => {
  it('keeps a quote under 25 words verbatim', () => {
    expect(quote('  Fade the chalk.  ', 'u')).toEqual({ text: '  Fade the chalk.  ', words: 3, source: 'u' });
  });

  it('omits, never trims, a quote of 25 words or more', () => {
    const long = Array.from({ length: 25 }, (_, i) => `w${i}`).join(' ');
    expect(quote(long, 'u')).toEqual({ text: null, words: 25, source: 'u' });
  });
});

describe('neutral selection', () => {
  const bet = (model: string, team: string, stake: number) => ({ model, modelKey: model, gameKey: 'A@B', team, stake, price: 150 });

  it('bet of the week is the largest stake, ties alphabetical by model then team', () => {
    expect(betOfTheWeek([bet('Zed', 'KC', 20), bet('Alpha', 'NYJ', 20), bet('Alpha', 'BUF', 20), bet('Mid', 'X', 5)])).toMatchObject({
      model: 'Alpha',
      team: 'BUF',
    });
    expect(betOfTheWeek([])).toBeNull();
  });

  it('upset of the week is the largest positive edge, ties alphabetical', () => {
    const e = (model: string, edge: number) => ({ model, modelKey: model, gameKey: 'A@B', team: 'A', modelProb: 0.5 + edge, marketProb: 0.5, edge });
    expect(upsetOfTheWeek([e('Zed', 0.1), e('Alpha', 0.1), e('Beta', 0.05)])?.model).toBe('Alpha');
    expect(upsetOfTheWeek([e('Zed', -0.1), e('Alpha', 0)])).toBeNull();
  });

  it('top picks are the most confident, ties by game', () => {
    const picks = [
      { gameKey: 'C@D', winProb: 0.8 },
      { gameKey: 'A@B', winProb: 0.8 },
      { gameKey: 'E@F', winProb: 0.9 },
      { gameKey: 'G@H', winProb: 0.6 },
    ];
    expect(topPicks(picks).map((p) => p.gameKey)).toEqual(['E@F', 'A@B', 'C@D']);
  });
});

describe('playoffStakes', () => {
  const row = (modelKey: string, record: string, pointsFor: number, rank: number): StandingsRow => ({
    model: modelKey,
    modelKey,
    record,
    allPlay: '0-0',
    pointsFor,
    rank,
    coRanked: false,
  });
  const table = [
    row('a', '3-1', 500, 1),
    row('b', '3-1', 490, 2),
    row('c', '2-2', 480, 3),
    row('d', '2-2', 470, 4),
    row('e', '2-2', 460, 5),
    row('f', '1-3', 450, 6),
  ];

  it('measures this game against the last seed with this team removed', () => {
    // Without e, the 4th seed is d at 2-2.
    expect(playoffStakes(table, 'e')).toEqual({
      line: { model: 'd', record: '2-2' },
      ifWin: { record: '3-2', versusLine: 'above' },
      ifLoss: { record: '2-3', versusLine: 'below' },
    });
  });

  it('a team inside the line is measured against the first team out', () => {
    // Without d, the 4th seed is e at 2-2.
    expect(playoffStakes(table, 'd')?.line).toEqual({ model: 'e', record: '2-2' });
    expect(playoffStakes(table, 'f')?.ifWin).toEqual({ record: '2-3', versusLine: 'below' });
  });
});
