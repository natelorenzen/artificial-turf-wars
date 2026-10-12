/**
 * The weekly video brief: one JSON document a presenter can read a week from.
 *
 * Served at /data/week/N/video.json and readable at /week/N/brief.
 *
 * "Built at 11:00 AM Pacific on Thursday" is implemented as an AS-OF CUTOFF, not as a
 * stored snapshot. Everything the brief reads is already immutable by then: picks and
 * bets lock before the cutoff, Thursday's final re-score lands three hours before it,
 * waiver runs are resolved on Wednesday, and the guide is published Wednesday or
 * Thursday. So the brief is a pure function of stored rows plus the cutoff, replays
 * exactly at any later time (hard rule 6), and needs no table and no cron of its own.
 * Rows that could only exist after the cutoff — a manual pick re-run, this week's game
 * results — are excluded by time rather than trusted to be absent.
 *
 * Selection is mechanical and stated in the document (`rules`), so nobody, us
 * included, chooses which model gets the airtime:
 *   - bet of the week:   the largest single stake.
 *   - upset of the week: the largest positive edge (model % minus market %).
 *   - ties:              alphabetical, by model name, then team.
 *
 * Quotes are verbatim and under 25 words. A quote that is longer is omitted with a
 * link to the full text, never trimmed, because a trimmed quote is a different quote.
 */

import { LEAGUE } from '@/lib/config/league';
import { supabase, SUPABASE_CONFIGURED } from '@/lib/supabase';
import { absoluteUrl } from '@/lib/site/nav';
import { SEASON, loadSeasonSnapshot, type StandingsRow } from '@/lib/site/results';
import { loadFixtureLinks, loadMatchup, weekBriefFacts, type MatchupView } from '@/lib/site/matchup';
import { loadPicksWeek, type ModelPickView } from '@/lib/site/picks';
import { loadWaiverRun } from '@/lib/site/waivers';
import { getGuide } from '@/lib/preview/read';
import { bankroll, BANKROLL_OPENED_WEEK, type Bet } from '@/lib/picks/bankroll';
import { loadOutcomes } from '@/lib/picks/data';
import type { GameOutcome } from '@/lib/picks/grade';

export const VIDEO_BRIEF_SCHEMA = 'artificialturfwar.video-brief.v1';
export const QUOTE_WORD_LIMIT = 25;
export const BRIEF_TIMEZONE = 'America/Los_Angeles';
export const BRIEF_HOUR = 11;

// ---------------------------------------------------------------------------
// Labelled numbers
// ---------------------------------------------------------------------------

export type NumberStatus = 'live' | 'provisional' | 'final';

/** Every number in the brief travels with the status it was read at. */
export interface Labeled<T = number> {
  value: T;
  status: NumberStatus;
}

const label = <T>(value: T, status: NumberStatus): Labeled<T> => ({ value, status });

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

export interface Quote {
  /** Exactly as written, or null when it is too long to quote whole. */
  text: string | null;
  words: number;
  /** Where to read it in full. */
  source: string;
}

export function quote(text: string | null | undefined, source: string): Quote | null {
  if (!text) return null;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return { text: words < QUOTE_WORD_LIMIT ? text : null, words, source };
}

// ---------------------------------------------------------------------------
// The cutoff
// ---------------------------------------------------------------------------

/** Wall-clock parts of an instant in a zone. */
function zoned(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday')),
  };
}

/** The instant a zone's wall clock reads `y-m-d h:00`, DST included. */
function wallTime(y: number, m: number, d: number, h: number, timeZone: string): Date {
  let guess = Date.UTC(y, m - 1, d, h);
  // Two passes settle the offset either side of a DST change.
  for (let i = 0; i < 2; i++) {
    const w = zoned(new Date(guess), timeZone);
    const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
    guess += Date.UTC(y, m - 1, d, h) - asUtc;
  }
  return new Date(guess);
}

/**
 * 11:00 AM Pacific on the Thursday of the week that opens at `firstKickoff`.
 *
 * The Thursday on or after the opener's Pacific date: the same day for a Thursday
 * opener (whose game is 17:15 PT, well after), the next day for the Wednesday openers
 * of weeks 1 and 12. Pacific, so the 1 Nov DST change moves the instant with the clock.
 */
