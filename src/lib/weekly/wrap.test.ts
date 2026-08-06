import { describe, it, expect } from 'vitest';
import { checkArticle, numberCheck, resultCheck, unluckyAndLucky, type WrapFacts, type WrapTeamFacts } from './wrap';

function team(over: Partial<WrapTeamFacts> & { model: string }): WrapTeamFacts {
  return {
    label: 'Team A',
    points: 112.4,
    optimal_points: 128.6,
    lineup_efficiency: 0.874,
    points_left_on_bench: 16.2,
    empty_slots: 0,
    fallback_applied: false,
    opponent: 'Rival',
    opponent_points: 99.1,
    result: 'W',
    allplay_week: '5-2',
    record: '4-2',
    rank: 3,
    points_for: 701.5,
    lineup_headline: null,
    lineup_closest_call: null,
    ...over,
  };
}

const facts: WrapFacts = {
  season: 2026,
  week: 7,
  scoring_status: 'provisional',
  ranking_basis: 'head-to-head',
  teams: [team({ model: 'Alpha' })],
  high_score: { model: 'Alpha', points: 112.4 },
  low_score: { model: 'Omega', points: 71.8 },
  closest_matchup: { winner: 'Alpha', loser: 'Rival', margin: 13.3 },
  biggest_margin: { winner: 'Beta', loser: 'Omega', margin: 44.6 },
  best_efficiency: { model: 'Alpha', efficiency: 0.874 },
  worst_efficiency: { model: 'Omega', efficiency: 0.612 },
  luck: [],
  waiver_adds: [],
};

const article = (column: string) => ({
  headline: 'A week of two halves',
  short_post: 'Short.',
  column_md: column,
});

describe('the number check', () => {
  it('passes an article whose figures all come from the packet', () => {
    const check = numberCheck(
      article('Alpha put up 112.4 to Rival\'s 99.1, a margin of 13.3, at 0.874 efficiency.'),
      facts,
    );
    expect(check.passed).toBe(true);
    expect(check.notes).toEqual([]);
  });

  it('catches an invented score', () => {
    const check = numberCheck(article('Alpha put up 118.9 and cruised.'), facts);
    expect(check.passed).toBe(false);
    expect(check.notes).toEqual(['118.9 does not appear in the facts packet']);
  });

  it('catches a plausible-looking derived figure it was not given', () => {
    // 112.4 - 99.1 = 13.3 is in the packet; 112.4 - 71.8 is not. The check is
    // membership, not arithmetic, and pretending otherwise would license any sum.
    const check = numberCheck(article('Alpha beat the league low by 40.6 points.'), facts);
    expect(check.passed).toBe(false);
  });

  it('does not flag small integers used as prose', () => {
    expect(numberCheck(article('All 8 teams lost at least 2 starters.'), facts).passed).toBe(true);
  });

  it('does not flag the week or the season', () => {
    expect(numberCheck(article('Week 7 of the 2026 season.'), facts).passed).toBe(true);
  });

  it('reports each bad figure once, however often it is repeated', () => {
    const check = numberCheck(article('118.9 here. And 118.9 again. And 118.9.'), facts);
    expect(check.notes).toHaveLength(1);
  });

  it('flags a decimal even when it is small', () => {
    // "1.4 points" is a claim in a way "2 starters" is not.
    expect(numberCheck(article('A margin of 1.4 points.'), facts).passed).toBe(false);
  });
});

