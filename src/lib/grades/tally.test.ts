import { describe, expect, it } from 'vitest';
import { buildGradingBoard, assertNoIdentityLeak, projectedTotals, type PickRow, type TeamRow } from '@/lib/grades/board';
import { kendallTau, kendallW, tallyGrades } from '@/lib/grades/tally';
import { gradeCardSchema, selfGuessSchema } from '@/lib/grades/schemas';
import type { GraderTranscript, Grade } from '@/lib/grades/types';
import { LEAGUE, type Position } from '@/lib/config/league';

/**
 * Fixtures build a full legal board — eight teams, fifteen rounds — because the board
 * builder refuses anything else, and it refuses on purpose: a ranking of eight rosters
 * where one is missing four rounds looks exactly like a ranking, and nobody reading it
 * could tell.
 */
const POSITIONS: Position[] = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'K', 'DEF', 'RB', 'WR', 'WR', 'TE', 'QB', 'RB', 'WR'];

function fixture() {
  const teams: TeamRow[] = Array.from({ length: LEAGUE.teams }, (_, i) => ({
    teamId: `t${i + 1}`,
    modelKey: `model-${i + 1}`,
    draftSlot: i + 1,
    auctionBid: 10 + i,
    faabRemaining: 90 - i,
  }));

  const picks: PickRow[] = [];
  let pick = 0;
  for (let round = 1; round <= LEAGUE.draftRounds; round++) {
    for (let t = 0; t < LEAGUE.teams; t++) {
      pick++;
      picks.push({
        teamId: `t${t + 1}`,
        playerId: `p${t + 1}-${round}`,
        pickOverall: pick,
        round,
        name: `Player ${t + 1}-${round}`,
        position: POSITIONS[round - 1],
        nflTeam: 'DET',
        // Team 1's players are worth the most, sliding down to team 8. Gives the
        // arithmetic control something unambiguous to correlate against.
        projectedPoints: 300 - t * 10 - round,
        adp: pick,
      });
    }
  }
  return buildGradingBoard(teams, picks, 2026);
}

const LABELS = ['Team A', 'Team B', 'Team C', 'Team D', 'Team E', 'Team F', 'Team G', 'Team H'];
const GRADES: Grade[] = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C'];

/** A transcript whose ranking is the given order, with grades that agree with it. */
function transcript(modelKey: string, ownTeam: string, ranking: string[], guess: string): GraderTranscript {
  const board = fixture().board;
  return {
    modelKey,
    ownTeam,
    card: {
      criterion: 'value over replacement',
      ranking,
      grades: ranking.map((team, i) => {
        const roster = board.teams.find((t) => t.label === team)!;
        return {
          team,
          grade: GRADES[i],
          verdict: 'fine',
          bestPick: roster.players[0].playerId,
          bestPickWhy: 'because',
          worstPick: roster.players[roster.players.length - 1].playerId,
          worstPickWhy: 'because',
        };
      }),
    },
    guess: { team: guess, confidence: 0.5, why: 'a hunch' },
    softViolations: [],
  };
}

describe('board', () => {
  it('refuses a partial draft rather than grading it', () => {
    const { board } = fixture();
    const teams: TeamRow[] = board.teams.map((t, i) => ({
      teamId: `t${i + 1}`,
      modelKey: `model-${i + 1}`,
      draftSlot: t.draftSlot,
      auctionBid: 0,
      faabRemaining: 0,
    }));
    expect(() => buildGradingBoard(teams, [], 2026)).toThrow(/refusing a partial board/);
  });

  it('gives every grader a board with the same id', () => {
    expect(fixture().board.boardId).toBe(fixture().board.boardId);
  });

  it('maps each model to the team it actually drafted', () => {
    const { ownTeamByModel } = fixture();
    expect(ownTeamByModel.get('model-1')).toBe('Team A');
    expect(ownTeamByModel.get('model-8')).toBe('Team H');
  });

  it('fills the whole starting lineup and only counts it once', () => {
    const { board } = fixture();
    const totals = projectedTotals(board.teams[0]);
    expect(totals.roster).toBeGreaterThan(totals.starters);
    // Nine slots, all fillable from this roster.
    expect(totals.starters).toBeGreaterThan(0);
  });

  it('catches a model name in a prompt', () => {
    expect(() => assertNoIdentityLeak('Team C drafted well — Anthropic', ['Anthropic'])).toThrow(/leaks model identity/);
    expect(() => assertNoIdentityLeak('Team C drafted well', ['Anthropic'])).not.toThrow();
  });
});

describe('statistics', () => {
  const asMap = (order: string[]) => new Map(order.map((l, i) => [l, i + 1]));

  it('tau is 1 for identical orders and -1 for a reversal', () => {
    expect(kendallTau(asMap(LABELS), asMap(LABELS))).toBe(1);
    expect(kendallTau(asMap(LABELS), asMap([...LABELS].reverse()))).toBe(-1);
  });

  it('W is 1 when every grader ranks identically', () => {
    expect(kendallW([asMap(LABELS), asMap(LABELS), asMap(LABELS)])).toBe(1);
  });

  it('W is 0 when two graders rank in exact opposition', () => {
    expect(kendallW([asMap(LABELS), asMap([...LABELS].reverse())])).toBe(0);
  });

  it('W is null with fewer than two rankings', () => {
    expect(kendallW([asMap(LABELS)])).toBeNull();
  });
});

