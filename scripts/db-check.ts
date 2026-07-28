/**
 * Verify the Supabase schema is applied and reachable.
 *
 *   npx tsx --env-file=.env.local scripts/db-check.ts
 *
 * Checks every table the migration creates, and separately confirms that RLS is
 * doing its job: the anon key must be able to READ and must NOT be able to WRITE.
 * That second check is the one worth having — an anon key that can write would be a
 * silent, total compromise of the audit trail, since anyone could rewrite history.
 */

import { createClient } from '@supabase/supabase-js';

const TABLES = [
  'models', 'seasons', 'teams', 'decisions', 'dossiers', 'rules_checks', 'gameplans',
  'auction_bids', 'plan_adherence', 'snapshots', 'players', 'player_projections',
  'player_stats', 'stat_corrections', 'nfl_games', 'team_byes', 'draft_picks',
  'rosters', 'lineups', 'lineup_scores', 'waiver_bids', 'h2h_schedule', 'standings',
  'move_evaluations', 'win_prob', 'allplay_proj', 'pos_strength', 'recaps',
];

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !serviceKey || !anonKey) {
    console.error('Missing Supabase env vars. Check .env.local.');
    process.exit(1);
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });

  const missing: string[] = [];
  const rows: Record<string, number> = {};

  for (const table of TABLES) {
    const { error, count } = await admin.from(table).select('*', { count: 'exact', head: true });
    if (error) missing.push(table);
    else rows[table] = count ?? 0;
  }

  console.log(`Schema: ${TABLES.length - missing.length}/${TABLES.length} tables present`);
  if (missing.length > 0) {
    console.log(`\n  MISSING: ${missing.join(', ')}`);
    console.log('\n  Apply supabase/migrations/0001_init.sql in the Supabase SQL editor.');
    process.exitCode = 1;
    return;
  }

  const populated = Object.entries(rows).filter(([, n]) => n > 0);
  console.log(
    populated.length > 0
      ? `  rows: ${populated.map(([t, n]) => `${t}=${n}`).join(', ')}`
      : '  all tables empty',
  );

  // RLS: anon reads, anon never writes.
  const { error: readError } = await anon.from('models').select('id').limit(1);
  console.log(`\nRLS anon read:  ${readError ? `BLOCKED — ${readError.message}` : 'allowed (correct)'}`);

  const { error: writeError } = await anon
    .from('models')
    .insert({ key: '__rls_probe__', display_name: 'probe', openrouter_id: 'probe', lab: 'probe', context_window: 1, price_in: 0 });

  if (writeError) {
    console.log('RLS anon write: BLOCKED (correct)');
  } else {
    console.log('RLS anon write: *** ALLOWED — THIS IS A SECURITY HOLE ***');
    console.log('  The anon key can write. Anyone could rewrite the audit trail.');
    await admin.from('models').delete().eq('key', '__rls_probe__');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
