/**
 * Is the cohort we are about to lock still the cohort we meant to lock?
 *
 *   npx tsx --env-file=.env.local scripts/cohort-check.ts
 *
 * Read-only. No model calls, no writes, no cost. Run it FIRST on draft day.
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 * The draft is the last moment the eight competitors can change. SPEC §8.1 #8 pins
 * the IDs before the draft and forbids swapping mid-season, and COHORT_FROZEN_AT
 * closes the pre-season loophole — the pre-season being exactly when labs ship.
 * After the freeze date nothing moves short of a provider withdrawing a model, so
 * whatever `COHORT` says on draft morning is what plays fourteen weeks of football.
 *
 * That makes draft morning the last chance to notice three different failures, and
 * this script looks for all three:
 *
 *   1. A PINNED MODEL IS GONE OR GOING. If OpenRouter no longer serves an ID, the
 *      draft fails 8 calls in and the season has a hole in it. If one carries an
 *      expiration date inside the season, the withdrawal happens in October instead
 *      — the `teams.frozen` path, which is a worse outcome than swapping today.
 *
 *   2. A LAB SHIPPED SOMETHING AFTER THE LAST RE-PIN. Four seats moved on 14 August
 *      for exactly this reason. Anything that landed since is reported here, with
 *      its description, because the rule is TOP-TIER GENERALLY AVAILABLE and not
 *      NEWEST — Google's newer models are Flash, a tier down, and Qwen's newer
 *      `qwen3.8-2.4t-a95b` is described as the open-weight variant of what we
 *      already run. Both are correctly declined. This script surfaces candidates;
 *      a human decides, and writes down why.
 *
 *   3. THE DATABASE DISAGREES WITH THE CONFIG. `scripts/repin-cohort.ts` documents
 *      the silent version of this: a re-pin changes a model's KEY, so a plain seed
 *      upsert inserts a new row, leaves `teams.model_id` on the old one, reports
 *      success, and the site shows a cohort the league is not actually playing.
 *      Config and seats are compared here rather than assumed.
 *
 * Nothing here is a verdict. It prints what is true this morning and says which of
 * it needs a decision before `scripts/dossier.ts` runs.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { COHORT, COHORT_FROZEN_AT, LEAGUE } from '@/lib/config/league';

const CATALOGUE = 'https://openrouter.ai/api/v1/models';
const SEASON = LEAGUE.season;

/** Slug fragments that usually mean a cheaper tier of the same generation. */
const LOWER_TIER = ['mini', 'flash', 'lite', 'small', 'nano', 'micro', 'air', 'turbo', 'instant', 'contributor', 'free'];
/** Slug fragments that usually mean a different job, not a better general model. */
const SPECIALIST = ['coder', 'embed', 'rerank', 'guard', 'moderation', 'tts', 'stt', 'whisper', 'image', 'video', 'audio', 'ocr', 'vl', 'search'];

interface CatalogueModel {
  id: string;
  name: string;
  created: number;
  description?: string;
  context_length?: number;
  expiration_date?: string | null;
  pricing?: { prompt?: string; completion?: string };
}

interface ModelRow {
  id: string;
  key: string;
  openrouter_id: string;
  lab: string;
  active: boolean;
}

const problems: string[] = [];
const decisions: string[] = [];

function money(perToken: string | undefined): number | null {
  if (perToken === undefined) return null;
  const n = Number(perToken);
  return Number.isFinite(n) ? n * 1_000_000 : null;
}

function usd(n: number | null): string {
  return n === null ? '?' : `$${n.toFixed(2)}`;
}

