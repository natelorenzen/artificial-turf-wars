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
  'job_runs', // 0003
  'social_posts', // 0007
  'playoff_seeds', // 0009
  'preseason_stats', // 0010
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
    // A missing table does NOT come back as an error here. PostgREST answers a
    // head-only count for an unknown relation with no error and a null count, so
    // testing `error` alone reported an entirely unapplied schema as fully present
    // — the exact failure this script exists to catch. A real empty table counts 0.
    if (error || count === null) missing.push(table);
    else rows[table] = count;
  }

  console.log(`Schema: ${TABLES.length - missing.length}/${TABLES.length} tables present`);
  if (missing.length > 0) {
    console.log(`\n  MISSING: ${missing.join(', ')}`);
    console.log('\n  Apply the migrations in supabase/migrations/, in order, in the Supabase SQL editor.');
    process.exitCode = 1;
    return;
  }

  const populated = Object.entries(rows).filter(([, n]) => n > 0);
  console.log(
    populated.length > 0
      ? `  rows: ${populated.map(([t, n]) => `${t}=${n}`).join(', ')}`
      : '  all tables empty',
  );

  // Does the ingested data actually look like a draftable board?
  if ((rows.player_projections ?? 0) > 0) {
    const season = Number(process.env.SEASON_YEAR ?? '2026');
    console.log(`\nTop projected players, ${season} (our scoring):`);
    for (const position of ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']) {
      const { data } = await admin
        .from('player_projections')
        .select('proj_pts, adp, players!inner(name, position)')
        .eq('season', season)
        .is('week', null)
        .eq('players.position', position)
        .order('proj_pts', { ascending: false })
        .limit(3);

      const top = (data ?? []).map((r) => {
        const player = r.players as unknown as { name: string };
        return `${player.name} ${Number(r.proj_pts).toFixed(1)}${r.adp ? ` (adp ${r.adp})` : ''}`;
      });
      console.log(`  ${position.padEnd(4)} ${top.join('  |  ') || '—'}`);
    }
  }

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
