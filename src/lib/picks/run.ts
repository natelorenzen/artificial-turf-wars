/**
 * The weekly picks call: every competitor picks the winner of every NFL game this week,
 * with a probability, and may bet its play-money bankroll on the moneyline.
 *
 * Three deliberate departures from the league's decision calls, all disclosed on
 * /methodology:
 *
 *   1. Models MAY use their own football knowledge. The user-facing question is "what
 *      do these models think of these teams", and a DATA-only rule would reduce it to
 *      "who has the better record", which a spreadsheet can answer. What they get from
 *      us is what their memory cannot have: this season's results, this week's injury
 *      report, and who is projected to start at quarterback. Where the two disagree the
 *      prompt says the data wins, because their memory stops before this season does.
 *   2. These are not `decisions`. A pick moves no roster and spends no budget, so it
 *      lives in `pick_sets` / `game_picks` — published just as completely.
 *   3. Since picks-v2 (25 Sept 2026) they see the market. Each game carries a consensus
 *      moneyline, and each model has $100 of play money for the season. Their win
 *      probabilities are therefore formed WITH the price in view, which is why the
 *      market's own de-vigged probability is graded beside them as a baseline.
 *
 * The DATA block is still identical for every model, byte for byte, and hashed. The one
 * per-model fact — its own bankroll — sits OUTSIDE the block, after it, the same split
 * the league's weekly calls use between base and overlay (§14.6).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { COHORT, LEAGUE } from '@/lib/config/league';
import { callModel } from '@/lib/openrouter/client';
import { assertNoLabelLeak } from '@/lib/engine/labels';
import { stableHash } from '@/lib/util/hash';
import { claimJobRun, completeJobRun, failJobRun } from '@/lib/cron/job-run';
import { loadFixtures, loadOutcomes, type FixtureWithKickoff } from './data';
import { teamRecords, type GameOutcome, type TeamRecord } from './grade';
import { fetchOdds, ODDS_SOURCE, parseOdds, type GameLine, type OddsEvent } from './odds';
import { bankroll, stakeLimit, STARTING_BANKROLL, type Bet } from './bankroll';

export const PICKS_PROMPT_VERSION = 'picks-v2-bankroll';

/** Lab and model names that must never reach a DATA block (hard rule 9). */
const FORBIDDEN_NAMES = [...COHORT.map((m) => m.displayName), ...COHORT.map((m) => m.lab)];

/** Positions whose injuries are listed. K and DEF injuries rarely decide a game. */
const INJURY_POSITIONS = ['QB', 'RB', 'WR', 'TE'];
/** Currently this high on the depth chart counts as a starter or first backup. */
const INJURY_DEPTH_MAX = 2;
/**
 * A team's preseason starters: the top N at each position by season-long projection.
 *
 * Needed because the depth chart alone loses exactly the injuries that matter. Sleeper
 * DEMOTES an injured starter: on 23 Sept 2026 Caleb Williams (Doubtful) was CHI's QB3,
 * Jayden Daniels (Doubtful) WAS's QB2 and Jaxson Dart (Doubtful) NYG's QB3. A depth-1
 * filter showed each team's backup as its starter with no hint why — to a model whose
 * memory says Williams starts, that reads as a data error to be overruled.
 */
const PRESEASON_STARTERS: Record<string, number> = { QB: 1, RB: 2, WR: 3, TE: 1 };

