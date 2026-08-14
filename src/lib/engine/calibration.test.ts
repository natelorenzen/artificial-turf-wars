import { describe, expect, it } from 'vitest';
import {
  binForecasts,
  brier,
  calibrate,
  describeCalibration,
  type Forecast,
} from './calibration';

/** n forecasts at `confidence`, of which `wins` were won. */
function forecasts(confidence: number, n: number, wins: number): Forecast[] {
  return Array.from({ length: n }, (_, i) => ({ confidence, outcome: i < wins ? 1 : 0 }));
}

describe('the Brier score', () => {
  it('is 0 for a perfect confident forecast', () => {
    expect(brier([{ confidence: 1, outcome: 1 }])).toBe(0);
  });

  it('is 1 for a confident forecast that was exactly wrong', () => {
    expect(brier([{ confidence: 1, outcome: 0 }])).toBe(1);
  });

  it('is 0.25 for a coin flip, whatever happens', () => {
    expect(brier([{ confidence: 0.5, outcome: 1 }])).toBe(0.25);
    expect(brier([{ confidence: 0.5, outcome: 0 }])).toBe(0.25);
  });

  it('is 0 on an empty set rather than NaN', () => {
    // A page rendering week 1 asks this before anything has been scored.
    expect(brier([])).toBe(0);
  });
});

describe('calibration', () => {
  it('calls a model that says 0.8 and wins 80% of the time calibrated', () => {
    const report = calibrate(forecasts(0.8, 10, 8));
    expect(report.bias).toBe(0);
    expect(report.calibrationError).toBe(0);
    expect(describeCalibration(report)).toBe('well calibrated');
  });

  it('catches overconfidence even when the model wins more often than not', () => {
    // 0.9 stated, 60% actual. A winning record and a badly wrong forecast at once —
    // which is the entire reason this board exists beside the standings.
    const report = calibrate(forecasts(0.9, 10, 6));
    expect(report.bias).toBeCloseTo(0.3, 4);
    expect(describeCalibration(report)).toBe('overconfident by 30 points');
  });

  it('catches underconfidence', () => {
    const report = calibrate(forecasts(0.3, 10, 6));
    expect(report.bias).toBeCloseTo(-0.3, 4);
    expect(describeCalibration(report)).toBe('underconfident by 30 points');
  });

  it('scores a tie as half a win', () => {
    const report = calibrate([{ confidence: 0.5, outcome: 0.5 }]);
    expect(report.brier).toBe(0);
    expect(report.bias).toBe(0);
  });
});

describe('the resolution term', () => {
  it('is zero for a model that says 0.5 every week', () => {
    // The trap a calibration table alone walks into: always answering the base rate is
    // impossible to fault on calibration and tells you nothing at all.
    const hedger = calibrate([
      ...forecasts(0.5, 8, 4),
    ]);
    expect(hedger.bias).toBe(0);
    expect(hedger.calibrationError).toBe(0);
    expect(hedger.resolution).toBe(0);
    // And it earns no skill over simply knowing the base rate.
    expect(hedger.skillScore).toBe(0);
  });

  it('rewards a forecaster that moves and is right', () => {
    const sharp = calibrate([
      ...forecasts(0.9, 5, 5),
      ...forecasts(0.1, 5, 0),
    ]);
    expect(sharp.resolution).toBeGreaterThan(0);
    expect(sharp.skillScore).toBeGreaterThan(0.8);
    expect(sharp.brier).toBeCloseTo(0.01, 4);
  });

  it('punishes a forecaster that moves and is wrong', () => {
    const wrong = calibrate([
      ...forecasts(0.9, 5, 0),
      ...forecasts(0.1, 5, 5),
    ]);
    // Worse than useless: it moves confidently in the wrong direction.
    expect(wrong.skillScore).toBeLessThan(0);
  });
});

describe('bins', () => {
  it('puts each forecast in exactly one bin, including 1.0', () => {
    const all = [
      { confidence: 0, outcome: 0 },
      { confidence: 0.45, outcome: 1 },
      { confidence: 0.55, outcome: 1 },
      { confidence: 0.7, outcome: 1 },
      { confidence: 1, outcome: 1 },
    ];
    const bins = binForecasts(all);
    expect(bins.reduce((a, b) => a + b.count, 0)).toBe(all.length);
    // 1.0 belongs in the top bin, not nowhere — an off-by-one here silently drops
    // every maximally confident forecast, which is the interesting half of the data.
    expect(bins.at(-1)!.count).toBe(1);
  });

  it('reports an empty bin as zero rather than omitting it', () => {
    const bins = binForecasts([{ confidence: 0.8, outcome: 1 }]);
    expect(bins).toHaveLength(5);
    expect(bins.filter((b) => b.count === 0)).toHaveLength(4);
  });
});

describe('refusing to judge a small sample', () => {
  it('says so instead of naming a lab overconfident on three weeks', () => {
    // Same standard the wrap's number check is held to. This publishes a claim about a
    // named lab, and a false positive is far more expensive than a missing one.
    const report = calibrate(forecasts(0.95, 3, 1));
    expect(describeCalibration(report)).toBe('3 forecasts — too few to judge');
  });

  it('judges once there is enough', () => {
    expect(describeCalibration(calibrate(forecasts(0.95, 8, 4)))).toContain('overconfident');
  });
});

describe('an unbeatable reference', () => {
  it('reports zero skill rather than infinity when every outcome is identical', () => {
    // 14 straight wins leaves the base-rate forecaster perfect, and 1 - score/0 is not
    // a number anyone should publish.
    const report = calibrate(forecasts(0.8, 14, 14));
    expect(Number.isFinite(report.skillScore)).toBe(true);
    expect(report.skillScore).toBe(0);
  });
});
