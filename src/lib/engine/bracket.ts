/**
 * The two-week playoff bracket (SPEC §3.3 as amended by §14.5).
 *
 * Week 15: seed 1 v seed 4, seed 2 v seed 3.
 * Week 16: the winners meet for the title, the losers play for third.
 * Week 17 is not played — playoff-clinched NFL teams rest starters, so it measures
 * which team avoided a bench-everyone opponent rather than which model managed best.
 *
 * Everything here is a pure function of the seeds and the scores. Nothing is stored
 * that could disagree with them: the bracket rows in `h2h_schedule` say who played
 * whom, and the round labels, the seeds and the winners are all re-derived from the
 * week-14 standings whenever anything asks. A stored `round` column would be a second
 * copy of a fact we already have, free to drift from it.
 *
 * ONE RULE HERE IS NOT IN THE REGULAR SEASON. A regular-season tie is a tie, recorded
 * W-L-T like a real league. A bracket cannot do that — somebody has to play next week
 * — so an exact tie is won by the HIGHER SEED. That is stated in the rulebook rather
 * than only enforced here, because three of the eight bugs found in rehearsal were a
 * model penalised for a rule it was never told, and "a tie loses" is a fact a lower
 * seed should be able to price into how much variance it wants.
 */

import { LEAGUE } from '@/lib/config/league';
import { playoffSeeds, type StandingRow } from './allplay';

export const SEMIFINAL_WEEK = LEAGUE.playoffWeeks[0];
export const FINAL_WEEK = LEAGUE.playoffWeeks[LEAGUE.playoffWeeks.length - 1];

/** The last week this league ever scores. Every job's upper bound. */
export const LAST_LEAGUE_WEEK = FINAL_WEEK;

export function isPlayoffWeek(week: number): boolean {
  return (LEAGUE.playoffWeeks as readonly number[]).includes(week);
}

export type PlayoffRound = 'semifinal' | 'final' | 'third_place';

export interface BracketGame {
  week: number;
  round: PlayoffRound;
  homeTeamId: string;
  awayTeamId: string;
  /** 1-indexed seed, so the tiebreak and the site's "(3) beat (2)" line agree. */
  homeSeed: number;
  awaySeed: number;
}

export interface GameResult {
  game: BracketGame;
  winnerTeamId: string;
  loserTeamId: string;
  winnerPts: number;
  loserPts: number;
  /** True when the seeds broke it rather than the scoreboard. */
  decidedBySeed: boolean;
}

/**
 * The four qualifiers, in seed order, from the standings as they stood after the
 * final regular-season week.
 *
 * Refuses a co-ranked cutoff rather than picking one, exactly as `splitPlayoffField`
 * does. The commissioner is deterministic; "the 4 seed is either of these two" is not
 * a result, and inventing a tiebreak the models were never told would be worse than
 * stopping.
 */
export function seedField(standings: StandingRow[]): string[] {
  const ranked = [...standings].sort((a, b) => a.rank - b.rank || (a.teamId < b.teamId ? -1 : 1));

  const cutoff = ranked[LEAGUE.playoffTeams - 1];
  const next = ranked[LEAGUE.playoffTeams];
  if (cutoff && next && cutoff.rank === next.rank) {
    throw new Error(
      `playoff field is ambiguous: ${cutoff.teamId} and ${next.teamId} are co-ranked at ` +
        `the ${LEAGUE.playoffTeams}-seed cutoff. Resolve before seeding the bracket.`,
    );
  }

  const seeds = playoffSeeds(ranked, LEAGUE.playoffTeams);
  if (seeds.length < LEAGUE.playoffTeams) {
    throw new Error(`playoffs need ${LEAGUE.playoffTeams} seeds, standings produced ${seeds.length}`);
  }
  return seeds;
}

/** Week 15. Higher seed is home, which is cosmetic here and decides ties everywhere. */
export function semifinalGames(seeds: string[]): BracketGame[] {
  if (seeds.length < 4) throw new Error('playoffs need four seeds');
  return [
    {
      week: SEMIFINAL_WEEK,
      round: 'semifinal',
      homeTeamId: seeds[0],
      awayTeamId: seeds[3],
      homeSeed: 1,
      awaySeed: 4,
    },
    {
      week: SEMIFINAL_WEEK,
      round: 'semifinal',
      homeTeamId: seeds[1],
      awayTeamId: seeds[2],
      homeSeed: 2,
      awaySeed: 3,
    },
  ];
}

/**
 * Week 16, which cannot be known until week 15 has been scored.
 *
 * Both games are built, not just the final. A third-place game is two more teams with
 * a reason to set a real lineup, and the alternative is asking two models to sit out
 * the last week of the season with a roster full of players.
 */
export function championshipGames(semifinals: GameResult[]): BracketGame[] {
  if (semifinals.length !== 2) {
    throw new Error(`the final round needs both semifinals, got ${semifinals.length}`);
  }

  const seedOf = (teamId: string) => {
    for (const result of semifinals) {
      if (result.game.homeTeamId === teamId) return result.game.homeSeed;
      if (result.game.awayTeamId === teamId) return result.game.awaySeed;
    }
    throw new Error(`${teamId} did not play a semifinal`);
  };

  const pair = (round: PlayoffRound, teams: string[]): BracketGame => {
    // Higher seed at home, so the tiebreak reads the same way in both rounds.
    const [home, away] = [...teams].sort((a, b) => seedOf(a) - seedOf(b));
    return {
      week: FINAL_WEEK,
      round,
      homeTeamId: home,
      awayTeamId: away,
      homeSeed: seedOf(home),
      awaySeed: seedOf(away),
    };
  };

  return [
    pair('final', semifinals.map((r) => r.winnerTeamId)),
    pair('third_place', semifinals.map((r) => r.loserTeamId)),
  ];
}