export const PICKS_SYSTEM = `You are picking the winner of every NFL game this week, and managing a
bankroll of play money you can bet on those games.

This is a public prediction record, for entertainment. The money is not real
and you are not advising anyone to bet.

YOU MAY USE YOUR OWN FOOTBALL KNOWLEDGE: coaching, quarterback quality, roster
strength, home field, how these teams are built. But your knowledge stops
before this season started, and the DATA block does not:
- this_season has every result so far this season. Rosters, coaches and form
  may have changed since your training data. Where DATA disagrees with your
  memory, DATA wins.
- injuries is the current injury report for starters and key backups.
- projected_starting_qb is who is projected to start at quarterback THIS week.
- moneyline is the market price on each side to win the game, in American odds.
If your reasoning relies on a player, check he is not listed as out.

THE BANKROLL. Every competitor started the season with $${STARTING_BANKROLL}. There are no
top-ups: what you lose is gone for the rest of the season, and what you win you
can bet again. The competitor holding the most money at the end of the season
wins this part. Your current balance is given after the DATA block.
- A bet is on one team to win the game outright, at that team's moneyline.
  +150 means a $10 bet wins $15 profit. -150 means a $15 bet wins $10 profit.
  A losing bet loses the stake. A tie returns the stake.
- You may bet on either team — it does not have to be the team you pick — on
  any number of games, or on none. Stakes are whole dollars, and your stakes
  this week together may not exceed the amount available to you.
- The two sides' prices include the market's margin, so betting at random loses
  money over time.
- A game with a null moneyline cannot be bet on this week.

For EVERY game in games, return:
- pick: the team code (one of the two in that game) you expect to win.
- win_prob: your probability that your pick wins, from 0.5 to 1.
  0.5 is a coin flip. 0.75 means your pick wins three times in four. 0.95 is
  close to certain. These are scored all season with a Brier score — a
  confident miss costs far more than a cautious one — and published.
- bet_team: the team you are betting on, or null for no bet.
- stake: whole dollars on bet_team, or 0 for no bet.
- reason: one sentence, at most 25 words, naming what decided it.

Return only a single JSON object. No preamble, no markdown, no code fences.`;

const OUTPUT_EXAMPLE = {
  headline: 'One sentence: the pick you are most sure of, or the upset you are calling.',
  picks: [
    { game_key: 'AWAY@HOME', pick: 'HOME', win_prob: 0.62, bet_team: null, stake: 0, reason: 'One sentence, 25 words max.' },
  ],
};

// ---------------------------------------------------------------------------
// The DATA block
// ---------------------------------------------------------------------------

interface InjuryLine {
  name: string;
  position: string;
  status: string;
  body_part: string | null;
  depth_chart_order: number | null;
  preseason_starter: boolean;
}

/** Player ids of each team's preseason starters, from the season-long projections. */
async function loadPreseasonStarters(db: SupabaseClient, season: number, teams: string[]): Promise<Set<string>> {
  const { data, error } = await db
    .from('player_projections')
    .select('player_id, proj_pts, players!inner(position, nfl_team)')
    .eq('season', season)
    .is('week', null)
    .in('players.nfl_team', teams)
    .in('players.position', INJURY_POSITIONS)
    .order('proj_pts', { ascending: false })
    .order('player_id');
  if (error) throw new Error(`season-long projections: ${error.message}`);

  const taken = new Map<string, number>();
  const out = new Set<string>();
  for (const row of data ?? []) {
    const player = row.players as unknown as { position: string; nfl_team: string };
    const slot = `${player.nfl_team}:${player.position}`;
    const count = taken.get(slot) ?? 0;
    if (count >= (PRESEASON_STARTERS[player.position] ?? 0)) continue;
    taken.set(slot, count + 1);
    out.add(row.player_id as string);
  }
  return out;
}

async function loadInjuries(
  db: SupabaseClient,
  season: number,
  teams: string[],
): Promise<Record<string, InjuryLine[]>> {
  const starters = await loadPreseasonStarters(db, season, teams);
  const { data, error } = await db
    .from('players')
    .select('sleeper_id, name, position, nfl_team, injury_status, injury_body_part, depth_chart_order')
    .in('nfl_team', teams)
    .in('position', INJURY_POSITIONS)
    .not('injury_status', 'is', null)
    .order('nfl_team')
    .order('position')
    .order('depth_chart_order', { nullsFirst: false })
    .order('name');
  if (error) throw new Error(`injuries: ${error.message}`);

  const out: Record<string, InjuryLine[]> = {};
  for (const team of [...teams].sort()) out[team] = [];
  for (const row of data ?? []) {
    const depth = (row.depth_chart_order as number | null) ?? null;
    const starter = starters.has(row.sleeper_id as string);
    // Listed if he was a starter going into the season, wherever the depth chart has
    // moved him since, or if he is a starter or first backup now. A backup QB's
    // hamstring does not move a game; a starting QB's does.
    const nowKey = depth !== null && (row.position === 'QB' ? depth <= 1 : depth <= INJURY_DEPTH_MAX);
    if (!starter && !nowKey) continue;
    out[row.nfl_team as string]?.push({
      name: row.name as string,
      position: row.position as string,
      status: row.injury_status as string,
      body_part: (row.injury_body_part as string | null) ?? null,
      depth_chart_order: depth,
      preseason_starter: starter,
    });
  }
  return out;
}