function day(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

function db(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('\n  REFUSING TO RUN\n  no Supabase credentials — run with --env-file=.env.local\n');
    process.exit(1);
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

async function fetchCatalogue(): Promise<CatalogueModel[]> {
  const response = await fetch(CATALOGUE, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    console.error(`\n  REFUSING TO RUN\n  OpenRouter catalogue returned ${response.status}\n`);
    process.exit(1);
  }
  const body = (await response.json()) as { data?: CatalogueModel[] };
  const models = body.data ?? [];
  if (models.length === 0) {
    console.error('\n  REFUSING TO RUN\n  the OpenRouter catalogue came back empty\n');
    process.exit(1);
  }
  return models;
}

/** The last kickoff the season schedules — the date a withdrawal has to clear. */
async function seasonEnd(supabase: SupabaseClient): Promise<string> {
  const lastWeek = Math.max(...LEAGUE.playoffWeeks);
  const { data } = await supabase
    .from('nfl_games')
    .select('kickoff_at')
    .eq('season', SEASON)
    .eq('season_type', 'regular')
    .lte('week', lastWeek)
    .order('kickoff_at', { ascending: false })
    .limit(1);
  const kickoff = data?.[0]?.kickoff_at as string | undefined;
  // No schedule loaded is its own problem, reported by db-check. Assume the season
  // runs to the end of the calendar year rather than passing a withdrawal as clear.
  return kickoff ? kickoff.slice(0, 10) : `${SEASON}-12-31`;
}

function freezeWindow(today: string, picks: number) {
  console.log('  Freeze window\n');
  if (today < COHORT_FROZEN_AT) {
    console.log(`    today ${today} — the cohort freezes ${COHORT_FROZEN_AT}. A seat may still move.`);
  } else if (today === COHORT_FROZEN_AT) {
    console.log(`    today ${today} — THE FREEZE DATE. This is the last day a seat may move.`);
    console.log('    From tomorrow, only a provider withdrawing a model justifies a change.');
  } else {
    console.log(`    today ${today} — frozen since ${COHORT_FROZEN_AT}. Nothing moves now except`);
    console.log('    around a withdrawal, and that is published as such. Anything newer below is');
    console.log('    information, not an option.');
  }
  if (picks > 0) {
    console.log(`    draft: ${picks} picks already made — the cohort is locked in fact as well as rule.`);
  } else {
    console.log('    draft: not started — a re-pin is still mechanically possible.');
  }
  console.log();
}

function checkPinned(catalogue: Map<string, CatalogueModel>, endsOn: string) {
  console.log('  The pinned eight, against the live catalogue\n');

  for (const model of COHORT) {
    const live = catalogue.get(model.openrouterId);
    if (!live) {
      console.log(`    ✗  ${model.lab.padEnd(9)} ${model.openrouterId}  NOT IN THE CATALOGUE`);
      problems.push(
        `${model.openrouterId} (${model.lab}) is not served by OpenRouter. The draft would fail on it. ` +
          'A withdrawn model is the one condition the freeze permits a change for.',
      );
      continue;
    }

    const drift: string[] = [];
    const priceIn = money(live.pricing?.prompt);
    const priceOut = money(live.pricing?.completion);
    if (priceIn !== null && Math.abs(priceIn - model.priceIn) > 0.005) {
      drift.push(`priceIn ${usd(model.priceIn)} → ${usd(priceIn)}`);
    }
    if (priceOut !== null && model.priceOut !== null && Math.abs(priceOut - model.priceOut) > 0.005) {
      drift.push(`priceOut ${usd(model.priceOut)} → ${usd(priceOut)}`);
    }
    if (live.context_length !== undefined && live.context_length !== model.contextWindow) {
      drift.push(`context ${model.contextWindow.toLocaleString()} → ${live.context_length.toLocaleString()}`);
    }

    const expires = live.expiration_date ? live.expiration_date.slice(0, 10) : null;
    const expiresInSeason = expires !== null && expires <= endsOn;

    console.log(
      `    ${expiresInSeason ? '✗' : drift.length ? '!' : '✓'}  ${model.lab.padEnd(9)}` +
        ` ${model.openrouterId.padEnd(34)} ${usd(model.priceIn)}/${usd(model.priceOut)}` +
        `  shipped ${day(live.created)}`,
    );
    if (expires) console.log(`       expires ${expires}${expiresInSeason ? '  — BEFORE THE SEASON ENDS' : ''}`);
    for (const d of drift) console.log(`       drift: ${d}`);

    if (expiresInSeason) {
      problems.push(
        `${model.openrouterId} (${model.lab}) expires ${expires}, before the season ends ${endsOn}. ` +
          'Swapping it today is cheaper than freezing the team in October.',
      );
    }
    if (drift.length > 0) {
      decisions.push(
        `${model.openrouterId}: ${drift.join(', ')}. The cohort table and /methodology quote these numbers.`,
      );
    }
    // Context is a hard constraint: prompts are capped below the smallest window.
    if (live.context_length !== undefined && live.context_length < LEAGUE.contextCeilingTokens) {
      problems.push(
        `${model.openrouterId} now serves ${live.context_length.toLocaleString()} tokens, below the ` +
          `${LEAGUE.contextCeilingTokens.toLocaleString()} ceiling we send. It would truncate first.`,
      );
    }
  }
  console.log();
}

function tierHint(id: string): string {
  const slug = id.split('/')[1] ?? id;
  if (LOWER_TIER.some((m) => slug.includes(m))) return '  (reads as a tier down)';
  if (SPECIALIST.some((m) => slug.includes(m))) return '  (reads as a specialist variant)';
  return '';
}

function checkNewer(all: CatalogueModel[], catalogue: Map<string, CatalogueModel>) {
  console.log('  Shipped by the same lab since each pin\n');
  let found = 0;

  for (const model of COHORT) {
    const pinned = catalogue.get(model.openrouterId);
    if (!pinned) continue;
    const author = model.openrouterId.split('/')[0];

    const sameLab = all.filter((m) => m.id.split('/')[0] === author && m.id !== model.openrouterId);

    /*
     * Two kinds of noise drown the signal here, and both were in the first run of
     * this script.
     *
     * A colon suffix (`:batch`, `:free`, `:thinking`) is a SERVING VARIANT of a model
     * already listed under its bare id, not a release. And `created` is a timestamp,
     * so every sibling shipped in the same launch as the pin sorts as "newer" by a
     * few minutes — OpenAI's Luna and Terra tiers all landed the same day as Sol.
     * Compare by day, which is also how the freeze comment reasons about ship dates.
     */
    const pinnedDay = day(pinned.created);
    const variants = sameLab.filter((m) => m.id.includes(':') && day(m.created) > pinnedDay).length;
    const sameDay = sameLab.filter((m) => !m.id.includes(':') && day(m.created) === pinnedDay).length;
    const newer = sameLab
      .filter((m) => !m.id.includes(':') && day(m.created) > pinnedDay)
      .sort((a, b) => b.created - a.created);

    const aside =
      [sameDay > 0 ? `${sameDay} same-day sibling(s)` : '', variants > 0 ? `${variants} serving variant(s)` : '']
        .filter(Boolean)
        .join(', ');

    if (newer.length === 0) {
      console.log(
        `    ✓  ${model.lab.padEnd(9)} nothing newer than ${model.openrouterId}` +
          (aside ? `  (${aside} not listed)` : ''),
      );
      continue;
    }

    found += newer.length;
    console.log(
      `    →  ${model.lab.padEnd(9)} ${newer.length} newer than ${model.openrouterId} (${pinnedDay})` +
        (aside ? `, plus ${aside} not listed` : '') +
        ':',
    );
    for (const candidate of newer.slice(0, 6)) {
      console.log(`         ${day(candidate.created)}  ${candidate.id}${tierHint(candidate.id)}`);
      const blurb = (candidate.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 150);
      if (blurb) console.log(`           "${blurb}${blurb.length === 150 ? '…' : ''}"`);
    }
    if (newer.length > 6) console.log(`         … and ${newer.length - 6} more`);
    decisions.push(`${model.lab}: ${newer.length} model(s) newer than the pinned ${model.openrouterId}.`);
  }

  console.log();
  if (found > 0) {
    console.log('    The rule is TOP-TIER GENERALLY AVAILABLE, not newest. A cheaper tier of the');
    console.log('    same generation, an open-weight sibling, or a specialist is correctly declined —');
    console.log('    read the descriptions and decide deliberately. Whatever you decide, write the');
    console.log('    reasoning into the COHORT_FREEZE comment in src/lib/config/league.ts, because');
    console.log('    "whatever was newest when someone looked" is a reaction and not a rule.\n');
  }
}

async function checkSeats(supabase: SupabaseClient, seasonId: string) {
  console.log('  Seats in the database\n');

  const { data: modelRows, error: modelError } = await supabase
    .from('models')
    .select('id, key, openrouter_id, lab, active');
  if (modelError) {
    problems.push(`could not read models: ${modelError.message}`);
    return;
  }
  const models = (modelRows ?? []) as ModelRow[];
  const byId = new Map(models.map((m) => [m.id, m]));

  const { data: teamRows, error: teamError } = await supabase
    .from('teams')
    .select('id, model_id, frozen')
    .eq('season_id', seasonId);
  if (teamError) {
    problems.push(`could not read teams: ${teamError.message}`);
    return;
  }
  const teams = (teamRows ?? []) as { id: string; model_id: string; frozen: boolean }[];

  if (teams.length !== LEAGUE.teams) {
    console.log(`    ✗  ${teams.length} teams for ${SEASON}, expected ${LEAGUE.teams}`);
    problems.push(`the ${SEASON} season has ${teams.length} teams, not ${LEAGUE.teams}.`);
  }

  const seated = new Set<string>();
  for (const team of teams) {
    const model = byId.get(team.model_id);
    if (!model) {
      problems.push(`a ${SEASON} team points at a model row that does not exist.`);
      continue;
    }
    seated.add(model.openrouter_id);
    const inCohort = COHORT.some((c) => c.openrouterId === model.openrouter_id);
    if (!inCohort) {
      console.log(`    ✗  ${model.lab.padEnd(9)} plays ${model.openrouter_id} — NOT IN COHORT`);
      problems.push(
        `a team is seated on ${model.openrouter_id}, which src/lib/config/league.ts no longer lists. ` +
          'This is the silent re-pin failure — see scripts/repin-cohort.ts.',
      );
    } else if (!model.active) {
      console.log(`    ✗  ${model.lab.padEnd(9)} plays ${model.openrouter_id} — row is INACTIVE`);
      problems.push(`${model.openrouter_id} is seated but marked inactive.`);
    } else if (team.frozen) {
      console.log(`    ✗  ${model.lab.padEnd(9)} ${model.openrouter_id} — team is FROZEN`);
      problems.push(`the ${model.lab} team is frozen before the season started.`);
    } else {
      console.log(`    ✓  ${model.lab.padEnd(9)} ${model.openrouter_id}`);
    }
  }

  for (const model of COHORT) {
    if (!seated.has(model.openrouterId)) {
      console.log(`    ✗  ${model.lab.padEnd(9)} ${model.openrouterId} — IN COHORT, NO TEAM PLAYS IT`);
      problems.push(
        `${model.openrouterId} is in COHORT but no ${SEASON} team is seated on it. ` +
          'Run scripts/repin-cohort.ts rather than scripts/seed.ts.',
      );
    }
  }
  console.log();
}

async function main() {
  const supabase = db();
  const today = new Date().toISOString().slice(0, 10);

  const { data: season, error: seasonError } = await supabase
    .from('seasons')
    .select('id')
    .eq('year', SEASON)
    .single();
  if (seasonError) {
    console.error(`\n  REFUSING TO RUN\n  no ${SEASON} season row: ${seasonError.message}\n`);
    process.exit(1);
  }

  const { count: picks } = await supabase
    .from('draft_picks')
    .select('*', { count: 'exact', head: true })
    .eq('season_id', season.id);

  const all = await fetchCatalogue();
  const catalogue = new Map(all.map((m) => [m.id, m]));
  const endsOn = await seasonEnd(supabase);

  console.log(`\n  COHORT CHECK — season ${SEASON}, ${all.length} models in the catalogue\n`);
  freezeWindow(today, picks ?? 0);
  checkPinned(catalogue, endsOn);
  checkNewer(all, catalogue);
  await checkSeats(supabase, season.id);

  if (problems.length > 0) {
    console.log('  MUST BE RESOLVED BEFORE THE DRAFT\n');
    for (const p of problems) console.log(`    ✗ ${p}`);
    console.log();
    process.exit(1);
  }

  if (decisions.length > 0) {
    console.log('  For a human to decide, before scripts/dossier.ts\n');
    for (const d of decisions) console.log(`    → ${d}`);
    console.log('\n  Deciding to keep every seat is a decision, and needs no command.\n');
    return;
  }

  console.log('  The eight pinned models are live, current, and correctly seated.\n');
}

main();
