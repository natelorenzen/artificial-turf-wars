/**
 * Moneyline odds for the picks bankroll, from The Odds API (the-odds-api.com).
 *
 * Fetched once per run, stored whole in `odds_snapshots`, and only then read back to
 * build the DATA block — decision-time code reads our own snapshot, never a live feed
 * (hard rule 6), so every bet replays against the exact price it was offered.
 *
 * Each game gets ONE consensus price per side: the median across US books, taken in
 * decimal odds (an American median is meaningless across the ±100 gap). No book is
 * named anywhere — the site links to no sportsbook, and naming the source of a price is
 * one step from that.
 *
 * Pure functions except `fetchOdds`, which is the only network call.
 */

export const ODDS_SOURCE = 'the-odds-api/v4 americanfootball_nfl h2h us, median across books';

const ODDS_URL = 'https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds';

/** The Odds API names teams in full; Sleeper uses these codes. */
export const TEAM_CODES: Record<string, string> = {
  'Arizona Cardinals': 'ARI',
  'Atlanta Falcons': 'ATL',
  'Baltimore Ravens': 'BAL',
  'Buffalo Bills': 'BUF',
  'Carolina Panthers': 'CAR',
  'Chicago Bears': 'CHI',
  'Cincinnati Bengals': 'CIN',
  'Cleveland Browns': 'CLE',
  'Dallas Cowboys': 'DAL',
  'Denver Broncos': 'DEN',
  'Detroit Lions': 'DET',
  'Green Bay Packers': 'GB',
  'Houston Texans': 'HOU',
  'Indianapolis Colts': 'IND',
  'Jacksonville Jaguars': 'JAX',
  'Kansas City Chiefs': 'KC',
  'Las Vegas Raiders': 'LV',
  'Los Angeles Chargers': 'LAC',
  'Los Angeles Rams': 'LAR',
  'Miami Dolphins': 'MIA',
  'Minnesota Vikings': 'MIN',
  'New England Patriots': 'NE',
  'New Orleans Saints': 'NO',
  'New York Giants': 'NYG',
  'New York Jets': 'NYJ',
  'Philadelphia Eagles': 'PHI',
  'Pittsburgh Steelers': 'PIT',
  'San Francisco 49ers': 'SF',
  'Seattle Seahawks': 'SEA',
  'Tampa Bay Buccaneers': 'TB',
  'Tennessee Titans': 'TEN',
  'Washington Commanders': 'WAS',
};

/** One game's line, keyed by our `AWAY@HOME` game key. */
export interface GameLine {
  gameKey: string;
  /** American odds, e.g. +150 or -180. */
  away: number;
  home: number;
  /** How many books the median was taken over. */
  books: number;
  /** The feed's REPORTED start time — unlike our modelled kickoff, this one is real. */
  commenceTime: string;
}

/** The subset of the feed we read. Anything else in it is kept in the raw snapshot. */
export interface OddsEvent {
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: {
    key: string;
    markets: { key: string; outcomes: { name: string; price: number }[] }[];
  }[];
}

export function americanToDecimal(price: number): number {
  if (!Number.isFinite(price) || (price > -100 && price < 100)) {
    throw new Error(`not an American price: ${price}`);
  }
  return price > 0 ? 1 + price / 100 : 1 + 100 / -price;
}

export function decimalToAmerican(decimal: number): number {
  if (!(decimal > 1)) throw new Error(`not a decimal price: ${decimal}`);
  return decimal >= 2 ? Math.round((decimal - 1) * 100) : -Math.round(100 / (decimal - 1));
}

/** The probability a price implies, bookmaker margin included. */
export function impliedProb(price: number): number {
  return 1 / americanToDecimal(price);
}

/**
 * The two sides' implied probabilities with the margin removed, so they sum to 1.
 * The market's own forecast, and the baseline the models' probabilities are held to.
 */
export function fairProbs(line: Pick<GameLine, 'away' | 'home'>): { away: number; home: number } {
  const a = impliedProb(line.away);
  const h = impliedProb(line.home);
  return { away: a / (a + h), home: h / (a + h) };
}

/** Profit on a winning bet. The stake itself comes back on top of this. */
export function winProfit(price: number, stake: number): number {
  return stake * (americanToDecimal(price) - 1);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Lines for the given games from a raw feed. A game the feed does not carry, or whose
 * team names we cannot map, simply has no line — it can be picked but not bet on.
 */
export function parseOdds(events: OddsEvent[], gameKeys: string[]): Map<string, GameLine> {
  const wanted = new Set(gameKeys);
  const out = new Map<string, GameLine>();

  for (const ev of events) {
    const away = TEAM_CODES[ev.away_team];
    const home = TEAM_CODES[ev.home_team];
    if (!away || !home) continue;
    const key = `${away}@${home}`;
    if (!wanted.has(key)) continue;

    const awayPrices: number[] = [];
    const homePrices: number[] = [];
    for (const book of ev.bookmakers ?? []) {
      const h2h = book.markets?.find((m) => m.key === 'h2h');
      const a = h2h?.outcomes.find((o) => o.name === ev.away_team)?.price;
      const h = h2h?.outcomes.find((o) => o.name === ev.home_team)?.price;
      // Both sides from the same book or neither: a one-sided quote is a stale market.
      if (typeof a !== 'number' || typeof h !== 'number') continue;
      if (Math.abs(a) < 100 || Math.abs(h) < 100) continue;
      awayPrices.push(americanToDecimal(a));
      homePrices.push(americanToDecimal(h));
    }
    if (awayPrices.length === 0) continue;

    // A feed can list one game twice (a rescheduled event); keep the better-covered one.
    const existing = out.get(key);
    if (existing && existing.books >= awayPrices.length) continue;
    out.set(key, {
      gameKey: key,
      away: decimalToAmerican(median(awayPrices)),
      home: decimalToAmerican(median(homePrices)),
      books: awayPrices.length,
      commenceTime: ev.commence_time,
    });
  }
  return out;
}

export async function fetchOdds(apiKey: string): Promise<{ events: OddsEvent[]; remaining: string | null }> {
  const url = `${ODDS_URL}?regions=us&markets=h2h&oddsFormat=american&apiKey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    // Never echo the URL: it carries the key.
    throw new Error(`odds feed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return {
    events: (await res.json()) as OddsEvent[],
    remaining: res.headers.get('x-requests-remaining'),
  };
}

/** A price as the prompt and the site print it: `+150`, `-180`. */
export function formatPrice(price: number): string {
  return price > 0 ? `+${price}` : String(price);
}
