/**
 * Snapshot the completed draft to `content/data/`, in git.
 *
 *   npx tsx --env-file=.env.local scripts/export-draft.ts
 *
 * The database is the record and this is not a replacement for it. It exists because the
 * draft is a ONE-SHOT event that cannot be re-run: if the database were lost, restored to
 * an earlier point, or simply became unreachable, nothing else on disk would say who
 * drafted whom or why. A committed snapshot means the board survives in a second place,
 * with an immutable public history, on the same argument the findings posts are markdown.
 *
 * What is included: everything needed to reconstruct the board and check the claims made
 * about it — picks, reasoning, per-decision telemetry, the auction, the seed and its
 * commitment, and every superseded decision with the reason it was superseded.
 *
 * What is NOT included: the full prompts. Each is ~24,000 characters and all 120 share one
 * dossier hash, so they are reproducible from the stored dossier and would add megabytes
 * of near-identical text. The hashes are here to prove which prompt each pick answered.
 *
 * The one exception is the raw response of a SUPERSEDED decision, which is small and is
 * the actual evidence — a truncated answer is only checkable if you can read where it
 * stopped.
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LEAGUE } from '@/lib/config/league';

/** A function DECLARATION, not an arrow const: TypeScript only narrows through the
 *  former, so `fail()` above a use of `season` actually convinces it. */
function fail(m: string): never {
  console.error(`\n  REFUSING TO RUN\n  ${m}\n`);
  process.exit(1);
}

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const { data: season, error: sErr } = await db
    .from('seasons')
    .select('id, year, rulebook_version, budget_total, seed_commit_hash, draft_seed, seed_revealed_at, draft_completed_at')
    .eq('year', LEAGUE.season)
    .single();
  if (sErr || !season) fail(`seasons: ${sErr?.message ?? 'no row'}`);
  if (!season.draft_completed_at) fail('the draft is not marked complete — nothing settled to snapshot.');

  const { data: models } = await db.from('models').select('id, key, display_name, lab, openrouter_id, context_window, price_in, price_out');
  const name = new Map((models ?? []).map((m) => [m.id as string, m]));

  const { data: teams } = await db
    .from('teams')
    .select('id, model_id, draft_slot, auction_bid, faab_remaining')
    .eq('season_id', season.id);
  const teamIds = (teams ?? []).map((t) => t.id as string);

  const { data: bids } = await db
    .from('auction_bids')
    .select('team_id, bid, slot_preference, assigned_slot, tiebroken, decision_id')
    .in('team_id', teamIds);

  const { data: picks } = await db
    .from('draft_picks')
    .select('pick_overall, round, team_id, player_id, pool_narrowed, decision_id')
    .eq('season_id', season.id)
    .order('pick_overall');
  const total = LEAGUE.teams * LEAGUE.draftRounds;
  if ((picks ?? []).length !== total) fail(`${(picks ?? []).length}/${total} picks — refusing to snapshot a partial draft.`);

  const pids = [...new Set((picks ?? []).map((p) => p.player_id as string))];
  const players = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < pids.length; i += 100) {
    const { data } = await db.from('players').select('sleeper_id, name, position, nfl_team').in('sleeper_id', pids.slice(i, i + 100));
    for (const p of (data ?? []) as Record<string, unknown>[]) players.set(String(p.sleeper_id), p);
  }

  const { data: decRows, error: dErr } = await db
    .from('decisions')
    .select('id, type, team_id, model_id, pick_overall, round, valid, fallback_applied, provider_failure, retry_count, headline, key_factors, closest_call, what_would_change_it, confidence, cited_fields, unsupported_claims, soft_violations, reasoning_tokens, tokens_in, tokens_out, latency_ms, cost_usd, prompt_version, rulebook_version, context_hash, dossier_hash, validation_error, raw_response, created_at')
    .eq('season_id', season.id)
    .in('type', ['auction', 'draft_pick'])
    .order('created_at');
  if (dErr) fail(`decisions: ${dErr.message}`);
  const decisions = (decRows ?? []) as Record<string, unknown>[];
  const byId = new Map(decisions.map((d) => [String(d.id), d]));

  const live = new Set([...(picks ?? []), ...(bids ?? [])].map((r) => r.decision_id as string).filter(Boolean));
  const strip = (d: Record<string, unknown>, keepRaw: boolean) => {
    const { raw_response, ...rest } = d;
    return keepRaw ? { ...rest, raw_response } : rest;
  };

  const snapshot = {
    generatedAt: new Date().toISOString(),
    note: 'Snapshot of a one-shot event. The database is the record; this exists so the board survives in a second place. Prompts are omitted and reproducible from the dossier hash; superseded decisions keep their raw response because a truncated answer is only checkable if you can read where it stopped.',
    season: {
      year: season.year,
      rulebookVersion: season.rulebook_version,
      budgetTotal: season.budget_total,
      seedCommitHash: season.seed_commit_hash,
      draftSeed: season.draft_seed,
      seedRevealedAt: season.seed_revealed_at,
      draftCompletedAt: season.draft_completed_at,
    },
    cohort: (models ?? []).filter((m) => (teams ?? []).some((t) => t.model_id === m.id)),
    auction: (bids ?? [])
      .map((b) => {
        const t = (teams ?? []).find((x) => x.id === b.team_id)!;
        return {
          model: (name.get(t.model_id as string) as Record<string, unknown>)?.display_name,
          slot: b.assigned_slot,
          bid: b.bid,
          slotPreference: b.slot_preference,
          tiebroken: b.tiebroken,
          faabRemaining: t.faab_remaining,
          decision: b.decision_id ? strip(byId.get(b.decision_id as string)!, false) : null,
        };
      })
      .sort((a, b) => (a.slot as number) - (b.slot as number)),
    board: (picks ?? []).map((p) => {
      const t = (teams ?? []).find((x) => x.id === p.team_id)!;
      const pl = players.get(String(p.player_id)) ?? {};
      return {
        pick: p.pick_overall,
        round: p.round,
        slot: t.draft_slot,
        model: (name.get(t.model_id as string) as Record<string, unknown>)?.display_name,
        playerId: p.player_id,
        player: pl.name,
        position: pl.position,
        nflTeam: pl.nfl_team,
        poolNarrowed: p.pool_narrowed,
        decision: strip(byId.get(p.decision_id as string)!, false),
      };
    }),
    superseded: decisions.filter((d) => !live.has(String(d.id))).map((d) => strip(d, true)),
  };

  const out = join(process.cwd(), 'content', 'data', `draft-${LEAGUE.season}.json`);
  writeFileSync(out, JSON.stringify(snapshot, null, 2));
  console.log(`\n  wrote ${out}`);
  console.log(`    ${snapshot.board.length} picks · ${snapshot.auction.length} auction slots · ${snapshot.superseded.length} superseded`);
  console.log(`    seed revealed: ${snapshot.season.seedRevealedAt ? 'yes' : 'no'}`);
  console.log(`    fallbacks on the board: ${snapshot.board.filter((b) => (b.decision as Record<string, unknown>)?.fallback_applied).length}\n`);
}

main();
