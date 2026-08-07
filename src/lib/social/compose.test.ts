import { describe, it, expect } from 'vitest';
import type { WrapFacts, WrapTeamFacts } from '@/lib/weekly/wrap';
import {
  COST_PER_POST,
  COST_PER_POST_WITH_URL,
  composeDraft,
  composeFinding,
  composeResults,
  composeWaivers,
  composeWeekend,
  estimateCost,
  fits,
  postLength,
  trimToFit,
} from './compose';

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

/** 2025 week 6 of the rehearsal, as actually stored. */
const wk6: WrapFacts = {
  season: 2025,
  week: 6,
  scoring_status: 'provisional',
  ranking_basis: 'head-to-head',
  teams: [team({ model: 'Claude Opus 5', points: 144.08 })],
  high_score: { model: 'Claude Opus 5', points: 144.08 },
  low_score: { model: 'Qwen3.7 Plus', points: 71.26 },
  closest_matchup: { winner: 'Muse Spark 1.1', loser: 'Gemini 3.1 Pro', margin: 1.18 },
  biggest_margin: { winner: 'Grok 4.5', loser: 'DeepSeek V4 Pro', margin: 33.86 },
  best_efficiency: { model: 'Gemini 3.1 Pro', efficiency: 1 },
  worst_efficiency: { model: 'GPT-5.6 Sol', efficiency: 0.7158 },
  luck: [
    { model: 'Kimi K3', note: 'scored 120.3, beat 5 of 7 rivals on all-play, and still lost to Claude Opus 5' },
    { model: 'GPT-5.6 Sol', note: 'won with 104.02, which would have lost to 6 of 7 rivals' },
  ],
  waiver_adds: [],
};

describe('length accounting', () => {
  it('counts a URL as X does — 23 characters whatever its real length', () => {
    // Getting this wrong in either direction is expensive: too generous and the API
    // rejects the post, too mean and we truncate copy that would have fit.
    expect(postLength('abc', null)).toBe(3);
    expect(postLength('abc', 'https://www.artificialturfwar.com/results/6')).toBe(3 + 24);
  });

  it('trims on a word boundary, never mid-word', () => {
    const long = `${'word '.repeat(80)}end`;
    const trimmed = trimToFit(long, null);
    expect(fits(trimmed, null)).toBe(true);
    expect(trimmed.endsWith('…')).toBe(true);
    expect(trimmed).not.toMatch(/wo…$/);
  });

  it('leaves a post that already fits completely alone', () => {
    expect(trimToFit('short', null)).toBe('short');
  });
});

describe('the results post', () => {
  it('quotes the beat writer when the column checked out', () => {
    const post = composeResults({
      season: 2025,
      facts: wk6,
      recap: {
        shortPost: 'DeepSeek V4 Pro hit 100% lineup efficiency and still lost.',
        numberCheckPassed: true,
        numberCheckNotes: [],
      },
    });
    expect(post.body).toBe('DeepSeek V4 Pro hit 100% lineup efficiency and still lost.');
    expect(post.autoEligible).toBe(true);
    expect(post.link).toContain('/results/6');
  });

  it('HOLDS a post whose column failed its checks', () => {
    // The case this gate exists for. Week 5 of the rehearsal produced a column saying
    // DeepSeek "fell to" GPT-5.6 Sol when DeepSeek had won. Broadcasting that would
    // have put a false result in front of people under this project's own name.
    const post = composeResults({
      season: 2025,
      facts: wk6,
      recap: {
        shortPost: 'DeepSeek V4 Pro fell to GPT-5.6 Sol.',
        numberCheckPassed: false,
        numberCheckNotes: ['RESULT: says GPT-5.6 Sol beat DeepSeek V4 Pro, but DeepSeek V4 Pro won'],
      },
    });
    expect(post.autoEligible).toBe(false);
    expect(post.holdReason).toContain('did not pass its checks');
    // And it does NOT repeat the bad sentence.
    expect(post.body).not.toContain('fell to');
  });

  it('falls back to figures when there is no column at all', () => {
    const post = composeResults({ season: 2025, facts: wk6, recap: null });
    expect(post.body).toContain('Week 6');
    expect(post.body).toContain('Claude Opus 5 led the league with 144.08');
    // The luck line beats the closest game — it is the harder story to get elsewhere.
    expect(post.body).toContain('Kimi K3');
    expect(post.autoEligible).toBe(true);
  });

  it('uses the closest game when the week had no luck story', () => {
    const post = composeResults({ season: 2025, facts: { ...wk6, luck: [] }, recap: null });
    expect(post.body).toContain('Muse Spark 1.1 edged Gemini 3.1 Pro by 1.18');
  });

  it('fits, on the real week', () => {
    const post = composeResults({ season: 2025, facts: wk6, recap: null });
    expect(fits(post.body, post.link)).toBe(true);
  });
});

