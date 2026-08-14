/**
 * The weekly DATA block, loaded once and shared by the two model-calling weekly jobs
 * (SPEC §14.3, §14.6).
 *
 * `lineups` and `waiver-bids` need almost the same picture of the league: who holds
 * what, who each team plays, where everybody stands, and what each model said last
 * time. Building that twice would guarantee the two drift, and a lineup job reasoning
 * from a different league state than the waiver job two days earlier is the kind of
 * bug that is invisible until somebody replays a week and the numbers do not match.
 *
 * Everything here reads from OUR OWN TABLES only (CLAUDE.md rule 6). No Sleeper fetch
 * happens at decision time, which is what lets any past decision be replayed exactly.
 *
 * The split into `base` and `overlay` is the §14.6 context claim in code. Opponent
 * awareness means the eight DATA blocks differ by construction, so "byte-identical for
 * all eight" is dead. What replaces it: the base half must be identical for everyone,
 * and each per-team overlay must replay from `(base, teamId)`. Both are asserted at
 * the call site with `assertSharedBase` and `assertOverlayReproducible`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { LEAGUE, RANKING_BASIS, type Position } from '@/lib/config/league';
import { round2 } from '@/lib/scoring/engine';
import { buildLabelMap } from '@/lib/engine/labels';
import { rankStandings, type StandingRow } from '@/lib/engine/allplay';
import {
  activeTeamsIn,
  bracketOpponent,
  isPlayoffWeek,
  LAST_LEAGUE_WEEK,
  type PlayoffRound,
} from '@/lib/engine/bracket';
import { loadBracket } from '@/lib/playoffs/state';
import {
  buildLookahead,
  buildOpponentView,
  buildStandingView,
  formatRecord,
  mean,
  type LookaheadOpponent,
  type OpponentView,
  type RosterEntry,
  type StandingView,
} from '@/lib/prompt/context';
import {
  buildMemoryBlock,
  seasonSummary,
  type GameplanSummary,
  type PriorDecision,
} from '@/lib/prompt/memory';
import type { DecisionType } from '@/lib/schemas/decisions';

/** How many recent weeks of real points a roster entry carries. */
export const FORM_WEEKS = 3;

export interface WeeklyTeam {
  teamId: string;
  modelId: string;
  openrouterId: string;
  displayName: string;
  draftSlot: number;
  label: string;
  faabRemaining: number;
  waiverPriority: number;
  /** A model its lab withdrew mid-season (SPEC §5.6). Still scored, no longer called. */
  frozen: boolean;
}

export interface Matchup {
  week: number;
  homeTeamId: string;
  awayTeamId: string;
}

export interface WeeklyContext {
  seasonId: string;
  season: number;
  /** The week being decided. */
  week: number;
  /** Last week with results in it. `week - 1` normally, 0 before the season starts. */
  throughWeek: number;
  teams: WeeklyTeam[];
  labels: Map<string, string>;
  /** Active roster per team, already carrying projection, form, injury and bye. */
  rosters: Map<string, RosterEntry[]>;
  standings: StandingRow[];
  /** Completed weekly totals per team, oldest first — the volatility input. */
  weeklyScores: Map<string, number[]>;
  schedule: Matchup[];
  /** This week's opponent. Null only if the schedule is missing a team's game. */
  opponentOf: Map<string, string | null>;
  /** NFL teams on bye this week. */
  byeTeams: string[];
  /** Per-team continuity block, already rendered (SPEC §4.1b). */
  memoryBlocks: Map<string, string>;
  /**
   * Which bracket game each team is playing, in a playoff week. Empty every other
   * week, and empty for the four eliminated teams — whose season is over (§14.5), and
   * whose absence from this map is what stops the lineup job asking them anything.
   */
  playoffRoundOf: Map<string, PlayoffRound>;
}

export interface BuildWeeklyContextInput {
  seasonId: string;
  season: number;
  week: number;
  /** Which decision type's history goes into the memory block. */
  memoryType: DecisionType;
}

// ---------------------------------------------------------------------------
// The loader
// ---------------------------------------------------------------------------

