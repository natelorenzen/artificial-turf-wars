/**
 * Preseason preview — eight models call one real NFL game from memory alone.
 *
 *   npx tsx --env-file=.env.local scripts/preseason-preview.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/preseason-preview.ts
 *
 * ---------------------------------------------------------------------------
 * This is NOT a league decision, and it deliberately breaks the league's rules
 * ---------------------------------------------------------------------------
 * The season's system prompt says, in its highest-priority block: "Do not use your
 * own memory of player performance, injuries, depth charts, teams, or schedules.
 * Your training data is out of date." That rule is the reason the league measures
 * reasoning over shared data instead of measuring who memorised the most football.
 *
 * This exercise asks for the exact opposite, so it must not travel through the league
 * path. Specifically it does NOT:
 *   - use SYSTEM_PROMPT or the rulebook,
 *   - go through `runDecision`, so nothing lands in the `decisions` table,
 *   - anonymise the models — attribution is the entire point of a preview, whereas
 *     SPEC §14.3 keeps lab names out of anything a competitor sees.
 *
 * Nothing here touches league state. It writes one markdown file.
 *
 * The interesting output is not who picks the winner. It is `known_unknowns`: a
 * preseason game three weeks past most training cutoffs is mostly a test of whether a
 * model will say "I do not know who is starting" or quietly invent a depth chart.
 */

import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import { COHORT } from '@/lib/config/league';
import { callModel } from '@/lib/openrouter/client';

// ---------------------------------------------------------------------------
// The game. Taken from the published NFL schedule, NOT from Sleeper.
//
// Sleeper's /schedule/nfl/pre/2026 returns 48 games across three weeks beginning
// 13 August and does not contain this game at all — it lists Carolina's "week 1" as
// CAR @ BUF on the 15th. The real preseason is four weeks and opens on the 6th, so
// Sleeper is missing the opening week and its week numbers are shifted by one.
// Worth knowing before any code ever reads a preseason week number from that feed.
// ---------------------------------------------------------------------------

const GAME = {
  label: 'Carolina Panthers at Arizona Cardinals',
  away: 'Carolina Panthers',
  home: 'Arizona Cardinals',
  awayAbbr: 'CAR',
  homeAbbr: 'ARI',
  kickoff: 'Thursday 6 August 2026, 5:00 PM Pacific',
  context: 'NFL preseason, Week 1 of 4',
};

const SYSTEM = `You are a football analyst writing a short preview of a single NFL preseason game.

Work from your own knowledge. There is no data block in this message.

Be honest about the limits of what you know. Preseason games are decided by
backups and roster hopefuls, coaches rarely announce plans in advance, and
this game may fall after your training cutoff. Saying you do not know
something specific is a correct answer, not a failure. Inventing a starter,
a depth chart, or an injury you are not sure about is the failure.

Return only a single JSON object matching the schema. No preamble, no
markdown, no code fences.`;

const previewSchema = z.object({
  predicted_winner: z.string().min(1),
  confidence: z.number().min(0).max(1),
  headline: z.string().min(1),
  what_to_watch: z.array(z.string().min(1)).min(1),
  known_unknowns: z.array(z.string().min(1)).min(1),
  training_cutoff_note: z.string().min(1),
});

type Preview = z.infer<typeof previewSchema>;

const OUTPUT_EXAMPLE = {
  predicted_winner: 'CAR or ARI',
  confidence: 0.5,
  headline: 'One sentence.',
  what_to_watch: ['A specific thing worth watching, and why.'],
  known_unknowns: ['Something material you genuinely do not know about this game.'],
  training_cutoff_note: 'What you do and do not know about these rosters as of this date, stated plainly.',
};

const USER_PROMPT = `Preview this game:

  ${GAME.away} at ${GAME.home}
  ${GAME.context}
  Kickoff: ${GAME.kickoff}

Give your pick, what you would watch for, and — importantly — what you do not
know. Use "${GAME.awayAbbr}" or "${GAME.homeAbbr}" for predicted_winner.

Return exactly this JSON shape and nothing else:
${JSON.stringify(OUTPUT_EXAMPLE, null, 2)}`;

interface Row {
  displayName: string;
  lab: string;
  openrouterId: string;
  preview: Preview | null;
  error: string | null;
  costUsd: number;
  latencyMs: number;
  raw: string | null;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log(`\n  ${GAME.label}`);
  console.log(`  ${GAME.context} — ${GAME.kickoff}`);
  console.log(`  ${COHORT.length} models, one call each, from memory alone.\n`);

