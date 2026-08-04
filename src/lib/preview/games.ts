/**
 * The Thursday weekend guide: pick the week's most interesting games, and build the
 * DATA block the models reason from.
 *
 * ---------------------------------------------------------------------------
 * What this can and cannot honestly claim
 * ---------------------------------------------------------------------------
 * Our ingest is fantasy-shaped. We hold per-player weekly projections, our own
 * computed weekly points, injury status, depth chart, the fixture list and byes.
 *
 * We hold NO team-level data at all: no scores, no records, no betting lines, no
 * weather. `nfl_games` stores a fixture and a kickoff time and nothing else.
 *
 * So the guide is grounded on "which players decide this game, and why" — a question
 * the data can actually answer — and never on "who wins and by how much", which it
 * cannot. A model asked the second question from this DATA block would be guessing,
 * and the prompt says so explicitly rather than letting it guess politely.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Position } from '@/lib/config/league';
import { labelForSlot } from '@/lib/engine/labels';

/** How many recent weeks of real points a player carries into the DATA block. */
export const FORM_WEEKS = 3;

/** Players shown per team. Enough to cover a lineup, short enough to stay readable. */
export const PLAYERS_PER_TEAM = 12;

export interface GameFixture {
  gameKey: string;
  home: string;
  away: string;
  kickoffAt: string | null;
}

export interface PreviewPlayer {
  playerId: string;
  name: string;
  position: Position;
  team: string;
  projPts: number;
  /** Most recent first. Shorter than FORM_WEEKS early in the season. */
  recentPts: number[];
  injuryStatus: string | null;
  depthChartOrder: number | null;
  /** Anonymous league label (SPEC §14.3), or null if nobody in our league holds him. */
  rosteredBy: string | null;
}

export interface GameContext {
  fixture: GameFixture;
  away: PreviewPlayer[];
  home: PreviewPlayer[];
  /** Sum of projected points across both shown squads. */
  projectedTotal: number;
  /** How many of the shown players are rostered in our own league. */
  leagueStake: number;
  /** The three highest projections in the game, summed — concentrated star power. */
  starPower: number;
  /** |away total − home total|. Small means the two sides project evenly. */
  imbalance: number;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

interface ProjectionRow {
  playerId: string;
  name: string;
  position: Position;
  team: string | null;
  opponent: string | null;
  projPts: number;
}

/**
 * This week's projections, joined to the player pool.
 *
 * `team` and `opponent` are read out of `raw_projection`, where the weekly ingest
 * stashed them — the season-long feed has neither, which is precisely why the weekly
 * ingest exists.
 */
async function loadWeekProjections(
  db: SupabaseClient,
  season: number,
  week: number,
): Promise<ProjectionRow[]> {
  const out: ProjectionRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('player_projections')
      .select('player_id, proj_pts, raw_projection, players!inner(name, position, nfl_team)')
      .eq('season', season)
      .eq('week', week)
      .order('proj_pts', { ascending: false })
      .range(from, from + 999);
    if (error) throw new Error(`week projections: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const row of data) {
      const player = row.players as unknown as { name: string; position: Position; nfl_team: string | null };
      const raw = (row.raw_projection ?? {}) as Record<string, unknown>;
      out.push({
        playerId: row.player_id as string,
        name: player.name,
        position: player.position,
        team: (raw._team as string | null) ?? player.nfl_team,
        opponent: (raw._opponent as string | null) ?? null,
        projPts: Number(row.proj_pts ?? 0),
      });
    }
    if (data.length < 1000) break;
  }
  return out;
}

/** Our own computed points for the last few weeks, per player. */
async function loadRecentForm(
  db: SupabaseClient,
  season: number,
  week: number,
): Promise<Map<string, Map<number, number>>> {
  const firstWeek = Math.max(1, week - FORM_WEEKS);
  const out = new Map<string, Map<number, number>>();

  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('player_stats')
      .select('player_id, week, computed_pts, status')
      .eq('season', season)
      .gte('week', firstWeek)
      .lt('week', week)
      .range(from, from + 999);
    if (error) throw new Error(`recent form: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const row of data) {
      const playerId = row.player_id as string;
      const w = row.week as number;
      const byWeek = out.get(playerId) ?? new Map<number, number>();
      // Final supersedes provisional for the same week.
      if (row.status === 'final' || !byWeek.has(w)) byWeek.set(w, Number(row.computed_pts));
      out.set(playerId, byWeek);
    }
    if (data.length < 1000) break;
  }
  return out;
}

