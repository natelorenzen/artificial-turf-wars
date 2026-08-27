/**
 * The two-round runner.
 *
 * Order is the design, so it is worth stating where it is enforced:
 *
 *   R1 GRADE is blind in both directions. No grader sees another grader, and no
 *      grader is told that one of the eight rosters is its own.
 *   R2 IDENTIFY runs only after every R1 card is recorded, in a fresh call with no
 *      conversation history. Nothing a model says in R2 can reach back into its
 *      grades, which is the only reason the self-preference number means anything.
 *
 * `callFn` is injected so the dry run exercises this identical code path with
 * synthetic responses and spends nothing.
 */

import type { ZodType, ZodTypeDef } from 'zod';
import { COHORT } from '@/lib/config/league';
import { assertNoIdentityLeak } from '@/lib/grades/board';
import { GRADES_SYSTEM_PROMPT, buildGradeRound, buildIdentifyRound } from '@/lib/grades/prompts';
import { cardSoftViolations, gradeCardSchema, selfGuessSchema } from '@/lib/grades/schemas';
import type { GradeCard, GraderTranscript, GradesRun, GradingBoard, SelfGuess } from '@/lib/grades/types';

/**
 * Output ceiling, matched to the league's rather than lowered.
 *
 * A grading card is eight verdicts plus sixteen pick notes — several times the size of
 * a debate response — and the client sends `reasoning.max_tokens` of
 * `LEAGUE.reasoningMaxTokens` on every call. Setting a ceiling below that would leave
 * the reservation with nothing to reserve, which is exactly the failure Findings 009
 * documented: one pool, reasoning drawn first, no room left to answer. At 20,000 the
 * 14,000 cap does its job and 6,000 tokens are held back for the JSON.
 */
export const GRADES_MAX_OUTPUT_TOKENS = 20_000;

export interface GradesCallResult<T> {
  ok: boolean;
  parsed: T | null;
  rawResponse: string | null;
  validationError: string | null;
  costUsd: number | null;
  /** Set when the failure will hit every remaining call — a budget refusal, a bad key. */
  fatal?: boolean;
}

/** Widened input type, for the same reason as the debate schemas: ours coerce. */
export type GradesSchema<T> = ZodType<T, ZodTypeDef, unknown>;

export type GradesCallFn = <T>(args: {
  openrouterId: string;
  systemPrompt: string;
  userPrompt: string;
  schema: GradesSchema<T>;
  round: string;
  modelKey: string;
}) => Promise<GradesCallResult<T>>;

export interface RunOptions {
  board: GradingBoard;
  /** modelKey -> the label of the team that model drafted. Used for scoring, never sent. */
  ownTeamByModel: Map<string, string>;
  call: GradesCallFn;
  live: boolean;
  /** Restrict the cohort, for a cheaper pilot. Defaults to all eight. */
  modelKeys?: string[];
  onEvent?: (message: string) => void;
}

/** Display names AND lab names — "Anthropic" identifies a model as precisely as "Claude Opus 5". */
function forbiddenStrings(): string[] {
  return COHORT.flatMap((m) => [m.displayName, m.lab, m.openrouterId]);
}

export async function runGrades(options: RunOptions): Promise<GradesRun> {
  const { board, ownTeamByModel, call, live, onEvent = () => {} } = options;
  const cohort = COHORT.filter((m) => !options.modelKeys || options.modelKeys.includes(m.key));
  if (cohort.length === 0) throw new Error('runGrades: no models selected');

  const forbidden = forbiddenStrings();
  const cardSchema = gradeCardSchema(board);
  const guessSchema = selfGuessSchema(board);

  const transcripts: GraderTranscript[] = cohort.map((m) => {
    const ownTeam = ownTeamByModel.get(m.key);
    if (!ownTeam) throw new Error(`runGrades: no team on the board for ${m.key}`);
    return { modelKey: m.key, ownTeam, card: null, guess: null, softViolations: [] };
  });

  let costUsd = 0;
  let calls = 0;
  let aborted: string | null = null;

  const guardedCall = async <T>(
    modelKey: string,
    openrouterId: string,
    userPrompt: string,
    schema: GradesSchema<T>,
    round: string,
  ): Promise<T | null> => {
    if (aborted) return null;
    assertNoIdentityLeak(userPrompt, forbidden);
    const result = await call({ openrouterId, systemPrompt: GRADES_SYSTEM_PROMPT, userPrompt, schema, round, modelKey });
    calls++;
    costUsd += result.costUsd ?? 0;
    if (!result.ok) {
      onEvent(`  ${round} ${modelKey}: FAILED — ${result.validationError ?? 'unknown'}`);
      if (result.fatal) {
        aborted = result.validationError ?? 'fatal provider error';
        onEvent(`\nABORTING RUN — this failure affects every remaining call.\n  ${aborted}`);
      }
      return null;
    }
    return result.parsed;
  };

  // ---- R1: blind grading --------------------------------------------------
  // One prompt, built once, sent to all eight. Not eight prompts that happen to match.
  const gradePrompt = buildGradeRound(board);
  onEvent(`R1 blind grading — ${cohort.length} graders, ${board.teams.length} drafts, board ${board.boardId}`);
  for (const t of transcripts) {
    const model = cohort.find((m) => m.key === t.modelKey)!;
    const card = await guardedCall(t.modelKey, model.openrouterId, gradePrompt, cardSchema, 'R1');
    t.card = (card as GradeCard) ?? null;
    if (t.card) t.softViolations = cardSoftViolations(t.card);
  }

  // ---- R2: self-identification -------------------------------------------
  const identifyPrompt = buildIdentifyRound(board);
  onEvent('R2 self-identification');
  for (const t of transcripts) {
    const model = cohort.find((m) => m.key === t.modelKey)!;
    const guess = await guardedCall(t.modelKey, model.openrouterId, identifyPrompt, guessSchema, 'R2');
    t.guess = (guess as SelfGuess) ?? null;
  }

  return { board, transcripts, costUsd: Number(costUsd.toFixed(4)), calls, live, aborted };
}
