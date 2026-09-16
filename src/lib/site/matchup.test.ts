import { describe, expect, it } from 'vitest';
import type { StarterSlot } from '@/lib/config/league';
import {
  autopilotLine,
  flagBenchMisses,
  signed,
  matchupHref,
  matchupStory,
  weekBrief,
  type BenchPlayer,
  type BoxPlayer,
  type BoxSlot,
  type MatchupSide,
  type MatchupView,
} from './matchup';

const SLOTS: StarterSlot[] = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'];

function player(name: string, position: string, points: number | null, projected = 10): BoxPlayer {
  return { playerId: name, name, position, nflTeam: 'XXX', opponent: 'v YYY', points, projected };
}

function side(model: string, starterPoints: number[], extra: Partial<MatchupSide> = {}): MatchupSide {
  const starters: BoxSlot[] = SLOTS.map((slot, i) => ({
    slot,
    player: player(`${model}-${slot}-${i}`, slot === 'FLEX' ? 'WR' : slot, starterPoints[i]),
  }));
  const points = starterPoints.reduce((a, b) => a + b, 0);
  return {
    model,
    modelKey: model.toLowerCase(),
    points,
    projected: 90,
    record: '1-0',
    rank: 1,
    starters,
    bench: [],
    optimal: points,
    efficiency: 1,
    autopilot: null,
    lineup: { decisionId: null, headline: null, closestCall: null, confidence: null, fallback: false },
    ...extra,
  };
}

describe('matchupHref', () => {
  it('builds a home-vs-away path that survives hyphenated model keys', () => {
    expect(matchupHref(3, 'gpt-5-6-sol', 'kimi-k3')).toBe('/results/3/gpt-5-6-sol-vs-kimi-k3');
    expect('gpt-5-6-sol-vs-kimi-k3'.split('-vs-')).toEqual(['gpt-5-6-sol', 'kimi-k3']);
  });
});

describe('flagBenchMisses', () => {
  it('names the weakest starter a bench player could legally have replaced, FLEX included', () => {
    const starters = side('A', [20, 3, 9, 10, 10, 4, 6, 5, 5]).starters;
    const bench: BenchPlayer[] = [
      { ...player('Bench RB', 'RB', 8), outscored: null },
      { ...player('Bench QB', 'QB', 15), outscored: null },
      { ...player('Bench K', 'K', 5), outscored: null },
    ];
    flagBenchMisses(starters, bench);

    expect(bench[0].outscored).toMatchObject({ slot: 'RB', points: 3 });
    // 15 < the starting QB's 20: sitting him was right.
    expect(bench[1].outscored).toBeNull();
    // Equal is not outscored.
    expect(bench[2].outscored).toBeNull();
  });

  it('never flags a player whose team was on bye or who has no score yet', () => {
    const starters = side('A', [1, 1, 1, 1, 1, 1, 1, 1, 1]).starters;
    const bench: BenchPlayer[] = [
      { ...player('Bye WR', 'WR', 30), opponent: 'BYE', outscored: null },
      { ...player('Unscored WR', 'WR', null), outscored: null },
    ];
    flagBenchMisses(starters, bench);
    expect(bench.every((p) => p.outscored === null)).toBe(true);
  });
});

describe('matchupStory', () => {
  it('leads with the result and calls out a bench decision that would have flipped it', () => {
    const winner = side('Alpha', [20, 10, 10, 10, 10, 5, 5, 5, 5]); // 80
    const bench: BenchPlayer[] = [
      { ...player('Sat RB', 'RB', 25), outscored: { name: 'Started RB', slot: 'RB', points: 2 } },
    ];
    const loser = side('Beta', [20, 2, 10, 10, 10, 5, 5, 5, 5], { optimal: 95, bench }); // 72

    const story = matchupStory({ status: 'final', home: winner, away: loser });
    expect(story[0]).toBe('Alpha beat Beta 80.00–72.00, a margin of 8.00.');
    expect(story.join(' ')).toContain("Beta's best possible lineup scored 95.00, enough to win.");
    expect(story.join(' ')).toContain('Sat RB (25.00) sat while Started RB started at RB (2.00)');
  });

  it('says plainly when no lineup could have won', () => {
    const story = matchupStory({
      status: 'provisional',
      home: side('Alpha', [30, 10, 10, 10, 10, 5, 5, 5, 5]),
      away: side('Beta', [10, 10, 10, 10, 10, 5, 5, 5, 5], { optimal: 80 }),
    });
    expect(story.at(-1)).toContain('No lineup Beta could have set would have won');
  });

  it('never calls a live lead a win', () => {
    const story = matchupStory({
      status: 'live',
      home: side('Alpha', [30, 10, 10, 10, 10, 5, 5, 5, 5]),
      away: side('Beta', [10, 10, 10, 10, 10, 5, 5, 5, 5]),
    });
    expect(story[0]).toMatch(/^Alpha leads .* Unofficial until Tuesday\.$/);
    expect(story.join(' ')).not.toMatch(/beat|best possible/);
  });

  it('describes an unplayed game from projections only', () => {
    const story = matchupStory({
      status: 'upcoming',
      home: side('Alpha', SLOTS.map(() => 0), { points: null, projected: 110 }),
      away: side('Beta', SLOTS.map(() => 0), { points: null, projected: 100.5 }),
    });
    expect(story).toEqual(['Alpha starts the week projected 110.00 to 100.50 — a 9.50-point edge on paper.']);
  });
});

