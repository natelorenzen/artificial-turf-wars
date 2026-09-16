/**
 * Rewrite a weekly column from a fresh facts packet.
 *
 *   npx tsx --env-file=.env.local scripts/rewrite-recap.ts --week 1 --facts   # packet only, no call
 *   npx tsx --env-file=.env.local scripts/rewrite-recap.ts --week 1           # one model call
 *
 * For when the PACKET was wrong or incomplete, not the writer. Written 16 Sept 2026, when
 * lineups began to be judged against the autopilot and week 1's column had been written
 * from a packet that only carried hindsight efficiency.
 *
 * The replaced column is not lost: its decision row keeps the full prompt and raw
 * response, marked `superseded_reason`. The new column is stored as a DRAFT — the
 * byline rule does not bend for a rewrite — so the week shows no column until someone
 * reads it and runs `scripts/publish.ts --recap --week N --release`.
 *
 * The wrap cron is not re-run for this: `job_runs` has already claimed the week, which
 * is exactly the guard that should stop a duplicate delivery from doing what this does
 * on purpose.
 */

import { createClient } from '@supabase/supabase-js';
import { LEAGUE } from '@/lib/config/league';
import { buildWrapFacts, recordRecapDecision, storeRecap, writeRecap } from '@/lib/weekly/wrap';

const SEASON = Number(process.env.SEASON_YEAR ?? LEAGUE.season);

async function main() {
  const weekArg = process.argv.indexOf('--week');
  const week = Number(process.argv[weekArg + 1]);
  if (weekArg < 0 || !Number.isInteger(week)) throw new Error('usage: --week N [--facts]');

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const { data: season } = await db.from('seasons').select('id').eq('year', SEASON).single();
  const seasonId = season!.id as string;

  const facts = await buildWrapFacts(db, { seasonId, season: SEASON, week });
  if (process.argv.includes('--facts')) {
    for (const t of facts.teams) {
      console.log(`  ${t.model.padEnd(22)} calls ${String(t.lineup_calls).padStart(7)}  ${t.lineup_changes.map((c) => `${c.started} over ${c.benched} (${c.points})`).join('; ')}`);
    }
    console.log('\n  best', facts.best_calls, '\n  worst', facts.worst_calls, '\n  decided', facts.decided_by_calls, '\n');
    return;
  }

  const { data: previous } = await db
    .from('recaps')
    .select('decision_id, published')
    .eq('season_id', seasonId)
    .eq('week', week)
    .maybeSingle();

  const result = await writeRecap(facts);
  const decisionId = await recordRecapDecision(db, seasonId, week, result);
  if (!result.recap) throw new Error(`writer returned no usable column: ${result.validationError ?? 'unknown'} — nothing replaced`);

  if (previous?.decision_id) {
    const { error } = await db
      .from('decisions')
      .update({ superseded_reason: `rewritten ${new Date().toISOString().slice(0, 10)} from a facts packet with lineup calls against the autopilot` })
      .eq('id', previous.decision_id);
    if (error) throw new Error(`decisions: ${error.message}`);
  }
  await storeRecap(db, { seasonId, week, result, decisionId });

  console.log(`\n  ${result.recap.headline}\n\n  ${result.recap.short_post}\n\n${result.recap.column_md}\n`);
  console.log(`  number check: ${result.numbers.passed ? 'passed' : `FAILED\n    - ${result.numbers.notes.join('\n    - ')}`}`);
  console.log(`  cost $${result.costUsd.toFixed(4)} · stored as a draft${previous?.published ? ' (the released column is now withdrawn until this is released)' : ''}\n`);
}

main().catch((err) => {
  console.error(`\n  ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
