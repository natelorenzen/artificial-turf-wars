/**
 * Releasing a byline piece — the weekend guide and the weekly column.
 *
 *   npx tsx --env-file=.env.local scripts/publish.ts                        # what is waiting
 *   npx tsx --env-file=.env.local scripts/publish.ts --guide --week 1       # read it
 *   npx tsx --env-file=.env.local scripts/publish.ts --guide --week 1 --release
 *   npx tsx --env-file=.env.local scripts/publish.ts --recap --week 1 --release
 *   npx tsx --env-file=.env.local scripts/publish.ts --recap --week 1 --retract
 *
 * Two things in this league stay human on purpose, and both are bylines: the weekly
 * column and the weekend guide. Nothing that affects a RESULT waits on a person;
 * everything that makes a factual claim under a byline does. The cron jobs write
 * drafts at `published = false` and stop there.
 *
 * That was the design from the start and it had no implementation. There was no
 * script, no flag and no documented SQL — the release was a hand-written UPDATE in
 * the Supabase editor that nobody had written down, on the one step that stands
 * between a model's prose and the public. This is that step, with the article printed
 * in full first, because the whole reason a human holds this flag is to read the
 * thing before it goes out.
 *
 * The number check is deterministic and it can only flag a bad figure, never fix one.
 * A column that failed it needs `--despite-check`, so releasing one is a decision
 * somebody typed rather than a default they did not notice.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { LEAGUE } from '@/lib/config/league';
import { LAST_LEAGUE_WEEK } from '@/lib/engine/bracket';

const SEASON = Number(process.env.SEASON_YEAR ?? LEAGUE.season);

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

/** `recaps` gained `published_at` in migration 0006; `weekend_guides` never had one. */
const KIND = {
  guide: { table: 'weekend_guides', label: 'weekend guide', stamped: false },
  recap: { table: 'recaps', label: 'weekly column', stamped: true },
} as const;

type Kind = keyof typeof KIND;

async function seasonId(supabase: SupabaseClient): Promise<string> {
  const { data } = await supabase.from('seasons').select('id').eq('year', SEASON).maybeSingle();
  if (!data?.id) fail(`no season row for ${SEASON}`);
  return data.id as string;
}

// ---------------------------------------------------------------------------
// What is waiting
// ---------------------------------------------------------------------------

async function list(supabase: SupabaseClient, id: string): Promise<void> {
  console.log(`\n  DRAFTS AND RELEASES — season ${SEASON}\n`);

  const { data: guides, error: gErr } = await supabase
    .from('weekend_guides')
    .select('week, headline, published, created_at')
    .eq('season_id', id)
    .order('week');
  if (gErr) fail(`weekend_guides: ${gErr.message}`);

  console.log('  weekend guides');
  if (!guides?.length) console.log('    none written yet');
  for (const row of guides ?? []) {
    const state = row.published ? 'PUBLISHED' : 'draft    ';
    console.log(`    wk ${String(row.week).padStart(2)}  ${state}  ${String(row.headline).slice(0, 62)}`);
  }

  const { data: recaps, error: rErr } = await supabase
    .from('recaps')
    .select('week, headline, published, number_check_passed, number_check_notes, created_at')
    .eq('season_id', id)
    .order('week');
  if (rErr) fail(`recaps: ${rErr.message}`);

  console.log('\n  weekly columns');
  if (!recaps?.length) console.log('    none written yet');
  for (const row of recaps ?? []) {
    const state = row.published ? 'PUBLISHED' : 'draft    ';
    const check = row.number_check_passed ? '' : `  ← number check FAILED (${(row.number_check_notes ?? []).length} notes)`;
    console.log(`    wk ${String(row.week).padStart(2)}  ${state}  ${String(row.headline).slice(0, 62)}${check}`);
  }

  const waiting =
    (guides ?? []).filter((r) => !r.published).length + (recaps ?? []).filter((r) => !r.published).length;
  console.log(
    waiting === 0
      ? '\n  Nothing is waiting on a human.\n'
      : `\n  ${waiting} draft${waiting === 1 ? '' : 's'} waiting. Read one with --guide|--recap --week N.\n`,
  );
}

// ---------------------------------------------------------------------------
// One piece
// ---------------------------------------------------------------------------

