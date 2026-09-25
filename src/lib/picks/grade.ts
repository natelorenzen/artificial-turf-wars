/**
 * Grading NFL picks. Pure functions, no I/O: the commissioner is code (hard rule 1),
 * and a grade anyone can recompute from published rows is the only kind worth
 * publishing.
 *
 * Where the scores come from. We hold no team-level feed — `nfl_games` is a fixture
 * list with no result — but every DEF unit's stat line carries `pts_allow`, which is
 * the OPPONENT's final score. So a game's score is read off the two defences:
 *
 *     home score = away DEF pts_allow        away score = home DEF pts_allow
 *
 * Checked on 23 Sept 2026 against a published box score: CHI 59, CAR 37 in week 1
 * matches Sleeper's CAR `pts_allow` 59 and CHI `pts_allow` 37 exactly.
 *
 * A game with either defence missing is PENDING, never a loss. Scores are recomputed at
 * read time rather than stored, so a Thursday stat correction regrades a pick instead
 * of leaving a verdict behind that no longer matches the table.
 */

export interface Fixture {
  gameKey: string;
  away: string;
  home: string;
}

export interface GameOutcome {
  gameKey: string;
  away: string;
  home: string;
  awayScore: number | null;
  homeScore: number | null;
  /** The winning team, 'TIE', or null while the game is unscored. */
  winner: string | null;
}

export interface Pick {
  gameKey: string;
  pick: string;
  /** Probability the picked team wins, 0.5 – 1. */
  winProb: number;
}

export type PickResult = 'won' | 'lost' | 'push' | 'pending';

export function gameKey(away: string, home: string): string {
  return `${away}@${home}`;
}

/**
 * Each game's result from the DEF units' points allowed.
 *
 * `pointsAllowed` maps an NFL team to what its defence allowed that week. Resolving
 * provisional against final (hard rule 3b) is the caller's job — this takes one number
 * per team and never sums anything.
 */
export function gameOutcomes(fixtures: Fixture[], pointsAllowed: Map<string, number>): GameOutcome[] {
  return fixtures.map((f) => {
    const homeScore = pointsAllowed.get(f.away) ?? null;
    const awayScore = pointsAllowed.get(f.home) ?? null;
    let winner: string | null = null;
    if (homeScore !== null && awayScore !== null) {
      winner = homeScore > awayScore ? f.home : awayScore > homeScore ? f.away : 'TIE';
    }
    return { gameKey: f.gameKey, away: f.away, home: f.home, awayScore, homeScore, winner };
  });
}

export function gradePick(pick: Pick, outcome: GameOutcome | undefined): PickResult {
  if (!outcome || outcome.winner === null) return 'pending';
  if (outcome.winner === 'TIE') return 'push';
  return outcome.winner === pick.pick ? 'won' : 'lost';
}

/**
 * The Brier score of one pick: (stated probability − what happened)².
 *
 * 0 is perfect, 0.25 is what a permanent coin flip scores, and a confident miss costs
 * far more than a timid one — a 0.95 pick that loses scores 0.9025. That asymmetry is
 * the point: accuracy rewards being right, Brier also punishes being SURE and wrong.
 * A tie counts as half a win for both sides.
 */
export function brier(winProb: number, result: PickResult): number | null {
  if (result === 'pending') return null;
  const happened = result === 'won' ? 1 : result === 'lost' ? 0 : 0.5;
  return (winProb - happened) ** 2;
}

export interface PickTally {
  won: number;
  lost: number;
  push: number;
  pending: number;
  /** won / (won + lost). Null until something has been decided. */
  accuracy: number | null;
  /** Mean Brier over every decided pick, pushes included. */
  brier: number | null;
  /** Mean stated probability over decided picks. */
  meanConfidence: number | null;
}