export async function buildWeeklyContext(
  db: SupabaseClient,
  input: BuildWeeklyContextInput,
): Promise<WeeklyContext> {
  const { seasonId, season, week, memoryType } = input;
  const throughWeek = week - 1;

  const teams = await loadTeams(db, seasonId);
  const labels = buildLabelMap(teams.map((t) => ({ teamId: t.teamId, draftSlot: t.draftSlot })));
  for (const team of teams) team.label = labels.get(team.teamId)!;

  const teamIds = teams.map((t) => t.teamId);
  const byeTeams = await loadByeTeams(db, season, week);
  const rosters = await loadRosters(db, teamIds, season, week, byeTeams);
  const schedule = await loadSchedule(db, seasonId);
  const weeklyScores = await loadWeeklyScores(db, teamIds, throughWeek);
  const standings = await loadStandings(db, teamIds, throughWeek);

  const opponentOf = new Map<string, string | null>(teamIds.map((id) => [id, null]));
  for (const match of schedule.filter((m) => m.week === week)) {
    opponentOf.set(match.homeTeamId, match.awayTeamId);
    opponentOf.set(match.awayTeamId, match.homeTeamId);
  }

  // In a playoff week the opponent above comes from the bracket fixtures the job
  // persisted into the same table; this only adds which ROUND it is. A model asked to
  // set a lineup for a final and one asked to set it for third place are being asked
  // different questions, and it should be able to tell which it is in.
  const playoffRoundOf = new Map<string, PlayoffRound>();
  if (isPlayoffWeek(week)) {
    const bracket = await loadBracket(db, seasonId);
    for (const teamId of bracket ? activeTeamsIn(bracket, week) : []) {
      const game = bracketOpponent(bracket!, week, teamId);
      if (game) playoffRoundOf.set(teamId, game.round);
    }
  }

  const gameplans = await loadGameplans(db, teamIds);
  const recent = await loadRecentDecisions(db, teamIds, memoryType);
  const standingOf = new Map(standings.map((row) => [row.teamId, row]));

  const memoryBlocks = new Map<string, string>();
  for (const team of teams) {
    const standing = standingOf.get(team.teamId)!;
    memoryBlocks.set(
      team.teamId,
      buildMemoryBlock({
        gameplan: gameplans.get(team.teamId) ?? null,
        roster: (rosters.get(team.teamId) ?? []).map((p) => ({ name: p.name, position: p.position })),
        faabRemaining: team.faabRemaining,
        record: {
          allplayW: standing.allplayW,
          allplayL: standing.allplayL,
          cumPts: standing.cumPts,
          rank: standing.rank,
        },
        recent: recent.get(team.teamId) ?? [],
        // A week-1 model has no season to summarise, and saying "0th of 8 at 0-0"
        // would read as a standing rather than as an absence of one.
        seasonSummary:
          throughWeek < 1
            ? null
            : seasonSummary(
                throughWeek,
                standing.rank,
                LEAGUE.teams,
                standing.allplayW,
                standing.allplayL,
                standing.cumPts,
              ),
      }),
    );
  }

  return {
    seasonId,
    season,
    week,
    throughWeek,
    teams,
    labels,
    rosters,
    standings,
    weeklyScores,
    schedule,
    opponentOf,
    byeTeams: [...byeTeams].sort(),
    memoryBlocks,
    playoffRoundOf,
  };
}

/**
 * The teams with a game this week — all eight in the regular season, the four
 * survivors in a playoff week.
 *
 * One function rather than a filter repeated at each call site, because the three
 * places that need it (the §14.6 assertion, the deterministic seeded lineups, and the
 * model calls themselves) must agree exactly. Two of them agreeing and one not is how
 * you get an eliminated team charged for a lineup, or a semifinalist left without one.
 */
export function teamsPlayingIn(context: WeeklyContext): WeeklyTeam[] {
  if (!isPlayoffWeek(context.week)) return context.teams;
  return context.teams.filter((team) => context.playoffRoundOf.has(team.teamId));
}

