import { describe, expect, it } from 'vitest';
import {
  decisionScore,
  describeLineupSkill,
  scoreDeltas,
  WEIGHTS,
  type WeeklyDelta,
} from './decision-score';

const weeks = (pairs: [number, number][]): WeeklyDelta[] =>
  pairs.map(([modelPts, baselinePts], i) => ({ week: i + 1, modelPts, baselinePts }));

describe('points added over the deterministic manager', () => {
  it('scores a model that exactly matches the sort at zero', () => {
    // The headline property. A model that starts the highest projections every week
    // played a season a `.sort()` would have played, and this says so however well it
    // finished in the table.
    const score = scoreDeltas(weeks([[100, 100], [120, 120], [90, 90]]));
    expect(score.total).toBe(0);
    expect(score.perWeek).toBe(0);
  });

  it('credits points the model added', () => {
    const score = scoreDeltas(weeks([[110, 100], [125, 120], [95, 90]]));
    expect(score.total).toBe(20);
    expect(score.perWeek).toBeCloseTo(6.67, 2);
  });

  it('charges a model that did worse than the sort', () => {
    const score = scoreDeltas(weeks([[90, 100], [115, 120]]));
    expect(score.total).toBe(-15);
  });

  it('reports zeros on an empty season rather than NaN', () => {
    expect(scoreDeltas([])).toEqual({ total: 0, perWeek: 0, spread: 0, weeks: 0, tStat: 0 });
  });

  it('does not claim significance from a single week', () => {
    const score = scoreDeltas(weeks([[130, 100]]));
    expect(score.total).toBe(30);
    expect(score.tStat).toBe(0);
    expect(score.spread).toBe(0);
  });
});

describe('separating signal from a hot streak', () => {
  const consistent = scoreDeltas(
    weeks(Array.from({ length: 14 }, () => [103, 100] as [number, number])),
  );

  const lucky = scoreDeltas(
    // Same +42 total, but produced by one enormous week and thirteen small losses.
    weeks([
      [180, 100],
      ...Array.from({ length: 13 }, () => [97, 100] as [number, number]),
    ]),
  );

  it('gives both the same total, because they added the same points', () => {
    expect(consistent.total).toBe(42);
    expect(lucky.total).toBe(41);
  });

  it('separates them on the t-statistic, which is the whole point', () => {
    // +3 every week for fourteen weeks is a skill. +80 once and -3 thirteen times is a
    // week. A rating that could not tell those apart would rank on variance.
    expect(consistent.tStat).toBeGreaterThan(10);
    expect(Math.abs(lucky.tStat)).toBeLessThan(2);
  });

  it('says so in words', () => {
    expect(describeLineupSkill(consistent)).toContain('beyond noise');
    expect(describeLineupSkill(lucky)).toContain('within the noise');
  });
});

describe('the composite', () => {
  const fourteen = weeks(Array.from({ length: 14 }, () => [104, 100] as [number, number]));

  it('adds the draft and converts calibration at the published rate', () => {
    const score = decisionScore({
      lineup: fourteen,
      draftDelta: 30,
      calibrationSkill: 0.2,
      forecasts: 14,
    });
    expect(score.total).toBe(56 + 30 + 0.2 * WEIGHTS.calibrationPoints);
    expect(score.provisional).toBe(false);
  });

  it('ignores a calibration score built on too few forecasts', () => {
    // Three forecasts can produce a spectacular skill score by accident, and it would
    // otherwise dominate a composite measured in points.
    const score = decisionScore({
      lineup: fourteen,
      draftDelta: 0,
      calibrationSkill: 0.9,
      forecasts: 3,
    });
    expect(score.total).toBe(56);
  });

  it('flags a thin season as provisional rather than hiding it', () => {
    const score = decisionScore({
      lineup: weeks([[110, 100], [110, 100]]),
      draftDelta: null,
      calibrationSkill: null,
      forecasts: 0,
    });
    expect(score.provisional).toBe(true);
    expect(score.total).toBe(20);
  });

  it('lets a model that beat the sort finish behind one that drafted better', () => {
    const goodManager = decisionScore({
      lineup: fourteen, // +56
      draftDelta: 0,
      calibrationSkill: null,
      forecasts: 0,
    });
    const goodDrafter = decisionScore({
      lineup: weeks(Array.from({ length: 14 }, () => [100, 100] as [number, number])),
      draftDelta: 120,
      calibrationSkill: null,
      forecasts: 0,
    });
    expect(goodDrafter.total).toBeGreaterThan(goodManager.total);
  });
});
