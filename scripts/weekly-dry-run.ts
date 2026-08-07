/**
 * The weekly cycle, rehearsed against real data, with no model called and nothing
 * written.
 *
 *   npx tsx --env-file=.env.local scripts/weekly-dry-run.ts --status
 *   npx tsx --env-file=.env.local scripts/weekly-dry-run.ts --season 2025 --week 5
 *
 * Every bug found on 4-5 August was found by running something, not by reading it: the
 * `CCRON_SECRET` typo, the 300s ceiling, and the seven projection queries missing a
 * week filter were all invisible until code executed. This is the cheapest possible
 * version of running the weekly jobs — it does everything the Tuesday and Thursday
 * routes do right up to the point where money is spent, then prints what it built.
 *
 * What it actually proves:
 *   - every query in the weekly path returns what the code expects, against real rows;
 *   - the base DATA block is identical for all eight and each overlay replays;
 *   - nothing in either block leaks a lab or model name;
 *   - the assembled prompt fits under the shared context ceiling for every team.
 *
 * What it cannot prove is what a model does with it. That needs the real run.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { COHORT, LEAGUE } from '@/lib/config/league';
import { assemblePrompt } from '@/lib/prompt/assemble';
import { REQUIRED_SLACK_HOURS } from '@/lib/cron/guard';
import { LINEUP_FIRINGS, WEEKEND_GUIDE_FIRINGS } from '@/lib/cron/upcoming';
import { assertNoLabelLeak } from '@/lib/engine/labels';
import { buildWeeklyContext, type WeeklyContext } from '@/lib/weekly/context';
import { assertLineupContexts, buildLineupContext, deterministicLineup, lineupRoster } from '@/lib/weekly/lineups';
import { assertWaiverContexts, buildWaiverContext, loadFreeAgents } from '@/lib/weekly/waivers';
import { buildWrapFacts } from '@/lib/weekly/wrap';

const FORBIDDEN_NAMES = [...COHORT.map((m) => m.displayName), ...COHORT.map((m) => m.lab)];

function db(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

const flag = (name: string) => process.argv.includes(`--${name}`);

function argValue(name: string): string | null {
  const exact = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (exact) return exact.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

function fail(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// --status
// ---------------------------------------------------------------------------

async function stageStatus() {
  const supabase = db();
  const { data: seasons, error } = await supabase.from('seasons').select('id, year').order('year');
  if (error) fail(`seasons: ${error.message}`);

  console.log('\n  season  teams  slots  picks  sched  rosters  lineups  standings  bids');
  for (const season of seasons ?? []) {
    const { data: teams } = await supabase
      .from('teams')
      .select('id, draft_slot')
      .eq('season_id', season.id);
    const ids = (teams ?? []).map((t) => t.id as string);

    const bySeason = async (table: string) =>
      (await supabase.from(table).select('*', { count: 'exact', head: true }).eq('season_id', season.id)).count ?? 0;
    const byTeam = async (table: string) =>
      ids.length === 0
        ? 0
        : ((await supabase.from(table).select('*', { count: 'exact', head: true }).in('team_id', ids)).count ?? 0);

    console.log(
      `  ${String(season.year).padStart(6)}  ${String(teams?.length ?? 0).padStart(5)}  ` +
        `${String((teams ?? []).filter((t) => t.draft_slot !== null).length).padStart(5)}  ` +
        `${String(await bySeason('draft_picks')).padStart(5)}  ${String(await bySeason('h2h_schedule')).padStart(5)}  ` +
        `${String(await byTeam('rosters')).padStart(7)}  ${String(await byTeam('lineups')).padStart(7)}  ` +
        `${String(await byTeam('standings')).padStart(9)}  ${String(await byTeam('waiver_bids')).padStart(4)}`,
    );
  }

  // Migrations are applied by hand in the Supabase SQL editor, so "is the schema what
  // this code expects" is a real question with a real answer, not a formality.
  console.log('\n  schema');
  for (const [table, column] of [
    ['job_runs', 'id'],
    ['weekend_guides', 'sections'],
    ['recaps', 'published'],
  ] as const) {
    const { error: probe } = await supabase.from(table).select(column).limit(1);
    console.log(`    ${table}.${column.padEnd(10)} ${probe ? `MISSING — ${probe.message}` : 'present'}`);
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// --crons — does every forward-looking job still clear its week's first kickoff?
// ---------------------------------------------------------------------------

/**
 * The jobs that MUST complete before a week starts, and when they fire in UTC.
 *
 * Only forward-looking jobs are listed. The scoring jobs and the wrap look backwards at
 * a week already played and cannot be too late for it.
 */
