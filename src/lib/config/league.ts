/**
 * THE single source of truth for league rules.
 *
 * SPEC §4.1-iii: the League Rulebook injected into every model call is *generated*
 * from this file, never hand-written, so the rulebook cannot drift from the code
 * that enforces it. If you change a number here, the rulebook text changes with it
 * and `rulebook_version` must be bumped (SPEC §4.1).
 */

export type Position = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DEF';
export type StarterSlot = 'QB' | 'RB' | 'WR' | 'TE' | 'FLEX' | 'K' | 'DEF';

/**
 * Bumped to v3 on 14 August: the lineup task now DEFINES `confidence` as the model's
 * probability of outscoring its opponent that week.
 *
 * It was previously undefined — the field appeared in the output example as `0.5` and
 * nothing said what the number meant. Every model answered anyway, between 0.62 and
 * 0.90 across the rehearsals, and it is impossible to say what any of them were
 * answering. Scoring that against real results and publishing "this model is
 * overconfident" would have been an accusation built on a question nobody asked.
 *
 * SPEC §14.3 already wanted this measurable — "each model's implied estimate of its own
 * win chance, against ours" — and it only becomes one once the question is stated.
 * Forecasts made under sys-v2 are not comparable to forecasts made under this, so the
 * calibration board starts from the first week decided under v3.
 */
/**
 * Still v3 — see the sys-v4 note in `src/lib/prompt/system.ts`.
 *
 * v4 was written on draft day to tell the models their output allowance, tried on one
 * pick, and reverted the same hour because it made that pick worse rather than better.
 * The prompt text is byte-identical to v3 again, so this string is accurate rather than
 * nostalgic; exactly one decision row in the 2026 season carries `sys-v4`, and it is a
 * fallback.
 *
 * The draft is therefore NOT meaningfully split: picks 1-45 and 46-120 run the same
 * prompt, with one recorded experiment in between.
 */
export const PROMPT_VERSION = 'sys-v3';
/**
 * Bumped for the v3 amendment (SPEC §14): H2H objective, opponent awareness.
 *
 * v3 adds the two playoff rules that were enforceable but unstated: the third-place
 * game SPEC §3.3 has always specified, and what happens when a bracket game ends in an
 * exact tie. A regular-season tie is a tie; a bracket has to advance somebody. Leaving
 * that in the engine only would have repeated the most expensive mistake of the
 * rehearsals — a model marked down for a rule nobody told it.
 */
export const RULEBOOK_VERSION = 'rulebook-v3';

/**
 * SPEC §14.2 — head-to-head decides the season. All-play is still computed and
 * published every week as the timing-luck-free measure of who managed best, but it
 * no longer ranks. Under all-play there is no opponent, and therefore no punting, no
 * variance-seeking, and no allocating resources across weeks.
 */
export const RANKING_BASIS = 'h2h' as const;

/** Yahoo default starting nine (SPEC §3.1). */
export const SLOTS: Record<StarterSlot, number> = {
  QB: 1,
  RB: 2,
  WR: 2,
  TE: 1,
  FLEX: 1,
  K: 1,
  DEF: 1,
};

export const FLEX_ELIGIBLE: Position[] = ['RB', 'WR', 'TE'];

