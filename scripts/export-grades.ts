/**
 * Publish a draft report-card run to `content/data/`, in git.
 *
 *   npx tsx scripts/export-grades.ts                    # every live run, in order
 *   npx tsx scripts/export-grades.ts --file <path>      # one specific run
 *
 * `draft-grades-runs/` is gitignored — it is evidence for a run, not source, and most
 * runs are dry. This promotes the live runs to the published record, so a findings post
 * that says "eight models said this" links to the thing they actually said, including
 * the cards that disagree with whatever the post argues.
 *
 * EVERY live run is published, not the best one. The moment this script starts choosing
 * between runs, a reader has to take our word for what the others said — and this
 * project has already learned once, in Findings 003, that the first run of anything is
 * as likely to be the outlier as the result.
 *
 * Model names appear here and ONLY here. The graders never saw them; the reader must,
 * or the result is unfalsifiable.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { COHORT } from '@/lib/config/league';
import type { GradesRun } from '@/lib/grades/types';
import type { GradesTally } from '@/lib/grades/tally';

const args = process.argv.slice(2);
const fileArg = args.find((a) => a.startsWith('--file='))?.split('=')[1];

const RUNS = join(process.cwd(), 'draft-grades-runs');

function liveRuns(): string[] {
  const files = readdirSync(RUNS)
    .filter((f) => f.includes('-live-') && f.endsWith('.json'))
    .sort();
  if (files.length === 0) {
    console.error('\n  No live run found in draft-grades-runs/. Run the script with --live first.\n');
    process.exit(1);
  }
  return files.map((f) => join(RUNS, f));
}

const displayName = new Map(COHORT.map((m) => [m.key, m.displayName]));
const name = (key: string) => displayName.get(key) ?? key;

function runSection(run: GradesRun, tally: GradesTally, index: number, total: number): string[] {
  const out: string[] = [];
  const playerName = new Map(run.board.teams.flatMap((t) => t.players.map((p) => [p.playerId, p.name])));
  const label = total > 1 ? `Run ${index + 1}` : 'The run';

  out.push(`## ${label}`);
  out.push('');
  out.push(`${run.calls} calls, $${run.costUsd.toFixed(4)}, generated ${run.board.createdAt}.`);
  out.push('');
  out.push('| Team | Mean rank | Range | Mean grade | Grade spread | 1st-place votes | Last-place votes |');
  out.push('|---|---|---|---|---|---|---|');
  for (const t of tally.teams) {
    out.push(
      `| ${t.label} | ${t.meanRank.toFixed(2)} | ${t.bestRank}–${t.worstRank} | ${t.meanGradeLetter} | ` +
        `${t.gradeSpread} | ${t.firstPlaceVotes} | ${t.lastPlaceVotes} |`,
    );
  }
  out.push('');
  out.push(`- Kendall's W: **${tally.kendallW}** (1.0 = identical rankings; ~0.125 = chance for eight graders)`);
  out.push(`- Mean pairwise Kendall tau: ${tally.meanPairwiseTau}`);
  out.push(`- Unanimous best draft: ${tally.unanimousFirst ?? 'none'} — unanimous worst: ${tally.unanimousLast ?? 'none'}`);
  if (tally.furthestPair) out.push(`- Furthest apart: ${name(tally.furthestPair.a)} / ${name(tally.furthestPair.b)} (tau ${tally.furthestPair.tau})`);
  out.push(`- Consensus vs total roster projection: tau ${tally.tauConsensusVsRosterProjection}; vs best-legal-starters: tau ${tally.tauConsensusVsStartersProjection}`);
  out.push(`- Self-preference: mean ${tally.selfPreferenceMeanDelta} places, ${tally.selfPreferenceCount}/${tally.gradersCounted} rated their own draft above the room`);
  out.push(`- Self-recognition: ${tally.recognitionCorrect}/${tally.recognitionAsked} correct, ${tally.recognitionExpected} expected by chance`);
  out.push('');

  out.push(`### ${label} — self-identification`);
  out.push('');
  out.push('| Grader | Own team | Own rank, self | Own rank, others | Guessed | Correct | Confidence |');
  out.push('|---|---|---|---|---|---|---|');
  for (const g of tally.graders) {
    out.push(
      `| ${name(g.modelKey)} | ${g.ownTeam} | ${g.ownRankSelf ?? '—'} | ${g.ownRankByOthers ?? '—'} | ` +
        `${g.guessedTeam ?? '—'} | ${g.guessCorrect ? 'yes' : 'no'} | ${g.guessConfidence ?? '—'} |`,
    );
  }
  out.push('');

  out.push(`### ${label} — every card`);
  out.push('');
  for (const t of run.transcripts) {
    out.push(`#### ${name(t.modelKey)} (${label})`);
    out.push('');
    out.push(`Drafted ${t.ownTeam}. Guessed **${t.guess?.team ?? '—'}** was its own (confidence ${t.guess?.confidence ?? '—'}).`);
    if (t.guess?.why) out.push(`\n> ${t.guess.why}`);
    out.push('');
    if (!t.card) {
      out.push("_No card — this grader's call failed strict validation and is excluded from every rank statistic._");
      out.push('');
      continue;
    }
    out.push(`**Criterion:** ${t.card.criterion}`);
    out.push('');
    out.push(`**Ranking:** ${t.card.ranking.join(' > ')}`);
    out.push('');
    out.push('| Team | Grade | Verdict | Best pick | Worst pick |');
    out.push('|---|---|---|---|---|');
    for (const teamLabel of t.card.ranking) {
      const g = t.card.grades.find((x) => x.team === teamLabel)!;
      out.push(
        `| ${g.team} | ${g.grade} | ${g.verdict} | ${playerName.get(g.bestPick) ?? g.bestPick} — ${g.bestPickWhy} | ` +
          `${playerName.get(g.worstPick) ?? g.worstPick} — ${g.worstPickWhy} |`,
      );
    }
    out.push('');
    if (t.softViolations.length > 0) {
      out.push(`_Soft violations, published rather than penalised: ${t.softViolations.join('; ')}_`);
      out.push('');
    }
  }
  return out;
}

function main() {
  const paths = fileArg ? [fileArg] : liveRuns();
  const loaded = paths.map((path) => {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { run: GradesRun; tally: GradesTally };
    if (!parsed.run.live) {
      console.error(`\n  ${path} is a dry run. Publishing synthetic answers as evidence would be a lie.\n`);
      process.exit(1);
    }
    if (parsed.run.aborted) {
      console.error(`\n  ${path} aborted (${parsed.run.aborted}) and is missing cards. Refusing to publish it as a result.\n`);
      process.exit(1);
    }
    return { path, ...parsed };
  });

  const first = loaded[0];
  const drafterOf = new Map(first.run.transcripts.map((t) => [t.ownTeam, name(t.modelKey)]));
  const out: string[] = [];

  out.push(`# Draft report cards, ${first.run.board.season}`);
  out.push('');
  out.push(
    'Eight models graded the completed draft. Every grader received a byte-identical board —',
    'all 120 picks, the eight rosters as Team A..H, each player with the projection and ADP',
    'the drafters themselves had. No model or lab name appeared in it, and no grader was told',
    'that one of the eight rosters was its own.',
    '',
    `- Board hash: \`${first.run.board.boardId}\``,
    `- Live runs published here: **${loaded.length}**, every one that was run`,
    `- Total: ${loaded.reduce((n, l) => n + l.run.calls, 0)} calls, $${loaded.reduce((n, l) => n + l.run.costUsd, 0).toFixed(4)}`,
    '- Script: `scripts/draft-grades.ts --live`',
    '',
    'The drafter column below is published here and was never shown to any grader.',
    '',
  );

  out.push('## Who was who');
  out.push('');
  out.push('| Team | Draft slot | Drafted by |');
  out.push('|---|---|---|');
  for (const team of first.run.board.teams) {
    out.push(`| ${team.label} | ${team.draftSlot} | ${drafterOf.get(team.label) ?? '—'} |`);
  }
  out.push('');

  if (loaded.length > 1) {
    // The comparison goes FIRST, because the single most important thing a reader can
    // know about these numbers is how much they moved when nothing about the question did.
    out.push('## Across runs');
    out.push('');
    out.push('Identical board, identical prompt, run more than once. What moved:');
    out.push('');
    out.push(`| Metric | ${loaded.map((_, i) => `Run ${i + 1}`).join(' | ')} |`);
    out.push(`|---|${loaded.map(() => '---').join('|')}|`);
    const row = (label: string, fn: (t: GradesTally) => string | number | null) =>
      out.push(`| ${label} | ${loaded.map((l) => String(fn(l.tally) ?? '—')).join(' | ')} |`);
    row("Kendall's W", (t) => t.kendallW);
    row('Mean pairwise tau', (t) => t.meanPairwiseTau);
    row('Unanimous best / worst', (t) => `${t.unanimousFirst ?? 'none'} / ${t.unanimousLast ?? 'none'}`);
    row('Self-preference (places)', (t) => t.selfPreferenceMeanDelta);
    row('Self-preference (count)', (t) => `${t.selfPreferenceCount}/${t.gradersCounted}`);
    row('Self-recognition', (t) => `${t.recognitionCorrect}/${t.recognitionAsked}`);
    row('Distinct "best pick" votes', (t) => t.distinctBestPicks);
    out.push('');
    out.push('Consensus placing by team, run over run:');
    out.push('');
    out.push(`| Team | Drafted by | ${loaded.map((_, i) => `Run ${i + 1}`).join(' | ')} |`);
    out.push(`|---|---|${loaded.map(() => '---').join('|')}|`);
    for (const team of first.run.board.teams) {
      const cells = loaded.map((l) => {
        const t = l.tally.teams.find((x) => x.label === team.label)!;
        return `${t.consensusRank} (${t.meanRank.toFixed(2)})`;
      });
      out.push(`| ${team.label} | ${drafterOf.get(team.label)} | ${cells.join(' | ')} |`);
    }
    out.push('');
  }

  for (const [i, l] of loaded.entries()) out.push(...runSection(l.run, l.tally, i, loaded.length));

  const dest = join(process.cwd(), 'content', 'data', `draft-grades-${first.run.board.season}.md`);
  writeFileSync(dest, out.join('\n'));
  console.log(
    `Wrote ${dest.replace(process.cwd() + '/', '')} from ${loaded.length} live run(s):\n` +
      loaded.map((l) => `  ${l.path.replace(process.cwd() + '/', '')}`).join('\n'),
  );
}

main();
