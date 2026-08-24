/**
 * Compose the draft-completion post for the queue.
 *
 *   npx tsx --env-file=.env.local scripts/compose-draft-post.ts            # dry run
 *   npx tsx --env-file=.env.local scripts/compose-draft-post.ts --commit
 *
 * The numbers come from the database, not from the operator: picks, fallbacks and the
 * true spend across every committed decision. A post announcing a one-shot event should
 * not be able to overstate it because someone typed the wrong figure at midnight.
 *
 * This only ever writes a DRAFT row, held by `composeDraft` on purpose. Releasing it is
 * a separate, deliberate act — see DRAFT-DAY.md.
 */
import { createClient } from '@supabase/supabase-js';
import { LEAGUE } from '@/lib/config/league';
import { composeDraft } from '@/lib/social/compose';
import { upsertDraft } from '@/lib/social/queue';

async function main() {
  const commit = process.argv.includes('--commit');
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const { data: season, error } = await db
    .from('seasons')
    .select('id, draft_completed_at')
    .eq('year', LEAGUE.season)
    .single();
  if (error) throw new Error(`seasons: ${error.message}`);
  if (!season.draft_completed_at) {
    console.error('\n  REFUSING: the draft is not marked complete. Nothing to announce.\n');
    process.exit(1);
  }

  const { data: picks } = await db
    .from('draft_picks')
    .select('decision_id')
    .eq('season_id', season.id);
  const total = LEAGUE.teams * LEAGUE.draftRounds;
  if ((picks ?? []).length !== total) {
    console.error(`\n  REFUSING: ${(picks ?? []).length}/${total} picks. Nothing to announce.\n`);
    process.exit(1);
  }

  // Cost and fallbacks from the decisions that actually produced the board, so a
  // superseded attempt cannot inflate either number.
  const ids = (picks ?? []).map((p) => p.decision_id as string);
  let costUsd = 0;
  let fallbacks = 0;
  for (let i = 0; i < ids.length; i += 50) {
    const { data } = await db
      .from('decisions')
      .select('cost_usd, fallback_applied')
      .in('id', ids.slice(i, i + 50));
    for (const d of data ?? []) {
      costUsd += Number(d.cost_usd ?? 0);
      if (d.fallback_applied) fallbacks++;
    }
  }
  // The auction is part of "the draft" as a reader means it — but only the eight calls
  // that actually assigned slots. Three duplicate auction decisions exist because an
  // operator ran the stage twice; that waste is ours and is reported in the findings
  // post, not folded into what the league cost to draft.
  const { data: teamRows } = await db.from('teams').select('id').eq('season_id', season.id);
  const { data: bids } = await db
    .from('auction_bids')
    .select('decision_id')
    .in('team_id', (teamRows ?? []).map((t) => t.id as string));
  const auctionIds = (bids ?? []).map((b) => b.decision_id as string).filter(Boolean);
  const { data: auction } = await db.from('decisions').select('cost_usd').in('id', auctionIds);
  const auctionCost = (auction ?? []).reduce((a, d) => a + Number(d.cost_usd ?? 0), 0);

  const post = composeDraft({
    season: LEAGUE.season,
    picks: total,
    costUsd: costUsd + auctionCost,
    fallbacks,
  });

  console.log(`\n  DRAFT POST${commit ? '' : '  (dry run)'}\n`);
  console.log(`    kind          ${post.kind}`);
  console.log(`    dedupe key    ${post.dedupeKey}`);
  console.log(`    auto eligible ${post.autoEligible}`);
  console.log(`    hold reason   ${post.holdReason}`);
  console.log(`    est cost      $${post.estCostUsd}`);
  console.log(`    length        ${post.body.length} chars\n`);
  console.log('    ----------------------------------------');
  for (const line of post.body.split('\n')) console.log(`    ${line}`);
  console.log('    ----------------------------------------\n');

  if (!commit) {
    console.log('    Re-run with --commit to queue it as a held draft.\n');
    return;
  }
  const result = await upsertDraft(db, season.id as string, post);
  if (!result) {
    console.log('    A post for this key already left the queue. Nothing written.\n');
    return;
  }
  console.log(`    Queued ${result.updated ? '(updated)' : '(new)'} — id ${result.id}`);
  console.log('    HELD. It does not send until someone sets auto_eligible = true.\n');
}

main();