const FORWARD_JOBS: { job: string; firings: { dow: number; hour: number }[] }[] = [
  { job: 'waiver-bids', firings: [{ dow: 2, hour: 16 }] },
  { job: 'waiver-resolve', firings: [{ dow: 3, hour: 16 }] },
  // Two entries, and the job stands down on the earlier one whenever the later still
  // clears — so the slack reported here is the LATEST firing that would actually run.
  { job: 'lineups', firings: LINEUP_FIRINGS },
  { job: 'weekend-guide', firings: WEEKEND_GUIDE_FIRINGS },
];

/**
 * Vercel Hobby fires anywhere inside the specified hour, so a job scheduled at 16:00
 * may not start until 16:59. The margin has to be measured from the LATEST possible
 * start, not the nominal one — measuring from 16:00 would report an hour of slack the
 * job might never have.
 */
const HOBBY_JITTER_HOURS = 59 / 60;

/** The last firing of a weekly UTC schedule strictly before `before`. */
function lastFiringBefore(before: Date, dow: number, hour: number): Date {
  const fire = new Date(before);
  fire.setUTCHours(hour, 0, 0, 0);
  while (fire.getUTCDay() !== dow || fire >= before) {
    fire.setUTCDate(fire.getUTCDate() - 1);
    fire.setUTCHours(hour, 0, 0, 0);
  }
  return fire;
}

async function stageCrons(season: number) {
  const supabase = db();
  const { data, error } = await supabase
    .from('nfl_games')
    .select('week, kickoff_at')
    .eq('season', season)
    .eq('season_type', 'regular')
    .lte('week', LEAGUE.regularSeasonWeeks)
    .not('kickoff_at', 'is', null)
    .order('kickoff_at', { ascending: true });
  if (error) fail(`nfl_games: ${error.message}`);

  const firstOf = new Map<number, Date>();
  for (const row of data ?? []) {
    const week = row.week as number;
    if (!firstOf.has(week)) firstOf.set(week, new Date(row.kickoff_at as string));
  }
  if (firstOf.size === 0) fail(`no ${season} schedule ingested — run the ingest first.`);

  console.log(`\n  CRON SLACK — season ${season}, ${REQUIRED_SLACK_HOURS}h required`);
  console.log(`  Worst-case start assumed, i.e. ${Math.round(HOBBY_JITTER_HOURS * 60)} min into the scheduled hour (Vercel Hobby).\n`);
  console.log('  wk  first kickoff (UTC)   ET     waiver-bids  waiver-resolve  lineups  weekend-guide');

  const failures: string[] = [];

  for (const week of [...firstOf.keys()].sort((a, b) => a - b)) {
    const kickoff = firstOf.get(week)!;
    const et = kickoff.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    const cells: string[] = [];
    for (const { job, firings } of FORWARD_JOBS) {
      // The firing that actually does the work: the latest one before kickoff.
      const fire = firings
        .map((f) => lastFiringBefore(kickoff, f.dow, f.hour))
        .sort((a, b) => b.getTime() - a.getTime())[0];
      const slack = (kickoff.getTime() - fire.getTime()) / 3_600_000 - HOBBY_JITTER_HOURS;
      const ok = slack >= REQUIRED_SLACK_HOURS;
      cells.push(`${ok ? ' ' : '!'}${slack.toFixed(1)}h`);
      if (!ok) {
        failures.push(
          `week ${week}: ${job} has ${slack.toFixed(1)}h before a ${et} kickoff — the guard will REFUSE and the job will not run`,
        );
      }
    }

    console.log(
      `  ${String(week).padStart(2)}  ${kickoff.toISOString().slice(0, 16).replace('T', ' ')}      ` +
        `${et.padEnd(10)} ${cells.map((c) => c.padStart(8)).join('  ')}`,
    );
  }

  console.log('');
  if (failures.length === 0) {
    console.log('  Every forward-looking job clears its week with margin to spare.\n');
    return;
  }
  for (const line of failures) console.log(`  ✗ ${line}`);
  console.log('');
}

// ---------------------------------------------------------------------------
// The weekly rehearsal
// ---------------------------------------------------------------------------

