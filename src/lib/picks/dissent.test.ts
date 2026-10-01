import { describe, expect, it } from 'vitest';
import { dissentKeys, dissents, type DissentInput } from './dissent';
import type { Pick } from './grade';

function set(model: string, picks: [string, string, number][]): DissentInput {
  return {
    model,
    modelKey: model.toLowerCase(),
    picks: new Map(picks.map(([gameKey, pick, winProb]) => [gameKey, { gameKey, pick, winProb } as Pick])),
  };
}

// Week 4, 2026, cut down: NYJ@CHI went 7–1, JAX@CIN 5–3, and one game splits evenly.
const market = new Map([
  ['NYJ@CHI', new Map([['CHI', 0.616], ['NYJ', 0.384]])],
  ['JAX@CIN', new Map([['CIN', 0.563], ['JAX', 0.437]])],
]);

const sets = [
  set('Grok', [['NYJ@CHI', 'NYJ', 0.56], ['JAX@CIN', 'JAX', 0.55], ['A@B', 'A', 0.6]]),
  set('Claude', [['NYJ@CHI', 'CHI', 0.57], ['JAX@CIN', 'JAX', 0.52], ['A@B', 'A', 0.55]]),
  set('Gemini', [['NYJ@CHI', 'CHI', 0.62], ['JAX@CIN', 'CIN', 0.55], ['A@B', 'B', 0.6]]),
  set('Kimi', [['NYJ@CHI', 'CHI', 0.55], ['JAX@CIN', 'CIN', 0.55], ['A@B', 'B', 0.55]]),
  set('Qwen', [['NYJ@CHI', 'CHI', 0.55], ['JAX@CIN', 'CIN', 0.55]]),
];

describe('dissents', () => {
  const list = dissents(sets, market);

  it('finds every minority pick and nothing on the majority side', () => {
    expect(list.map((d) => `${d.model} ${d.pick.pick}`)).toEqual(['Grok NYJ', 'Grok JAX', 'Claude JAX']);
  });

  it('says what the majority was and how big', () => {
    const nyj = list.find((d) => d.pick.pick === 'NYJ')!;
    expect(nyj).toMatchObject({ majority: 'CHI', agree: 4, of: 5 });
  });

  it("measures the edge against the market's price for the team the model picked", () => {
    const nyj = list.find((d) => d.pick.pick === 'NYJ')!;
    expect(nyj.marketProb).toBe(0.384);
    expect(nyj.claimedEdge).toBeCloseTo(0.176, 6);
  });

  it('skips a game the panel split evenly', () => {
    expect(list.some((d) => d.pick.gameKey === 'A@B')).toBe(false);
  });

  it('leaves the edge null without a line, and sorts those last', () => {
    const noLine = dissents(sets, new Map([['JAX@CIN', market.get('JAX@CIN')!]]));
    expect(noLine.at(-1)).toMatchObject({ model: 'Grok', marketProb: null, claimedEdge: null });
  });

  it('keys cells for the grid', () => {
    expect(dissentKeys(list)).toEqual(new Set(['NYJ@CHI|grok', 'JAX@CIN|grok', 'JAX@CIN|claude']));
  });
});
