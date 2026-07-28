/**
 * The rules comprehension check (SPEC §4.1b Step 2) — the fairness gate.
 *
 * Before any consequential decision, each model answers a fixed set of questions
 * with objectively correct answers DERIVED FROM THE CONFIG, scored deterministically
 * in code. A model scoring below 100% has the rulebook re-injected and re-answers,
 * and the failure is published.
 *
 * The point: a model that cannot restate the scoring table has not been outreasoned,
 * it has been misbriefed, and every later decision it makes is uninterpretable.
 * "All eight models scored 12/12 before the draft" is the single most credible
 * sentence on the methodology page — which is exactly why an ambiguous question
 * would discredit it. Every question below has one arithmetically forced answer.
 */

import {
  DEF_SCORING,
  KICKER_SCORING,
  LEAGUE,
  OFFENSE_SCORING,
  SLOTS,
} from '@/lib/config/league';
import { pointsAllowedPoints, round2 } from '@/lib/scoring/engine';

export interface RulesQuestion {
  id: string;
  prompt: string;
  /** The one correct answer, computed from config — never hand-typed. */
  answer: string;
  kind: 'number' | 'text';
  /** Extra accepted spellings for text answers. Never loosens a numeric answer. */
  accepts?: string[];
  /** What rule this question protects. Published alongside the scores. */
  tests: string;
}

export function buildRulesCheck(): RulesQuestion[] {
  const s = OFFENSE_SCORING;
  const opponents = LEAGUE.teams - 1;

  // Q1 — the full-PPR vs half-PPR prior, the exact bias §4.1-i exists to remove.
  const q1 = round2(6 * s.rec + 82 * s.rec_yd + 1 * s.rec_td);

  // Q6 — a 45-yard FG against a reception plus 20 receiving yards.
  const fg45 = KICKER_SCORING.fg_40_49;
  const catch20 = round2(s.rec + 20 * s.rec_yd);

  // Q8 — a quarterback line, which is where the -1 vs -2 interception prior bites.
  const q8 = round2(287 * s.pass_yd + 2 * s.pass_td + 1 * s.pass_int + 1 * s.rush_td);

  // Q9 — a defense with a shutout, which is the largest single DEF swing.
  const q9 = round2(3 * DEF_SCORING.sack + 2 * DEF_SCORING.int + pointsAllowedPoints(0).points);

  // Q12 — banded points allowed at a boundary value.
  const q12 = pointsAllowedPoints(13).points;

  return [
    {
      id: 'ppr_line',
      prompt:
        'A wide receiver catches 6 passes for 82 receiving yards and 1 receiving touchdown. How many fantasy points does he score in this league? Answer with a number only.',
      answer: String(q1),
      kind: 'number',
      tests: 'full PPR reception value',
    },
    {
      id: 'allplay_record',
      prompt: `Your lineup outscores 5 of the other ${opponents} teams this week. What is your all-play record for that week? Answer in the form W-L.`,
      answer: `5-${opponents - 5}`,
      kind: 'text',
      tests: 'the stated objective is all-play',
    },
    {
      id: 'budget_split',
      prompt: `You bid $60 for your draft slot and win it. How many dollars of FAAB do you have for the entire season? Answer with a number only.`,
      answer: String(LEAGUE.budgetTotal - 60),
      kind: 'number',
      tests: 'one shared budget funds both the auction and waivers',
    },
    {
      id: 'three_wr',
      prompt:
        'Can you start three wide receivers in a single week? Answer yes or no.',
      answer: 'yes',
      kind: 'text',
      accepts: ['yes', 'y', 'true'],
      tests: 'FLEX eligibility',
    },
    {
      id: 'empty_slot',
      prompt:
        'Your only kicker is on a bye week and you make no roster move. How many points does your K slot score? Answer with a number only.',
      answer: '0',
      kind: 'number',
      tests: 'an unfilled starting slot scores zero',
    },
    {
      id: 'fg_vs_catch',
      prompt:
        'Which is worth more in this league: a made 45-yard field goal, or one reception for 20 receiving yards? Answer "field goal" or "reception".',
      answer: fg45 > catch20 ? 'field goal' : 'reception',
      kind: 'text',
      accepts: fg45 > catch20 ? ['field goal', 'fieldgoal', 'fg', 'the field goal'] : ['reception', 'the reception'],
      tests: 'kicker band values against receiving value',
    },
    {
      id: 'return_td_owner',
      prompt:
        'A cornerback returns a punt for a touchdown. In this league, which roster slot is credited with those 6 points: the individual returner, or the DEF/ST unit? Answer "returner" or "DEF/ST".',
      answer: 'def/st',
      kind: 'text',
      accepts: ['def/st', 'def', 'defst', 'def st', 'the def/st unit', 'defense'],
      tests: 'return-TD ownership, so it is never double-counted',
    },
    {
      id: 'qb_line',
      prompt:
        'A quarterback throws for 287 yards and 2 touchdowns with 1 interception, and also runs for 1 touchdown. How many fantasy points? Answer with a number only.',
      answer: String(q8),
      kind: 'number',
      tests: 'interception value is -1, not -2',
    },
    {
      id: 'def_line',
      prompt:
        'A team defense records 3 sacks and 2 interceptions and allows 0 points. How many fantasy points? Answer with a number only.',
      answer: String(q9),
      kind: 'number',
      tests: 'DEF/ST scoring plus the shutout band',
    },
    {
      id: 'roster_move',
      prompt: `Your roster is full at ${LEAGUE.rosterSize} players and you win a waiver claim. How many players must you drop to complete it? Answer with a number only.`,
      answer: '1',
      kind: 'number',
      tests: 'every add requires a drop',
    },
    {
      id: 'tie_rule',
      prompt:
        'Your lineup scores exactly the same number of points as one other team this week. How many all-play wins does that single comparison give you? Answer with a number only.',
      answer: '0.5',
      kind: 'number',
      tests: 'the exact-tie rule',
    },
    {
      id: 'pts_allowed_band',
      prompt:
        'Your team defense allows exactly 13 points. How many fantasy points does the points-allowed category award? Answer with a number only.',
      answer: String(q12),
      kind: 'number',
      tests: 'points-allowed band boundaries',
    },
    {
      id: 'starters_count',
      prompt: `How many players do you start each week? Answer with a number only.`,
      answer: String(Object.values(SLOTS).reduce((a, b) => a + b, 0)),
      kind: 'number',
      tests: 'the full Yahoo starting nine including K and DEF/ST',
    },
  ];
}