/**
 * Who won, from the scores that week.
 *
 * Returns null when a team has no score at all — an unscored week is not a 0-0 draw
 * won by the higher seed, and advancing somebody on that basis would be the single
 * worst thing this code could do quietly.
 */
export function decideGame(
  game: BracketGame,
  pointsByTeam: Map<string, number>,
): GameResult | null {
  const home = pointsByTeam.get(game.homeTeamId);
  const away = pointsByTeam.get(game.awayTeamId);
  if (home === undefined || away === undefined) return null;

  const homeWins = home > away || (home === away && game.homeSeed < game.awaySeed);

  return {
    game,
    winnerTeamId: homeWins ? game.homeTeamId : game.awayTeamId,
    loserTeamId: homeWins ? game.awayTeamId : game.homeTeamId,
    winnerPts: homeWins ? home : away,
    loserPts: homeWins ? away : home,
    decidedBySeed: home === away,
  };
}

export interface BracketState {
  seeds: string[];
  eliminated: string[];
  semifinals: BracketGame[];
  semifinalResults: GameResult[];
  /** Empty until both semifinals are scored. */
  championship: BracketGame[];
  championshipResults: GameResult[];
  championTeamId: string | null;
  runnerUpTeamId: string | null;
  thirdTeamId: string | null;
}

/**
 * The whole bracket in one pass, from the standings and whatever weeks have been
 * scored so far. Every consumer — the lineup job, the results pages, the champion
 * line on the front page — reads this rather than re-deriving its own half of it.
 */
export function buildBracket(input: {
  standings: StandingRow[];
  pointsByWeek: Map<number, Map<string, number>>;
  /**
   * The frozen field, when there is one. Passing it makes this function ignore the
   * standings for seeding entirely — which is the point: after the pool has run, the
   * bracket must not move because a stat correction moved a week-14 score.
   */
  seeds?: string[];
}): BracketState {
  const ranked = [...input.standings].sort((a, b) => a.rank - b.rank || (a.teamId < b.teamId ? -1 : 1));
  const seeds = input.seeds ?? seedField(ranked);
  if (seeds.length !== LEAGUE.playoffTeams) {
    throw new Error(`bracket needs ${LEAGUE.playoffTeams} seeds, got ${seeds.length}`);
  }
  const qualified = new Set(seeds);
  const eliminated = ranked.filter((row) => !qualified.has(row.teamId)).map((row) => row.teamId);

  const semifinals = semifinalGames(seeds);
  const semiPoints = input.pointsByWeek.get(SEMIFINAL_WEEK) ?? new Map<string, number>();
  const semifinalResults = semifinals
    .map((game) => decideGame(game, semiPoints))
    .filter((result): result is GameResult => result !== null);

  // Both, or neither. A bracket built from one settled semifinal would name a
  // finalist whose opponent does not exist yet.
  const championship = semifinalResults.length === 2 ? championshipGames(semifinalResults) : [];
  const finalPoints = input.pointsByWeek.get(FINAL_WEEK) ?? new Map<string, number>();
  const championshipResults = championship
    .map((game) => decideGame(game, finalPoints))
    .filter((result): result is GameResult => result !== null);

  const title = championshipResults.find((r) => r.game.round === 'final') ?? null;
  const third = championshipResults.find((r) => r.game.round === 'third_place') ?? null;

  return {
    seeds,
    eliminated,
    semifinals,
    semifinalResults,
    championship,
    championshipResults,
    championTeamId: title?.winnerTeamId ?? null,
    runnerUpTeamId: title?.loserTeamId ?? null,
    thirdTeamId: third?.winnerTeamId ?? null,
  };
}

/**
 * Which teams are still playing in a given playoff week.
 *
 * Week 15 is the four qualifiers; week 16 is all four again, two for the title and
 * two for third. Eliminated teams stop setting lineups the moment the regular season
 * ends (§14.5) — their players are in the pool by then and mostly on other rosters.
 */
export function activeTeamsIn(bracket: BracketState, week: number): string[] {
  if (week === SEMIFINAL_WEEK) return bracket.seeds;
  if (week === FINAL_WEEK) {
    return bracket.championship.flatMap((game) => [game.homeTeamId, game.awayTeamId]);
  }
  return [];
}

/** The bracket opponent for one team in one playoff week, or null if it is not playing. */
export function bracketOpponent(
  bracket: BracketState,
  week: number,
  teamId: string,
): { opponentTeamId: string; round: PlayoffRound } | null {
  const games = week === SEMIFINAL_WEEK ? bracket.semifinals : week === FINAL_WEEK ? bracket.championship : [];
  for (const game of games) {
    if (game.homeTeamId === teamId) return { opponentTeamId: game.awayTeamId, round: game.round };
    if (game.awayTeamId === teamId) return { opponentTeamId: game.homeTeamId, round: game.round };
  }
  return null;
}