  if (dryRun) {
    console.log('  --- SYSTEM ---');
    console.log(SYSTEM);
    console.log('\n  --- USER ---');
    console.log(USER_PROMPT);
    console.log('\n  DRY RUN — no calls made. Re-run without --dry-run.\n');
    return;
  }

  const rows: Row[] = [];

  for (const model of COHORT) {
    process.stdout.write(`  ${model.displayName.padEnd(16)} `);

    const result = await callModel({
      openrouterId: model.openrouterId,
      systemPrompt: SYSTEM,
      userPrompt: USER_PROMPT,
      schema: previewSchema,
      // Small bounded output — see the note on CallOptions.maxOutputTokens about
      // OpenRouter reserving the whole ceiling against the balance.
      maxOutputTokens: 4000,
    });

    rows.push({
      displayName: model.displayName,
      lab: model.lab,
      openrouterId: model.openrouterId,
      preview: result.parsed,
      error: result.parsed ? null : (result.validationError ?? `finish_reason=${result.finishReason}`),
      costUsd: result.usage.costUsd ?? 0,
      latencyMs: result.latencyMs,
      raw: result.rawResponse,
    });

    if (result.parsed) {
      const p = result.parsed;
      console.log(`${p.predicted_winner.padEnd(4)} conf ${p.confidence.toFixed(2)}  "${p.headline}"`);
    } else {
      console.log(`FAILED — ${result.providerFailure ? 'provider failure' : 'invalid output'}`);
    }
  }

  writeFileSync(OUT_PATH, renderMarkdown(rows), 'utf8');

  const ok = rows.filter((r) => r.preview);
  const cost = rows.reduce((sum, r) => sum + r.costUsd, 0);
  const picks = new Map<string, number>();
  for (const r of ok) picks.set(r.preview!.predicted_winner, (picks.get(r.preview!.predicted_winner) ?? 0) + 1);

  console.log(`\n  ${ok.length}/${rows.length} answered.`);
  console.log(`  Split: ${[...picks].map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
  console.log(`  Cost: $${cost.toFixed(4)}`);
  console.log(`  Written to ${OUT_PATH}\n`);
}

/** Committed as the evidence behind Findings 004, alongside the posts it supports. */
const OUT_PATH = 'content/data/preseason-preview-2026-08-06-car-ari.md';

function renderMarkdown(rows: Row[]): string {
  const ok = rows.filter((r) => r.preview);
  const picks = new Map<string, string[]>();
  for (const r of ok) {
    const list = picks.get(r.preview!.predicted_winner) ?? [];
    list.push(r.displayName);
    picks.set(r.preview!.predicted_winner, list);
  }

  const lines: string[] = [
    `# ${GAME.label}`,
    '',
    `**${GAME.context} — ${GAME.kickoff}**`,
    '',
    'Eight frontier models, one question, no data block. Each was asked to preview this',
    'game from its own knowledge and to be explicit about what it does not know.',
    '',
    '> This is not a league decision. The season\'s system prompt forbids models from',
    '> using their own memory of rosters and schedules; this exercise asks for exactly',
    '> that, so it runs outside the league path and is recorded nowhere in the decision',
    '> log. Models are named here, which the season never does.',
    '',
    '## The split',
    '',
  ];

  for (const [pick, models] of picks) {
    lines.push(`- **${pick}** — ${models.join(', ')}`);
  }
  if (rows.some((r) => !r.preview)) {
    lines.push(`- **no answer** — ${rows.filter((r) => !r.preview).map((r) => r.displayName).join(', ')}`);
  }

  lines.push('', '## Previews', '');

  for (const row of rows) {
    lines.push(`### ${row.displayName}`, '', `*${row.lab} — \`${row.openrouterId}\`*`, '');

    if (!row.preview) {
      lines.push(`**No usable answer.** ${row.error}`, '');
      if (row.raw) lines.push('```', row.raw.slice(0, 800), '```', '');
      continue;
    }

    const p = row.preview;
    lines.push(
      `**Pick: ${p.predicted_winner}** (confidence ${p.confidence.toFixed(2)})`,
      '',
      `> ${p.headline}`,
      '',
      '**What to watch**',
      ...p.what_to_watch.map((w) => `- ${w}`),
      '',
      '**What it says it does not know**',
      ...p.known_unknowns.map((w) => `- ${w}`),
      '',
      `**On its own cutoff:** ${p.training_cutoff_note}`,
      '',
    );
  }

  lines.push(
    '---',
    '',
    `Generated ${new Date().toISOString()} · ` +
      `$${rows.reduce((s, r) => s + r.costUsd, 0).toFixed(4)} across ${rows.length} calls.`,
    '',
  );

  return lines.join('\n');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
