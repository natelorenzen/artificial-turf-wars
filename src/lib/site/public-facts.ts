/**
 * The handful of facts every public description of the league repeats.
 *
 * Season status, the current week, the cohort's price range, the rules-gate score and
 * the cohort list. They used to be typed by hand into three places — the homepage,
 * `/faq` and `/llms.txt` — and they drifted the way hand-typed copies do: on 11 Oct
 * 2026, in week 5, llms.txt and the FAQ both still said the season had not started,
 * quoted a $0.32 price floor from a seat that had since moved, and the FAQ called the
 * gate "17 out of 17" while the homepage said 19/19.
 *
 * Every one of those surfaces now reads from here, and `public-facts.test.ts` renders
 * all three and fails if they disagree. Text that states one of these facts and is not
 * built from this module is the bug this file exists to prevent.
 */

import { COHORT, LEAGUE } from '@/lib/config/league';
import { buildRulesCheck } from '@/lib/preseason/rules-check';
import { supabase, SUPABASE_CONFIGURED } from '@/lib/supabase';
import { loadCurrentWeek, loadSeasonSnapshot, SEASON, type CurrentWeekView, type SeasonSnapshot } from '@/lib/site/results';

// ---------------------------------------------------------------------------
// Price range
// ---------------------------------------------------------------------------

export interface PriceRange {
  min: number;
  max: number;
  /** Display names of the cheapest and dearest seats, for "X is the floor". */
  floorModel: string;
  ceilingModel: string;
}

export function priceRange(cohort: readonly { displayName: string; priceIn: number }[] = COHORT): PriceRange {
  const byPrice = [...cohort].sort((a, b) => a.priceIn - b.priceIn || a.displayName.localeCompare(b.displayName));
  return {
    min: byPrice[0].priceIn,
    max: byPrice.at(-1)!.priceIn,
    floorModel: byPrice[0].displayName,
    ceilingModel: byPrice.at(-1)!.displayName,
  };
}

/** "$0.58 to $5.00 per million input tokens". */
export function formatPriceRange(range: PriceRange): string {
  return `$${range.min.toFixed(2)} to $${range.max.toFixed(2)} per million input tokens`;
}

// ---------------------------------------------------------------------------
// Rules gate
// ---------------------------------------------------------------------------

export interface RulesGate {
  /** Teams that passed, of `of`. */
  passed: number;
  of: number;
  /** The lowest final score among the teams, out of `maxScore` — so "19/19" means all of them. */
  score: number;
  maxScore: number;
  /** True when no team needed a second attempt. */
  firstAttempt: boolean;
  /** Where the numbers came from. `config` only when there is no database to read. */
  source: 'database' | 'config';
}

/** Pure: the gate summarised from each team's final attempt. */
export function gateFromChecks(
  checks: { score: number; maxScore: number; attempts: number; passed: boolean }[],
): RulesGate | null {
  if (checks.length === 0) return null;
  return {
    passed: checks.filter((c) => c.passed).length,
    of: checks.length,
    score: Math.min(...checks.map((c) => c.score)),
    maxScore: Math.max(...checks.map((c) => c.maxScore)),
    firstAttempt: checks.every((c) => c.attempts === 1),
    source: 'database',
  };
}

/**
 * The gate as the code defines it, for a build with no database. Every seat passed
 * every question on the first attempt (14 Aug 2026), which is what the stored rows say
 * too; the fallback exists so a build can render, not to supply a different answer.
 */
export function gateFromConfig(): RulesGate {
  const questions = buildRulesCheck().length;
  return { passed: COHORT.length, of: COHORT.length, score: questions, maxScore: questions, firstAttempt: true, source: 'config' };
}

/** "19/19". */
export function gateScore(gate: RulesGate): string {
  return `${gate.score}/${gate.maxScore}`;
}

/** One sentence, the same everywhere it appears. */
export function gateSentence(gate: RulesGate): string {
  const all = gate.passed === gate.of;
  if (all && gate.score === gate.maxScore) {
    return (
      `All ${gate.of} models scored ${gateScore(gate)} on the rules comprehension check` +
      `${gate.firstAttempt ? ', on the first attempt' : ''}, from one shared byte-identical briefing.`
    );
  }
  return (
    `${gate.passed} of ${gate.of} models passed the rules comprehension check; the lowest final score was ` +
    `${gate.score} of ${gate.maxScore}${gate.firstAttempt ? '' : ', and at least one needed a retry'}.`
  );
}

async function loadRulesGate(season: number): Promise<RulesGate> {
  if (!SUPABASE_CONFIGURED) return gateFromConfig();
  const { data: seasonRow } = await supabase.from('seasons').select('id').eq('year', season).maybeSingle();
  if (!seasonRow) return gateFromConfig();
  const { data: teams } = await supabase.from('teams').select('id').eq('season_id', seasonRow.id);
  const ids = (teams ?? []).map((t) => t.id as string);
  if (ids.length === 0) return gateFromConfig();

  const { data: rows } = await supabase
    .from('rules_checks')
    .select('team_id, score, max_score, attempt, passed')
    .in('team_id', ids);

  // Each team's final attempt, as `loadLeagueFacts` takes it for the methodology page.
  const latest = new Map<string, { score: number; maxScore: number; attempts: number; passed: boolean }>();
  for (const row of rows ?? []) {
    const current = latest.get(row.team_id as string);
    if (current && current.attempts >= (row.attempt as number)) continue;
    latest.set(row.team_id as string, {
      score: Number(row.score),
      maxScore: Number(row.max_score),
      attempts: Number(row.attempt),
      passed: Boolean(row.passed),
    });
  }
  return gateFromChecks([...latest.values()]) ?? gateFromConfig();
}

