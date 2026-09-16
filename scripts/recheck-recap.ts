/**
 * Re-run the deterministic article check on a stored weekly column.
 *
 *   npx tsx --env-file=.env.local scripts/recheck-recap.ts --week 1           # dry run
 *   npx tsx --env-file=.env.local scripts/recheck-recap.ts --week 1 --write   # store it
 *
 * For when the CHECK was wrong, not the article. The column and the facts packet are
 * read exactly as stored — the packet is the one the writer was given — so nothing is
 * rebuilt and no model is called. Only `number_check_passed` / `number_check_notes`
 * change, and only on a draft: a released column's published verdict is not rewritten
 * underneath its readers.
 *
 * Written 16 Sept 2026, when the result check read "beat four teams on all-play, yet
 * still lost to Qwen3.8 Max" as GPT-5.6 Sol beating Qwen3.8 Max.
 */

import { createClient } from '@supabase/supabase-js';
import { LEAGUE } from '@/lib/config/league';
import { checkArticle, type WrapFacts } from '@/lib/weekly/wrap';

const SEASON = Number(process.env.SEASON_YEAR ?? LEAGUE.season);

async function main() {
  const weekArg = process.argv.indexOf('--week');
  const week = Number(process.argv[weekArg + 1]);
  if (weekArg < 0 || !Number.isInteger(week)) throw new Error('usage: --week N [--write]');
  const write = process.argv.includes('--write');

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const { data: season } = await db.from('seasons').select('id').eq('year', SEASON).single();
  const { data: row, error } = await db
    .from('recaps')
    .select('id, headline, short_post, column_md, facts_packet, number_check_passed, number_check_notes, published')
    .eq('season_id', season!.id)
    .eq('week', week)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new Error(`no column stored for week ${week}`);

  const check = checkArticle(
    { headline: row.headline, short_post: row.short_post, column_md: row.column_md },
    row.facts_packet as WrapFacts,
  );

  const show = (passed: boolean, notes: string[]) =>
    `${passed ? 'PASSED' : 'FAILED'}${notes.map((n) => `\n      - ${n}`).join('')}`;
  console.log(`\n  week ${week} column — ${row.published ? 'RELEASED' : 'draft'}`);
  console.log(`    stored:   ${show(row.number_check_passed, row.number_check_notes ?? [])}`);
  console.log(`    re-check: ${show(check.passed, check.notes)}\n`);

  if (!write) {
    console.log('  dry run. Re-run with --write to store the re-check.\n');
    return;
  }
  if (row.published) throw new Error('already released — not rewriting a published verdict');

  const { error: updateError } = await db
    .from('recaps')
    .update({ number_check_passed: check.passed, number_check_notes: check.notes })
    .eq('id', row.id);
  if (updateError) throw new Error(updateError.message);
  console.log('  stored.\n');
}

main().catch((err) => {
  console.error(`\n  ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