// ---------------------------------------------------------------------------
// The shared halves of every weekly DATA block
// ---------------------------------------------------------------------------

export interface WeeklyBase {
  week: number;
  ranking_basis: typeof RANKING_BASIS;
  regular_season_weeks: number;
  playoff_spots: number;
  /** Which half of the season this is. Identical for all eight, so it belongs here. */
  phase: 'regular_season' | 'playoffs';
  weeks_remaining: number;
  /** NFL teams with no game this week. A player on one of these cannot score. */
  nfl_teams_on_bye: string[];
  /** The league table as it stood after the last scored week. */
  standings: { label: string; record: string; points_for: number; rank: number }[];
  /** Every fixture this week, so a model can see the whole slate, not just its own. */
  matchups: { home: string; away: string }[];
}

/**
 * The half of the block every model must receive identically. Deliberately holds no
 * roster and no opponent detail — those are the overlay, and mixing them would make
 * the shared-base assertion vacuous.
 */
export function weeklyBase(context: WeeklyContext): WeeklyBase {
  const { labels } = context;
  return {
    week: context.week,
    ranking_basis: RANKING_BASIS,
    regular_season_weeks: LEAGUE.regularSeasonWeeks,
    playoff_spots: LEAGUE.playoffTeams,
    phase: isPlayoffWeek(context.week) ? 'playoffs' : 'regular_season',
    // Weeks left to play, counted within the phase you are in. Under the old
    // expression a playoff week read `0`, which says "the season is over" to a model
    // being asked to win a semifinal.
    weeks_remaining: isPlayoffWeek(context.week)
      ? Math.max(0, LAST_LEAGUE_WEEK - context.week + 1)
      : Math.max(0, LEAGUE.regularSeasonWeeks - context.week + 1),
    nfl_teams_on_bye: context.byeTeams,
    standings: [...context.standings]
      .sort((a, b) => a.rank - b.rank)
      .map((row) => ({
        label: labels.get(row.teamId) ?? 'Unknown',
        record: formatRecord(row),
        points_for: row.cumPts,
        rank: row.rank,
      })),
    matchups: context.schedule
      .filter((m) => m.week === context.week)
      .map((m) => ({
        home: labels.get(m.homeTeamId) ?? 'Unknown',
        away: labels.get(m.awayTeamId) ?? 'Unknown',
      }))
      // Sorted so the base block is byte-stable regardless of row order from Postgres.
      .sort((a, b) => (a.home < b.home ? -1 : a.home > b.home ? 1 : 0)),
  };
}

export interface WeeklyOverlay {
  your_label: string;
  your_record: string;
  faab_remaining: number;
  waiver_priority: number;
  your_roster: RosterEntry[];
  /** Null in a week this team has no fixture — the playoff weeks, mainly. */
  opponent: OpponentView | null;
  /**
   * Which bracket game this is, when it is one. Null all regular season.
   *
   * Per-team rather than shared, because in week 16 two models are playing for the
   * title and two for third, and telling all four the same thing would be false for
   * half of them.
   */
  playoff_round: PlayoffRound | null;
  standing: StandingView;
  lookahead: LookaheadOpponent[];
}

/**
 * One team's half. A pure function of `(context, teamId)` — that is not a stylistic
 * preference, it is the property `assertOverlayReproducible` checks, and the only
 * thing that keeps the weakened §14.6 claim honest.
 */
