import { describe, expect, it } from 'vitest';
import { assignAnalystLabels, assertNoAnalystLeak } from '@/lib/debate/labels';
import { buildSlate, type ProjectionRow } from '@/lib/debate/slate';
import { tallyDebate, readTally } from '@/lib/debate/tally';
import type { AnalystTranscript, Slate, Stance } from '@/lib/debate/types';

function slateOf(ids: string[]): Slate {
  return {
    slateId: 'test',
    season: 2026,
    createdAt: '2026-07-31T00:00:00.000Z',
    players: ids.map((id, i) => ({
      playerId: id,
      name: `Player ${id}`,
      position: 'RB' as const,
      team: 'XX',
      projectedPoints: 200 - i,
      projectionRank: i + 1,
      adp: 10 + i,
      adpRank: i + 1,
      divergence: 0,
    })),
  };
}

/** `r0`/`r3` are per-player stance strings, one char per player: C = CHALK, W = WALK. */
function analyst(label: string, ids: string[], r0: string, r3: string): AnalystTranscript {
  const calls = (spec: string) =>
    ids.map((id, i) => ({
      playerId: id,
      stance: (spec[i] === 'C' ? 'CHALK' : 'WALK') as Stance,
      confidence: 0.6,
      rationale: 'x',
    }));
  return {
    modelKey: label.toLowerCase().replace(/\s+/g, '-'),
    label,
    r0: { calls: calls(r0) },
    r1: { challenges: [] },
    r2: { rebuttals: [] },
    r3: { calls: calls(r3) },
  };
}

describe('tallyDebate — herd rate', () => {
  it('reports total herding when every mover joins the majority', () => {
    const ids = ['p1'];
    const slate = slateOf(ids);
    // 5 CHALK / 3 WALK at R0; all three dissenters fold to CHALK.
    const transcripts = [
      analyst('Analyst A', ids, 'C', 'C'),
      analyst('Analyst B', ids, 'C', 'C'),
      analyst('Analyst C', ids, 'C', 'C'),
      analyst('Analyst D', ids, 'C', 'C'),
      analyst('Analyst E', ids, 'C', 'C'),
      analyst('Analyst F', ids, 'W', 'C'),
      analyst('Analyst G', ids, 'W', 'C'),
      analyst('Analyst H', ids, 'W', 'C'),
    ];
    const t = tallyDebate(slate, transcripts);

    expect(t.herdRate).toBe(1);
    expect(t.totalFlips).toBe(3);
    expect(t.flipsToMajority).toBe(3);
    expect(t.dissentSurvival).toBe(0);
    expect(t.unanimousR0).toBe(0);
    expect(t.unanimousR3).toBe(1);
    expect(t.players[0].convergedToUnanimous).toBe(true);
    expect(readTally(t)).toMatch(/^HERDING/);
  });

  it('returns null herd rate when nobody moves, and never 0', () => {
    const ids = ['p1', 'p2'];
    const slate = slateOf(ids);
    const transcripts = [
      analyst('Analyst A', ids, 'CW', 'CW'),
      analyst('Analyst B', ids, 'CC', 'CC'),
      analyst('Analyst C', ids, 'WC', 'WC'),
    ];
    const t = tallyDebate(slate, transcripts);

    // The distinction matters: 0 would read as "moved, but away from the crowd",
    // which is the opposite finding from "did not move at all".
    expect(t.herdRate).toBeNull();
    expect(t.totalFlips).toBe(0);
    expect(readTally(t)).toMatch(/^NO MOVEMENT/);
  });

  it('scores movement away from the majority as anti-herding', () => {
    const ids = ['p1'];
    const slate = slateOf(ids);
    // 6 CHALK / 2 WALK; two of the majority defect to WALK instead.
    const transcripts = [
      analyst('Analyst A', ids, 'C', 'W'),
      analyst('Analyst B', ids, 'C', 'W'),
      analyst('Analyst C', ids, 'C', 'C'),
      analyst('Analyst D', ids, 'C', 'C'),
      analyst('Analyst E', ids, 'C', 'C'),
      analyst('Analyst F', ids, 'C', 'C'),
      analyst('Analyst G', ids, 'W', 'W'),
      analyst('Analyst H', ids, 'W', 'W'),
    ];
    const t = tallyDebate(slate, transcripts);

    expect(t.herdRate).toBe(0);
    expect(t.flipsFromMajority).toBe(2);
    expect(t.dissentSurvival).toBe(1); // both original dissenters held
    expect(readTally(t)).toMatch(/^VIABLE/);
  });

  it('excludes flips on a tied player from the herd rate', () => {
    const ids = ['p1'];
    const slate = slateOf(ids);
    // Exactly 2-2 at R0, so there is no majority to move toward. One analyst flips.
    const transcripts = [
      analyst('Analyst A', ids, 'C', 'C'),
      analyst('Analyst B', ids, 'C', 'C'),
      analyst('Analyst C', ids, 'W', 'W'),
      analyst('Analyst D', ids, 'W', 'C'),
    ];
    const t = tallyDebate(slate, transcripts);

    expect(t.players[0].majorityR0).toBeNull();
    expect(t.totalFlips).toBe(1);
    // Counted as a flip, but excluded from the directional maths — including it would
    // have produced herdRate 0 and read as evidence against herding we never saw.
    expect(t.flipsToMajority).toBe(0);
    expect(t.flipsFromMajority).toBe(0);
    expect(t.herdRate).toBeNull();
    // Nobody is in the "minority" of an even split.
    expect(t.minorityPositionsR0).toBe(0);
    expect(t.dissentSurvival).toBeNull();
  });

  it('tracks per-analyst holding and dissent survival', () => {
    const ids = ['p1', 'p2'];
    const slate = slateOf(ids);
    const transcripts = [
      analyst('Analyst A', ids, 'CC', 'CC'),
      analyst('Analyst B', ids, 'CC', 'CC'),
      analyst('Analyst C', ids, 'WW', 'CW'), // folds on p1, holds its dissent on p2
    ];
    const t = tallyDebate(slate, transcripts);
    const c = t.analysts.find((a) => a.label === 'Analyst C')!;

    expect(c.minorityPositionsR0).toBe(2);
    expect(c.minorityPositionsHeld).toBe(1);
    expect(c.flipped).toBe(1);
    expect(c.held).toBe(1);
    expect(c.flippedToMajority).toBe(1);
    expect(t.dissentSurvival).toBe(0.5);
  });

  it('counts challenges issued, received, and silence', () => {
    const ids = ['p1'];
    const slate = slateOf(ids);
    const a = analyst('Analyst A', ids, 'C', 'C');
    a.r1 = {
      challenges: [
        { playerId: 'p1', target: 'Analyst B', claim: 'wrong', evidence: 'because', confidence: 0.7 },
      ],
    };
    const b = analyst('Analyst B', ids, 'W', 'W');
    b.r2 = { rebuttals: [{ playerId: 'p1', challenger: 'Analyst A', response: 'no', concedes: false }] };
    const t = tallyDebate(slate, [a, b]);

    expect(t.totalChallenges).toBe(1);
    expect(t.analysts.find((x) => x.label === 'Analyst A')!.challengesIssued).toBe(1);
    expect(t.analysts.find((x) => x.label === 'Analyst B')!.challengesReceived).toBe(1);
    // B issued none. Silence is a legitimate result and must be counted, not hidden.
    expect(t.silentAnalysts).toBe(1);
  });
});

