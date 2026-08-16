/**
 * Build, hash, and store the shared pre-season dossier (SPEC §4.1b Step 1).
 *
 *   npx tsx --env-file=.env.local scripts/dossier.ts            # 2026, stores it
 *   npx tsx --env-file=.env.local scripts/dossier.ts --season 2025 --dry-run
 */
import { createClient } from '@supabase/supabase-js';
import { buildDossier } from '@/lib/preseason/dossier';

async function main() {
  const i = process.argv.indexOf('--season');
  const season = Number(i >= 0 ? process.argv[i + 1] : (process.env.SEASON_YEAR ?? '2026'));
  const dryRun = process.argv.includes('--dry-run');

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { dossier, hash, tokenCount, withPreseason } = await buildDossier(db, { season });

  const injured = dossier.players.filter((p) => p.injury_status).length;

  console.log(`Dossier for ${season}`);
  console.log(`  players       ${dossier.players.length}`);
  console.log(`  preseason     ${withPreseason} of ${dossier.players.length} carry a preseason line`);
  console.log(`  injury flags  ${injured}`);
  console.log(`  tokens        ~${tokenCount.toLocaleString()} (ceiling 150,000)`);
  console.log(`  hash          ${hash}`);

  // Loud, because a dossier with no preseason coverage is indistinguishable from a
  // good one once it is stored, and the draft reads whatever is stored.
  if (withPreseason === 0) {
    console.log('\n  WARNING: not one player has a preseason line.');
    console.log('  If this is the live season, the preseason ingest has not run:');
    console.log(`    npm run ingest -- --preseason-stats --season ${season}`);
  }
  console.log('\n  Positional scarcity — the number the backtest showed was missing:\n');
  console.log('    pos   best   replacement (rank)   spread over replacement');
  for (const c of dossier.scarcity_curves) {
    console.log(
      `    ${c.position.padEnd(5)} ${c.points_by_rank[0].proj_season_points.toFixed(1).padStart(6)}` +
      `   ${c.replacement_points.toFixed(1).padStart(6)} (${String(c.replacement_rank).padStart(2)})` +
      `        ${c.spread_over_replacement.toFixed(1).padStart(6)}`,
    );
  }

  if (dryRun) { console.log('\n  dry run — nothing stored'); return; }

  const { data: seasonRow, error } = await db.from('seasons').select('id').eq('year', season).single();
  if (error) throw new Error(`season ${season}: ${error.message}`);

  const { error: insertError } = await db.from('dossiers').insert({
    season_id: seasonRow.id, content: dossier as unknown as Record<string, unknown>,
    content_hash: hash, token_count: tokenCount,
  });
  if (insertError) throw new Error(`dossiers: ${insertError.message}`);
  console.log('\n  stored.');
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
