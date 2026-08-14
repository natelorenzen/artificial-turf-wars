import { describe, expect, it } from 'vitest';
import { LEAGUE } from '@/lib/config/league';
import { rankStandings, type StandingInput } from './allplay';
import {
  activeTeamsIn,
  bracketOpponent,
  buildBracket,
  championshipGames,
  decideGame,
  FINAL_WEEK,
  isPlayoffWeek,
  LAST_LEAGUE_WEEK,
  seedField,
  semifinalGames,
  SEMIFINAL_WEEK,
} from './bracket';

const TEAMS = ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8'];

/** t1 best, t8 worst, no ties anywhere. */
function ladder(): StandingInput[] {
  return TEAMS.map((teamId, i) => ({
    teamId,
    h2hW: 14 - i * 2,
    h2hL: i * 2,
    h2hT: 0,
    allplayW: 0,
    allplayL: 0,
    cumPts: 1500 - i * 40,
  }));
}

const points = (entries: Record<string, number>) => new Map(Object.entries(entries));

describe('playoff weeks are reachable at all', () => {
  it('bounds the season at the final, not at week 14', () => {
    expect(LAST_LEAGUE_WEEK).toBe(FINAL_WEEK);
    expect(LAST_LEAGUE_WEEK).toBeGreaterThan(LEAGUE.regularSeasonWeeks);
  });

  it('knows which weeks are playoff weeks', () => {
    expect(isPlayoffWeek(LEAGUE.regularSeasonWeeks)).toBe(false);
    expect(isPlayoffWeek(SEMIFINAL_WEEK)).toBe(true);
    expect(isPlayoffWeek(FINAL_WEEK)).toBe(true);
    expect(isPlayoffWeek(17)).toBe(false);
  });
});

describe('seeding', () => {
  it('takes the top four in the order the site has shown all season', () => {
    expect(seedField(rankStandings(ladder()))).toEqual(['t1', 't2', 't3', 't4']);
  });

  it('refuses a co-ranked cutoff rather than picking one', () => {
    const rows = ladder();
    // t4 and t5 identical on both the basis and the tiebreak: genuinely co-ranked.
    rows[4] = { ...rows[3], teamId: 't5' };
    expect(() => seedField(rankStandings(rows))).toThrow(/ambiguous/);
  });

  it('does not care what order the standings arrive in', () => {
    const ranked = rankStandings(ladder());
    expect(seedField([...ranked].reverse())).toEqual(['t1', 't2', 't3', 't4']);
  });
});

describe('the bracket', () => {
  const seeds = ['t1', 't2', 't3', 't4'];

  it('pairs 1v4 and 2v3 in week 15', () => {
    const games = semifinalGames(seeds);
    expect(games.map((g) => [g.homeTeamId, g.awayTeamId])).toEqual([
      ['t1', 't4'],
      ['t2', 't3'],
    ]);
    expect(games.every((g) => g.week === SEMIFINAL_WEEK && g.round === 'semifinal')).toBe(true);
  });

  it('sends the winners to the final and the losers to the third-place game', () => {
    const semis = semifinalGames(seeds);
    const results = [
      decideGame(semis[0], points({ t1: 100, t4: 120 }))!, // the 4 seed upsets the 1
      decideGame(semis[1], points({ t2: 130, t3: 90 }))!,
    ];

    const round2 = championshipGames(results);
    const final = round2.find((g) => g.round === 'final')!;
    const third = round2.find((g) => g.round === 'third_place')!;

    expect([final.homeTeamId, final.awayTeamId]).toEqual(['t2', 't4']);
    expect([third.homeTeamId, third.awayTeamId]).toEqual(['t1', 't3']);
    // Higher seed at home in both games, so the tiebreak reads identically in each.
    expect(final.homeSeed).toBeLessThan(final.awaySeed);
    expect(third.homeSeed).toBeLessThan(third.awaySeed);
    expect(round2.every((g) => g.week === FINAL_WEEK)).toBe(true);
  });

  it('refuses to build the final off one semifinal', () => {
    const semis = semifinalGames(seeds);
    const one = decideGame(semis[0], points({ t1: 100, t4: 90 }))!;
    expect(() => championshipGames([one])).toThrow(/both semifinals/);
  });
});

describe('deciding a game', () => {
  const [game] = semifinalGames(['t1', 't2', 't3', 't4']); // t1 (seed 1) v t4 (seed 4)

  it('is won on points', () => {
    expect(decideGame(game, points({ t1: 101.2, t4: 101.1 }))!.winnerTeamId).toBe('t1');
    expect(decideGame(game, points({ t1: 101.1, t4: 101.2 }))!.winnerTeamId).toBe('t4');
  });

  it('gives an exact tie to the higher seed, and says that is what happened', () => {
    const result = decideGame(game, points({ t1: 118.4, t4: 118.4 }))!;
    expect(result.winnerTeamId).toBe('t1');
    expect(result.decidedBySeed).toBe(true);
  });

  it('does not decide a game where a team has no score at all', () => {
    // An unscored week is not a 0-0 draw won by the higher seed. Advancing somebody on
    // that basis is the worst thing this file could do quietly.
    expect(decideGame(game, points({ t1: 118.4 }))).toBeNull();
    expect(decideGame(game, points({}))).toBeNull();
  });

  it('marks a real win as not decided by seed', () => {
    expect(decideGame(game, points({ t1: 100, t4: 99 }))!.decidedBySeed).toBe(false);
  });
});