describe('assignAnalystLabels', () => {
  const keys = ['m1', 'm2', 'm3', 'm4'];

  it('is deterministic for a given slate id', () => {
    const a = assignAnalystLabels(keys, 'slate-1');
    const b = assignAnalystLabels(keys, 'slate-1');
    expect([...a.byModel]).toEqual([...b.byModel]);
  });

  it('reshuffles across slates so no analyst builds a reputation', () => {
    const a = assignAnalystLabels(keys, 'slate-1');
    const b = assignAnalystLabels(keys, 'slate-2');
    expect([...a.byModel]).not.toEqual([...b.byModel]);
  });

  it('round-trips label back to model', () => {
    const { byModel, byLabel } = assignAnalystLabels(keys, 'slate-1');
    for (const k of keys) expect(byLabel.get(byModel.get(k)!)).toBe(k);
  });

  it('rejects duplicate model keys rather than silently merging them', () => {
    expect(() => assignAnalystLabels(['m1', 'm1'], 's')).toThrow(/duplicate/);
  });
});

describe('assertNoAnalystLeak', () => {
  it('throws when a lab or display name reaches a prompt', () => {
    expect(() => assertNoAnalystLeak('Analyst A says Claude Opus 5 is wrong', ['Claude Opus 5'])).toThrow(
      /leaks model identity/,
    );
  });

  it('passes a prompt that only uses labels', () => {
    expect(() => assertNoAnalystLeak('Analyst A challenges Analyst C', ['Claude Opus 5', 'OpenAI'])).not.toThrow();
  });
});

describe('buildSlate', () => {
  const rows: ProjectionRow[] = [
    // projection rank 1, ADP rank 4 → market is low on him (divergence -3)
    { playerId: 'a', name: 'A', position: 'RB', nflTeam: 'X', projPts: 300, adp: 40 },
    { playerId: 'b', name: 'B', position: 'RB', nflTeam: 'X', projPts: 280, adp: 30 },
    { playerId: 'c', name: 'C', position: 'RB', nflTeam: 'X', projPts: 260, adp: 20 },
    // projection rank 4, ADP rank 1 → market is high on him (divergence +3)
    { playerId: 'd', name: 'D', position: 'RB', nflTeam: 'X', projPts: 240, adp: 10 },
  ];

  it('picks the strongest disagreement in both directions', () => {
    const slate = buildSlate(rows, { season: 2026, positions: ['RB'], perPosition: 2 });
    const ids = slate.players.map((p) => p.playerId).sort();
    expect(ids).toEqual(['a', 'd']);

    const a = slate.players.find((p) => p.playerId === 'a')!;
    expect(a.projectionRank).toBe(1);
    expect(a.adpRank).toBe(4);
    expect(a.divergence).toBe(-3);
  });

  it('produces a stable id for the same board, and a different one otherwise', () => {
    const one = buildSlate(rows, { season: 2026, positions: ['RB'], perPosition: 2 });
    const two = buildSlate(rows, { season: 2026, positions: ['RB'], perPosition: 2 });
    expect(one.slateId).toBe(two.slateId);

    const wider = buildSlate(rows, { season: 2026, positions: ['RB'], perPosition: 4 });
    expect(wider.slateId).not.toBe(one.slateId);
  });

  it('ignores players with no real ADP', () => {
    const withUnranked: ProjectionRow[] = [
      ...rows,
      { playerId: 'z', name: 'Z', position: 'RB', nflTeam: 'X', projPts: 10, adp: Number.NaN },
    ];
    const slate = buildSlate(withUnranked, { season: 2026, positions: ['RB'], perPosition: 4 });
    expect(slate.players.map((p) => p.playerId)).not.toContain('z');
  });
});
