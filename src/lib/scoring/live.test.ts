import { describe, expect, it } from 'vitest';
import { projectTable, type ProjectionTeam } from './live';

/**
 * Four teams, two fixtures, a table that already has a week in it.
 *
 * A ranks first on 2-0, B second on 1-1 with more points than C, D last.
 */
const TEAMS: ProjectionTeam[] = [
  { teamId: 'a', h2hW: 2, h2hT: 0, cumPts: 240, rank: 1 },
  { teamId: 'b', h2hW: 1, h2hT: 0, cumPts: 230, rank: 2 },
  { teamId: 'c', h2hW: 1, h2hT: 0, cumPts: 210, rank: 3 },
  { teamId: 'd', h2hW: 0, h2hT: 0, cumPts: 190, rank: 4 },
];

const FIXTURES = [
  { homeTeamId: 'a', awayTeamId: 'd' },
  { homeTeamId: 'b', awayTeamId: 'c' },
];

describe('projectTable', () => {
  it('leaves the table alone when nothing has been played', () => {
    const places = projectTable({ teams: TEAMS, fixtures: FIXTURES, live: new Map() });

    expect([...places].map(([id, p]) => [id, p.rank])).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 3],
      ['d', 4],
    ]);
    expect([...places.values()].every((p) => p.delta === 0)).toBe(true);
  });

  it('moves a team that is losing its live matchup', () => {
    // D is beating A; C is beating B. Records become a 2, c 2, b 1, d 1; points-for
    // becomes a 320, c 315, d 310, b 300.
    const live = new Map([
      ['a', 80],
      ['d', 120],
      ['b', 70],
      ['c', 105],
    ]);
    const places = projectTable({ teams: TEAMS, fixtures: FIXTURES, live });

    // A holds first: level with C on record, ahead on the points-for tiebreak.
    expect(places.get('a')!.rank).toBe(1);
    expect(places.get('a')!.delta).toBe(0);

    // C wins and climbs a place; B loses and is passed by both C and D.
    expect(places.get('c')!.rank).toBe(2);
    expect(places.get('c')!.delta).toBe(1);
    expect(places.get('d')!.rank).toBe(3);
    expect(places.get('d')!.delta).toBe(1);
    expect(places.get('b')!.rank).toBe(4);
    expect(places.get('b')!.delta).toBe(-2);
  });

  it('SKIPS a fixture where only one side has played', () => {
    // D leads A 120-0 only because A's players have not kicked off. Awarding that win
    // would swing the table all Sunday morning for reasons that are not football.
    const live = new Map([['d', 120]]);
    const places = projectTable({ teams: TEAMS, fixtures: FIXTURES, live });

    expect(places.get('a')!.rank).toBe(1);
    expect(places.get('d')!.rank).toBe(4);
    expect(places.get('d')!.delta).toBe(0);
  });

  it('counts an exact live tie as half a win to each side', () => {
    const live = new Map([
      ['b', 100],
      ['c', 100],
    ]);
    const places = projectTable({ teams: TEAMS, fixtures: FIXTURES, live });

    // Both go to 1-0-1 = 1.5, ahead of D and behind A's 2.0. B keeps second on points.
    expect(places.get('b')!.rank).toBe(2);
    expect(places.get('c')!.rank).toBe(3);
    expect(places.get('a')!.rank).toBe(1);
  });

  it('lets co-ranked teams share a rank rather than separating them', () => {
    const level: ProjectionTeam[] = [
      { teamId: 'a', h2hW: 1, h2hT: 0, cumPts: 200, rank: 1 },
      { teamId: 'b', h2hW: 1, h2hT: 0, cumPts: 200, rank: 1 },
    ];
    const places = projectTable({ teams: level, fixtures: [], live: new Map() });

    expect(places.get('a')!.rank).toBe(1);
    expect(places.get('b')!.rank).toBe(1);
  });

  it('adds live points to points-for, which is the tiebreak', () => {
    // B and C are level on record. C outscores B live and takes the tiebreak.
    const level: ProjectionTeam[] = [
      { teamId: 'b', h2hW: 1, h2hT: 0, cumPts: 230, rank: 2 },
      { teamId: 'c', h2hW: 1, h2hT: 0, cumPts: 210, rank: 3 },
    ];
    const places = projectTable({
      teams: level,
      // No fixture between them, so only the points move.
      fixtures: [],
      live: new Map([
        ['b', 10],
        ['c', 50],
      ]),
    });

    expect(places.get('c')!.rank).toBe(1);
    expect(places.get('b')!.rank).toBe(2);
  });
});