// ---------------------------------------------------------------------------
// Season status
// ---------------------------------------------------------------------------

export type SeasonPhase =
  /** No database to ask. Said as "unknown", never as "not started". */
  | 'unknown'
  | 'preseason'
  | 'regular-season'
  | 'playoffs'
  | 'complete';

export interface SeasonStatus {
  phase: SeasonPhase;
  season: number;
  /** The week the league has locked lineups for, or null before week 1. */
  currentWeek: number | null;
  /** What the current week is doing right now. */
  currentWeekState: 'lineups locked' | 'under way' | 'scored' | null;
  /** Latest week the standings are built through. */
  throughWeek: number | null;
  regularSeasonWeeks: number;
  leader: { model: string; record: string; coRanked: boolean } | null;
  champion: string | null;
  /** One sentence for the top of any page or brief. */
  sentence: string;
}

export interface StatusInput {
  season: number;
  dbAvailable: boolean;
  current: Pick<CurrentWeekView, 'week' | 'scored' | 'kickedOff'> | null;
  snapshot: Pick<SeasonSnapshot, 'throughWeek' | 'champion' | 'table'>;
}

/** Pure, so the wording is testable without a database. */
export function seasonStatus(input: StatusInput): SeasonStatus {
  const { season, current, snapshot } = input;
  const weeks = LEAGUE.regularSeasonWeeks;
  const top = snapshot.table[0];
  const base = {
    season,
    currentWeek: current?.week ?? null,
    currentWeekState: current
      ? current.scored
        ? ('scored' as const)
        : current.kickedOff
          ? ('under way' as const)
          : ('lineups locked' as const)
      : null,
    throughWeek: snapshot.throughWeek,
    regularSeasonWeeks: weeks,
    leader: top ? { model: top.model, record: top.record, coRanked: top.coRanked } : null,
    champion: snapshot.champion,
  };

  if (!input.dbAvailable) {
    return {
      ...base,
      phase: 'unknown',
      sentence: `The ${season} season's current status could not be read; the homepage carries it.`,
    };
  }
  if (snapshot.champion) {
    return {
      ...base,
      phase: 'complete',
      sentence: `The ${season} season is complete. ${snapshot.champion} won the title.`,
    };
  }
  if (current === null) {
    return {
      ...base,
      phase: 'preseason',
      sentence: `The ${season} season has not kicked off yet. No league week has been played.`,
    };
  }

  const doing =
    base.currentWeekState === 'scored'
      ? 'has been scored'
      : base.currentWeekState === 'under way'
        ? 'is being played'
        : 'has its lineups locked';
  const through =
    snapshot.throughWeek === null
      ? 'No week has been scored yet.'
      : `Standings are official through week ${snapshot.throughWeek}.`;

  if (current.week > weeks) {
    return {
      ...base,
      phase: 'playoffs',
      sentence: `The ${season} season is in its playoffs: week ${current.week} ${doing}. ${through}`,
    };
  }
  return {
    ...base,
    phase: 'regular-season',
    sentence: `The ${season} season is under way: week ${current.week} of ${weeks} ${doing}. ${through}`,
  };
}

// ---------------------------------------------------------------------------
// Everything together
// ---------------------------------------------------------------------------

export interface PublicFacts {
  season: number;
  status: SeasonStatus;
  prices: PriceRange;
  gate: RulesGate;
  cohort: { key: string; displayName: string; lab: string; priceIn: number }[];
}

/** "GPT-5.6 Sol (OpenAI), Claude Opus 5 (Anthropic), …" — config order, which is draft-seat order. */
export function cohortList(facts: Pick<PublicFacts, 'cohort'>): string {
  return facts.cohort.map((m) => `${m.displayName} (${m.lab})`).join(', ');
}

/** Pure assembly, exported so the test can build facts without a database. */
export function assembleFacts(input: StatusInput & { gate: RulesGate }): PublicFacts {
  return {
    season: input.season,
    status: seasonStatus(input),
    prices: priceRange(),
    gate: input.gate,
    cohort: COHORT.map((m) => ({ key: m.key, displayName: m.displayName, lab: m.lab, priceIn: m.priceIn })),
  };
}

/**
 * The facts, as of now. Pages that also need the current week or the snapshot for
 * their own rendering pass them in, so the page and its sentences come from one read.
 */
export async function loadPublicFacts(
  preloaded?: { current: CurrentWeekView | null; snapshot: SeasonSnapshot },
  season = SEASON,
): Promise<PublicFacts> {
  const current = preloaded ? preloaded.current : await loadCurrentWeek(season);
  const snapshot = preloaded ? preloaded.snapshot : await loadSeasonSnapshot(season);
  return assembleFacts({
    season,
    dbAvailable: SUPABASE_CONFIGURED,
    current,
    snapshot,
    gate: await loadRulesGate(season),
  });
}
