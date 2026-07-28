/**
 * Phase 5, the fairness gate (SPEC §4.1b Step 2).
 *
 *   npx tsx --env-file=.env.local scripts/preseason-rules-check.ts
 *
 * Every model answers the same questions, graded deterministically in code. A model
 * below 100% has the rulebook RE-INJECTED and re-answers, and the failure is
 * published either way — this script writes both attempts to `rules_checks` and
 * every call to `decisions`.
 *
 * Why the gate matters: a model that cannot restate the scoring table has not been
 * outreasoned, it has been misbriefed, and every later decision it makes is
 * uninterpretable. "All eight scored 17/17 before the draft" is the most credible
 * sentence on the methodology page — and it is only credible if we would have
 * published the failure.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { LEAGUE } from '@/lib/config/league';
import { assertSharedContext } from '@/lib/prompt/assemble';
import { runDecision } from '@/lib/decisions/run';
import { rulesCheckSchema } from '@/lib/schemas/decisions';
import { buildRulesCheck, gradeRulesCheck, rulesCheckData } from '@/lib/preseason/rules-check';

const OUTPUT_EXAMPLE = {
  answers: [{ id: 'question_id', answer: 'your answer' }],
};

interface TeamRow {
  id: string;
  model_id: string;
  models: { openrouter_id: string; display_name: string };
}

async function attempt(
  supabase: SupabaseClient,
  seasonId: string,
  team: TeamRow,
  attemptNumber: number,
  wrongIds: string[],
) {
  const questions = buildRulesCheck();

  // The re-injection: the rulebook is already in every prompt, so a second attempt
  // names the questions that were wrong WITHOUT supplying the answers. Anything more
  // would be coaching, and the gate would stop measuring comprehension.
  const task =
    attemptNumber === 1
      ? `Answer all ${questions.length} questions. Return one object per question, using the exact id given.`
      : `Your previous answers to these questions were incorrect: ${wrongIds.join(', ')}. ` +
        'Re-read the RULEBOOK above carefully — every answer is derivable from it — and answer all ' +
        `${questions.length} questions again.`;

  const record = await runDecision(
    {
      seasonId,
      teamId: team.id,
      modelId: team.model_id,
      openrouterId: team.models.openrouter_id,
      type: 'rules_check',
      data: rulesCheckData(questions),
      task,
      outputExample: OUTPUT_EXAMPLE,
      schema: rulesCheckSchema,
    },
    supabase,
  );

  const grade = record.parsed
    ? gradeRulesCheck(record.parsed.answers, questions)
    : { score: 0, maxScore: questions.length, passed: false, graded: [] };

  const { error } = await supabase.from('rules_checks').upsert(
    {
      team_id: team.id,
      attempt: attemptNumber,
      answers: (record.parsed?.answers ?? []) as unknown as Record<string, unknown>,
      score: grade.score,
      max_score: grade.maxScore,
      passed: grade.passed,
      decision_id: record.decisionId,
    },
    { onConflict: 'team_id,attempt' },
  );
  if (error) throw new Error(`rules_checks: ${error.message}`);

  return { record, grade };
}

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const season = Number(process.env.SEASON_YEAR ?? '2026');

  const { data: seasonRow, error: seasonError } = await supabase
    .from('seasons').select('id').eq('year', season).single();
  if (seasonError) throw new Error(`season: ${seasonError.message}. Run scripts/seed.ts first.`);

  const { data: teams, error: teamError } = await supabase
    .from('teams')
    .select('id, model_id, models!inner(openrouter_id, display_name)')
    .eq('season_id', seasonRow.id);
  if (teamError) throw new Error(`teams: ${teamError.message}`);

  const rows = teams as unknown as TeamRow[];
  console.log(`Rules comprehension check — ${buildRulesCheck().length} questions, ${rows.length} models\n`);

  const contextHashes: string[] = [];
  const summary: { name: string; score: number; max: number; attempts: number; passed: boolean }[] = [];
  let cost = 0;

  for (const team of rows) {
    let { record, grade } = await attempt(supabase, seasonRow.id, team, 1, []);
    contextHashes.push(record.contextHash);
    cost += record.call.usage.costUsd ?? 0;
    let attempts = 1;

    if (!grade.passed) {
      const wrong = grade.graded.filter((g) => !g.correct).map((g) => g.id);
      console.log(`  ${team.models.display_name}: ${grade.score}/${grade.maxScore} — re-injecting the rulebook (${wrong.join(', ')})`);
      const retry = await attempt(supabase, seasonRow.id, team, 2, wrong);
      cost += retry.record.call.usage.costUsd ?? 0;
      record = retry.record;
      grade = retry.grade;
      attempts = 2;
    }

    console.log(
      `  ${grade.passed ? '✓' : '✗'} ${team.models.display_name.padEnd(16)} ${grade.score}/${grade.maxScore}` +
        `  attempt ${attempts}  ${record.call.latencyMs}ms  $${(record.call.usage.costUsd ?? 0).toFixed(4)}`,
    );
    for (const wrong of grade.graded.filter((g) => !g.correct)) {
      console.log(`      ✗ ${wrong.id}: ${JSON.stringify(wrong.given)} (expected ${JSON.stringify(wrong.expected)})`);
    }

    summary.push({
      name: team.models.display_name,
      score: grade.score,
      max: grade.maxScore,
      attempts,
      passed: grade.passed,
    });
  }

  // The rules check has no per-team component, so this is the strong form of the
  // claim: one byte-identical DATA block for all eight.
  assertSharedContext(contextHashes, 'rules check');

  const passed = summary.filter((s) => s.passed).length;
  const firstTry = summary.filter((s) => s.passed && s.attempts === 1).length;

  console.log(`\n  ${passed}/${summary.length} passed  (${firstTry} on the first attempt)`);
  console.log(`  shared context hash: ${contextHashes[0]}`);
  console.log(`  total cost: $${cost.toFixed(4)}`);

  if (passed < summary.length) {
    console.log('\n  *** The gate is NOT met. Models below 100% cannot proceed to the draft.');
    console.log('  *** If a model fails twice, the rulebook is the suspect — do not lower the gate.');
    process.exitCode = 1;
  } else {
    console.log(`\n  Gate met. All ${LEAGUE.teams} models can be briefed identically and demonstrably understood it.`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