export function weeklyOverlay(context: WeeklyContext, teamId: string): WeeklyOverlay {
  const team = context.teams.find((t) => t.teamId === teamId);
  if (!team) throw new Error(`weeklyOverlay: team ${teamId} is not in this season`);

  const standing = context.standings.find((row) => row.teamId === teamId)!;
  const opponentId = context.opponentOf.get(teamId) ?? null;
  const opponentStanding = opponentId
    ? context.standings.find((row) => row.teamId === opponentId)
    : undefined;

  return {
    your_label: team.label,
    your_record: formatRecord(standing),
    faab_remaining: team.faabRemaining,
    waiver_priority: team.waiverPriority,
    your_roster: context.rosters.get(teamId) ?? [],
    opponent:
      opponentId && opponentStanding
        ? buildOpponentView({
            label: context.labels.get(opponentId)!,
            standing: opponentStanding,
            weeklyScores: context.weeklyScores.get(opponentId) ?? [],
            roster: context.rosters.get(opponentId) ?? [],
          })
        : null,
    playoff_round: context.playoffRoundOf.get(teamId) ?? null,
    standing: buildStandingView(context.standings, teamId, context.labels, context.throughWeek),
    lookahead: buildLookahead(
      context.schedule,
      teamId,
      context.week,
      context.labels,
      new Map(context.standings.map((row) => [row.teamId, row])),
      context.weeklyScores,
    ),
  };
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

interface TeamJoinRow {
  id: string;
  model_id: string;
  draft_slot: number | null;
  faab_remaining: number | null;
  waiver_priority: number | null;
  frozen: boolean | null;
  models: { openrouter_id: string; display_name: string };
}

async function loadTeams(db: SupabaseClient, seasonId: string): Promise<WeeklyTeam[]> {
  const { data, error } = await db
    .from('teams')
    .select('id, model_id, draft_slot, faab_remaining, waiver_priority, frozen, models!inner(openrouter_id, display_name)')
    .eq('season_id', seasonId);
  if (error) throw new Error(`teams: ${error.message}`);

  const rows = (data ?? []) as unknown as TeamJoinRow[];
  if (rows.length !== LEAGUE.teams) {
    throw new Error(`expected ${LEAGUE.teams} teams, found ${rows.length}`);
  }
  for (const row of rows) {
    // Labels come from draft slot. Without one there is no stable way to name a rival,
    // and inventing an order here would rename teams mid-season.
    if (row.draft_slot === null) {
      throw new Error(`team ${row.id} has no draft slot — the auction has not run`);
    }
  }

  return rows.map((row) => ({
    teamId: row.id,
    modelId: row.model_id,
    openrouterId: row.models.openrouter_id,
    displayName: row.models.display_name,
    draftSlot: row.draft_slot!,
    label: '',
    faabRemaining: Number(row.faab_remaining ?? 0),
    waiverPriority: Number(row.waiver_priority ?? 0),
    frozen: Boolean(row.frozen),
  }));
}

async function loadByeTeams(db: SupabaseClient, season: number, week: number): Promise<Set<string>> {
  const { data, error } = await db
    .from('team_byes')
    .select('nfl_team')
    .eq('season', season)
    .eq('week', week);
  if (error) throw new Error(`team_byes: ${error.message}`);
  return new Set((data ?? []).map((r) => r.nfl_team as string));
}

/**
 * Every active roster, with this week's projection and recent actual form attached.
 *
 * `projection` is null rather than 0 for a player Sleeper did not project — on bye,
 * inactive, or simply absent from the feed. The DATA RULE tells models to treat null
 * as unknown; a zero would read as a confident prediction of nothing.
 */
async function loadRosters(
  db: SupabaseClient,
  teamIds: string[],
  season: number,
  week: number,
  byeTeams: Set<string>,
): Promise<Map<string, RosterEntry[]>> {
  const { data, error } = await db
    .from('rosters')
    .select('team_id, player_id, players!inner(name, position, nfl_team, injury_status)')
    .in('team_id', teamIds)
    .eq('active', true);
  if (error) throw new Error(`rosters: ${error.message}`);

  const rows = data ?? [];
  const playerIds = [...new Set(rows.map((r) => r.player_id as string))];
  const projections = await loadWeekProjections(db, season, week, playerIds);
  const form = await loadPlayerForm(db, season, week, playerIds);

  const out = new Map<string, RosterEntry[]>(teamIds.map((id) => [id, []]));
  for (const row of rows) {
    const player = row.players as unknown as {
      name: string;
      position: Position;
      nfl_team: string | null;
      injury_status: string | null;
    };
    const playerId = row.player_id as string;
    const history = form.get(playerId) ?? [];

    out.get(row.team_id as string)!.push({
      player_id: playerId,
      name: player.name,
      position: player.position,
      nfl_team: player.nfl_team,
      projection: projections.get(playerId) ?? null,
      season_ppg: mean(history),
      last3_ppg: mean(history.slice(-FORM_WEEKS)),
      injury_status: player.injury_status,
      is_on_bye: player.nfl_team ? byeTeams.has(player.nfl_team) : false,
    });
  }

  // Deterministic order, or the overlay hash changes between two identical loads.
  for (const list of out.values()) {
    list.sort((a, b) => (a.player_id < b.player_id ? -1 : a.player_id > b.player_id ? 1 : 0));
  }
  return out;
}

async function loadWeekProjections(
  db: SupabaseClient,
  season: number,
  week: number,
  playerIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const chunk of chunked(playerIds, 200)) {
    const { data, error } = await db
      .from('player_projections')
      .select('player_id, proj_pts')
      .eq('season', season)
      .eq('week', week)
      .in('player_id', chunk);
    if (error) throw new Error(`player_projections: ${error.message}`);
    for (const row of data ?? []) {
      if (row.proj_pts === null) continue;
      out.set(row.player_id as string, round2(Number(row.proj_pts)));
    }
  }
  return out;
}

