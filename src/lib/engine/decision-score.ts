/**
 * The Decision Score: what the model was worth over the code that could have replaced it.
 *
 * ---------------------------------------------------------------------------
 * The idea
 * ---------------------------------------------------------------------------
 * Every job in this league already computes a deterministic answer before it calls
 * anybody. The lineup cron seeds the best-projection lineup for all eight teams before
 * the first model call; the draft has a highest-projected-available fallback; the
 * waiver fallback is to stand pat. Those are not just safety nets — together they are a
 * NINTH MANAGER, playing the same league from the same data with no judgment at all.
 *
 * So the eval writes itself: **how many points did each model add over the version of
 * itself that was a sort?** A model that starts the highest projections every week
 * scores zero here, however well it finishes, because a `.sort()` would have produced
 * the identical season.
 *
 * ---------------------------------------------------------------------------
 * Why this removes luck when a raw score does not
 * ---------------------------------------------------------------------------
 * The model and its baseline hold the SAME roster in the SAME week against the SAME
 * outcomes. Whatever variance the week contained hits both. What survives the
 * subtraction is only the part the model chose: the players it started that the sort
 * would not have, and the ones it benched that the sort would have started.
 *
 * It is not luck-FREE. A model that correctly benches a player who then scores 30 is
 * charged for it, and fourteen weeks is a small sample, which is why `weeks` and the
 * per-week spread are reported beside every figure rather than a bare number.
 *
 * ---------------------------------------------------------------------------
 * Calibration is a separate axis on purpose
 * ---------------------------------------------------------------------------
 * Points added and knowing-what-you-know are different virtues and folding them into
 * one number hides the interesting cases — the model that adds points while being
 * wildly overconfident, and the one that adds none but knows exactly how its week will
 * go. They are combined only at the very end, with published weights.
 */

export interface WeeklyDelta {
  week: number;
  /** What the model's lineup actually scored. */
  modelPts: number;
  /** What the deterministic best-projection lineup would have scored, same roster. */
  baselinePts: number;
}

export interface ComponentScore {
  /** Total points added over the baseline. Negative means the sort would have done better. */
  total: number;
  /** Per week, so a 14-week and a 2-week sample are not read as the same claim. */
  perWeek: number;
  /** Sample standard deviation of the weekly deltas. */
  spread: number;
  weeks: number;
  /**
   * How many per-week standard errors the total sits from zero.
   *
   * The honest summary of a small sample: +40 points across 14 weeks means something
   * quite different depending on whether the weekly deltas were all +3 or ranged from
   * -25 to +30. Below about 2 this is not distinguishable from noise, and the site
   * should say so rather than rank on it.
   */
  tStat: number;
}

const round2 = (n: number) => Number(n.toFixed(2)) + 0;

export function scoreDeltas(deltas: WeeklyDelta[]): ComponentScore {
  const n = deltas.length;
  if (n === 0) return { total: 0, perWeek: 0, spread: 0, weeks: 0, tStat: 0 };

  const values = deltas.map((d) => d.modelPts - d.baselinePts);
  const total = values.reduce((a, b) => a + b, 0);
  const mean = total / n;

  // Sample standard deviation. One week has no spread — reported as 0 rather than NaN,
  // and its t-stat is 0 because a single observation distinguishes nothing.
  const variance =
    n > 1 ? values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (n - 1) : 0;
  const spread = Math.sqrt(variance);
  const standardError = spread > 0 && n > 1 ? spread / Math.sqrt(n) : 0;

  return {
    total: round2(total),
    perWeek: round2(mean),
    spread: round2(spread),
    weeks: n,
    tStat: round2(tStatistic(mean, standardError, spread, n)),
  };
}

/**
 * How many standard errors the mean sits from zero.
 *
 * Zero spread is the case worth spelling out. A model that beat the baseline by exactly
 * +3 in all fourteen weeks has no variance at all, and dividing by that standard error
 * is a division by zero — which the obvious guard turns into a t-stat of 0, reporting
 * the most consistent result possible as indistinguishable from noise. It is the
 * opposite: an effect that never once failed to appear.
 *
 * Capped rather than infinite, because this number is rendered on a page and serialised
 * into JSON, and neither has a sensible representation of ∞. The cap is far beyond any
 * threshold anything reads it against.
 */
const T_CAP = 99;

function tStatistic(mean: number, standardError: number, spread: number, n: number): number {
  if (n < 2 || mean === 0) return 0;
  if (spread === 0) return mean > 0 ? T_CAP : -T_CAP;
  return mean / standardError;
}

export interface DecisionScoreInput {
  /** Points added over the seeded best-projection lineup, week by week. */
  lineup: WeeklyDelta[];
  /**
   * Season points of the drafted roster against a deterministic drafter taking the
   * highest projected player available at the same 15 slots. One observation, so it
   * carries no t-stat and is weighted accordingly.
   */
  draftDelta: number | null;
  /**
   * Brier skill score on the model's stated win probabilities: positive means its
   * varying forecasts beat simply knowing the league's base win rate.
   */
  calibrationSkill: number | null;
  /** How many forecasts that skill score rests on. */
  forecasts: number;
}

export interface DecisionScore {
  lineup: ComponentScore;
  draftDelta: number | null;
  calibrationSkill: number | null;
  /**
   * The composite, in points-added units.
   *
   * Deliberately expressed in POINTS rather than as an index out of 100. An index
   * invites the question "out of what?" and hides its own weights; points added over
   * the deterministic manager is a quantity with a meaning — it is what the model was
   * worth, and zero is a real and interpretable value rather than a floor.
   */
  total: number;
  /** True when the sample is too thin for the total to mean anything. */
  provisional: boolean;
}

/**
 * What each component is worth in the composite.
 *
 * Published, arguable, and deliberately simple. The draft is one decision set whose
 * effects run all season, so it enters at full weight; calibration is converted into
 * points at a stated exchange rate rather than being folded in as a ratio, because
 * adding a dimensionless skill score to a points total would be arithmetic nonsense
 * dressed as a rating.
 */
export const WEIGHTS = {
  lineup: 1,
  draft: 1,
  /** A perfect Brier skill of 1.0 is worth this many points. */
  calibrationPoints: 50,
} as const;

/** Below this many weeks the composite is shown but flagged as provisional. */
export const MIN_WEEKS = 6;

export function decisionScore(input: DecisionScoreInput): DecisionScore {
  const lineup = scoreDeltas(input.lineup);

  const calibrationContribution =
    input.calibrationSkill !== null && input.forecasts >= MIN_WEEKS
      ? input.calibrationSkill * WEIGHTS.calibrationPoints
      : 0;

  const total =
    lineup.total * WEIGHTS.lineup +
    (input.draftDelta ?? 0) * WEIGHTS.draft +
    calibrationContribution;

  return {
    lineup,
    draftDelta: input.draftDelta === null ? null : round2(input.draftDelta),
    calibrationSkill: input.calibrationSkill,
    total: round2(total),
    provisional: lineup.weeks < MIN_WEEKS,
  };
}

/** One line describing whether a lineup component is distinguishable from noise. */
export function describeLineupSkill(score: ComponentScore): string {
  if (score.weeks === 0) return 'no weeks scored';
  if (Math.abs(score.tStat) < 2) {
    return score.total >= 0
      ? `+${score.total} points, within the noise`
      : `${score.total} points, within the noise`;
  }
  return score.total > 0
    ? `+${score.total} points over the sort, beyond noise`
    : `${score.total} points below the sort, beyond noise`;
}