const swap = (started: string | null, benched: string | null, delta: number) => ({
  started: started ? player(started, 'WR', 0) : null,
  benched: benched ? player(benched, 'WR', 0) : null,
  delta,
});

describe('autopilot lines', () => {
  it('names each call and what it was worth, with a real minus sign', () => {
    const s = side('Claude', [10, 10, 10, 10, 10, 5, 5, 5, 5], {
      autopilot: { points: 93, delta: -23, swaps: [swap('Ferguson', 'Kraft', -6.9), swap('Rice', 'Flowers', -16.1)] },
    });
    expect(autopilotLine(s)).toBe(
      "Claude's own calls were worth \u221223.00 against the autopilot: Ferguson over Kraft (\u22126.90); Rice over Flowers (\u221216.10).",
    );
    expect(signed(9.7)).toBe('+9.70');
    expect(signed(0)).toBe('0.00');
  });

  it('says so when a model started the autopilot lineup, and says nothing before scoring', () => {
    const same = side('Grok', [10, 10, 10, 10, 10, 5, 5, 5, 5], { autopilot: { points: 70, delta: 0, swaps: [] } });
    expect(autopilotLine(same)).toBe('Grok started exactly the nine the autopilot would have.');
    const unscored = side('Grok', [], { autopilot: { points: null, delta: null, swaps: [swap('A', 'B', 0)] } });
    expect(autopilotLine(unscored)).toBeNull();
  });

  it('flags a game the lineup calls decided', () => {
    const story = matchupStory({
      status: 'final',
      home: side('Alpha', [20, 10, 10, 10, 10, 5, 5, 5, 5], { autopilot: { points: 70, delta: 10, swaps: [swap('X', 'Y', 10)] } }),
      away: side('Beta', [10, 10, 10, 10, 10, 5, 5, 5, 5], { autopilot: { points: 75, delta: 0, swaps: [] } }),
    });
    expect(story).toContain('On autopilot, Beta would have won 75.00–70.00. The lineup calls decided this game.');
  });

  it('ranks the week by calls in the brief', () => {
    const view = (home: MatchupSide, away: MatchupSide): MatchupView => ({
      season: 2026, week: 1, slug: 'x', status: 'final', computedAt: null, home, away, story: [],
    });
    const a = side('Alpha', [20, 10, 10, 10, 10, 5, 5, 5, 5], { autopilot: { points: 70, delta: 10, swaps: [swap('X', 'Y', 10)] } });
    const b = side('Beta', [10, 10, 10, 10, 10, 5, 5, 5, 5], { autopilot: { points: 75, delta: 0, swaps: [] } });
    const brief = weekBrief({ views: [view(a, b)], luck: [] });
    expect(brief).toContain('Best lineup calls: Alpha, +10.00 over the autopilot.');
    expect(brief).toContain('1 of 2 teams started exactly what the autopilot would have.');
    expect(brief).toContain('Decided by the calls: Alpha over Beta — on autopilot, the loser wins.');
  });
});

describe('weekBrief', () => {
  const view = (home: MatchupSide, away: MatchupSide): MatchupView => ({
    season: 2026,
    week: 1,
    slug: `${home.modelKey}-vs-${away.modelKey}`,
    status: 'final',
    computedAt: null,
    home,
    away,
    story: [],
  });

  it('summarises the week from box scores alone, and is empty before anything is scored', () => {
    const a = side('Alpha', [40, 10, 10, 10, 10, 5, 5, 5, 5]); // 100
    const b = side('Beta', [20, 10, 10, 10, 10, 5, 5, 5, 5], { optimal: 101, efficiency: 0.79 }); // 80
    const c = side('Gamma', [21, 10, 10, 10, 10, 5, 5, 5, 5]); // 81
    const d = side('Delta', [20, 10, 10, 10, 10, 5, 5, 5, 4]); // 79

    const brief = weekBrief({ views: [view(a, b), view(c, d)], luck: [] });
    expect(brief[0]).toBe('High score: Alpha with 100.00. Low: Delta with 79.00.');
    expect(brief).toContain('Closest game: Gamma over Delta by 2.00.');
    expect(brief).toContain('Biggest win: Alpha over Beta by 20.00.');
    expect(brief).toContain('Player of the week: Alpha-QB-0 (QB), 40.00 for Alpha.');
    expect(brief).toContain('Most left on the bench, in hindsight: Beta, 21.00 points.');
    // No autopilot data on these sides, so no claim about lineup calls is made.
    expect(brief.join(' ')).not.toContain('autopilot');

    const unscored = { ...view(a, b), status: 'live' as const };
    expect(weekBrief({ views: [unscored], luck: [] })).toEqual([]);
  });
});
