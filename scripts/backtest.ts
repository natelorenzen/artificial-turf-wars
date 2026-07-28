/**
 * Phase 4 — the 2025 backtest (SPEC §9).
 *
 *   npx tsx --env-file=.env.local scripts/backtest.ts --ingest    # ~90s, no model calls
 *   npx tsx --env-file=.env.local scripts/backtest.ts --verify    # deterministic, free
 *   npx tsx --env-file=.env.local scripts/backtest.ts --auction   # 8 model calls, ~$0.20
 *
 * The gate this exists to satisfy: "Scoring math verified; auction shows bid
 * dispersion." The draft is one-shot and irreversible, so every part of the engine
 * that a bad number could poison gets exercised against a season whose answers are
 * already known.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { COHORT, LEAGUE } from '@/lib/config/league';
import { FANTASY_POSITIONS, fetchSeasonStats } from '@/lib/sleeper/client';
import { ingestProjections, ingestWeeklyStats } from '@/lib/sleeper/ingest';
import { slotPickNumbers } from '@/lib/engine/draft';
import { auctionDiscriminates, resolveAuction, type AuctionEntry } from '@/lib/engine/auction';
import { callModel } from '@/lib/openrouter/client';
import { assemblePrompt, assertSharedContext } from '@/lib/prompt/assemble';
import { auctionSchema } from '@/lib/schemas/decisions';
import {
  defenceBandIsPerGame,
  runSpotChecks,
  verifyWeeklyAgainstSeason,
  type SeasonRow,
  type WeeklyRow,
} from '@/lib/backtest/verify-scoring';
import type { Position } from '@/lib/config/league';

const SEASON = 2025;
/**
 * The LEAGUE runs weeks 1-14, but scoring verification must cover the FULL regular
 * season: Sleeper's season totals span all 18 weeks, so comparing them against a
 * 14-week sum would show a deficit for every player and look exactly like a scoring
 * bug. (It did, on the first run.)
 */
const VERIFY_WEEKS = 18;