export interface GradedAnswer {
  id: string;
  given: string;
  expected: string;
  correct: boolean;
}

export interface RulesCheckGrade {
  score: number;
  maxScore: number;
  passed: boolean;
  graded: GradedAnswer[];
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/[.$"']/g, '').replace(/\s+/g, ' ');
}

function parseNumber(value: string): number | null {
  const match = value.replace(/[$,]/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Deterministic grading. No model call, no partial credit (SPEC §8.4). */
export function gradeRulesCheck(
  answers: { id: string; answer: string }[],
  questions = buildRulesCheck(),
): RulesCheckGrade {
  const given = new Map(answers.map((a) => [a.id, a.answer]));

  const graded = questions.map((q) => {
    const raw = given.get(q.id) ?? '';
    let correct = false;

    if (q.kind === 'number') {
      const value = parseNumber(raw);
      const expected = Number(q.answer);
      correct = value !== null && Math.abs(value - expected) < 0.005;
    } else {
      const normalized = normalizeText(raw);
      const accepted = (q.accepts ?? [q.answer]).map(normalizeText);
      correct = accepted.includes(normalized) || accepted.some((a) => normalized === a);
    }

    return { id: q.id, given: raw, expected: q.answer, correct };
  });

  const score = graded.filter((g) => g.correct).length;
  return { score, maxScore: questions.length, passed: score === questions.length, graded };
}

/** The DATA block for the check — questions only, never the answers. */
export function rulesCheckData(questions = buildRulesCheck()) {
  return {
    instructions:
      'Answer every question from the RULEBOOK above. Each has one objectively correct answer. Answer exactly as the question asks — a number only where a number is requested.',
    questions: questions.map((q) => ({ id: q.id, question: q.prompt })),
  };
}
