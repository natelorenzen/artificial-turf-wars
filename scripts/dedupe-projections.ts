/**
 * Collapse duplicate SEASON-LONG projection rows, newest wins.
 *
 *   npx tsx --env-file=.env.local scripts/dedupe-projections.ts --season 2026
 *   npx tsx --env-file=.env.local scripts/dedupe-projections.ts --season 2026 --commit
 *
 * Migration 0008 does the same thing in one SQL statement and adds the index that makes
 * it impossible again. This exists because the two halves have different urgencies: the
 * index needs the SQL editor and a human, the DATA needs fixing before the draft runs,
 * and the draft was days away when this was found.
 *
 * Why the duplicates exist: `unique (player_id, season, week)` does not constrain rows
 * where `week IS NULL`, because in SQL every NULL is distinct. The daily ingest upserted
 * with that as the conflict target, never matched an existing season-long row, and
 * inserted a fresh copy of every player every day.
 *
 * Deliberately NOT delete-everything-then-reinsert, which is what the fixed ingest does.
 * That is correct for a job that has just fetched a full replacement set in memory. Here
 * there is nothing to reinsert from, so a partial failure would leave the draft board
 * short — and a short board is a worse failure than a duplicated one.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { LEAGUE } from '@/lib/config/league';

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
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

interface Row {
  id: string;
  player_id: string;
  created_at: string;
}

async function main() {
  const season = Number(argValue('season') ?? LEAGUE.season);
  const commit = flag('commit');
  const supabase = db();

  // Page it: there are tens of thousands of rows and Supabase caps a select at 1000.
  //
  // Ordered by `id`, which is unique, NOT by `created_at`, which is not. The whole
  // ingest writes in bulk, so thousands of rows share a timestamp to the microsecond;
  // paging on a non-unique key lets rows shuffle between requests, so some are returned
  // twice and others never at all. The first run of this script did exactly that and
  // left 3,914 rows where 3,237 were expected — caught only because the tally at the
  // end compares the two.
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('player_projections')
      .select('id, player_id, created_at')
      .eq('season', season)
      .is('week', null)
      .order('id', { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`read: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...(data as Row[]));
    if (data.length < 1000) break;
  }

  // Rows arrive in id order, so "newest" has to be decided explicitly rather than by
  // position. ADP moves through August; the projections themselves have not.
  const keep = new Map<string, Row>();
  for (const row of rows) {
    const held = keep.get(row.player_id);
    if (!held || row.created_at > held.created_at) keep.set(row.player_id, row);
  }
  const doomed = rows.filter((row) => keep.get(row.player_id)!.id !== row.id).map((row) => row.id);

  console.log(`\n  season ${season} season-long projection rows`);
  console.log(`    total       ${rows.length}`);
  console.log(`    distinct    ${keep.size} players`);
  console.log(`    duplicates  ${doomed.length}`);
  console.log(`    mode        ${commit ? '*** COMMIT — deleting ***' : 'DRY RUN — nothing deleted'}\n`);

  if (doomed.length === 0) {
    console.log('  Nothing to do.\n');
    return;
  }
  if (!commit) {
    console.log('  Re-run with --commit to delete them.\n');
    return;
  }

  let deleted = 0;
  for (let i = 0; i < doomed.length; i += 200) {
    const batch = doomed.slice(i, i + 200);
    const { error } = await supabase.from('player_projections').delete().in('id', batch);
    if (error) throw new Error(`delete: ${error.message}`);
    deleted += batch.length;
  }

  const { count } = await supabase
    .from('player_projections')
    .select('*', { count: 'exact', head: true })
    .eq('season', season)
    .is('week', null);

  console.log(`  Deleted ${deleted}. ${count} season-long rows remain for ${season}.`);
  console.log(`  Expected ${keep.size} — ${count === keep.size ? 'MATCHES' : '*** MISMATCH, investigate'}\n`);
}

main().catch((err) => {
  console.error(`\n  ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
