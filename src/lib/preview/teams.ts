/**
 * NFL abbreviation → readable name, for the weekend guide only.
 *
 * The guide's whole premise is that a novice can read it, and a heading of "BAL@IND"
 * fails that on its own terms — it assumes you already know the abbreviations, which
 * is exactly the knowledge the article is written for people not to have.
 *
 * Deliberately scoped to presentation. Nothing here feeds a DATA block, a scoring
 * path, or a decision; `players.nfl_team` remains the abbreviation everywhere else,
 * because that is what Sleeper returns and what every join is keyed on.
 */

const TEAM_NAMES: Record<string, string> = {
  ARI: 'Cardinals', ATL: 'Falcons', BAL: 'Ravens', BUF: 'Bills',
  CAR: 'Panthers', CHI: 'Bears', CIN: 'Bengals', CLE: 'Browns',
  DAL: 'Cowboys', DEN: 'Broncos', DET: 'Lions', GB: 'Packers',
  HOU: 'Texans', IND: 'Colts', JAX: 'Jaguars', KC: 'Chiefs',
  LAC: 'Chargers', LAR: 'Rams', LV: 'Raiders', MIA: 'Dolphins',
  MIN: 'Vikings', NE: 'Patriots', NO: 'Saints', NYG: 'Giants',
  NYJ: 'Jets', PHI: 'Eagles', PIT: 'Steelers', SEA: 'Seahawks',
  SF: '49ers', TB: 'Buccaneers', TEN: 'Titans', WAS: 'Commanders',
};

/** "BAL" → "Ravens". Falls back to the abbreviation rather than inventing a name. */
export function teamName(abbr: string): string {
  return TEAM_NAMES[abbr.toUpperCase()] ?? abbr;
}

/** "BAL@IND" → "Ravens at Colts". Unknown keys degrade to the key itself. */
export function gameTitle(gameKey: string): string {
  const [away, home] = gameKey.split('@');
  if (!away || !home) return gameKey;
  return `${teamName(away)} at ${teamName(home)}`;
}