/** playerId → anonymous league label, for players our eight teams hold. */
async function loadLeagueOwnership(
  db: SupabaseClient,
  seasonId: string,
): Promise<Map<string, string>> {
  const { data, error } = await db
    .from('rosters')
    .select('player_id, teams!inner(draft_slot, season_id)')
    .eq('active', true)
    .eq('teams.season_id', seasonId);
  if (error) throw new Error(`ownership: ${error.message}`);

  const out = new Map<string, string>();
  for (const row of data ?? []) {
    const team = row.teams as unknown as { draft_slot: number | null };
    if (team.draft_slot === null) continue;
    out.set(row.player_id as string, labelForSlot(team.draft_slot));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/**
 * Build every fixture for the week with its context, ranked by interest.
 *
 * Interest = projected points on the field, plus a weight for how much of our own
 * league is invested in it. The second term is what stops the guide from being a
 * generic fantasy column: a game four of our eight AI managers have players in is a
 * game this site has a specific reason to care about.
 */
export async function buildWeekContexts(
  db: SupabaseClient,
  season: number,
  week: number,
  seasonId: string | null,
): Promise<GameContext[]> {
  const { data: games, error } = await db
    .from('nfl_games')
    .select('home, away, kickoff_at')
    .eq('season', season)
    .eq('week', week)
    .eq('season_type', 'regular');
  if (error) throw new Error(`nfl_games: ${error.message}`);
  if (!games || games.length === 0) return [];

  const projections = await loadWeekProjections(db, season, week);
  const form = await loadRecentForm(db, season, week);
  const ownership = seasonId ? await loadLeagueOwnership(db, seasonId) : new Map<string, string>();

  const byTeam = new Map<string, ProjectionRow[]>();
  for (const row of projections) {
    if (!row.team) continue;
    const list = byTeam.get(row.team) ?? [];
    list.push(row);
    byTeam.set(row.team, list);
  }

  const toPreviewPlayer = (row: ProjectionRow, injury: InjuryRow | undefined): PreviewPlayer => {
    const weeks = form.get(row.playerId);
    const recentPts: number[] = [];
    for (let w = week - 1; w >= Math.max(1, week - FORM_WEEKS); w--) {
      const pts = weeks?.get(w);
      if (pts !== undefined) recentPts.push(Number(pts.toFixed(2)));
    }
    return {
      playerId: row.playerId,
      name: row.name,
      position: row.position,
      team: row.team!,
      projPts: Number(row.projPts.toFixed(2)),
      recentPts,
      injuryStatus: injury?.injury_status ?? null,
      depthChartOrder: injury?.depth_chart_order ?? null,
      rosteredBy: ownership.get(row.playerId) ?? null,
    };
  };

  const injuries = await loadInjuries(
    db,
    projections.map((p) => p.playerId),
  );

  const contexts: GameContext[] = [];
  for (const game of games) {
    const home = (byTeam.get(game.home as string) ?? [])
      .slice(0, PLAYERS_PER_TEAM)
      .map((r) => toPreviewPlayer(r, injuries.get(r.playerId)));
    const away = (byTeam.get(game.away as string) ?? [])
      .slice(0, PLAYERS_PER_TEAM)
      .map((r) => toPreviewPlayer(r, injuries.get(r.playerId)));

    // A fixture with no projections on either side is a data gap, not a game worth
    // previewing. Publishing a preview built on nothing would be worse than skipping.
    if (home.length === 0 && away.length === 0) continue;

    const all = [...home, ...away];
    const sumOf = (list: PreviewPlayer[]) => list.reduce((sum, p) => sum + p.projPts, 0);
    const top3 = [...all].sort((a, b) => b.projPts - a.projPts).slice(0, 3);

    contexts.push({
      fixture: {
        gameKey: `${game.away}@${game.home}`,
        home: game.home as string,
        away: game.away as string,
        kickoffAt: (game.kickoff_at as string | null) ?? null,
      },
      home,
      away,
      projectedTotal: Number(sumOf(all).toFixed(2)),
      leagueStake: all.filter((p) => p.rosteredBy).length,
      starPower: Number(sumOf(top3).toFixed(2)),
      imbalance: Number(Math.abs(sumOf(away) - sumOf(home)).toFixed(2)),
    });
  }

  return contexts.sort((a, b) => interestScore(b) - interestScore(a));
}

/**
 * Ranking score.
 *
 * `projectedTotal` is deliberately NOT in here. Every team contributes its best
 * PLAYERS_PER_TEAM players, so the total lands within a couple of points of the same
 * number for every fixture — measured on 2026 week 1, the top six games spanned 196.3
 * to 198.8. Ranking on it is ranking on noise, and it would have quietly made the
 * "four most interesting games" an arbitrary pick.
 *
 * What does discriminate:
 *   - `leagueStake`, weighted highest. A game four of our eight AI managers hold
 *     players in is one this site has a specific reason to cover, and it is the thing
 *     that stops the guide being a generic fantasy column. It is 0 until the draft.
 *   - `starPower`, the three biggest projections in the game — concentration, not
 *     depth, is what gives a game a story.
 *   - `imbalance`, subtracted. Two evenly projected sides make a better argument than
 *     a mismatch.
 */
export function interestScore(context: GameContext): number {
  return context.leagueStake * 15 + context.starPower * 2 - context.imbalance;
}

/**
 * Does the ranking actually separate the field?
 *
 * Same idea as the auction's dispersion gate: if the top games are within noise of
 * each other, the selection is arbitrary and should be reported as such rather than
 * presented as "the week's four most interesting games".
 */
export function selectionDiscriminates(
  contexts: GameContext[],
  count: number,
): { ok: boolean; reason: string } {
  if (contexts.length <= count) {
    return { ok: true, reason: `only ${contexts.length} fixtures — no selection to make` };
  }
  const scores = contexts.map(interestScore);
  const chosenFloor = scores[count - 1];
  const nextBest = scores[count];
  const spread = scores[0] - chosenFloor;

  if (spread < 1) {
    return { ok: false, reason: `top ${count} span only ${spread.toFixed(2)} points — effectively tied` };
  }
  if (chosenFloor - nextBest < 0.5) {
    return {
      ok: false,
      reason: `#${count} and #${count + 1} differ by ${(chosenFloor - nextBest).toFixed(2)} — the cut is arbitrary`,
    };
  }
  return {
    ok: true,
    reason: `top ${count} span ${spread.toFixed(1)}, cut margin ${(chosenFloor - nextBest).toFixed(1)}`,
  };
}

interface InjuryRow {
  injury_status: string | null;
  depth_chart_order: number | null;
}

async function loadInjuries(
  db: SupabaseClient,
  playerIds: string[],
): Promise<Map<string, InjuryRow>> {
  const out = new Map<string, InjuryRow>();
  const unique = [...new Set(playerIds)];
  for (let i = 0; i < unique.length; i += 500) {
    const { data, error } = await db
      .from('players')
      .select('sleeper_id, injury_status, depth_chart_order')
      .in('sleeper_id', unique.slice(i, i + 500));
    if (error) throw new Error(`injuries: ${error.message}`);
    for (const row of data ?? []) {
      out.set(row.sleeper_id as string, {
        injury_status: row.injury_status as string | null,
        depth_chart_order: row.depth_chart_order as number | null,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The DATA block
// ---------------------------------------------------------------------------

/**
 * What one model sees for one game. Identical for all eight, so the published
 * context hash proves they reasoned from the same facts (SPEC §7.2).
 */
export function gameDataBlock(context: GameContext, week: number) {
  const strip = (p: PreviewPlayer) => ({
    player_id: p.playerId,
    name: p.name,
    position: p.position,
    proj_pts_this_week: p.projPts,
    last_weeks_actual: p.recentPts,
    injury_status: p.injuryStatus,
    depth_chart_order: p.depthChartOrder,
    rostered_in_this_league_by: p.rosteredBy,
  });

  return {
    week,
    kickoff_at: context.fixture.kickoffAt,
    away_team: context.fixture.away,
    home_team: context.fixture.home,
    away_players: context.away.map(strip),
    home_players: context.home.map(strip),
    league_stake: context.leagueStake,
    data_notes: [
      'proj_pts_this_week is OUR scoring applied to Sleeper projections, not Sleeper\'s own points.',
      'last_weeks_actual is most recent first, and is shorter than 3 entries early in the season.',
      'No team records, scores, betting lines or weather exist in this data set. Do not assert any.',
      'rostered_in_this_league_by names an anonymous team in the AI league, not an NFL team.',
    ],
  };
}