async function one(supabase: SupabaseClient, id: string, kind: Kind, week: number): Promise<void> {
  const { table, label, stamped } = KIND[kind];
  const columns =
    kind === 'recap'
      ? 'week, headline, short_post, column_md, published, number_check_passed, number_check_notes, created_at'
      : 'week, headline, standfirst, column_md, published, game_keys, created_at';

  const { data: row, error } = await supabase
    .from(table)
    .select(columns)
    .eq('season_id', id)
    .eq('week', week)
    .maybeSingle<Record<string, unknown>>();
  if (error) fail(`${table}: ${error.message}`);
  if (!row) fail(`no ${label} stored for ${SEASON} week ${week}. The cron job writes it; this only releases it.`);

  const published = Boolean(row.published);
  const checkPassed = kind === 'recap' ? Boolean(row.number_check_passed) : true;
  const notes = (row.number_check_notes ?? []) as string[];

  console.log(`\n  ${label.toUpperCase()} — season ${SEASON}, week ${week}`);
  console.log(`  written ${String(row.created_at).slice(0, 16)}, currently ${published ? 'PUBLISHED' : 'a draft'}\n`);
  console.log(`  ${row.headline}`);
  if (row.standfirst) console.log(`  ${row.standfirst}`);
  if (row.short_post) console.log(`\n  short post:\n    ${String(row.short_post).replace(/\n/g, '\n    ')}`);
  console.log('\n  ---\n');
  console.log(String(row.column_md).replace(/^/gm, '  '));
  console.log('\n  ---\n');

  if (kind === 'recap') {
    console.log(
      checkPassed
        ? '  Number check: passed — every figure was found in the facts packet.'
        : `  Number check: FAILED, ${notes.length} note${notes.length === 1 ? '' : 's'}:`,
    );
    for (const note of notes) console.log(`    - ${note}`);
    console.log('');
  }

  if (flag('retract')) {
    if (!published) fail('already a draft — nothing to retract.');
    await setPublished(supabase, table, id, week, false, stamped);
    console.log(`  Retracted. The ${label} for week ${week} is a draft again and off the site.\n`);
    return;
  }

  if (!flag('release')) {
    console.log(
      published
        ? '  Already published. Re-run with --retract to pull it.\n'
        : '  Read it. Then re-run with --release to publish it.\n',
    );
    return;
  }

  if (published) {
    console.log(`  Already published — nothing to do.\n`);
    return;
  }

  // The one refusal. A failed number check is exactly the case where a human reading
  // it matters most, so it must not be releasable by the same keystroke as a clean one.
  if (!checkPassed && !flag('despite-check')) {
    fail(
      `the week ${week} column did not pass its number check. Read the notes above. ` +
        'Release it anyway with --despite-check, which is a decision, not a default.',
    );
  }

  await setPublished(supabase, table, id, week, true, stamped);
  console.log(`  Published. The ${label} for week ${week} is live${checkPassed ? '' : ' DESPITE a failed number check'}.\n`);
}

async function setPublished(
  supabase: SupabaseClient,
  table: string,
  id: string,
  week: number,
  published: boolean,
  stamped: boolean,
): Promise<void> {
  const patch: Record<string, unknown> = { published };
  if (stamped) patch.published_at = published ? new Date().toISOString() : null;

  const { error } = await supabase.from(table).update(patch).eq('season_id', id).eq('week', week);
  if (error) fail(`${table}: ${error.message}`);
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const supabase = db();
  const id = await seasonId(supabase);

  const kinds = (['guide', 'recap'] as Kind[]).filter((k) => flag(k));
  if (kinds.length === 0) {
    if (flag('release') || flag('retract')) fail('say which: --guide or --recap.');
    await list(supabase, id);
    return;
  }
  if (kinds.length > 1) fail('one at a time: --guide or --recap, not both.');

  const weekArg = argValue('week');
  const week = Number(weekArg);
  if (!weekArg || !Number.isInteger(week) || week < 1 || week > LAST_LEAGUE_WEEK) {
    fail(`--week must be 1..${LAST_LEAGUE_WEEK}, got "${weekArg ?? ''}"`);
  }
  if (flag('release') && flag('retract')) fail('--release and --retract are opposites.');

  await one(supabase, id, kinds[0], week);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