/** The highest-projected QB per team this week — who the projections expect to start. */
async function loadProjectedQbs(
  db: SupabaseClient,
  season: number,
  week: number,
  teams: string[],
): Promise<Record<string, string | null>> {
  const { data, error } = await db
    .from('player_projections')
    .select('proj_pts, raw_projection, players!inner(name, position, nfl_team)')
    .eq('season', season)
    .eq('week', week)
    .eq('players.position', 'QB')
    .order('proj_pts', { ascending: false });
  if (error) throw new Error(`QB projections: ${error.message}`);

  const out: Record<string, string | null> = {};
  for (const team of [...teams].sort()) out[team] = null;
  for (const row of data ?? []) {
    const player = row.players as unknown as { name: string; nfl_team: string | null };
    const raw = (row.raw_projection ?? {}) as Record<string, unknown>;
    const team = (raw._team as string | null) ?? player.nfl_team;
    if (team && team in out && out[team] === null && Number(row.proj_pts ?? 0) > 0) out[team] = player.name;
  }
  return out;
}

function easternDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function recordLine(r: TeamRecord | undefined) {
  if (!r) return { record: '0-0', points_for: 0, points_against: 0, games: [] };
  return {
    record: r.ties > 0 ? `${r.wins}-${r.losses}-${r.ties}` : `${r.wins}-${r.losses}`,
    points_for: r.pointsFor,
    points_against: r.pointsAgainst,
    games: r.games.map((g) => ({
      week: g.week,
      opponent: g.opponent,
      at: g.at,
      score: `${g.scoreFor}-${g.scoreAgainst}`,
      result: g.result,
    })),
  };
}

export interface PicksData {
  week: number;
  /** The games still open to pick — every game, unless the run is mid-week. */
  fixtures: FixtureWithKickoff[];
  /** Consensus lines for the open games that have one. */
  lines: Map<string, GameLine>;
  oddsSnapshotId: string | null;
  data: Record<string, unknown>;
  contextHash: string;
}

/**
 * Whether a game can still be picked at `now`. The feed's REPORTED start time wins
 * where there is one; our modelled kickoff is the fallback, and it is the earliest
 * slot of that weekday, so it can only close a game early, never late.
 */
export function gameIsOpen(f: FixtureWithKickoff, line: GameLine | undefined, now: Date): boolean {
  const start = line?.commenceTime ?? f.kickoffAt;
  return start !== null && new Date(start).getTime() > now.getTime();
}

