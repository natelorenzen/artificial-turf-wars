/**
 * Strict zod schemas for the grading rounds.
 *
 * Same policy as the league and the debate schemas: STRICT on anything that changes a
 * measurement, LENIENT on cosmetics.
 *
 * Strict here means the ranking must be a true permutation of the eight labels, every
 * team must be graded exactly once, a letter must be on the scale we published, and a
 * "best pick" must be a player that team actually drafted. Every one of those is load
 * bearing — a ranking with a team missing cannot be correlated with another ranking,
 * and a best-pick vote for somebody on a different roster is not a vote.
 *
 * Lenient means label spelling and letter formatting. A model that writes `"a-"` or
 * `"C"` instead of `"Team C"` has answered the question, and recording that as a
 * failed model would be a lie about what happened. Anything genuinely ambiguous still
 * fails.
 *
 * The schema is a FACTORY because validity depends on the board: which labels exist,
 * and which players are on which roster. A schema that only checked shapes would let
 * the single most corrupting error through — a grade attached to the wrong team.
 */

import { z } from 'zod';
import { GRADE_SCALE, type Grade, type GradingBoard } from '@/lib/grades/types';

export const VERDICT_WORD_LIMIT = 40;
export const WHY_WORD_LIMIT = 25;

/**
 * `Team C`, `team c`, `C`, `"C "` all mean Team C. Anything else is left alone and
 * will fail the enum below, which is what we want.
 */
export function normalizeLabel(raw: string): string {
  const text = String(raw).trim().replace(/\s+/g, ' ');
  const bare = text.replace(/^team\s+/i, '').toUpperCase();
  return /^[A-Z]$/.test(bare) ? `Team ${bare}` : text;
}

/** `a-`, `A -`, `A minus`, `A_MINUS` all mean A-. */
export function normalizeGrade(raw: string): string {
  return String(raw)
    .trim()
    .toUpperCase()
    .replace(/[\s_]*PLUS$/, '+')
    .replace(/[\s_]*MINUS$/, '-')
    .replace(/\s+/g, '');
}

const confidence = z.coerce.number().min(0).max(1);

export function gradeCardSchema(board: GradingBoard) {
  const labels = board.teams.map((t) => t.label);
  const rosterOf = new Map(board.teams.map((t) => [t.label, new Set(t.players.map((p) => p.playerId))]));

  const label = z.string().transform(normalizeLabel).pipe(z.enum(labels as [string, ...string[]]));
  const grade = z.string().transform(normalizeGrade).pipe(z.enum([...GRADE_SCALE] as [Grade, ...Grade[]]));

  const teamGrade = z.object({
    team: label,
    grade,
    verdict: z.string().min(1),
    bestPick: z.coerce.string().min(1),
    bestPickWhy: z.string().min(1),
    worstPick: z.coerce.string().min(1),
    worstPickWhy: z.string().min(1),
  });

  return z
    .object({
      criterion: z.string().min(1),
      ranking: z.array(label).length(labels.length),
      grades: z.array(teamGrade).length(labels.length),
    })
    .superRefine((card, ctx) => {
      if (new Set(card.ranking).size !== labels.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'ranking must list each team exactly once' });
      }
      const graded = card.grades.map((g) => g.team);
      if (new Set(graded).size !== labels.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'grades must cover each team exactly once' });
      }
      for (const g of card.grades) {
        const roster = rosterOf.get(g.team);
        if (!roster) continue;
        // A pick attributed to a team that did not draft the player is not a
        // formatting slip: it means the model lost track of whose roster it was
        // reading, and every other claim it made about that team is now suspect.
        if (!roster.has(g.bestPick)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${g.team} bestPick ${g.bestPick} is not on that roster` });
        }
        if (!roster.has(g.worstPick)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${g.team} worstPick ${g.worstPick} is not on that roster` });
        }
      }
    });
}

export function selfGuessSchema(board: GradingBoard) {
  const labels = board.teams.map((t) => t.label);
  return z.object({
    team: z.string().transform(normalizeLabel).pipe(z.enum(labels as [string, ...string[]])),
    confidence,
    why: z.string().min(1),
  });
}

/** Deviations we publish next to the answer rather than failing the model over. */
export function cardSoftViolations(card: { grades: { team: string; verdict: string; bestPickWhy: string; worstPickWhy: string }[] }): string[] {
  const notes: string[] = [];
  const words = (s: string) => s.trim().split(/\s+/).length;
  for (const g of card.grades) {
    if (words(g.verdict) > VERDICT_WORD_LIMIT) {
      notes.push(`${g.team} verdict: ${words(g.verdict)} words (max ${VERDICT_WORD_LIMIT})`);
    }
    for (const [field, text] of [['bestPickWhy', g.bestPickWhy], ['worstPickWhy', g.worstPickWhy]] as const) {
      if (words(text) > WHY_WORD_LIMIT) {
        notes.push(`${g.team} ${field}: ${words(text)} words (max ${WHY_WORD_LIMIT})`);
      }
    }
  }
  return notes;
}
