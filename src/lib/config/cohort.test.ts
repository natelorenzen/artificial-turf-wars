import { describe, expect, it } from 'vitest';
import { COHORT, COHORT_FROZEN_AT, LEAGUE } from '@/lib/config/league';

/**
 * The cohort table is published on the home page and quoted in the FAQ and llms.txt, so
 * a wrong number here is a wrong number in front of readers. These assert the shape that
 * has already gone wrong once.
 */
describe('COHORT', () => {
  it('has exactly one model per team slot', () => {
    expect(COHORT).toHaveLength(LEAGUE.teams);
  });

  it('has unique keys, display names, labs and OpenRouter ids', () => {
    for (const field of ['key', 'displayName', 'lab', 'openrouterId'] as const) {
      const values = COHORT.map((m) => m[field]);
      expect(new Set(values).size, `duplicate ${field}`).toBe(values.length);
    }
  });

  it('prices every model on both sides', () => {
    /*
     * `priceOut` was null for Qwen, which the cohort table rendered as an em dash —
     * implying the model charged nothing for output tokens. It charges $1.28/M. A null
     * here is far more likely to be an unfilled field than a genuinely free model, so
     * the type still permits it and this test does not.
     */
    for (const m of COHORT) {
      expect(m.priceIn, `${m.key} priceIn`).toBeGreaterThan(0);
      expect(m.priceOut, `${m.key} priceOut is null — is it really free, or unfilled?`).not.toBeNull();
      expect(m.priceOut!, `${m.key} priceOut`).toBeGreaterThan(0);
    }
  });

  it('keeps every context window above the ceiling we send', () => {
    // Prompts are capped below the smallest window so no model truncates first.
    for (const m of COHORT) {
      expect(m.contextWindow, `${m.key} context`).toBeGreaterThanOrEqual(LEAGUE.contextCeilingTokens);
    }
  });

  it('has a parseable freeze date', () => {
    expect(Number.isNaN(Date.parse(COHORT_FROZEN_AT)), COHORT_FROZEN_AT).toBe(false);
  });

  it('freezes the cohort before the season starts', () => {
    // A freeze date after kickoff would be the mid-season swap the whole rule forbids.
    expect(new Date(COHORT_FROZEN_AT).getUTCFullYear()).toBe(LEAGUE.season);
    expect(new Date(COHORT_FROZEN_AT) < new Date(`${LEAGUE.season}-09-09`)).toBe(true);
  });
});