describe('the waiver post', () => {
  const outcomes = [
    { model: 'Grok 4.5', player: 'Jake Ferguson', bid: 25, won: true },
    { model: 'GPT-5.6 Sol', player: 'Jake Ferguson', bid: 21, won: false },
    { model: 'Muse Spark 1.1', player: 'Jake Ferguson', bid: 18, won: false },
    { model: 'Kimi K3', player: 'Rachaad White', bid: 13, won: true },
  ];

  it('leads with the biggest winning bid and names the scramble', () => {
    const post = composeWaivers(6, outcomes)!;
    expect(post.body).toContain('Grok 4.5 paid $25 for Jake Ferguson');
    expect(post.body).toContain('3 teams wanted Jake Ferguson');
  });

  it('carries no link, and therefore costs 13x less', () => {
    // The one post of the week whose content IS the news.
    const post = composeWaivers(6, outcomes)!;
    expect(post.link).toBeNull();
    expect(post.estCostUsd).toBe(COST_PER_POST);
  });

  it('is always auto-eligible — no model wrote any of it', () => {
    expect(composeWaivers(6, outcomes)!.autoEligible).toBe(true);
  });

  it('says so when every claim failed', () => {
    const post = composeWaivers(6, outcomes.map((o) => ({ ...o, won: false })))!;
    expect(post.body).toContain('Every claim failed.');
  });

  it('composes nothing at all for a week nobody bid in', () => {
    // Silence is correct. "No waiver activity this week" is not news.
    expect(composeWaivers(6, [])).toBeNull();
  });
});

describe('the weekend post', () => {
  const base = { week: 6, headline: 'Four games, four arguments', standfirst: 'What the models disagree about.' };

  it('holds until the guide is actually released', () => {
    // Announcing a page that does not show the article yet is worse than not posting.
    const post = composeWeekend({ ...base, published: false });
    expect(post.autoEligible).toBe(false);
    expect(post.holdReason).toContain('not been released');
  });

  it('goes out once it is', () => {
    expect(composeWeekend({ ...base, published: true }).autoEligible).toBe(true);
  });
});

describe('findings and the draft', () => {
  it('drops the summary rather than truncating the title', () => {
    const post = composeFinding({
      slug: 'x',
      title: 'Eight AI models picked the same winner. Not one of them believed it.',
      summary: 'A '.repeat(200),
      kicker: 'Findings 004',
    });
    expect(post.body).toContain('Findings 004: Eight AI models picked the same winner');
    expect(fits(post.body, post.link)).toBe(true);
  });

  it('keeps the summary when there is room', () => {
    const post = composeFinding({ slug: 'x', title: 'Short title', summary: 'Short summary.', kicker: null });
    expect(post.body).toBe('Short title\n\nShort summary.');
  });

  it('reports the draft as figures, not adjectives', () => {
    const post = composeDraft({ season: 2026, picks: 120, costUsd: 4.9723, fallbacks: 0 });
    expect(post.body).toContain('120 picks, $4.97 of inference, 0 fallbacks');
    expect(fits(post.body, post.link)).toBe(true);
  });
});

describe('cost', () => {
  it('prices a linked post at 13x a plain one', () => {
    expect(COST_PER_POST_WITH_URL / COST_PER_POST).toBeCloseTo(13.33, 1);
  });

  it('totals a typical week', () => {
    // Results + weekend carry links; waivers does not.
    const week = [
      composeResults({ season: 2025, facts: wk6, recap: null }),
      composeWaivers(6, [{ model: 'Grok 4.5', player: 'X', bid: 1, won: true }])!,
      composeWeekend({ week: 6, headline: 'h', standfirst: 's', published: true }),
    ];
    expect(estimateCost(week)).toBeCloseTo(0.415, 3);
  });
});
