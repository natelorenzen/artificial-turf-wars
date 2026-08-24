/**
 * Mark decisions that are retained as record but must not be counted.
 *
 *   npx tsx --env-file=.env.local scripts/mark-superseded.ts            # dry run
 *   npx tsx --env-file=.env.local scripts/mark-superseded.ts --commit
 *
 * Requires migration 0011.
 *
 * A decision is LIVE if something in the league points at it — a draft pick or an
 * auction bid. Everything else of those two types is an attempt that did not become
 * part of the season. Derived from the references rather than from a hand-kept list,
 * so it cannot drift and can be re-run safely.
 *
 * It never touches rules_check, gameplan, lineup, waiver or recap decisions, and it
 * never marks a row that IS referenced. A model that genuinely failed keeps its row
 * counted — that is the finding, not an embarrassment to be tidied away.
 */
import { createClient } from '@supabase/supabase-js';
import { LEAGUE } from '@/lib/config/league';

async function main() {
  const commit = process.argv.includes('--commit');
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const { data: season } = await db.from('seasons').select('id').eq('year', LEAGUE.season).single();
  const seasonId = season!.id as string;

  const { data: teamRows } = await db.from('teams').select('id').eq('season_id', seasonId);
  const teamIds = (teamRows ?? []).map((t) => t.id as string);

  const { data: picks } = await db.from('draft_picks').select('decision_id').eq('season_id', seasonId);
  const { data: bids } = await db.from('auction_bids').select('decision_id').in('team_id', teamIds);
  const live = new Set([...(picks ?? []), ...(bids ?? [])].map((r) => r.decision_id as string).filter(Boolean));

  const { data: all, error: readError } = await db
    .from('decisions')
    .select('id, type, pick_overall, model_id, valid, fallback_applied, provider_failure, superseded_reason, created_at')
    .eq('season_id', seasonId)
    .in('type', ['auction', 'draft_pick'])
    .order('created_at');
  /*
   * Checked, and loudly. Selecting a column that does not exist returns an ERROR and a
   * null `data`, which reads downstream as "no decisions to mark" — a script that
   * reports success having done nothing. That failure shape has cost this project real
   * time before, and it cost it again writing this file: the first run printed
   * "0 decisions, 0 to mark" against a season holding 151, because migration 0011 had
   * not been applied yet.
   */
  if (readError) {
    console.error(
      `\n  REFUSING TO RUN\n  decisions read: ${readError.message}\n` +
        '  If this mentions `superseded_reason`, migration 0011 has not been applied.\n' +
        '  Apply supabase/migrations/0011_superseded_decisions.sql, then re-run.\n',
    );
    process.exit(1);
  }
  if ((all ?? []).length === 0) {
    console.error('\n  REFUSING TO RUN\n  no auction or draft_pick decisions found — that cannot be right.\n');
    process.exit(1);
  }
  const { data: models } = await db.from('models').select('id, display_name');
  const name = new Map((models ?? []).map((m) => [m.id as string, m.display_name as string]));

  const orphans = (all ?? []).filter((d) => !live.has(d.id as string));
  console.log(`\n  SUPERSEDED DECISIONS${commit ? '' : '  (dry run)'}\n`);
  console.log(`    ${(all ?? []).length} auction + draft_pick decisions, ${live.size} referenced by the league`);
  console.log(`    ${orphans.length} to mark\n`);

  for (const d of orphans) {
    /*
     * A superseded decision that was VALID is a different statement from one that
     * failed, and these strings are published. Pick 5 is the case: GPT-5.6 Sol answered
     * it perfectly well, and it was re-run only because correcting pick 4 changed the
     * board it had been answering. Filing that under "a defect" would read as Sol
     * having done something wrong.
     */
    const reason =
      d.type === 'auction'
        ? 'duplicate run of the auction stage — the league used the other response'
        : d.valid
          ? `pick ${d.pick_overall} was re-run because correcting an earlier pick changed the board this answered — the response itself was valid`
          : `pick ${d.pick_overall} was re-run after a defect in our own code; this attempt did not become the pick`;
    const already = d.superseded_reason ? '  [already marked]' : '';
    console.log(`    ${String(d.type).padEnd(11)} ${String(d.pick_overall ?? '—').padStart(3)}  ${String(name.get(d.model_id as string)).padEnd(21)}${already}`);
    console.log(`      → ${reason}`);
    if (commit && !d.superseded_reason) {
      const { error } = await db.from('decisions').update({ superseded_reason: reason }).eq('id', d.id);
      if (error) throw new Error(`decisions ${d.id}: ${error.message}`);
    }
  }

  if (!commit) {
    console.log('\n    Re-run with --commit to write.\n');
    return;
  }
  const { count } = await db
    .from('decisions')
    .select('*', { count: 'exact', head: true })
    .eq('season_id', seasonId)
    .not('superseded_reason', 'is', null);
  console.log(`\n    ✓ ${count} decisions marked. They stay published; they stop counting.\n`);
}

main();
