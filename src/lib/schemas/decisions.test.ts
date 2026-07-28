import { describe, expect, it } from 'vitest';
import { extractJson, reasoningSoftViolations, rulesCheckSchema } from './decisions';
import { gradeRulesCheck } from '@/lib/preseason/rules-check';

describe('rules check schema', () => {
  it('accepts a numeric answer to a question that asked for a number', () => {
    // A real cohort run failed on exactly this: the model answered correctly and was
    // rejected for JSON typing.
    const parsed = rulesCheckSchema.parse({
      answers: [
        { id: 'ppr_line', answer: 20.2 },
        { id: 'margin_is_worthless', answer: 0 },
        { id: 'three_wr', answer: true },
        { id: 'ranking_basis', answer: 'head-to-head' },
      ],
    });
    expect(parsed.answers.map((a) => a.answer)).toEqual(['20.2', '0', 'true', 'head-to-head']);
  });

  it('grades a numeric answer identically to its string form', () => {
    const asNumber = rulesCheckSchema.parse({ answers: [{ id: 'ppr_line', answer: 20.2 }] });
    const asString = rulesCheckSchema.parse({ answers: [{ id: 'ppr_line', answer: '20.2' }] });
    const grade = (a: typeof asNumber) => gradeRulesCheck(a.answers).graded.find((g) => g.id === 'ppr_line')!.correct;
    expect(grade(asNumber)).toBe(true);
    expect(grade(asString)).toBe(true);
  });

  it('still rejects a structurally wrong response', () => {
    expect(() => rulesCheckSchema.parse({ answers: [{ answer: 'orphaned' }] })).toThrow();
    expect(() => rulesCheckSchema.parse({ answers: 'not an array' })).toThrow();
  });
});

describe('extractJson', () => {
  it('reads bare JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('reads JSON the model wrapped in a fence it was told not to use', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('reads JSON buried in preamble prose', () => {
    expect(extractJson('Sure! Here is my answer:\n{"a":1}\nHope that helps.')).toEqual({ a: 1 });
  });

  it('throws rather than guessing when there is no object at all', () => {
    expect(() => extractJson('I would rather not.')).toThrow(/no JSON object/);
  });
});

describe('reasoning soft violations', () => {
  const base = {
    headline: 'A sentence.',
    closest_call: 'A call.',
    what_would_change_it: 'A change.',
    confidence: 0.5,
  };

  it('is silent on a compliant response', () => {
    expect(reasoningSoftViolations({ ...base, key_factors: ['one', 'two', 'three'] })).toEqual([]);
  });

  it('records a fifth bullet without failing the decision', () => {
    const notes = reasoningSoftViolations({ ...base, key_factors: ['a', 'b', 'c', 'd', 'e'] });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('max 4');
  });

  it('records an over-long bullet', () => {
    const notes = reasoningSoftViolations({ ...base, key_factors: ['w '.repeat(25).trim(), 'b'] });
    expect(notes.some((n) => n.includes('words'))).toBe(true);
  });
});
