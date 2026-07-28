/**
 * Phase 2 gate (SPEC §9): one model call, end to end, strictly parsed.
 *
 *   npx tsx --env-file=.env.local scripts/smoke.ts
 *   npx tsx --env-file=.env.local scripts/smoke.ts --model anthropic/claude-opus-5
 *   npx tsx --env-file=.env.local scripts/smoke.ts --all      # all eight, sequential
 *
 * Deliberately runs the RULES COMPREHENSION CHECK rather than a lineup: it exercises
 * the whole path — generated rulebook, prompt assembly, context hashing, OpenRouter,
 * strict zod parse, deterministic grading — while needing no league state and no
 * database. Nothing is written anywhere.
 *
 * The grade is real signal, not decoration. If a frontier model cannot restate our
 * scoring table from the rulebook, the rulebook is the problem, and it is far cheaper
 * to learn that now than in late August.
 */

import { COHORT, LEAGUE } from '@/lib/config/league';
import { assemblePrompt, assertContextCeiling } from '@/lib/prompt/assemble';
import { callModel } from '@/lib/openrouter/client';
import { rulesCheckSchema } from '@/lib/schemas/decisions';
import { buildRulesCheck, gradeRulesCheck, rulesCheckData } from '@/lib/preseason/rules-check';

const OUTPUT_EXAMPLE = {
  answers: [
    { id: 'question_id', answer: 'your answer' },
    { id: 'another_id', answer: 'your answer' },
  ],
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function runOne(openrouterId: string, displayName: string) {
  const questions = buildRulesCheck();
  const data = rulesCheckData(questions);

  const prompt = assemblePrompt({
    data,
    task: `Answer all ${questions.length} questions. Return one object per question, using the exact id given.`,
    outputExample: OUTPUT_EXAMPLE,
  });
  assertContextCeiling(prompt.estimatedTokens, `rules_check for ${openrouterId}`);

  process.stdout.write(`\n${displayName}  (${openrouterId})\n`);
  process.stdout.write(`  prompt ~${prompt.estimatedTokens} tokens, context ${prompt.contextHash.slice(0, 12)}…\n`);

  const result = await callModel({
    openrouterId,
    systemPrompt: prompt.systemPrompt,
    userPrompt: prompt.userPrompt,
    schema: rulesCheckSchema,
  });

  if (!result.ok) {
    console.log(`  ✗ ${result.providerFailure ? 'PROVIDER FAILURE' : 'INVALID RESPONSE'}`);
    console.log(`    ${result.validationError}`);
    if (result.rawResponse) console.log(`    raw: ${result.rawResponse.slice(0, 400)}`);
    return { displayName, passed: false, score: 0, max: questions.length, cost: result.usage.costUsd ?? 0 };
  }

  const grade = gradeRulesCheck(result.parsed!.answers, questions);
  const cost = result.usage.costUsd ?? 0;

  console.log(
    `  ${grade.passed ? '✓' : '✗'} ${grade.score}/${grade.maxScore}` +
      `   ${result.latencyMs}ms   ${result.usage.tokensIn ?? '?'}→${result.usage.tokensOut ?? '?'} tok` +
      (result.usage.reasoningTokens ? ` (${result.usage.reasoningTokens} reasoning)` : '') +
      `   $${cost.toFixed(4)}`,
  );

  for (const wrong of grade.graded.filter((g) => !g.correct)) {
    console.log(`    ✗ ${wrong.id}: answered ${JSON.stringify(wrong.given)}, expected ${JSON.stringify(wrong.expected)}`);
  }

  return { displayName, passed: grade.passed, score: grade.score, max: grade.maxScore, cost };
}

async function main() {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error('OPENROUTER_API_KEY is not set. Add it to .env.local and re-run.');
    process.exit(1);
  }

  const targets = process.argv.includes('--all')
    ? COHORT.map((m) => ({ id: m.openrouterId, name: m.displayName }))
    : (() => {
        const id = arg('model') ?? COHORT[0].openrouterId;
        const found = COHORT.find((m) => m.openrouterId === id);
        return [{ id, name: found?.displayName ?? id }];
      })();

  console.log(`Rules comprehension check — ${buildRulesCheck().length} questions, rulebook ${LEAGUE.season}`);

  const results = [];
  // Sequential: same upstream conditions for every model, and this is the run whose
  // results we may quote publicly.
  for (const target of targets) {
    results.push(await runOne(target.id, target.name));
  }

  const total = results.reduce((sum, r) => sum + r.cost, 0);
  const passed = results.filter((r) => r.passed).length;
  console.log(`\n${passed}/${results.length} scored 100%.  Total cost $${total.toFixed(4)}.`);

  if (targets.length === COHORT.length && passed < results.length) {
    console.log('\nA model below 100% gets the rulebook re-injected and re-answers (SPEC §4.1b).');
    console.log('If it fails twice, fix the rulebook — do not lower the gate.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