describe('luck — where the schedule and the scoreboard disagree', () => {
  it('names a team that outscored most rivals and still lost', () => {
    const out = unluckyAndLucky([
      team({ model: 'Alpha', result: 'L', allplay_week: '5-2', points: 112.4, opponent: 'Beta' }),
      ...Array.from({ length: 7 }, (_, i) => team({ model: `T${i}`, result: 'W', allplay_week: '4-3' })),
    ]);
    expect(out[0].model).toBe('Alpha');
    expect(out[0].note).toContain('still lost to Beta');
  });

  it('names a team that won on a score most rivals would have beaten', () => {
    const out = unluckyAndLucky([
      team({ model: 'Alpha', result: 'W', allplay_week: '1-6', points: 78.2 }),
      ...Array.from({ length: 7 }, (_, i) => team({ model: `T${i}`, result: 'L', allplay_week: '4-3' })),
    ]);
    expect(out[0].model).toBe('Alpha');
    expect(out[0].note).toContain('would have lost to 6 of 7');
  });

  it('says nothing about a team whose result matched its scoring', () => {
    const out = unluckyAndLucky(
      Array.from({ length: 8 }, (_, i) =>
        team({ model: `T${i}`, result: i < 4 ? 'W' : 'L', allplay_week: i < 4 ? '6-1' : '1-6' }),
      ),
    );
    expect(out).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Regression: the first real article, 2025 week 5, 6 August 2026.
//
// Ten number-check failures, every one of them wrong, and one genuine error the check
// waved straight through. Both halves are pinned here verbatim — a synthetic fixture
// would not have found either, and would not stop them coming back.
// ---------------------------------------------------------------------------

const wk5: WrapFacts = {
  season: 2025,
  week: 5,
  scoring_status: 'provisional',
  ranking_basis: 'head-to-head',
  teams: [
    team({
      model: 'DeepSeek V4 Pro', points: 139.14, lineup_efficiency: 1.0, optimal_points: 139.14,
      points_left_on_bench: 0, opponent: 'GPT-5.6 Sol', opponent_points: 122.92, result: 'W',
      allplay_week: '5-2', rank: 3,
    }),
    team({
      model: 'GPT-5.6 Sol', points: 122.92, opponent: 'DeepSeek V4 Pro', opponent_points: 139.14,
      result: 'L', allplay_week: '2-5', rank: 6,
      lineup_closest_call: 'Nearly started Quentin Johnston over Justin Jefferson, a 1.19 projection gap.',
    }),
    team({
      model: 'Kimi K3', points: 148.22, opponent: 'Muse Spark 1.1', opponent_points: 59.6,
      result: 'W', allplay_week: '7-0', rank: 1,
      lineup_closest_call: "Pollard's last3_ppg 11.23 and season_ppg 10.4 beat Brown's 8.2 and 9.43.",
    }),
    team({
      model: 'Muse Spark 1.1', points: 59.6, lineup_efficiency: 0.7815, optimal_points: 76.26,
      opponent: 'Kimi K3', opponent_points: 148.22, result: 'L', allplay_week: '0-7', rank: 8,
    }),
    team({ model: 'Grok 4.5', points: 143.32, opponent: 'Qwen3.7 Plus', opponent_points: 121.54, result: 'W', allplay_week: '6-1', rank: 2 }),
    team({ model: 'Qwen3.7 Plus', points: 121.54, opponent: 'Grok 4.5', opponent_points: 143.32, result: 'L', allplay_week: '1-6', rank: 7 }),
  ],
  high_score: { model: 'Kimi K3', points: 148.22 },
  low_score: { model: 'Muse Spark 1.1', points: 59.6 },
  closest_matchup: { winner: 'DeepSeek V4 Pro', loser: 'GPT-5.6 Sol', margin: 16.22 },
  biggest_margin: { winner: 'Kimi K3', loser: 'Muse Spark 1.1', margin: 88.62 },
  best_efficiency: { model: 'DeepSeek V4 Pro', efficiency: 1.0 },
  worst_efficiency: { model: 'Muse Spark 1.1', efficiency: 0.7815 },
  luck: [],
  waiver_adds: [],
};

describe('regression — the first real wrap', () => {
  it('does not flag a model version number as an invented statistic', () => {
    // "Grok 4.5", "Muse Spark 1.1" and "GPT-5.6 Sol" produced 4.5, 1.1 and -5.6.
    // Rule 2 REQUIRES the writer to print those names.
    const check = numberCheck(
      article('Grok 4.5 and Muse Spark 1.1 both played. GPT-5.6 Sol did too.'),
      wk5,
    );
    expect(check.notes).toEqual([]);
  });

  it('does not flag a figure quoted accurately out of the packet prose', () => {
    // Straight from Kimi K3's stored closest_call. Rule 4 tells the writer to quote it.
    const check = numberCheck(
      article('Kimi K3 called it thin: "Pollard\'s last3_ppg 11.23 and season_ppg 10.4 beat Brown\'s 8.2 and 9.43."'),
      wk5,
    );
    expect(check.notes).toEqual([]);
  });

  it('does not flag an efficiency restated as a percentage', () => {
    expect(numberCheck(article('DeepSeek V4 Pro hit 100% lineup efficiency.'), wk5).notes).toEqual([]);
  });

  it('still flags a genuinely invented score', () => {
    expect(numberCheck(article('Kimi K3 put up 201.77.'), wk5).passed).toBe(false);
  });

  it('catches the inverted result the number check waved through', () => {
    // The real sentence. Both figures are in the packet; only the direction is false.
    const check = resultCheck(
      article('DeepSeek V4 Pro posted a flawless 1.000 lineup efficiency, yet still fell to GPT-5.6 Sol, 139.14 to 122.92.'),
      wk5,
    );
    expect(check.passed).toBe(false);
    expect(check.notes[0]).toBe('says GPT-5.6 Sol beat DeepSeek V4 Pro, but DeepSeek V4 Pro won that matchup');
  });

  it('accepts the same matchup written the right way round', () => {
    expect(resultCheck(article('DeepSeek V4 Pro beat GPT-5.6 Sol, 139.14 to 122.92.'), wk5).passed).toBe(true);
    expect(resultCheck(article('GPT-5.6 Sol fell to DeepSeek V4 Pro.'), wk5).passed).toBe(true);
  });

  it('reads a "demolition of" as a win, and gets it right', () => {
    expect(resultCheck(article('Kimi K3 authored an 88.62-point demolition of Muse Spark 1.1.'), wk5).passed).toBe(true);
    expect(resultCheck(article('Muse Spark 1.1 authored a demolition of Kimi K3.'), wk5).passed).toBe(false);
  });

  it('says nothing about two models that never played each other', () => {
    // "beat everyone except Kimi K3" is a shape this cannot parse. Grok and Kimi both
    // won, against other people. Guessing here would invent a fixture to be wrong about.
    expect(
      resultCheck(article("Grok 4.5's 143.32 was good enough to beat everyone except Kimi K3."), wk5).passed,
    ).toBe(true);
  });

  it('leads with the result error and labels both kinds', () => {
    const check = checkArticle(
      article('DeepSeek V4 Pro fell to GPT-5.6 Sol. Kimi K3 put up 201.77.'),
      wk5,
    );
    expect(check.passed).toBe(false);
    expect(check.notes[0]).toMatch(/^RESULT:/);
    expect(check.notes[1]).toMatch(/^FIGURE:/);
  });
});
