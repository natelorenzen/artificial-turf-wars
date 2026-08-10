/**
 * Sleeper picks — eight models price the same draft board against the market.
 *
 *   npx tsx --env-file=.env.local scripts/sleeper-picks.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/sleeper-picks.ts
 *
 * ---------------------------------------------------------------------------
 * Why this has to run BEFORE the draft
 * ---------------------------------------------------------------------------
 * It is a pre-registration. Each model names the players it thinks the market has
 * mispriced, from the exact board it will draft from days later. That makes it
 * scoreable twice, and neither reading is available afterwards:
 *
 *   1. Did it actually draft the players it called undervalued? A model that names a
 *      sleeper and then takes someone else at that pick has told us something about the
 *      distance between its analysis and its behaviour.
 *   2. Did those players outperform? Fourteen weeks of real scoring answers it.
 *
 * Run this after the draft and the first question is unanswerable, because the answer
 * has already happened.
 *
 * ---------------------------------------------------------------------------
 * Not a league decision
 * ---------------------------------------------------------------------------
 * Same treatment as `preseason-preview.ts`: no `runDecision`, nothing in `decisions`,
 * no anonymised labels. Attribution is the point of a published prediction, whereas
 * SPEC §14.3 keeps lab names out of anything a competitor sees. Nothing here touches
 * league state; it writes one markdown file.
 *
 * Unlike the preseason preview, this one IS grounded. It reasons from the same ADP and
 * projection rows the draft reads, so the DATA RULE applies in full.
 */

import { writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { COHORT, LEAGUE } from '@/lib/config/league';
import { callModel } from '@/lib/openrouter/client';
import { stableHash, stableStringify } from '@/lib/util/hash';

/** How deep a board the models price. Well past the 120 picks a draft consumes. */
const BOARD_SIZE = 200;

const OUT_PATH = 'content/data/sleeper-picks-2026.md';

const pickSchema = z.object({
  player_id: z.string().min(1),
  name: z.string().min(1),
  why: z.string().min(1),
});

const sleeperSchema = z.object({
  undervalued: z.array(pickSchema).min(1).max(5),
  overvalued: z.array(pickSchema).min(1).max(5),
  positional_read: z.string().min(1),
  headline: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

type SleeperResponse = z.infer<typeof sleeperSchema>;

const SYSTEM = `You are a fantasy football analyst pricing a draft board against the
market.

DATA RULE (highest priority):
Reason only from the DATA block in this message. Do not use your own memory of
depth charts, injuries, or 2026 news — your training data is out of date and the
projections here are ours, computed from our own scoring rules. If a field is
null, treat it as unknown and say so rather than filling it in.

WHAT THE FIELDS MEAN:
- adp is the market's average draft position. Lower means drafted earlier.
- proj_pts is OUR projection under OUR scoring, not the market's.
- adp_pos_rank and proj_pos_rank are that player's rank WITHIN HIS POSITION on
  each of those two measures.

A player whose proj_pts rank is far better than his adp rank is not automatically
undervalued. This is a league that starts one quarterback, so the gap between the
best quarterback and a replacement-level one is worth far less than the same gap
at running back. Raw projected points ignore that entirely. Say what you think the
position is worth, not just what the projection says.

Pick players you would actually spend a pick on at their current price, and say
what the market appears to be missing. Cite a specific field and value.

Return only a single JSON object matching the schema. No preamble, no markdown,
no code fences.`;

const EXAMPLE = {
  undervalued: [{ player_id: 'id from the board', name: 'Player Name', why: 'One sentence citing a field and value.' }],
  overvalued: [{ player_id: 'id from the board', name: 'Player Name', why: 'One sentence citing a field and value.' }],
  positional_read: 'One or two sentences on which positions you think the market is mispricing as a group.',
  headline: 'One sentence a reader could repeat.',
  confidence: 0.5,
};

interface BoardRow {
  player_id: string;
  name: string;
  position: string;
  nfl_team: string | null;
  adp: number;
  proj_pts: number;
  adp_pos_rank: number;
  proj_pos_rank: number;
}

async function loadBoard(): Promise<BoardRow[]> {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { data, error } = await db
    .from('player_projections')
    .select('player_id, adp, proj_pts, players!inner(name, position, nfl_team)')
    .eq('season', LEAGUE.season)
    // Season-long rows only. The weekly rows live in this same table.
    .is('week', null)
    .not('adp', 'is', null)
    .order('adp', { ascending: true })
    .limit(BOARD_SIZE);
  if (error) throw new Error(`board: ${error.message}`);

  const rows = (data ?? []).map((r) => {
    const p = r.players as unknown as { name: string; position: string; nfl_team: string | null };
    return {
      player_id: r.player_id as string,
      name: p.name,
      position: p.position,
      nfl_team: p.nfl_team,
      adp: Number(r.adp),
      proj_pts: Number(r.proj_pts),
      adp_pos_rank: 0,
      proj_pos_rank: 0,
    };
  });

  // Positional ranks on both measures. Without these the board can only be read on raw
  // points, which is exactly the reading the system prompt warns against — and giving a
  // model only the misleading view then grading it on the misreading would be a rigged
  // question.
  for (const position of new Set(rows.map((r) => r.position))) {
    const group = rows.filter((r) => r.position === position);
    [...group].sort((a, b) => a.adp - b.adp).forEach((r, i) => (r.adp_pos_rank = i + 1));
    [...group].sort((a, b) => b.proj_pts - a.proj_pts).forEach((r, i) => (r.proj_pos_rank = i + 1));
  }

  return rows;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const board = await loadBoard();

  const data = {
    season: LEAGUE.season,
    league: {
      teams: LEAGUE.teams,
      rounds: LEAGUE.draftRounds,
      starters: LEAGUE.slots,
      scoring: 'full PPR, 4-point passing touchdowns, -1 interception',
    },
    board,
  };
  const serialized = stableStringify(data);

  console.log(`\n  SLEEPER PICKS — season ${LEAGUE.season}`);
  console.log(`    board          ${board.length} players, ADP ${board[0]?.adp} to ${board[board.length - 1]?.adp}`);
  console.log(`    positions      ${[...new Set(board.map((r) => r.position))].sort().join(' ')}`);
  console.log(`    DATA size      ${serialized.length} chars`);
  console.log(`    context hash   ${stableHash(data)}`);
  console.log(`    model calls    ${dryRun ? 0 : COHORT.length}`);
  console.log(`    mode           ${dryRun ? 'DRY RUN — no calls, no file' : '*** LIVE — spends model calls ***'}\n`);

  if (dryRun) {
    console.log('  Sample rows as the models will see them:');
    for (const r of board.slice(0, 3)) console.log(`    ${JSON.stringify(r)}`);
    console.log('\n  Re-run without --dry-run to fire it.\n');
    return;
  }

  const userPrompt = [
    '=== DATA ===',
    serialized,
    '=== END DATA ===',
    '',
    `Name the players on this board you believe are mispriced. Up to five undervalued and ` +
      `up to five overvalued. Every player_id must appear in the board.`,
    '',
    'Return exactly this JSON shape and nothing else:',
    JSON.stringify(EXAMPLE, null, 2),
  ].join('\n');

  // Parallel, like every other multi-model exercise here: eight providers, and no
  // answer depends on another.
  const settled = await Promise.allSettled(
    COHORT.map(async (model) => ({
      model,
      call: await callModel({
        openrouterId: model.openrouterId,
        systemPrompt: SYSTEM,
        userPrompt,
        schema: sleeperSchema,
      }),
    })),
  );

  const results = settled.map((outcome, i) =>
    outcome.status === 'fulfilled'
      ? { model: outcome.value.model, parsed: outcome.value.call.parsed, raw: outcome.value.call.rawResponse, cost: outcome.value.call.usage.costUsd ?? 0, error: outcome.value.call.validationError }
      : { model: COHORT[i], parsed: null, raw: String(outcome.reason).slice(0, 2000), cost: 0, error: String(outcome.reason).slice(0, 300) },
  );

  const cost = results.reduce((sum, r) => sum + r.cost, 0);
  for (const r of results) {
    if (!r.parsed) {
      console.log(`  ✗ ${r.model.displayName.padEnd(16)} ${r.error?.slice(0, 100)}`);
      continue;
    }
    console.log(`  ${r.model.displayName.padEnd(16)} conf ${r.parsed.confidence.toFixed(2)}  "${r.parsed.headline}"`);
    console.log(`       up: ${r.parsed.undervalued.map((p) => p.name).join(', ')}`);
    console.log(`     down: ${r.parsed.overvalued.map((p) => p.name).join(', ')}`);
  }

  writeFileSync(OUT_PATH, renderMarkdown(board, results, stableHash(data)), 'utf8');
  console.log(`\n  ${results.filter((r) => r.parsed).length}/${COHORT.length} answered. $${cost.toFixed(4)}.`);
  console.log(`  Evidence written to ${OUT_PATH}\n`);
}

interface Result {
  model: (typeof COHORT)[number];
  parsed: SleeperResponse | null;
  raw: string | null;
  cost: number;
  error: string | null;
}

function renderMarkdown(board: BoardRow[], results: Result[], contextHash: string): string {
  const byId = new Map(board.map((r) => [r.player_id, r]));
  const lines: string[] = [
    `# Sleeper picks, ${LEAGUE.season}`,
    '',
    `Eight models, one board of ${board.length} players, asked before the draft which of them`,
    'the market has mispriced. Every model saw a byte-identical DATA block.',
    '',
    `- Context hash: \`${contextHash}\``,
    `- Generated: ${new Date().toISOString()}`,
    `- Script: \`scripts/sleeper-picks.ts\``,
    '',
    '## Tally',
    '',
    '| Player | Pos | ADP | Our proj | Called up by | Called down by |',
    '|---|---|---|---|---|---|',
  ];

  const up = new Map<string, string[]>();
  const down = new Map<string, string[]>();
  for (const r of results) {
    if (!r.parsed) continue;
    for (const p of r.parsed.undervalued) up.set(p.player_id, [...(up.get(p.player_id) ?? []), r.model.displayName]);
    for (const p of r.parsed.overvalued) down.set(p.player_id, [...(down.get(p.player_id) ?? []), r.model.displayName]);
  }
  const mentioned = [...new Set([...up.keys(), ...down.keys()])]
    .sort((a, b) => (up.get(b)?.length ?? 0) + (down.get(b)?.length ?? 0) - (up.get(a)?.length ?? 0) - (down.get(a)?.length ?? 0));

  for (const id of mentioned) {
    const row = byId.get(id);
    lines.push(
      `| ${row?.name ?? id} | ${row?.position ?? '?'} | ${row?.adp ?? '—'} | ${row?.proj_pts ?? '—'} | ` +
        `${(up.get(id) ?? []).join(', ') || '—'} | ${(down.get(id) ?? []).join(', ') || '—'} |`,
    );
  }

  for (const r of results) {
    lines.push('', `## ${r.model.displayName}`, '');
    if (!r.parsed) {
      lines.push(`**No usable response.** \`${r.error ?? 'unknown'}\``, '', '```', r.raw ?? '', '```');
      continue;
    }
    lines.push(`> ${r.parsed.headline}`, '', `**Confidence ${r.parsed.confidence}**`, '');
    lines.push('**Undervalued**', '');
    for (const p of r.parsed.undervalued) lines.push(`- **${p.name}** — ${p.why}`);
    lines.push('', '**Overvalued**', '');
    for (const p of r.parsed.overvalued) lines.push(`- **${p.name}** — ${p.why}`);
    lines.push('', `**Positional read.** ${r.parsed.positional_read}`, '');
    lines.push('<details><summary>Raw response</summary>', '', '```json', r.raw ?? '', '```', '</details>');
  }

  return `${lines.join('\n')}\n`;
}

main().catch((err) => {
  console.error(`\n  ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