/**
 * Actual points per player for every week before this one, oldest first.
 *
 * Final beats provisional where both exist, for the same reason the scoring job
 * prefers it: Thursday's corrected number is the published one, and showing a model
 * the superseded value would have it reasoning from a score the site no longer shows.
 */
export async function loadPlayerForm(
  db: SupabaseClient,
  season: number,
  week: number,
  playerIds: string[],
): Promise<Map<string, number[]>> {
  if (week <= 1) return new Map();

  const best = new Map<string, Map<number, { pts: number; status: string }>>();
  for (const chunk of chunked(playerIds, 200)) {
    const { data, error } = await db
      .from('player_stats')
      .select('player_id, week, computed_pts, status')
      .eq('season', season)
      .lt('week', week)
      .in('player_id', chunk);
    if (error) throw new Error(`player_stats: ${error.message}`);

    for (const row of data ?? []) {
      const playerId = row.player_id as string;
      const byWeek = best.get(playerId) ?? new Map<number, { pts: number; status: string }>();
      const existing = byWeek.get(row.week as number);
      if (existing?.status === 'final' && row.status !== 'final') continue;
      byWeek.set(row.week as number, { pts: Number(row.computed_pts), status: row.status as string });
      best.set(playerId, byWeek);
    }
  }

  const out = new Map<string, number[]>();
  for (const [playerId, byWeek] of best) {
    out.set(
      playerId,
      [...byWeek.entries()].sort((a, b) => a[0] - b[0]).map(([, entry]) => round2(entry.pts)),
    );
  }
  return out;
}

async function loadSchedule(db: SupabaseClient, seasonId: string): Promise<Matchup[]> {
  const { data, error } = await db
    .from('h2h_schedule')
    .select('week, home_team_id, away_team_id')
    .eq('season_id', seasonId)
    .order('week', { ascending: true });
  if (error) throw new Error(`h2h_schedule: ${error.message}`);
  return (data ?? []).map((row) => ({
    week: row.week as number,
    homeTeamId: row.home_team_id as string,
    awayTeamId: row.away_team_id as string,
  }));
}

/** Completed weekly totals per team, oldest first. Final beats provisional. */
async function loadWeeklyScores(
  db: SupabaseClient,
  teamIds: string[],
  throughWeek: number,
): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>(teamIds.map((id) => [id, []]));
  if (throughWeek < 1) return out;

  const { data, error } = await db
    .from('lineup_scores')
    .select('week, status, total_pts, lineups!inner(team_id)')
    .lte('week', throughWeek)
    .in('lineups.team_id', teamIds);
  if (error) throw new Error(`lineup_scores: ${error.message}`);

  const best = new Map<string, Map<number, { pts: number; status: string }>>();
  for (const row of data ?? []) {
    const teamId = (row.lineups as unknown as { team_id: string }).team_id;
    const byWeek = best.get(teamId) ?? new Map<number, { pts: number; status: string }>();
    const existing = byWeek.get(row.week as number);
    if (existing?.status === 'final' && row.status !== 'final') continue;
    byWeek.set(row.week as number, { pts: Number(row.total_pts), status: row.status as string });
    best.set(teamId, byWeek);
  }

  for (const [teamId, byWeek] of best) {
    out.set(
      teamId,
      [...byWeek.entries()].sort((a, b) => a[0] - b[0]).map(([, entry]) => round2(entry.pts)),
    );
  }
  return out;
}