/** The newest stored odds snapshot for a week, or null. */
export async function loadOddsSnapshot(
  db: SupabaseClient,
  seasonId: string,
  week: number,
): Promise<{ id: string; lines: Map<string, GameLine> } | null> {
  const { data, error } = await db
    .from('odds_snapshots')
    .select('id, lines')
    .eq('season_id', seasonId)
    .eq('week', week)
    .order('fetched_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`odds_snapshots: ${error.message}`);
  const row = data?.[0];
  if (!row) return null;
  const lines = new Map<string, GameLine>();
  for (const [gameKey, l] of Object.entries(row.lines as Record<string, Omit<GameLine, 'gameKey'>>)) {
    lines.set(gameKey, { gameKey, ...l });
  }
  return { id: row.id as string, lines };
}

/** Fetch the feed once and store it whole. Returns what was stored. */
export async function storeOddsSnapshot(
  db: SupabaseClient,
  seasonId: string,
  season: number,
  week: number,
  apiKey: string,
): Promise<{ id: string; lines: Map<string, GameLine>; remaining: string | null }> {
  const fixtures = await loadFixtures(db, season, week);
  const { events, remaining } = await fetchOdds(apiKey);
  const lines = parseOdds(events, fixtures.map((f) => f.gameKey));
  const { data, error } = await db
    .from('odds_snapshots')
    .insert({
      season_id: seasonId,
      week,
      source: ODDS_SOURCE,
      raw: events as unknown as OddsEvent[],
      lines: Object.fromEntries(
        [...lines].map(([k, l]) => [k, { away: l.away, home: l.home, books: l.books, commenceTime: l.commenceTime }]),
      ),
    })
    .select('id')
    .single();
  if (error) throw new Error(`odds_snapshots insert: ${error.message}`);
  return { id: data.id as string, lines, remaining };
}

export async function buildPicksData(
  db: SupabaseClient,
  season: number,
  week: number,
  opts: { seasonId?: string; now?: Date } = {},
): Promise<PicksData> {
  const now = opts.now ?? new Date();
  const all = await loadFixtures(db, season, week);
  if (all.length === 0) throw new Error(`no fixtures stored for ${season} week ${week}`);

  const snapshot = opts.seasonId ? await loadOddsSnapshot(db, opts.seasonId, week) : null;
  const allLines = snapshot?.lines ?? new Map<string, GameLine>();
  const fixtures = all.filter((f) => gameIsOpen(f, allLines.get(f.gameKey), now));
  if (fixtures.length === 0) throw new Error(`every game in ${season} week ${week} has started`);
  const lines = new Map([...allLines].filter(([k]) => fixtures.some((f) => f.gameKey === k)));
  const teams = [...new Set(fixtures.flatMap((f) => [f.away, f.home]))];

  // Every scored game so far, THIS week's included: a run made after Thursday night
  // should know how Thursday night went.
  const past = [];
  for (let w = 1; w <= week; w++) {
    const { outcomes } = await loadOutcomes(db, season, w);
    past.push({ week: w, outcomes });
  }
  const records = teamRecords(past);

  const data = {
    week,
    games: fixtures.map((f) => {
      const line = lines.get(f.gameKey);
      return {
        game_key: f.gameKey,
        away: f.away,
        home: f.home,
        // The DATE only. Our stored kickoff time is modelled, not reported, and must not
        // be presented as the real one (see src/lib/sleeper/kickoff.ts).
        // Eastern, not UTC: a Thursday night game is already Friday in UTC.
        date: f.kickoffAt ? easternDate(f.kickoffAt) : null,
        moneyline: line ? { [f.away]: line.away, [f.home]: line.home } : null,
      };
    }),
    this_season: Object.fromEntries([...teams].sort().map((t) => [t, recordLine(records.get(t))])),
    injuries: await loadInjuries(db, season, teams),
    projected_starting_qb: await loadProjectedQbs(db, season, week, teams),
    data_notes: [
      'Scores in this_season are final NFL scores, most recent week last.',
      'injuries lists QB/RB/WR/TE on the injury report who were preseason starters (preseason_starter: true) or are first or second on the depth chart now (starting QB only). Teams move an injured starter down the depth chart, so a preseason starter with a high depth_chart_order is usually hurt, not benched.',
      'projected_starting_qb is the highest-projected quarterback for that team this week; null if none is projected.',
      'moneyline is the median price across US sportsbooks when these prices were taken, in American odds, keyed by team. It includes the bookmakers\' margin. null means no price was available.',
      'There is no weather and no point spread in this data set.',
    ],
  };

  assertNoLabelLeak(JSON.stringify(data), FORBIDDEN_NAMES);
  return { week, fixtures, lines, oddsSnapshotId: snapshot?.id ?? null, data, contextHash: stableHash(data) };
}

// ---------------------------------------------------------------------------
// The response schema — built per week and per model, because the game keys and the
// money available are the outcome
// ---------------------------------------------------------------------------

/**
 * Strict on outcomes (every game picked exactly once, a pick that is one of the two
 * teams, a probability in range, bets that are legal and affordable) and nothing else.
 * A schema failure goes back to the model through `callModel`'s parse retries, exactly
 * as a malformed lineup does — so an over-stake gets a chance to be fixed rather than
 * silently trimmed.
 */
export function picksSchema(fixtures: FixtureWithKickoff[], lines: Map<string, GameLine>, limit: number) {
  const keys = fixtures.map((f) => f.gameKey) as [string, ...string[]];
  const sides = new Map(fixtures.map((f) => [f.gameKey, [f.away, f.home]]));

  return z
    .object({
      headline: z.string().min(1),
      picks: z.array(
        z.object({
          game_key: z.enum(keys),
          pick: z.string().min(1),
          win_prob: z.number().min(0.5).max(1),
          bet_team: z.string().min(1).nullable().default(null),
          stake: z.number().int().min(0).default(0),
          reason: z.string().min(1),
        }),
      ),
    })
    .superRefine((value, ctx) => {
      const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      const seen = new Set<string>();
      let total = 0;
      for (const p of value.picks) {
        if (seen.has(p.game_key)) fail(`${p.game_key} picked twice`);
        seen.add(p.game_key);
        const teams = sides.get(p.game_key) ?? [];
        if (!teams.includes(p.pick)) {
          fail(`${p.game_key}: pick "${p.pick}" is not one of ${teams.join(' / ')}`);
        }
        if (p.stake > 0) {
          total += p.stake;
          if (p.bet_team === null || !teams.includes(p.bet_team)) {
            fail(`${p.game_key}: a stake of ${p.stake} needs bet_team to be one of ${teams.join(' / ')}`);
          }
          if (!lines.has(p.game_key)) fail(`${p.game_key} has no moneyline this week and cannot be bet on`);
        }
      }
      const missing = keys.filter((k) => !seen.has(k));
      if (missing.length > 0) fail(`no pick for ${missing.join(', ')}`);
      if (total > limit) fail(`stakes total $${total}, but only $${limit} is available to bet this week`);
    });
}

export type PicksResponse = z.infer<ReturnType<typeof picksSchema>>;

export function picksUserPrompt(input: PicksData, available: number): string {
  const limit = stakeLimit(available);
  return [
    '=== DATA ===',
    JSON.stringify(input.data),
    '=== END DATA ===',
    '',
    `YOUR BANKROLL: $${available.toFixed(2)} available.` +
      (limit > 0
        ? ` Your stakes this week may total at most $${limit}.`
        : ' That is less than the $1 minimum stake, so you cannot bet this week: every stake must be 0.'),
    '',
    `Pick the winner of all ${input.fixtures.length} games in week ${input.week}. Every game_key in games, exactly once.`,
    '',
    'Return exactly this JSON shape and nothing else (one entry in picks per game):',
    JSON.stringify(OUTPUT_EXAMPLE, null, 2),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Bankrolls
// ---------------------------------------------------------------------------

/**
 * Every model's bankroll as of now, from every bet it has placed this season, settled
 * against the scores we hold. Money on a game not yet scored is at risk, not available.
 */
export async function loadBankrolls(
  db: SupabaseClient,
  seasonId: string,
  season: number,
): Promise<Map<string, ReturnType<typeof bankroll>>> {
  const { data, error } = await db
    .from('game_picks')
    .select('model_id, week, game_key, bet_team, stake, bet_price')
    .eq('season_id', seasonId)
    .gt('stake', 0);
  if (error) throw new Error(`game_picks (bets): ${error.message}`);

  const outcomes = new Map<string, GameOutcome>();
  for (const week of [...new Set((data ?? []).map((r) => r.week as number))]) {
    for (const o of (await loadOutcomes(db, season, week)).outcomes) outcomes.set(`${week}:${o.gameKey}`, o);
  }

  const bets = new Map<string, Bet[]>();
  for (const r of data ?? []) {
    const list = bets.get(r.model_id as string) ?? [];
    list.push({
      // Keyed by week too: a matchup can recur in a season.
      gameKey: `${r.week}:${r.game_key}`,
      team: r.bet_team as string,
      stake: r.stake as number,
      price: r.bet_price as number,
    });
    bets.set(r.model_id as string, list);
  }

  const out = new Map<string, ReturnType<typeof bankroll>>();
  for (const [modelId, list] of bets) out.set(modelId, bankroll(list, outcomes));
  return out;
}

// ---------------------------------------------------------------------------
// Calling and storing
// ---------------------------------------------------------------------------

export interface PickEntrant {
  key: string;
  displayName: string;
  openrouterId: string;
  modelId: string;
}

export interface PickSetOutcome {
  entrant: PickEntrant;
  valid: boolean;
  providerFailure: boolean;
  error: string | null;
  costUsd: number;
  headline: string | null;
  staked: number;
  available: number;
}

/**
 * One model's picks, stored the moment they land.
 *
 * Stored here rather than by the caller after all eight settle, because a Vercel
 * function killed at its ceiling flushes nothing: the unit of loss on a timeout should
 * be the models still thinking, not the ones that already answered.
 */
export async function decideAndStore(
  db: SupabaseClient,
  seasonId: string,
  input: PicksData,
  entrant: PickEntrant,
  available: number,
): Promise<PickSetOutcome> {
  const userPrompt = picksUserPrompt(input, available);
  const call = await callModel({
    openrouterId: entrant.openrouterId,
    systemPrompt: PICKS_SYSTEM,
    userPrompt,
    schema: picksSchema(input.fixtures, input.lines, stakeLimit(available)),
    maxOutputTokens: LEAGUE.maxOutputTokens,
  });

  const { data: set, error } = await db
    .from('pick_sets')
    .upsert(
      {
        season_id: seasonId,
        week: input.week,
        model_id: entrant.modelId,
        prompt_version: PICKS_PROMPT_VERSION,
        system_prompt: PICKS_SYSTEM,
        user_prompt: userPrompt,
        context_hash: input.contextHash,
        raw_response: call.rawResponse,
        headline: call.parsed?.headline ?? null,
        valid: call.ok,
        validation_error: call.validationError,
        provider_failure: call.providerFailure,
        retry_count: call.retryCount,
        latency_ms: call.latencyMs,
        cost_usd: call.usage.costUsd,
        locked_at: new Date().toISOString(),
        bankroll_available: available,
        odds_snapshot_id: input.oddsSnapshotId,
      },
      { onConflict: 'season_id,week,model_id' },
    )
    .select('id')
    .single();
  if (error) throw new Error(`pick_sets (${entrant.displayName}): ${error.message}`);

  let staked = 0;
  if (call.parsed) {
    const { error: pickError } = await db.from('game_picks').upsert(
      call.parsed.picks.map((p) => {
        const line = input.lines.get(p.game_key);
        const [away, home] = p.game_key.split('@');
        const betting = p.stake > 0 && p.bet_team !== null && line !== undefined;
        if (betting) staked += p.stake;
        return {
          pick_set_id: set.id,
          season_id: seasonId,
          week: input.week,
          model_id: entrant.modelId,
          game_key: p.game_key,
          pick: p.pick,
          win_prob: p.win_prob,
          reason: p.reason,
          bet_team: betting ? p.bet_team : null,
          stake: betting ? p.stake : 0,
          bet_price: betting ? (p.bet_team === away ? line.away : p.bet_team === home ? line.home : null) : null,
          away_price: line?.away ?? null,
          home_price: line?.home ?? null,
        };
      }),
      { onConflict: 'season_id,week,model_id,game_key' },
    );
    if (pickError) throw new Error(`game_picks (${entrant.displayName}): ${pickError.message}`);
  }

  return {
    entrant,
    valid: call.ok,
    providerFailure: call.providerFailure,
    error: call.validationError,
    costUsd: call.usage.costUsd ?? 0,
    headline: call.parsed?.headline ?? null,
    staked,
    available,
  };
}

// ---------------------------------------------------------------------------
// The whole run — shared by the cron route and the operator script
// ---------------------------------------------------------------------------

export interface PicksRunResult {
  week: number;
  skipped?: string;
  games: number;
  gamesWithOdds: number;
  oddsNote: string;
  contextHash: string | null;
  alreadyStored: number;
  sets: PickSetOutcome[];
  errors: string[];
  costUsd: number;
}

/**
 * Snapshot the odds, build the block, and call every model that has not yet answered.
 *
 * Odds are fail-soft on purpose: with no key, or a feed that is down, the week is still
 * picked — every game simply has a null moneyline and no bet can be placed. Losing the
 * betting for a week is recoverable; losing the picks is not, because the games do not
 * wait. The job detail says which happened.
 */
export async function runPicks(
  db: SupabaseClient,
  args: { season: number; seasonId: string; week: number; now?: Date; oddsApiKey?: string },
): Promise<PicksRunResult> {
  const { season, seasonId, week } = args;
  const now = args.now ?? new Date();

  const claim = await claimJobRun(db, { job: 'picks', seasonId, week, resumable: true });
  if (!claim.claimed) {
    return { week, skipped: claim.reason, games: 0, gamesWithOdds: 0, oddsNote: '', contextHash: null, alreadyStored: 0, sets: [], errors: [], costUsd: 0 };
  }

  try {
    // One snapshot per week. A resumed run reuses it, so a model answering after a
    // restart sees the same prices — and the same hash — as the ones before it.
    const stored = await loadOddsSnapshot(db, seasonId, week);
    let oddsNote: string;
    if (stored) {
      oddsNote = `reusing odds snapshot ${stored.id.slice(0, 8)}, ${stored.lines.size} lines`;
    } else if (!args.oddsApiKey) {
      oddsNote = 'no ODDS_API_KEY set';
    } else {
      try {
        const snap = await storeOddsSnapshot(db, seasonId, season, week, args.oddsApiKey);
        oddsNote = `odds snapshot ${snap.id.slice(0, 8)}, ${snap.lines.size} lines, ${snap.remaining ?? '?'} feed requests left`;
      } catch (err) {
        oddsNote = `odds feed failed (${err instanceof Error ? err.message : String(err)}); using the newest stored snapshot if any`;
      }
    }

    // Built, hashed and leak-checked BEFORE the first call: a block that fails costs
    // nothing.
    const input = await buildPicksData(db, season, week, { seasonId, now });

    const { data: modelRows, error: modelError } = await db.from('models').select('id, key');
    if (modelError) throw new Error(`models: ${modelError.message}`);
    const idOf = new Map((modelRows ?? []).map((m) => [m.key as string, m.id as string]));

    const { data: existing, error: existingError } = await db
      .from('pick_sets')
      .select('model_id, provider_failure')
      .eq('season_id', seasonId)
      .eq('week', week);
    if (existingError) throw new Error(`pick_sets read: ${existingError.message}`);
    const done = new Set(
      (existing ?? []).filter((row) => !row.provider_failure).map((row) => row.model_id as string),
    );

    const entrants: PickEntrant[] = COHORT.flatMap((m) => {
      const modelId = idOf.get(m.key);
      return modelId && !done.has(modelId)
        ? [{ key: m.key, displayName: m.displayName, openrouterId: m.openrouterId, modelId }]
        : [];
    });

    const bankrolls = await loadBankrolls(db, seasonId, season);
    const settled = await Promise.allSettled(
      entrants.map((entrant) =>
        decideAndStore(db, seasonId, input, entrant, bankrolls.get(entrant.modelId)?.available ?? STARTING_BANKROLL),
      ),
    );
    const sets = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
    const errors = settled.flatMap((s, i) =>
      s.status === 'rejected'
        ? [`${entrants[i].displayName}: ${s.reason instanceof Error ? s.reason.message : String(s.reason)}`]
        : [],
    );
    const costUsd = sets.reduce((sum, o) => sum + o.costUsd, 0);
    const valid = sets.filter((o) => o.valid).length;

    await completeJobRun(db, {
      runId: claim.runId!,
      modelCalls: entrants.length,
      costUsd,
      detail:
        `${valid}/${entrants.length} valid pick sets for ${input.fixtures.length} games, ` +
        `$${sets.reduce((sum, o) => sum + o.staked, 0)} staked; ${oddsNote}` +
        (done.size > 0 ? `; ${done.size} already stored` : '') +
        (errors.length > 0 ? `; errors: ${errors.join(' | ')}` : ''),
    });

    return {
      week,
      games: input.fixtures.length,
      gamesWithOdds: input.lines.size,
      oddsNote,
      contextHash: input.contextHash,
      alreadyStored: done.size,
      sets,
      errors,
      costUsd,
    };
  } catch (err) {
    await failJobRun(db, { runId: claim.runId!, detail: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}