export function briefCutoff(firstKickoff: Date): Date {
  const local = zoned(firstKickoff, BRIEF_TIMEZONE);
  const ahead = (4 - local.weekday + 7) % 7;
  const day = new Date(Date.UTC(local.year, local.month - 1, local.day + ahead));
  return wallTime(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), BRIEF_HOUR, BRIEF_TIMEZONE);
}

// ---------------------------------------------------------------------------
// Neutral selection
// ---------------------------------------------------------------------------

export interface BetCandidate {
  model: string;
  modelKey: string;
  gameKey: string;
  team: string;
  stake: number;
  /** American odds. */
  price: number;
}

/** Largest single stake; ties alphabetical by model, then team. */
export function betOfTheWeek(bets: BetCandidate[]): BetCandidate | null {
  return (
    [...bets].sort(
      (a, b) => b.stake - a.stake || a.model.localeCompare(b.model) || a.team.localeCompare(b.team),
    )[0] ?? null
  );
}

export interface EdgeCandidate {
  model: string;
  modelKey: string;
  gameKey: string;
  team: string;
  modelProb: number;
  marketProb: number;
  edge: number;
}

/** Largest positive edge; ties alphabetical by model, then team. Null if none is positive. */
export function upsetOfTheWeek(candidates: EdgeCandidate[]): EdgeCandidate | null {
  return (
    candidates
      .filter((c) => c.edge > 0)
      .sort((a, b) => b.edge - a.edge || a.model.localeCompare(b.model) || a.team.localeCompare(b.team))[0] ?? null
  );
}

/** Highest stated probability first; ties by game key so the order replays. */
export function topPicks<T extends { gameKey: string; winProb: number }>(picks: T[], n = 3): T[] {
  return [...picks].sort((a, b) => b.winProb - a.winProb || a.gameKey.localeCompare(b.gameKey)).slice(0, n);
}

// ---------------------------------------------------------------------------
// Playoff stakes
// ---------------------------------------------------------------------------

function parseRecord(record: string): { w: number; l: number; t: number } {
  const [w = 0, l = 0, t = 0] = record.split('-').map(Number);
  return { w, l, t };
}
const h2hScore = (r: { w: number; t: number }) => r.w + r.t * 0.5;
/** Win share, a tie half a win. The comparison has to be a rate: the hypothetical gives this team one more game than the line. */
const winShare = (r: { w: number; l: number; t: number }) => (r.w + r.l + r.t === 0 ? 0 : h2hScore(r) / (r.w + r.l + r.t));
const fmtRecord = (r: { w: number; l: number; t: number }) => (r.t > 0 ? `${r.w}-${r.l}-${r.t}` : `${r.w}-${r.l}`);

export type VersusLine = 'above' | 'level' | 'below';

export interface PlayoffStakes {
  /** The last playoff seed as the table stands, excluding this team. */
  line: { model: string; record: string };
  ifWin: { record: string; versusLine: VersusLine };
  ifLoss: { record: string; versusLine: VersusLine };
}

/**
 * "If" stakes, by record alone against today's playoff line.
 *
 * The line is the team that would hold the last seed if this team were removed from the
 * table. A result that puts this team's win share above that team's is `above`; equal
 * is `level`, which points-for would decide. Win share rather than wins, because only
 * this team has had the extra game added. Everyone else's game this week is unknown and
 * held where it is — this is the stake of THIS game, not a projection of the table.
 * We do not forecast (hard rule 10), so there is no probability here.
 */
export function playoffStakes(table: StandingsRow[], modelKey: string, spots = LEAGUE.playoffTeams): PlayoffStakes | null {
  const self = table.find((r) => r.modelKey === modelKey);
  const others = table
    .filter((r) => r.modelKey !== modelKey)
    .map((r) => ({ row: r, rec: parseRecord(r.record) }))
    .sort((a, b) => h2hScore(b.rec) - h2hScore(a.rec) || b.row.pointsFor - a.row.pointsFor);
  const line = others[spots - 1];
  if (!self || !line) return null;

  const rec = parseRecord(self.record);
  const versus = (r: { w: number; l: number; t: number }): VersusLine => {
    const diff = winShare(r) - winShare(line.rec);
    return diff > 0 ? 'above' : diff === 0 ? 'level' : 'below';
  };
  const win = { ...rec, w: rec.w + 1 };
  const loss = { ...rec, l: rec.l + 1 };
  return {
    line: { model: line.row.model, record: line.row.record },
    ifWin: { record: fmtRecord(win), versusLine: versus(win) },
    ifLoss: { record: fmtRecord(loss), versusLine: versus(loss) },
  };
}