export function tally(picks: Pick[], outcomes: Map<string, GameOutcome>): PickTally {
  let won = 0;
  let lost = 0;
  let push = 0;
  let pending = 0;
  let brierSum = 0;
  let confSum = 0;
  let decided = 0;

  for (const pick of picks) {
    const result = gradePick(pick, outcomes.get(pick.gameKey));
    if (result === 'pending') {
      pending++;
      continue;
    }
    if (result === 'won') won++;
    else if (result === 'lost') lost++;
    else push++;
    brierSum += brier(pick.winProb, result)!;
    confSum += pick.winProb;
    decided++;
  }

  return {
    won,
    lost,
    push,
    pending,
    accuracy: won + lost > 0 ? won / (won + lost) : null,
    brier: decided > 0 ? brierSum / decided : null,
    meanConfidence: decided > 0 ? confSum / decided : null,
  };
}

/**
 * The home-team baseline, as a set of picks: always the home side, at 0.5.
 *
 * At 0.5 its Brier is exactly 0.25 whatever happens, so it doubles as the coin flip. Its
 * ACCURACY is the interesting number — a model that cannot beat "always pick the home
 * team" is not adding anything its football knowledge was supposed to add.
 */
export function homeTeamPicks(fixtures: Fixture[]): Pick[] {
  return fixtures.map((f) => ({ gameKey: f.gameKey, pick: f.home, winProb: 0.5 }));
}

export interface ConsensusPick extends Pick {
  /** How many of the models that picked this game chose `pick`. */
  agree: number;
  of: number;
}

/**
 * The majority pick per game, at the mean probability of the models that made it.
 *
 * A split vote is broken toward the side with the higher summed probability, then the
 * home team — deterministic, so the consensus row replays exactly.
 */
export function consensusPicks(fixtures: Fixture[], all: Pick[][]): ConsensusPick[] {
  const out: ConsensusPick[] = [];
  for (const f of fixtures) {
    const forGame = all.flatMap((set) => set.filter((p) => p.gameKey === f.gameKey));
    if (forGame.length === 0) continue;
    const side = (team: string) => forGame.filter((p) => p.pick === team);
    const home = side(f.home);
    const away = side(f.away);
    const sum = (ps: Pick[]) => ps.reduce((s, p) => s + p.winProb, 0);
    const homeWins =
      home.length !== away.length ? home.length > away.length : sum(home) >= sum(away);
    const chosen = homeWins ? home : away;
    out.push({
      gameKey: f.gameKey,
      pick: homeWins ? f.home : f.away,
      winProb: chosen.length > 0 ? sum(chosen) / chosen.length : 0.5,
      agree: chosen.length,
      of: forGame.length,
    });
  }
  return out;
}

export interface TeamRecord {
  team: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  games: {
    week: number;
    opponent: string;
    at: 'home' | 'away';
    scoreFor: number;
    scoreAgainst: number;
    result: 'W' | 'L' | 'T';
  }[];
}

/** Every team's season so far, from scored outcomes. Unscored games are left out. */
export function teamRecords(weeks: { week: number; outcomes: GameOutcome[] }[]): Map<string, TeamRecord> {
  const records = new Map<string, TeamRecord>();
  const get = (team: string) => {
    let r = records.get(team);
    if (!r) {
      r = { team, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0, games: [] };
      records.set(team, r);
    }
    return r;
  };

  for (const { week, outcomes } of [...weeks].sort((a, b) => a.week - b.week)) {
    for (const o of outcomes) {
      if (o.winner === null || o.homeScore === null || o.awayScore === null) continue;
      const sides: [string, string, 'home' | 'away', number, number][] = [
        [o.home, o.away, 'home', o.homeScore, o.awayScore],
        [o.away, o.home, 'away', o.awayScore, o.homeScore],
      ];
      for (const [team, opponent, at, scoreFor, scoreAgainst] of sides) {
        const r = get(team);
        const result = scoreFor > scoreAgainst ? 'W' : scoreFor < scoreAgainst ? 'L' : 'T';
        if (result === 'W') r.wins++;
        else if (result === 'L') r.losses++;
        else r.ties++;
        r.pointsFor += scoreFor;
        r.pointsAgainst += scoreAgainst;
        r.games.push({ week, opponent, at, scoreFor, scoreAgainst, result });
      }
    }
  }
  return records;
}
