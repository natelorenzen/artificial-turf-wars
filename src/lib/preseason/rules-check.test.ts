import { describe, expect, it } from 'vitest';
import { buildRulesCheck, gradeRulesCheck, rulesCheckData } from './rules-check';
import { rulebook } from '@/lib/prompt/rulebook';

const questions = buildRulesCheck();

describe('the rules comprehension check', () => {
  it('asks at least a dozen questions, each with a unique id', () => {
    expect(questions.length).toBeGreaterThanOrEqual(12);
    expect(new Set(questions.map((q) => q.id)).size).toBe(questions.length);
  });

  it('derives its answers from the config, matching the spec worked examples', () => {
    const byId = new Map(questions.map((q) => [q.id, q.answer]));
    expect(byId.get('ppr_line')).toBe('20.2'); // 6 + 8.2 + 6
    expect(byId.get('allplay_record')).toBe('5-2');
    expect(byId.get('budget_split')).toBe('40');
    expect(byId.get('three_wr')).toBe('yes');
    expect(byId.get('empty_slot')).toBe('0');
    expect(byId.get('fg_vs_catch')).toBe('field goal'); // 4 beats 3
    expect(byId.get('qb_line')).toBe('24.48'); // 11.48 + 8 - 1 + 6
    expect(byId.get('def_line')).toBe('17'); // 3 + 4 + 10
    expect(byId.get('tie_rule')).toBe('0.5');
    expect(byId.get('pts_allowed_band')).toBe('4');
    expect(byId.get('starters_count')).toBe('9');
  });

  it('is answerable from the rulebook alone — every rule it tests is stated there', () => {
    const text = rulebook();
    expect(text).toContain('FULL PPR');
    expect(text).toContain('half a win');
    expect(text).toContain('An unfilled starting slot scores 0');
    expect(text).toContain('every add requires a drop');
    expect(text).toContain('credited to the DEF/ST unit');
  });

  it('never leaks the answers into the DATA block', () => {
    const serialized = JSON.stringify(rulesCheckData(questions));
    expect(serialized).not.toContain('20.2');
    expect(serialized).not.toContain('"answer"');
  });
});

describe('grading', () => {
  const perfect = questions.map((q) => ({ id: q.id, answer: q.answer }));

  it('passes only at 100%', () => {
    const grade = gradeRulesCheck(perfect, questions);
    expect(grade.score).toBe(questions.length);
    expect(grade.passed).toBe(true);

    const oneWrong = [...perfect];
    oneWrong[0] = { id: oneWrong[0].id, answer: '19.2' };
    const failed = gradeRulesCheck(oneWrong, questions);
    expect(failed.passed).toBe(false);
    expect(failed.score).toBe(questions.length - 1);
    expect(failed.graded.find((g) => !g.correct)!.id).toBe('ppr_line');
  });

  it('accepts a number wrapped in prose or currency, since only the value is asked for', () => {
    expect(gradeRulesCheck([{ id: 'budget_split', answer: '$40' }], questions).graded[2].correct).toBe(true);
    expect(
      gradeRulesCheck([{ id: 'ppr_line', answer: '20.20 points' }], questions).graded[0].correct,
    ).toBe(true);
  });

  it('does not accept a near-miss number', () => {
    expect(gradeRulesCheck([{ id: 'ppr_line', answer: '20.5' }], questions).graded[0].correct).toBe(false);
    // Half-PPR would give 17.2 — exactly the prior this question exists to catch.
    expect(gradeRulesCheck([{ id: 'ppr_line', answer: '17.2' }], questions).graded[0].correct).toBe(false);
  });

  it('accepts documented spellings of a text answer only', () => {
    expect(gradeRulesCheck([{ id: 'return_td_owner', answer: 'DEF/ST' }], questions).graded[6].correct).toBe(true);
    expect(gradeRulesCheck([{ id: 'return_td_owner', answer: 'the returner' }], questions).graded[6].correct).toBe(false);
  });

  it('scores a missing answer as wrong rather than throwing', () => {
    const grade = gradeRulesCheck([], questions);
    expect(grade.score).toBe(0);
    expect(grade.graded).toHaveLength(questions.length);
  });
});