// ---------------------------------------------------------------------------
// The loader
// ---------------------------------------------------------------------------

export type VideoBriefResult =
  | { ok: true; brief: Awaited<ReturnType<typeof buildBrief>> }
  | { ok: false; status: 404 | 425; reason: string; availableAt: string | null };

async function seasonRow(season: number): Promise<string | null> {
  if (!SUPABASE_CONFIGURED) return null;
  const { data } = await supabase.from('seasons').select('id').eq('year', season).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

async function weekOpener(season: number, week: number): Promise<Date | null> {
  const { data } = await supabase
    .from('nfl_games')
    .select('kickoff_at')
    .eq('season', season)
    .eq('season_type', 'regular')
    .eq('week', week)
    .not('kickoff_at', 'is', null)
    .order('kickoff_at', { ascending: true })
    .limit(1);
  const first = data?.[0]?.kickoff_at as string | undefined;
  return first ? new Date(first) : null;
}

const scoreStatus = (views: MatchupView[]): NumberStatus =>
  views.length > 0 && views.every((v) => v.status === 'final')
    ? 'final'
    : views.some((v) => v.status === 'live')
      ? 'live'
      : 'provisional';

export async function loadVideoBrief(week: number, season = SEASON, now = new Date()): Promise<VideoBriefResult> {
  if (!(await seasonRow(season))) return { ok: false, status: 404, reason: 'no such season', availableAt: null };

  const opener = await weekOpener(season, week);
  if (!opener) return { ok: false, status: 404, reason: `week ${week} has no scheduled games`, availableAt: null };
  const cutoff = briefCutoff(opener);
  if (now < cutoff) {
    return { ok: false, status: 425, reason: `the week ${week} brief is built at 11:00 AM Pacific on Thursday`, availableAt: cutoff.toISOString() };
  }

  const [picks, guide] = await Promise.all([loadPicksWeek(week, season), getGuide(week, season)]);
  const missing = [!picks && 'picks', !guide && 'weekend guide'].filter(Boolean);
  if (missing.length > 0) {
    return { ok: false, status: 425, reason: `waiting for the ${missing.join(' and ')}`, availableAt: null };
  }
  return { ok: true, brief: await buildBrief(week, season, cutoff, picks!, guide!) };
}

async function buildBrief(
  week: number,
  season: number,
  cutoff: Date,
  picksWeek: NonNullable<Awaited<ReturnType<typeof loadPicksWeek>>>,
  guide: NonNullable<Awaited<ReturnType<typeof getGuide>>>,
) {
  const prev = week - 1;
  const isPlayoffs = week > LEAGUE.regularSeasonWeeks;

  // ---- last week: the table, the scores, the headline numbers ---------------
  const prevFixtures = prev >= 1 ? await loadFixtureLinks(prev, season) : [];
  const prevViews = (await Promise.all(prevFixtures.map((f) => loadMatchup(prev, f.slug, season)))).filter(
    (v): v is MatchupView => v !== null,
  );
  const prevStatus = scoreStatus(prevViews);
  const lastWeek = weekBriefFacts(prevViews);

  const snapshot = prev >= 1 ? await loadSeasonSnapshot(season, Math.min(prev, LEAGUE.regularSeasonWeeks)) : null;
  const table = snapshot?.table ?? [];
  const row = (key: string) => table.find((r) => r.modelKey === key) ?? null;

  // ---- this week's matchups ------------------------------------------------
  const fixtures = await loadFixtureLinks(week, season);
  const team = (t: { model: string; modelKey: string }) => {
    const r = row(t.modelKey);
    return {
      model: t.model,
      modelKey: t.modelKey,
      record: r ? label(r.record, prevStatus) : null,
      rank: r ? label(r.rank, prevStatus) : null,
      coRanked: r?.coRanked ?? false,
      stakes: !isPlayoffs && r ? playoffStakes(table, t.modelKey) : null,
    };
  };

  // ---- picks: only sets locked by the cutoff -------------------------------
  const sets = picksWeek.sets.filter((s) => new Date(s.lockedAt) <= cutoff);
  const picksUrl = absoluteUrl(`/picks/${week}`);

  // Bankroll as of the cutoff: every bet from the opening week to this one, settled
  // against results from earlier weeks only. This week's stakes are at risk.
  const bankrolls = await bankrollsAt(season, week, sets.map((s) => s.modelKey));

  const allBets: BetCandidate[] = sets.flatMap((s) =>
    [...s.picks.values()].flatMap((p) =>
      p.bet ? [{ model: s.model, modelKey: s.modelKey, gameKey: p.gameKey, team: p.bet.team, stake: p.bet.stake, price: p.bet.price }] : [],
    ),
  );
  const edges: EdgeCandidate[] = sets.flatMap((s) =>
    [...s.picks.values()].flatMap((p) => {
      const market = picksWeek.market.get(p.gameKey)?.get(p.pick);
      return market === undefined
        ? []
        : [{ model: s.model, modelKey: s.modelKey, gameKey: p.gameKey, team: p.pick, modelProb: p.winProb, marketProb: market, edge: p.winProb - market }];
    }),
  );

  const betView = (b: BetCandidate | null) =>
    b ? { model: b.model, modelKey: b.modelKey, game: b.gameKey, team: b.team, odds: label(b.price, 'final'), stake: label(b.stake, 'final') } : null;
  const edgeView = (e: EdgeCandidate) => ({
    model: e.model,
    modelKey: e.modelKey,
    game: e.gameKey,
    team: e.team,
    modelPct: label(round1(e.modelProb * 100), 'final'),
    marketPct: label(round1(e.marketProb * 100), 'final'),
    edgePts: label(round1(e.edge * 100), 'final'),
  });

  // ---- waivers since last week ---------------------------------------------
  const run = prev >= 1 ? await loadWaiverRun(prev, season) : null;

  return {
    schema: VIDEO_BRIEF_SCHEMA,
    season,
    week,
    asOf: cutoff.toISOString(),
    asOfLabel: '11:00 AM Pacific, Thursday',
    rules: {
      betOfTheWeek: 'largest single stake; ties alphabetical by model, then team',
      upsetOfTheWeek: 'largest positive edge (model % minus margin-free market %); ties alphabetical by model, then team',
      quotes: `verbatim and under ${QUOTE_WORD_LIMIT} words; a longer quote is omitted (text: null) with a link, never trimmed`,
      stakes: "by record alone against today's playoff line, with every other game this week held where it is; not a forecast",
      statuses: 'live is unofficial; provisional is Tuesday; final is Thursday and never changes. Odds, stakes and probabilities are final once locked.',
    },
    links: {
      page: absoluteUrl(`/week/${week}/brief`),
      picks: picksUrl,
      weekendGuide: absoluteUrl(`/weekend/${week}`),
      weekData: absoluteUrl(`/data/week/${week}.json`),
      lastWeekResults: prev >= 1 ? absoluteUrl(`/results/${prev}`) : null,
      waivers: prev >= 1 ? absoluteUrl(`/waivers/${prev}`) : null,
    },

    matchups: fixtures.map((f) => ({
      url: absoluteUrl(`/results/${week}/${f.slug}`),
      home: team(f.home),
      away: team(f.away),
    })),

    picks: sets
      .slice()
      .sort((a, b) => a.model.localeCompare(b.model))
      .map((s) => {
        const bets = allBets.filter((b) => b.modelKey === s.modelKey);
        const br = bankrolls.get(s.modelKey);
        return {
          model: s.model,
          modelKey: s.modelKey,
          headline: quote(s.headline, picksUrl),
          topPicks: topPicks<ModelPickView>([...s.picks.values()]).map((p) => ({
            game: p.gameKey,
            team: p.pick,
            winPct: label(round1(p.winProb * 100), 'final'),
          })),
          biggestBet: betView(betOfTheWeek(bets)),
          bankroll: br
            ? {
                balance: label(br.balance, prevStatus),
                atRiskThisWeek: label(br.atRisk, 'final'),
                available: label(br.available, prevStatus),
              }
            : null,
        };
      }),

    againstTheGrain: picksWeek.dissents
      .filter((d) => sets.some((s) => s.modelKey === d.modelKey))
      .map((d) => ({
        model: d.model,
        modelKey: d.modelKey,
        game: d.pick.gameKey,
        team: d.pick.pick,
        panel: `${d.of - d.agree} against ${d.agree}`,
        modelPct: label(round1(d.pick.winProb * 100), 'final'),
        marketPct: d.marketProb === null ? null : label(round1(d.marketProb * 100), 'final'),
        edgePts: d.claimedEdge === null ? null : label(round1(d.claimedEdge * 100), 'final'),
      })),

    betOfTheWeek: betView(betOfTheWeek(allBets)),
    upsetOfTheWeek: (() => {
      const u = upsetOfTheWeek(edges);
      return u ? edgeView(u) : null;
    })(),

    sayThis: guide.sections.map((s) => ({
      game: s.gameKey,
      line: quote(s.takeaway, absoluteUrl(`/weekend/${week}`)),
    })),

    lastWeek:
      lastWeek && prev >= 1
        ? {
            week: prev,
            status: lastWeek.status,
            highScore: { model: lastWeek.high.model, points: label(lastWeek.high.points, lastWeek.status) },
            lowScore: { model: lastWeek.low.model, points: label(lastWeek.low.points, lastWeek.status) },
            biggestWin: lastWeek.biggest
              ? { winner: lastWeek.biggest.winner.model, loser: lastWeek.biggest.loser.model, margin: label(lastWeek.biggest.margin, lastWeek.status) }
              : null,
            closestGame: {
              winner: lastWeek.closest.winner.model,
              loser: lastWeek.closest.loser.model,
              margin: label(lastWeek.closest.margin, lastWeek.status),
            },
            bestLineupCalls: lastWeek.bestCalls
              ? { model: lastWeek.bestCalls.model, vsAutopilot: label(lastWeek.bestCalls.delta, lastWeek.status) }
              : null,
            worstLineupCalls: lastWeek.worstCalls
              ? { model: lastWeek.worstCalls.model, vsAutopilot: label(lastWeek.worstCalls.delta, lastWeek.status) }
              : null,
            mostLeftOnBench: lastWeek.mostLeftOnBench
              ? { model: lastWeek.mostLeftOnBench.model, points: label(lastWeek.mostLeftOnBench.points, lastWeek.status) }
              : null,
            playerOfTheWeek: lastWeek.playerOfWeek
              ? {
                  name: lastWeek.playerOfWeek.name,
                  position: lastWeek.playerOfWeek.position,
                  model: lastWeek.playerOfWeek.model,
                  points: label(lastWeek.playerOfWeek.points, lastWeek.status),
                }
              : null,
          }
        : null,

    waivers:
      run && !run.sealed
        ? {
            run: prev,
            budgets: run.teams
              .slice()
              .sort((a, b) => a.model.localeCompare(b.model))
              .map((t) => ({ model: t.model, modelKey: t.modelKey, faab: t.faabAfter === null ? null : label(t.faabAfter, 'final') })),
            winningClaims: run.contests
              .flatMap((c) => (c.winner ? [c.winner] : []))
              .sort((a, b) => b.bid - a.bid || a.model.localeCompare(b.model))
              .map((w) => ({ model: w.model, added: w.add.name, position: w.add.position, dropped: w.drop.name, bid: label(w.bid, 'final') })),
          }
        : null,

    disclaimer: 'Play money, for entertainment only. Not betting advice. An exhibition, not a benchmark.',
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Each model's bankroll at the cutoff: every bet from the week the bankroll opened to
 * this one, with only EARLIER weeks' results applied. Keyed by week so a matchup that
 * recurs in a season is two bets, as on the season board.
 */
async function bankrollsAt(season: number, week: number, modelKeys: string[]) {
  const out = new Map<string, ReturnType<typeof bankroll>>();
  const bets = new Map<string, Bet[]>();
  const outcomes = new Map<string, Map<string, GameOutcome>>();

  for (let w = BANKROLL_OPENED_WEEK; w <= week; w++) {
    const pw = await loadPicksWeek(w, season);
    if (!pw) continue;
    const results = w < week ? new Map((await loadOutcomes(supabase, season, w)).outcomes.map((o) => [o.gameKey, o])) : new Map();
    for (const set of pw.sets) {
      if (!modelKeys.includes(set.modelKey)) continue;
      const list = bets.get(set.modelKey) ?? [];
      const known = outcomes.get(set.modelKey) ?? new Map<string, GameOutcome>();
      for (const p of set.picks.values()) {
        if (!p.bet) continue;
        const key = `${w}:${p.gameKey}`;
        list.push({ gameKey: key, team: p.bet.team, stake: p.bet.stake, price: p.bet.price });
        const o = results.get(p.gameKey);
        if (o) known.set(key, o);
      }
      bets.set(set.modelKey, list);
      outcomes.set(set.modelKey, known);
    }
  }
  for (const key of modelKeys) out.set(key, bankroll(bets.get(key) ?? [], outcomes.get(key) ?? new Map()));
  return out;
}