/**
 * The table as it stood after `throughWeek`, read rather than recomputed.
 *
 * The scoring jobs own the standings; a decision job that recomputed them could
 * publish one order on the site and reason from another in a prompt. Every team gets a
 * row even before a ball is thrown, because `buildStandingView` needs one — a missing
 * row in week 1 would throw rather than say "0-0".
 */
async function loadStandings(
  db: SupabaseClient,
  teamIds: string[],
  throughWeek: number,
): Promise<StandingRow[]> {
  const zero = new Map(
    teamIds.map((id) => [id, { teamId: id, h2hW: 0, h2hL: 0, h2hT: 0, allplayW: 0, allplayL: 0, cumPts: 0 }]),
  );

  if (throughWeek >= 1) {
    const { data, error } = await db
      .from('standings')
      .select('team_id, week, h2h_w, h2h_l, h2h_t, cum_allplay_w, cum_allplay_l, cum_pts')
      .in('team_id', teamIds)
      .lte('week', throughWeek)
      .order('week', { ascending: true });
    if (error) throw new Error(`standings: ${error.message}`);

    // Ascending order means the last row written per team is the latest week.
    for (const row of data ?? []) {
      zero.set(row.team_id as string, {
        teamId: row.team_id as string,
        h2hW: Number(row.h2h_w ?? 0),
        h2hL: Number(row.h2h_l ?? 0),
        h2hT: Number(row.h2h_t ?? 0),
        allplayW: Number(row.cum_allplay_w ?? 0),
        allplayL: Number(row.cum_allplay_l ?? 0),
        cumPts: Number(row.cum_pts ?? 0),
      });
    }
  }

  return rankStandings([...zero.values()]);
}

async function loadGameplans(
  db: SupabaseClient,
  teamIds: string[],
): Promise<Map<string, GameplanSummary | null>> {
  const { data, error } = await db
    .from('gameplans')
    .select('team_id, positional_strategy, auction_stance, scarcity_read, risk_posture, waiver_philosophy')
    .in('team_id', teamIds);
  if (error) throw new Error(`gameplans: ${error.message}`);

  const out = new Map<string, GameplanSummary | null>(teamIds.map((id) => [id, null]));
  for (const row of data ?? []) {
    out.set(row.team_id as string, {
      positional_strategy: row.positional_strategy as string,
      auction_stance: row.auction_stance as string,
      scarcity_read: row.scarcity_read as string,
      risk_posture: row.risk_posture as string,
      waiver_philosophy: row.waiver_philosophy as string,
    });
  }
  return out;
}

/** The last N decisions of ONE type per team — same structure, same cap, for everyone. */
async function loadRecentDecisions(
  db: SupabaseClient,
  teamIds: string[],
  type: DecisionType,
): Promise<Map<string, PriorDecision[]>> {
  const out = new Map<string, PriorDecision[]>(teamIds.map((id) => [id, []]));

  for (const teamId of teamIds) {
    const { data, error } = await db
      .from('decisions')
      .select('week, headline, closest_call')
      .eq('team_id', teamId)
      .eq('type', type)
      .eq('valid', true)
      .order('created_at', { ascending: false })
      .limit(LEAGUE.memoryRecentDecisions);
    if (error) throw new Error(`decisions: ${error.message}`);

    out.set(
      teamId,
      (data ?? []).map((row) => ({
        week: row.week as number | null,
        headline: row.headline as string | null,
        closest_call: row.closest_call as string | null,
      })),
    );
  }
  return out;
}

function chunked<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