/** Positions that must be fillable every week — drives the round-13 soft cap (SPEC §4.3). */
export const REQUIRED_POSITIONS: Position[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

/**
 * Per-player offensive scoring, keyed by Sleeper stat field.
 *
 * NOTE on `st_td`: deliberately absent. A special-teams touchdown is owned by the
 * DEF/ST unit (`def_st_td`), never by the individual returner — see SCORING_NOTES
 * and SPEC §3.2's return-TD double-count warning. Scoring both would award 12
 * points league-wide for one return.
 */
export const OFFENSE_SCORING = {
  pass_yd: 0.04,
  pass_td: 4,
  pass_int: -1,
  rush_yd: 0.1,
  rush_td: 6,
  rec: 1.0,
  rec_yd: 0.1,
  rec_td: 6,
  fum_lost: -2,
  pass_2pt: 2,
  rush_2pt: 2,
  rec_2pt: 2,
} as const;

/**
 * Kicker scoring. `fg_0_39` is DERIVED by subtraction (`fgm - fgm_40_49 - fgm_50p`),
 * never by summing `fgm_20_29 + fgm_30_39` — Sleeper has no `fgm_0_19` key, so
 * summing bands silently drops a sub-20-yard field goal (SPEC §3.2).
 *
 * `fgm_50_59` is never read: `fgm_50p` already contains it.
 */
export const KICKER_SCORING = {
  fg_0_39: 3,
  fg_40_49: 4,
  fg_50p: 5,
  xpm: 1,
} as const;

export const DEF_SCORING = {
  sack: 1,
  int: 2,
  fum_rec: 2,
  safe: 2,
  blk_kick: 2,
  def_td: 6,
  def_st_td: 6,
} as const;

/**
 * Points-allowed bands, evaluated in order against the raw `pts_allow` integer.
 * Never read Sleeper's `pts_allow_*` indicator fields — Sleeper omits a key rather
 * than returning zero, so their absence is not evidence of anything (SPEC §5.2 #7).
 */
export const DEF_POINTS_ALLOWED_BANDS: ReadonlyArray<{
  max: number;
  points: number;
  label: string;
}> = [
  { max: 0, points: 10, label: '0' },
  { max: 6, points: 7, label: '1-6' },
  { max: 13, points: 4, label: '7-13' },
  { max: 20, points: 1, label: '14-20' },
  { max: 27, points: 0, label: '21-27' },
  { max: 34, points: -1, label: '28-34' },
  { max: Infinity, points: -4, label: '35+' },
];

export const LEAGUE = {
  name: 'Gridiron Gauntlet',
  season: 2026,
  teams: 8,
  rosterSize: 15,
  benchSize: 6,
  draftRounds: 15,
  draftType: 'snake' as const,
  /** One shared budget funds both the slot auction and season-long FAAB (SPEC §4.2). */
  budgetTotal: 100,
  regularSeasonWeeks: 14,
  playoffWeeks: [15, 16] as const,
  playoffTeams: 4,
  /**
   * SPEC §14.5 — after Week 14 the eliminated teams' rosters are released into a
   * free-agent pool and the four survivors bid remaining FAAB on them. Eliminated
   * teams stop setting lineups.
   */
  playoffPoolRelease: true,
  /**
   * How a bracket game that ends level is decided. The regular season records a tie as
   * a tie; the playoffs cannot, so the higher seed advances — the thing fourteen weeks
   * of head-to-head record actually bought. Stated in the rulebook, not just enforced.
   */
  playoffTieBreak: 'higher_seed' as const,
  /** How many upcoming opponents a model is shown, so "save it for next week" is groundable. */
  lookaheadOpponents: 3,
  /** Soft cap fires from this round if a required position is still unfilled (SPEC §4.3). */
  softCapRound: 13,
  /** SPEC §8.1: same temperature requested of every model. */
  temperature: 0.2,
  /**
   * SPEC §8.1 #12 — identical for all eight, and high enough that the bounded
   * reasoning schema never truncates for anyone.
   *
   * Raised from 4000 after the 2025 backtest: reasoning-tier models spend the budget
   * on thinking before writing a single character of JSON, and two of eight returned
   * EMPTY CONTENT on the auction — which is indistinguishable from a refusal unless
   * `finish_reason` is captured. Kimi K3 used 2,946 output tokens on a one-player
   * board; the real board is sixty.
   *
   * Costs nothing to raise: providers bill tokens generated, not the ceiling.
   *
   * RAISED AGAIN to 20,000 on draft day, at pick 52, alongside `reasoningMaxTokens`
   * below. The 4000 -> 16000 fix above treated the size of the pool; it did not treat
   * the fact that it is ONE pool. Reasoning and answer are drawn from the same
   * allowance, so a model can spend all of it thinking and emit nothing — which is
   * precisely what happened twice, and no ceiling alone prevents it.
   */
  maxOutputTokens: 20_000,

  /**
   * The share of `maxOutputTokens` a model may spend on internal reasoning, leaving
   * the remainder RESERVED for the answer. Identical for all eight.
   *
   * Draft day made the case in numbers. Qwen3.8 Max's five successful picks used
   * 9,891 / 10,256 / 12,703 / 13,456 / 14,864 reasoning tokens. Its two failures used
   * 15,663 and 16,000 — the second returning zero characters after 941 seconds, having
   * thought its way through the entire budget without writing anything. The working
   * picks and the runaways are cleanly separable, and 14,000 is the line between them:
   * four of the five successes pass under it untouched.
   *
   * The 6,000 left over is 3.5x the largest answer any model has produced (Kimi's
   * 1,697 tokens). This is not a limit on thinking so much as a floor under answering.
   *
   * It is not Qwen-specific and was not chosen for Qwen. As the board gets harder every
   * model spends more: Claude Opus 5 used 187 reasoning tokens on pick 2 and 13,387 on
   * pick 47, and DeepSeek 12,435 on pick 49. Both still fit under this cap. Without it,
   * the back half of a draft fills with fallbacks exactly where the decisions are most
   * interesting.
   *
   * THE DRAFT IS SPLIT HERE. Picks 1-51 ran with no reasoning cap, 52-120 with this
   * one. The boundary is checkable rather than asserted: no decision after pick 51
   * exceeds 14,000 reasoning tokens, and that is visible in the published data.
   */
  reasoningMaxTokens: 14_000,
  /** Below Grok 4.5's 500K window so no model truncates first (SPEC §8.1 #11). */
  contextCeilingTokens: 400_000,
  /** SPEC §4.1b: dossier must be asserted under this. */
  dossierMaxTokens: 150_000,
  /** SPEC §4.1b: last N same-type decisions carried in the memory block. */
  memoryRecentDecisions: 3,
  maxRetries: 2,
  slots: SLOTS,
  flexEligible: FLEX_ELIGIBLE,
  scoring: {
    offense: OFFENSE_SCORING,
    kicker: KICKER_SCORING,
    def: DEF_SCORING,
    defPointsAllowed: DEF_POINTS_ALLOWED_BANDS,
  },
} as const;

export const STARTERS_COUNT = Object.values(SLOTS).reduce((a, b) => a + b, 0); // 9

/**
 * Deviations and resolutions a human needs alongside the numbers. Rendered into
 * the rulebook and the /methodology page so the two can never disagree.
 */
export const SCORING_NOTES = {
  ppr: 'Full PPR (1.0) instead of Yahoo half-PPR — variance reduction, SPEC §3.2.',
  returnTd:
    'A special-teams touchdown is credited to the DEF/ST unit, not to the individual returner. One return TD is worth exactly 6 points league-wide.',
  fgBands:
    'FG 0-39 is derived as fgm - fgm_40_49 - fgm_50p. Sleeper has no fgm_0_19 key.',
  ptsAllowed:
    'Points allowed is banded from the raw pts_allow integer, not from Sleeper indicator fields.',
} as const;

/**
 * COHORT FREEZE (SPEC §8.1 #8, extended).
 *
 * The rule was always "pinned before the draft, never swapped mid-season". That leaves
 * the pre-season open, and the pre-season is exactly when labs ship. On 3 August 2026,
 * Alibaba released `qwen/qwen3.8-max` — newer and a tier above our pinned
 * `qwen/qwen3.7-plus` — which raised the question this constant answers.
 *
 * "Whatever was newest on the day someone happened to look" is not a rule, it is a
 * reaction, and it is the first thing a sceptical reader would pull at. So the cohort is
 * frozen on a stated date, published on /methodology, and after it no model ID changes
 * for any reason short of a provider withdrawing one.
 *
 * On 3 August we did NOT take qwen3.8-max, because swapping a seat would have
 * invalidated the "8/8 at 17/17 from one shared briefing" claim until that model was
 * re-gated, and currency was not worth spending that for.
 *
 * REVISED 14 August. That objection stopped applying. Bumping the rulebook to v3 for
 * the playoff rules forces all eight to re-sit the comprehension check anyway, so the
 * re-gate is happening regardless and the marginal cost of taking the newest models is
 * zero. Four seats moved, each to its lab's current top-tier generally-available model,
 * verified against the OpenRouter catalogue that day:
 *
 *   xAI       grok-4.5           → grok-4.6              (shipped 12 Aug)
 *   Meta      muse-spark-1.1     → muse-spark-1.2        (shipped  5 Aug)
 *   DeepSeek  deepseek-v4-pro    → deepseek-v4-pro-0813  (shipped 12 Aug, the GA release)
 *   Alibaba   qwen3.7-plus       → qwen3.8-max           (shipped  3 Aug)
 *
 * OpenAI, Anthropic, Moonshot and Google were already on their lab's top tier. Google
 * looks stale at February, and is not: everything newer from them is Flash, a tier down.
 *
 * The date below still governs. After it, no model ID changes for any reason short of a
 * provider withdrawing one — including if a lab ships something on 25 August.
 */
export const COHORT_FROZEN_AT = '2026-08-24';

/** The eight competitors (SPEC §2). Pinned before the draft; never swapped mid-season. */
export interface CohortModel {
  key: string;
  displayName: string;
  openrouterId: string;
  lab: string;
  contextWindow: number;
  priceIn: number;
  priceOut: number | null;
}

export const COHORT: readonly CohortModel[] = [
  // Repriced by OpenAI since the pin: $5.00/$30.00 → $2.00/$10.00. Caught by
  // scripts/cohort-check.ts on draft morning, 24 August 2026. These numbers are
  // published — the cohort table and the "not price-matched" span on /methodology and
  // /teams are computed from them — and they are the fallback when OpenRouter does not
  // return a cost on a call. The MODEL is unchanged; only its price moved.
  { key: 'gpt-5-6-sol', displayName: 'GPT-5.6 Sol', openrouterId: 'openai/gpt-5.6-sol', lab: 'OpenAI', contextWindow: 1_050_000, priceIn: 2.0, priceOut: 10.0 },
  { key: 'claude-opus-5', displayName: 'Claude Opus 5', openrouterId: 'anthropic/claude-opus-5', lab: 'Anthropic', contextWindow: 1_000_000, priceIn: 5.0, priceOut: 25.0 },
  { key: 'grok-4-6', displayName: 'Grok 4.6', openrouterId: 'x-ai/grok-4.6', lab: 'xAI', contextWindow: 500_000, priceIn: 2.0, priceOut: 6.0 },
  { key: 'gemini-3-1-pro', displayName: 'Gemini 3.1 Pro', openrouterId: 'google/gemini-3.1-pro-preview', lab: 'Google', contextWindow: 1_048_576, priceIn: 2.0, priceOut: 12.0 },
  { key: 'muse-spark-1-2', displayName: 'Muse Spark 1.2', openrouterId: 'meta/muse-spark-1.2', lab: 'Meta', contextWindow: 1_048_576, priceIn: 1.25, priceOut: 4.25 },
  // Also repriced since the pin, and by more than 2x: $0.43/$0.87 → $1.12/$3.37, same
  // check, same morning. The old figures were the pre-GA preview price.
  { key: 'deepseek-v4-pro-0813', displayName: 'DeepSeek V4 Pro 0813', openrouterId: 'deepseek/deepseek-v4-pro-0813', lab: 'DeepSeek', contextWindow: 1_048_576, priceIn: 1.12, priceOut: 3.37 },
  { key: 'kimi-k3', displayName: 'Kimi K3', openrouterId: 'moonshotai/kimi-k3', lab: 'Moonshot', contextWindow: 1_048_576, priceIn: 3.0, priceOut: 15.0 },
  // priceOut was null here, which the cohort table rendered as "—" — implying Qwen
  // charged nothing for output. It charges $1.28/M. Corrected against the OpenRouter
  // catalogue, 3 August 2026.
  // Qwen3.8 Max, not the newer `qwen3.8-2.4t-a95b`: OpenRouter describes that one as
  // "the open-weight variant of Qwen3.8 Max", so it is a sibling release rather than a
  // tier above. Newest is not the rule; top-tier generally-available is.
  { key: 'qwen3-8-max', displayName: 'Qwen3.8 Max', openrouterId: 'qwen/qwen3.8-max', lab: 'Alibaba', contextWindow: 1_000_000, priceIn: 2.0, priceOut: 6.0 },
] as const;

/**
 * SPEC §7.5: the weekly wrap is written by a model with no team in the league.
 * If the 8th seat ever swaps to Mistral, this must move to another non-competing lab.
 */
export const BEAT_WRITER_MODEL = 'mistralai/mistral-medium-3-5';

export const SMALLEST_CONTEXT_WINDOW = Math.min(...COHORT.map((m) => m.contextWindow));