describe('tally', () => {
  it('reports unanimity, and the consensus that produced it', () => {
    const { board } = fixture();
    const transcripts = LABELS.map((own, i) => transcript(`model-${i + 1}`, own, LABELS, 'Team A'));
    const tally = tallyGrades(board, transcripts);

    expect(tally.kendallW).toBe(1);
    expect(tally.meanPairwiseTau).toBe(1);
    expect(tally.unanimousFirst).toBe('Team A');
    expect(tally.unanimousLast).toBe('Team H');
    expect(tally.teams[0].label).toBe('Team A');
    expect(tally.teams[0].firstPlaceVotes).toBe(8);
    expect(tally.mostContested?.rankSpread).toBe(0);
  });

  it('measures self-preference against the room, not against the mean', () => {
    const { board } = fixture();
    // Everyone ranks alphabetically except Team H's drafter, which swaps itself with
    // whoever was first. A swap rather than a promotion, so exactly one other team is
    // disturbed and the knock-on below is small enough to state exactly.
    const selfish = [...LABELS];
    [selfish[0], selfish[7]] = [selfish[7], selfish[0]];
    const transcripts = LABELS.map((own, i) =>
      transcript(`model-${i + 1}`, own, own === 'Team H' ? selfish : LABELS, own),
    );
    const tally = tallyGrades(board, transcripts);

    const h = tally.graders.find((g) => g.ownTeam === 'Team H')!;
    expect(h.ownRankSelf).toBe(1);
    expect(h.ownRankByOthers).toBe(8);
    expect(h.ownRankDelta).toBe(-7);

    // Two, not one, and the second is the point. Team A's drafter did nothing selfish;
    // it ranked itself first and so did six of the other seven. The eighth demoted it
    // to last, which drags the room's opinion of Team A to 2.0 and leaves Team A's own
    // ranking looking generous by a place. The measure is RELATIVE, so one distorting
    // grader perturbs everybody else's delta — read the individual rows, not just the
    // count, before writing a sentence about eight models flattering themselves.
    const a = tally.graders.find((g) => g.ownTeam === 'Team A')!;
    expect(a.ownRankByOthers).toBe(2);
    expect(a.ownRankDelta).toBe(-1);
    expect(tally.selfPreferenceCount).toBe(2);

    // Everyone identified themselves correctly here, which is the ceiling.
    expect(tally.recognitionCorrect).toBe(8);
    expect(tally.recognitionExpected).toBe(1);
  });

  it('excludes a failed grader from every rank statistic without zeroing it', () => {
    const { board } = fixture();
    const transcripts = LABELS.map((own, i) => transcript(`model-${i + 1}`, own, LABELS, own));
    transcripts[0] = { ...transcripts[0], card: null, guess: null };
    const tally = tallyGrades(board, transcripts);

    expect(tally.gradersCounted).toBe(7);
    expect(tally.kendallW).toBe(1);
    // The failed grader is still listed — silence is a result, not an absence.
    const failed = tally.graders.find((g) => g.modelKey === 'model-1')!;
    expect(failed.graded).toBe(false);
    expect(failed.ownRankSelf).toBeNull();
    expect(failed.criterion).toBeNull();
    expect(tally.recognitionAsked).toBe(7);
  });

  it('correlates the consensus with the arithmetic the graders never saw', () => {
    const { board } = fixture();
    // Fixture projections descend from Team A to Team H, and so does this ranking.
    const transcripts = LABELS.map((own, i) => transcript(`model-${i + 1}`, own, LABELS, own));
    const tally = tallyGrades(board, transcripts);
    expect(tally.tauConsensusVsRosterProjection).toBe(1);
  });
});

describe('schemas', () => {
  const { board } = fixture();
  const schema = gradeCardSchema(board);
  const valid = transcript('model-1', 'Team A', LABELS, 'Team A').card!;

  it('accepts loose label and grade spellings', () => {
    const parsed = schema.parse({
      ...valid,
      ranking: ['A', 'team b', 'Team C', 'D', 'E', 'F', 'G', 'H'],
      grades: valid.grades.map((g, i) => ({ ...g, grade: i === 0 ? 'a plus' : g.grade })),
    });
    expect(parsed.ranking[0]).toBe('Team A');
    expect(parsed.grades[0].grade).toBe('A+');
  });

  it('rejects a ranking that is not a permutation', () => {
    expect(() => schema.parse({ ...valid, ranking: ['Team A', ...LABELS.slice(0, 7)] })).toThrow(
      /each team exactly once/,
    );
  });

  it('rejects a best pick from somebody else\'s roster', () => {
    const grades = valid.grades.map((g) => (g.team === 'Team A' ? { ...g, bestPick: 'p2-1' } : g));
    expect(() => schema.parse({ ...valid, grades })).toThrow(/not on that roster/);
  });

  it('rejects a self-identification that is not a team on the board', () => {
    expect(() => selfGuessSchema(board).parse({ team: 'Team Z', confidence: 0.5, why: 'x' })).toThrow();
  });
});
