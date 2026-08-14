/**
 * Scoring what the models CLAIMED against what happened (SPEC §6.4, §14.3).
 *
 * Fantasy results are mostly luck over fourteen weeks. A model can start the right nine
 * players and lose by forty because a tight end scored three touchdowns for somebody
 * else. So the head-to-head table answers "who won" and this file answers a different
 * and more interesting question: **did the model know what it knew?**
 *
 * Every lineup decision carries a `confidence`, defined in the task as the model's
 * probability of outscoring its opponent that week. That is a forecast, the outcome is
 * binary and observable, and forecasts are scoreable in a way fantasy points are not:
 *
 *   - a model that says 0.9 and wins 90% of the time is calibrated, whatever its record;
 *   - a model that says 0.9 and wins 55% of the time is overconfident, even if it is
 *     top of the table;
 *   - a model that says 0.5 every week is perfectly safe and tells you nothing, which
 *     the RESOLUTION term below is what catches.
 *
 * Nothing here is a model call. Every number is arithmetic over stored rows, so the
 * board can be recomputed from the published data by anyone who doubts it.
 *
 * ONE HONESTY CONSTRAINT, enforced by the caller rather than here: only forecasts made
 * under a prompt that DEFINED confidence may be scored. It was an undefined field until
 * 14 August 2026, and the numbers models produced under it are not answers to this
 * question.
 */

export interface Forecast {
  /** The model's stated probability of winning, 0..1. */
  confidence: number;
  /** Whether it actually won. A tie counts as half, so it is a number, not a boolean. */
  outcome: number;
}

export interface CalibrationBin {
  /** Inclusive lower edge, exclusive upper — except the last, which includes 1.0. */
  from: number;
  to: number;
  count: number;
  /** What the models said, on average, in this bin. */
  meanConfidence: number;
  /** What actually happened, as a rate. */
  actualRate: number;
}

export interface CalibrationReport {
  forecasts: number;
  /** Mean squared error of the forecasts. Lower is better; 0.25 is a coin flip. */
  brier: number;
  /**
   * Brier skill against the naive forecaster that always predicts the base rate.
   *
   * Positive means the model's varying forecasts beat simply knowing how often teams
   * win. This is the number that separates a good forecaster from one that has noticed
   * everybody wins about half the time.
   */
  skillScore: number;
  /** Mean |stated − actual| across bins, weighted by bin size. 0 is perfect. */
  calibrationError: number;
  /**
   * Mean confidence minus actual win rate. Positive is overconfident, negative under.
   * The single most legible number here, and the one a headline can carry.
   */
  bias: number;
  /**
   * How much the forecasts move. A model answering 0.5 every week scores 0 and is
   * useless however good its Brier looks, which is the trap a calibration table alone
   * walks into.
   */
  resolution: number;
  bins: CalibrationBin[];
}

/**
 * `+ 0` collapses negative zero.
 *
 * A perfectly calibrated model produces a bias of exactly -0 here, which renders as
 * "-0" on the page and reads as a rounded-down deficit rather than as dead on.
 */
const round4 = (n: number) => Number(n.toFixed(4)) + 0;

/** Default bins. Five is enough to see a shape without pretending to a precision 14 weeks cannot support. */
export const DEFAULT_EDGES = [0, 0.4, 0.5, 0.6, 0.75, 1] as const;

export function brier(forecasts: Forecast[]): number {
  if (forecasts.length === 0) return 0;
  const sum = forecasts.reduce((acc, f) => acc + (f.confidence - f.outcome) ** 2, 0);
  return sum / forecasts.length;
}

export function binForecasts(
  forecasts: Forecast[],
  edges: readonly number[] = DEFAULT_EDGES,
): CalibrationBin[] {
  const bins: CalibrationBin[] = [];

  for (let i = 0; i < edges.length - 1; i++) {
    const from = edges[i];
    const to = edges[i + 1];
    const last = i === edges.length - 2;

    const inBin = forecasts.filter(
      (f) => f.confidence >= from && (last ? f.confidence <= to : f.confidence < to),
    );

    bins.push({
      from,
      to,
      count: inBin.length,
      meanConfidence: inBin.length
        ? round4(inBin.reduce((a, f) => a + f.confidence, 0) / inBin.length)
        : 0,
      actualRate: inBin.length
        ? round4(inBin.reduce((a, f) => a + f.outcome, 0) / inBin.length)
        : 0,
    });
  }
  return bins;
}

/**
 * The whole report for one model.
 *
 * Returns zeros rather than throwing on an empty set. Through week 1 most of these will
 * be empty or nearly so, and a page that 500s until week 4 is worse than one that says
 * "not enough weeks yet".
 */
export function calibrate(
  forecasts: Forecast[],
  edges: readonly number[] = DEFAULT_EDGES,
): CalibrationReport {
  const n = forecasts.length;
  if (n === 0) {
    return {
      forecasts: 0,
      brier: 0,
      skillScore: 0,
      calibrationError: 0,
      bias: 0,
      resolution: 0,
      bins: binForecasts([], edges),
    };
  }

  const baseRate = forecasts.reduce((a, f) => a + f.outcome, 0) / n;
  const meanConfidence = forecasts.reduce((a, f) => a + f.confidence, 0) / n;
  const score = brier(forecasts);

  // The reference forecaster: predicts the base rate every single week. Its Brier is
  // the variance of the outcomes, and beating it is what "skill" means here.
  const reference = forecasts.reduce((acc, f) => acc + (baseRate - f.outcome) ** 2, 0) / n;

  const bins = binForecasts(forecasts, edges);
  const populated = bins.filter((b) => b.count > 0);
  const calibrationError = populated.reduce(
    (acc, b) => acc + (b.count / n) * Math.abs(b.meanConfidence - b.actualRate),
    0,
  );

  const resolution =
    forecasts.reduce((acc, f) => acc + (f.confidence - meanConfidence) ** 2, 0) / n;

  return {
    forecasts: n,
    brier: round4(score),
    // Undefined when every outcome is identical — 14 straight wins leaves the reference
    // forecaster perfect and nothing to improve on. Reported as 0, not as infinity.
    skillScore: reference === 0 ? 0 : round4(1 - score / reference),
    calibrationError: round4(calibrationError),
    bias: round4(meanConfidence - baseRate),
    resolution: round4(resolution),
    bins,
  };
}

/**
 * How a model's calibration reads in one line.
 *
 * Deliberately conservative about small samples. Fourteen weeks is not many forecasts,
 * and "overconfident" is a claim about a named lab — the same standard the wrap's
 * number check is held to, for the same reason.
 */
export function describeCalibration(report: CalibrationReport, minForecasts = 6): string {
  if (report.forecasts < minForecasts) {
    return `${report.forecasts} forecast${report.forecasts === 1 ? '' : 's'} — too few to judge`;
  }
  const pts = Math.abs(Math.round(report.bias * 100));
  if (pts < 5) return 'well calibrated';
  return report.bias > 0 ? `overconfident by ${pts} points` : `underconfident by ${pts} points`;
}