describe('the whole bracket state', () => {
  const standings = rankStandings(ladder());

  it('names the four qualifiers and the four eliminated before a playoff week is played', () => {
    const bracket = buildBracket({ standings, pointsByWeek: new Map() });
    expect(bracket.seeds).toEqual(['t1', 't2', 't3', 't4']);
    expect(bracket.eliminated).toEqual(['t5', 't6', 't7', 't8']);
    expect(bracket.semifinals).toHaveLength(2);
    // Week 16 cannot exist yet: naming a finalist whose opponent is undecided would be
    // a fixture nobody can play.
    expect(bracket.championship).toEqual([]);
    expect(bracket.championTeamId).toBeNull();
  });

  it('resolves the whole thing once both weeks are scored', () => {
    const bracket = buildBracket({
      standings,
      pointsByWeek: new Map([
        [SEMIFINAL_WEEK, points({ t1: 120, t4: 118, t2: 95, t3: 140 })],
        [FINAL_WEEK, points({ t1: 130, t3: 131, t2: 100, t4: 99 })],
      ]),
    });

    expect(bracket.semifinalResults.map((r) => r.winnerTeamId)).toEqual(['t1', 't3']);
    expect(bracket.championTeamId).toBe('t3');
    expect(bracket.runnerUpTeamId).toBe('t1');
    // Third place is the winner of the losers' game: t2 beat t4, 100 to 99.
    expect(bracket.thirdTeamId).toBe('t2');
  });

  it('holds the title open when only one final has been scored', () => {
    const bracket = buildBracket({
      standings,
      pointsByWeek: new Map([
        [SEMIFINAL_WEEK, points({ t1: 120, t4: 118, t2: 95, t3: 140 })],
        [FINAL_WEEK, points({ t2: 100, t4: 99 })],
      ]),
    });
    expect(bracket.thirdTeamId).toBe('t2');
    expect(bracket.championTeamId).toBeNull();
  });

  it('says who is still playing, and who is not', () => {
    const bracket = buildBracket({
      standings,
      pointsByWeek: new Map([[SEMIFINAL_WEEK, points({ t1: 120, t4: 118, t2: 95, t3: 140 })]]),
    });

    expect(activeTeamsIn(bracket, SEMIFINAL_WEEK).sort()).toEqual(['t1', 't2', 't3', 't4']);
    // Both week-16 games are real, so all four survivors set a lineup in the final week.
    expect(activeTeamsIn(bracket, FINAL_WEEK).sort()).toEqual(['t1', 't2', 't3', 't4']);
    expect(activeTeamsIn(bracket, LEAGUE.regularSeasonWeeks)).toEqual([]);
  });

  it('gives each survivor its bracket opponent, and nothing to the eliminated', () => {
    const bracket = buildBracket({ standings, pointsByWeek: new Map() });

    expect(bracketOpponent(bracket, SEMIFINAL_WEEK, 't4')).toEqual({
      opponentTeamId: 't1',
      round: 'semifinal',
    });
    expect(bracketOpponent(bracket, SEMIFINAL_WEEK, 't5')).toBeNull();
    // Week 16 has no opponents until week 15 is in the books.
    expect(bracketOpponent(bracket, FINAL_WEEK, 't1')).toBeNull();
  });
});

describe('the frozen field', () => {
  const standings = rankStandings(ladder());

  it('ignores the live standings when a field has been frozen', () => {
    // The pool ran on Tuesday and froze this field. On Thursday a stat correction
    // reorders week 14 and the standings now say t5 outranks t4 — which must not
    // change a bracket four teams have already rebuilt their rosters for.
    const corrected = rankStandings(
      ladder().map((row) => (row.teamId === 't5' ? { ...row, h2hW: 99, cumPts: 9999 } : row)),
    );
    const bracket = buildBracket({
      standings: corrected,
      pointsByWeek: new Map(),
      seeds: ['t1', 't2', 't3', 't4'],
    });

    expect(bracket.seeds).toEqual(['t1', 't2', 't3', 't4']);
    expect(bracket.eliminated).toContain('t5');
    expect(seedField(corrected)[0]).toBe('t5'); // what it would have said unfrozen
  });

  it('still derives the field when nothing has been frozen yet', () => {
    expect(buildBracket({ standings, pointsByWeek: new Map() }).seeds).toEqual([
      't1',
      't2',
      't3',
      't4',
    ]);
  });

  it('refuses a field of the wrong size rather than playing a three-team bracket', () => {
    expect(() =>
      buildBracket({ standings, pointsByWeek: new Map(), seeds: ['t1', 't2', 't3'] }),
    ).toThrow(/needs 4 seeds/);
  });
});