function db(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

const flag = (name: string) => process.argv.includes(`--${name}`);

// ---------------------------------------------------------------------------
// Stage 1 — ingest the completed season
// ---------------------------------------------------------------------------

async function stageIngest() {
  console.log(`Ingesting ${SEASON}: projections, then weeks 1-${VERIFY_WEEKS}.\n`);

  const projections = await ingestProjections(SEASON);
  console.log(`  projections  ${projections.projections} rows, ${projections.withAdp} with ADP`);

  for (let week = 1; week <= VERIFY_WEEKS; week++) {
    const result = await ingestWeeklyStats(SEASON, week, 'final');
    process.stdout.write(`  week ${String(week).padStart(2)}     ${result.scored} scored`);
    if (result.backfilled > 0) process.stdout.write(`, ${result.backfilled} players backfilled`);
    if (result.skippedDefenses > 0) process.stdout.write(`, ${result.skippedDefenses} DEF skipped`);
    process.stdout.write('\n');
  }
}

// ---------------------------------------------------------------------------
// Stage 2 — verify the scoring math
// ---------------------------------------------------------------------------

async function stageVerify() {
  const supabase = db();
  console.log(`Verifying the scoring engine against completed ${SEASON} results.\n`);

  // Weekly rows we computed at ingest.
  const weekly: WeeklyRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('player_stats')
      .select('player_id, week, raw_stats, computed_pts')
      .eq('season', SEASON)
      .range(from, from + 999);
    if (error) throw new Error(`player_stats: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      weekly.push({
        playerId: row.player_id as string,
        week: row.week as number,
        stats: row.raw_stats as Record<string, unknown>,
        computedPts: Number(row.computed_pts),
      });
    }
    if (data.length < 1000) break;
  }
  console.log(`  loaded ${weekly.length} weekly stat lines`);

  // Season totals, fetched fresh — a different payload from a different endpoint.
  const seasonTotals: SeasonRow[] = [];
  for (const position of FANTASY_POSITIONS) {
    const result = await fetchSeasonStats(SEASON, position);
    for (const rec of result.data) {
      seasonTotals.push({
        playerId: rec.player_id,
        position: position as Position,
        name: [rec.player?.first_name, rec.player?.last_name].filter(Boolean).join(' ') || rec.player_id,
        stats: rec.stats ?? {},
      });
    }
  }
  console.log(`  loaded ${seasonTotals.length} season totals\n`);

  const result = verifyWeeklyAgainstSeason(weekly, seasonTotals);
  console.log(`  Weekly-sum vs season-total, offensive players:`);
  console.log(`    compared ${result.compared}, matched ${result.matched}, worst delta ${result.worstDelta.toFixed(2)}`);

  if (result.discrepancies.length > 0) {
    console.log(`\n    ${result.discrepancies.length} disagreements — top 10:`);
    for (const d of result.discrepancies.slice(0, 10)) {
      console.log(
        `      ${d.name.padEnd(24)} ${d.position}  weeks=${String(d.weeks).padStart(2)}  ` +
          `sum ${d.weeklySum.toFixed(2)} vs total ${d.seasonTotal.toFixed(2)}  delta ${d.delta.toFixed(2)}`,
      );
    }
  }

  // The DEF band must NOT be linear in the season total.
  const band = defenceBandIsPerGame();
  console.log(
    `\n  DEF points-allowed band is per-game (asserted): 17 weeks at 20 allowed = ` +
      `${band.weekly} pts, vs banding the 340 season total = ${band.seasonTotal} pts`,
  );

  // Whole-table errors that internal consistency cannot catch.
  const spot = runSpotChecks([
    { label: '6 rec, 82 yds, 1 TD (rulebook example)', position: 'WR', stats: { rec: 6, rec_yd: 82, rec_td: 1 }, expected: 20.2 },
    { label: '300 pass yds, 2 TD, 1 INT', position: 'QB', stats: { pass_yd: 300, pass_td: 2, pass_int: 1 }, expected: 19 },
    { label: '100 rush yds, 1 TD, 1 fumble lost', position: 'RB', stats: { rush_yd: 100, rush_td: 1, fum_lost: 1 }, expected: 14 },
    { label: '3 FG (one 45yd), 2 XP', position: 'K', stats: { fgm: 3, fgm_40_49: 1, xpm: 2 }, expected: 12 },
    { label: 'DEF: 4 sacks, 1 INT, 10 allowed', position: 'DEF', stats: { sack: 4, int: 1, pts_allow: 10 }, expected: 10 },
    { label: 'one kick-return TD, league-wide', position: 'DEF', stats: { def_st_td: 1, pts_allow: 24 }, expected: 6 },
  ]);

  console.log('\n  Spot checks against hand-computed values:');
  for (const check of spot) {
    console.log(`    ${check.ok ? '✓' : '✗'} ${check.label.padEnd(40)} ${check.actual} (expected ${check.expected})`);
  }

  const allOk = spot.every((c) => c.ok) && result.discrepancies.length === 0;
  console.log(
    allOk
      ? '\n  Scoring math VERIFIED.'
      : '\n  *** Scoring math NOT verified. Do not draft until this is clean. ***',
  );
  if (!allOk) process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// Stage 3 — the auction, against real 2025 pre-season data
// ---------------------------------------------------------------------------

const AUCTION_OUTPUT_EXAMPLE = {
  bid: 30,
  slot_preference: [4, 3, 5, 2, 6, 1, 7, 8],
  headline: 'One sentence.',
  key_factors: ['cites a DATA field and value', '...'],
  closest_call: 'The bid level nearly chosen instead, and what it would have cost later.',
  what_would_change_it: 'One sentence.',
  confidence: 0.5,
};

async function stageAuction() {
  const supabase = db();

  const { data: board, error } = await supabase
    .from('player_projections')
    .select('player_id, proj_pts, adp, players!inner(name, position)')
    .eq('season', SEASON)
    .not('adp', 'is', null)
    .order('adp', { ascending: true })
    .limit(60);
  if (error) throw new Error(`board: ${error.message}`);

  const topAvailable = (board ?? []).map((row) => {
    const player = row.players as unknown as { name: string; position: string };
    return {
      player_id: row.player_id,
      name: player.name,
      position: player.position,
      proj_season_points: Number(row.proj_pts),
      adp: Number(row.adp),
    };
  });

  const data = {
    budget_total: LEAGUE.budgetTotal,
    teams: LEAGUE.teams,
    rounds: LEAGUE.draftRounds,
    draft_type: LEAGUE.draftType,
    slot_pick_numbers: slotPickNumbers(),
    top_available: topAvailable,
    budget_rule:
      'Whatever you do not spend here is your entire FAAB budget for all 14 weeks. It does not replenish.',
  };

  const prompt = assemblePrompt({
    data,
    task:
      'Bid for your draft slot and rank all 8 slots in preference order. Your bid is deducted ' +
      'from the single budget that also funds every waiver claim you will make this season.',
    outputExample: AUCTION_OUTPUT_EXAMPLE,
  });

  console.log(`Slot auction against ${SEASON} pre-season data.`);
  console.log(`  ${topAvailable.length} players on the board, prompt ~${prompt.estimatedTokens} tokens\n`);

  const entries: AuctionEntry[] = [];
  const hashes: string[] = [];
  let cost = 0;

  for (const model of COHORT) {
    const call = await callModel({
      openrouterId: model.openrouterId,
      systemPrompt: prompt.systemPrompt,
      userPrompt: prompt.userPrompt,
      schema: auctionSchema,
    });
    hashes.push(prompt.contextHash);
    cost += call.usage.costUsd ?? 0;

    if (!call.ok) {
      console.log(`  ✗ ${model.displayName.padEnd(16)} ${call.providerFailure ? 'provider failure' : 'invalid'}`);
      console.log(`        finish_reason=${call.finishReason}  out=${call.usage.tokensOut} reasoning=${call.usage.reasoningTokens}`);
      console.log(`        ${call.validationError?.slice(0, 160)}`);
      entries.push({ teamId: model.key, bid: null, slotPreference: null });
      continue;
    }

    const { bid, slot_preference, headline, confidence } = call.parsed!;
    entries.push({ teamId: model.key, bid, slotPreference: slot_preference });
    console.log(`  $${String(bid).padStart(3)}  slot pref ${slot_preference.join('')}  conf ${confidence.toFixed(2)}  ${model.displayName}`);
    console.log(`        "${headline}"`);
  }

  assertSharedContext(hashes, 'backtest auction');

  const result = resolveAuction(entries, process.env.DRAFT_SEED ?? 'backtest-seed');
  const gate = auctionDiscriminates(result);

  console.log('\n  Resolution:');
  for (const award of result.awards) {
    const model = COHORT.find((m) => m.key === award.teamId)!;
    console.log(
      `    slot ${award.assignedSlot}  ${model.displayName.padEnd(16)} paid $${String(award.bid).padStart(3)}  ` +
        `FAAB left $${String(award.faabRemaining).padStart(3)}${award.tiebroken ? '  (tiebroken)' : ''}${award.fallbackApplied ? '  (FALLBACK)' : ''}`,
    );
  }

  const d = result.dispersion;
  console.log(`\n  Dispersion: ${d.distinct} distinct bids, $${d.min}-$${d.max}, mean $${d.mean}, stdev ${d.stdev}`);
  console.log(`  Total cost: $${cost.toFixed(4)}`);
  console.log(
    gate.ok
      ? `\n  GATE MET — the auction discriminates. ${gate.reason}`
      : `\n  *** GATE NOT MET — ${gate.reason}.\n  *** SPEC §4.2: reconsider the mechanism before it runs for real.`,
  );
  if (!gate.ok) process.exitCode = 1;
}

async function main() {
  const any = flag('ingest') || flag('verify') || flag('auction');
  if (!any) {
    console.log('Pick a stage: --ingest, --verify, --auction');
    return;
  }
  if (flag('ingest')) await stageIngest();
  if (flag('verify')) await stageVerify();
  if (flag('auction')) await stageAuction();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