async function stageWeek(season: number, week: number) {
  const supabase = db();

  const { data: seasonRow, error } = await supabase
    .from('seasons')
    .select('id')
    .eq('year', season)
    .single();
  if (error) fail(`no season row for ${season}: ${error.message}`);
  const seasonId = seasonRow.id as string;

  console.log(`\n  WEEKLY DRY RUN — season ${season}, week ${week}. No model calls, no writes.\n`);

  // --- Thursday: lineups ---------------------------------------------------
  const context = await buildWeeklyContext(supabase, { seasonId, season, week, memoryType: 'lineup' });
  reportContext(context);

  assertLineupContexts(context);
  console.log('\n  LINEUPS');
  reportBlocks(
    context,
    (teamId) => buildLineupContext(context, teamId).data,
    'Set your starting lineup for this week.',
  );

  const emptied = context.teams.filter((team) => {
    const lineup = deterministicLineup(lineupRoster(context.rosters.get(team.teamId) ?? []));
    return [lineup.qb, lineup.te, lineup.flex, lineup.k, lineup.def, ...lineup.rb, ...lineup.wr].some((id) => !id);
  });
  console.log(
    `    fallback lineup  legal and complete for ${context.teams.length - emptied.length}/${context.teams.length} teams` +
      (emptied.length > 0 ? ` — ${emptied.map((t) => t.label).join(', ')} would start an empty slot` : ''),
  );

  // --- Tuesday: waivers ----------------------------------------------------
  const waiverContext = await buildWeeklyContext(supabase, {
    seasonId,
    season,
    week,
    memoryType: 'waiver',
  });
  const freeAgents = await loadFreeAgents(supabase, waiverContext);
  const input = { context: waiverContext, freeAgents, bidWeek: week - 1 };
  assertWaiverContexts(input);

  console.log('\n  WAIVERS');
  console.log(`    free agents      ${freeAgents.length}`);
  console.log(
    `    by position      ${['QB', 'RB', 'WR', 'TE', 'K', 'DEF']
      .map((p) => `${p} ${freeAgents.filter((f) => f.position === p).length}`)
      .join('  ')}`,
  );
  reportBlocks(waiverContext, (teamId) => buildWaiverContext(input, teamId).data, 'Submit your sealed FAAB claims.');

  // --- Tuesday: the wrap ---------------------------------------------------
  console.log('\n  WRAP');
  const facts = await buildWrapFacts(supabase, { seasonId, season, week: week - 1 });
  if (facts.teams.length === 0) {
    console.log(`    week ${week - 1} has no scored lineups — nothing to write about.`);
  } else {
    console.log(`    facts packet     ${facts.teams.length} teams, ${JSON.stringify(facts).length} chars`);
    console.log(`    scoring status   ${facts.scoring_status}`);
    console.log(`    high / low       ${facts.high_score?.model} ${facts.high_score?.points} / ${facts.low_score?.model} ${facts.low_score?.points}`);
    for (const note of facts.luck) console.log(`    luck             ${note.model} ${note.note}`);
  }

  console.log('\n  All assertions passed. Nothing was called and nothing was written.\n');
}

function reportContext(context: WeeklyContext) {
  const rostered = [...context.rosters.values()];
  const projected = rostered.flat().filter((p) => p.projection !== null).length;

  console.log('  CONTEXT');
  console.log(`    teams            ${context.teams.length}, labels ${[...context.labels.values()].join(' ')}`);
  console.log(`    rosters          ${rostered.reduce((n, list) => n + list.length, 0)} players, ${projected} with a week-${context.week} projection`);
  console.log(`    byes             ${context.byeTeams.length === 0 ? 'none' : context.byeTeams.join(' ')}`);
  console.log(`    standings        through week ${context.throughWeek}`);
  console.log(`    opponents        ${[...context.opponentOf.values()].filter(Boolean).length}/${context.teams.length} teams have a fixture`);

  const noProjection = rostered.flat().filter((p) => p.projection === null && !p.is_on_bye);
  if (noProjection.length > 0) {
    // Not fatal — the DATA RULE covers null — but a large number here means the weekly
    // projection ingest did not run for this week, which is worth knowing before a
    // model is asked to reason from it.
    console.log(`    NOTE             ${noProjection.length} rostered players have no projection and are not on bye`);
  }
}

function reportBlocks(
  context: WeeklyContext,
  build: (teamId: string) => unknown,
  task: string,
) {
  let maxTokens = 0;
  let maxChars = 0;

  for (const team of context.teams) {
    const data = build(team.teamId);
    const serialized = JSON.stringify(data);
    assertNoLabelLeak(serialized, FORBIDDEN_NAMES);

    const prompt = assemblePrompt({
      data,
      memoryBlock: context.memoryBlocks.get(team.teamId),
      task,
      outputExample: {},
    });
    maxTokens = Math.max(maxTokens, prompt.estimatedTokens);
    maxChars = Math.max(maxChars, serialized.length);
  }

  console.log(`    DATA size        up to ${maxChars} chars`);
  console.log(`    prompt tokens    up to ~${maxTokens} of the ${LEAGUE.contextCeilingTokens} ceiling`);
  console.log(`    label leak       none (checked against ${FORBIDDEN_NAMES.length} lab and model names)`);
  console.log(`    context claim    base identical across all ${context.teams.length}, every overlay replays`);
}

// ---------------------------------------------------------------------------

async function main() {
  if (flag('status')) return stageStatus();

  const season = Number(argValue('season') ?? LEAGUE.season);
  if (flag('crons')) return stageCrons(season);

  const week = Number(argValue('week') ?? '1');
  if (!Number.isInteger(season) || !Number.isInteger(week) || week < 1) {
    fail('usage: --status, --crons, or --season <year> --week <n>');
  }
  return stageWeek(season, week);
}

main().catch((err) => {
  console.error(`\n  ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
