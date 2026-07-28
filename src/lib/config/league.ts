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

export const PROMPT_VERSION = 'sys-v2';
/** Bumped for the v3 amendment (SPEC §14): H2H objective, opponent awareness. */
export const RULEBOOK_VERSION = 'rulebook-v2';

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
   */
  maxOutputTokens: 16_000,
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
  { key: 'gpt-5-6-sol', displayName: 'GPT-5.6 Sol', openrouterId: 'openai/gpt-5.6-sol', lab: 'OpenAI', contextWindow: 1_050_000, priceIn: 5.0, priceOut: 30.0 },
  { key: 'claude-opus-5', displayName: 'Claude Opus 5', openrouterId: 'anthropic/claude-opus-5', lab: 'Anthropic', contextWindow: 1_000_000, priceIn: 5.0, priceOut: 25.0 },
  { key: 'grok-4-5', displayName: 'Grok 4.5', openrouterId: 'x-ai/grok-4.5', lab: 'xAI', contextWindow: 500_000, priceIn: 2.0, priceOut: 6.0 },
  { key: 'gemini-3-1-pro', displayName: 'Gemini 3.1 Pro', openrouterId: 'google/gemini-3.1-pro-preview', lab: 'Google', contextWindow: 1_050_000, priceIn: 2.0, priceOut: 12.0 },
  { key: 'muse-spark-1-1', displayName: 'Muse Spark 1.1', openrouterId: 'meta/muse-spark-1.1', lab: 'Meta', contextWindow: 1_050_000, priceIn: 1.25, priceOut: 4.25 },
  { key: 'deepseek-v4-pro', displayName: 'DeepSeek V4 Pro', openrouterId: 'deepseek/deepseek-v4-pro', lab: 'DeepSeek', contextWindow: 1_050_000, priceIn: 0.44, priceOut: 0.87 },
  { key: 'kimi-k3', displayName: 'Kimi K3', openrouterId: 'moonshotai/kimi-k3', lab: 'Moonshot', contextWindow: 1_050_000, priceIn: 3.0, priceOut: 15.0 },
  { key: 'qwen3-7-plus', displayName: 'Qwen3.7 Plus', openrouterId: 'qwen/qwen3.7-plus', lab: 'Alibaba', contextWindow: 1_000_000, priceIn: 0.32, priceOut: null },
] as const;

/**
 * SPEC §7.5: the weekly wrap is written by a model with no team in the league.
 * If the 8th seat ever swaps to Mistral, this must move to another non-competing lab.
 */
export const BEAT_WRITER_MODEL = 'mistralai/mistral-medium-3-5';

export const SMALLEST_CONTEXT_WINDOW = Math.min(...COHORT.map((m) => m.contextWindow));
