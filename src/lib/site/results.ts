/**
 * What the site shows about a completed week, and about the season so far.
 *
 * Reads through `buildWrapFacts` rather than defining "what happened in week N" a
 * second time. That function is already the deterministic answer — it is what the beat
 * writer is given, and the number check grades the article against it. If the results
 * page computed its own totals, the page and the column could disagree about the same
 * week and there would be no way to say which was right.
 *
 * Everything here runs against the ANON client. RLS is on with a select-only policy, so
 * these pages cannot write even if the key leaks.
 */

import { LEAGUE, RANKING_BASIS } from '@/lib/config/league';
import { supabase, SUPABASE_CONFIGURED } from '@/lib/supabase';
import { buildWrapFacts, type WrapFacts, type WrapTeamFacts } from '@/lib/weekly/wrap';
import { FINAL_WEEK, isPlayoffWeek, SEMIFINAL_WEEK } from '@/lib/engine/bracket';
import { loadBracket } from '@/lib/playoffs/state';
import { completedWeek } from '@/lib/scoring/week';
import { projectTable, type ProjectionTeam } from '@/lib/scoring/live';

/**
 * Which season the site shows.
 *
 * Reads `SEASON_YEAR` like every cron route does, rather than hardcoding
 * `LEAGUE.season`. Two reasons, and the second is the real one: it keeps the site and
 * the jobs writing/reading the same season by construction, and it makes these pages
 * renderable against the 2025 rehearsal locally — which is the only way to see a
 * populated standings table before the 2026 draft has been run.
 */
export const SEASON = Number(process.env.SEASON_YEAR ?? LEAGUE.season);

export interface WeekMatchup {
  winner: WrapTeamFacts;
  loser: WrapTeamFacts;
  margin: number;
  tied: boolean;
}

export interface WeekResults {
  week: number;
  facts: WrapFacts;
  matchups: WeekMatchup[];
  recap: WeekRecap | null;
  /** Present only in weeks 15 and 16. */
  playoff: PlayoffView | null;
}

export interface PlayoffView {
  /** What the whole week is: two semifinals, or the final and the third-place game. */
  weekLabel: string;
  /** Round per matchup, keyed by the two model display names sorted and joined. */
  roundOf: Map<string, 'semifinal' | 'final' | 'third_place'>;
  /** Named once week 16's final has been scored, and null every moment before that. */
  champion: string | null;
  runnerUp: string | null;
  third: string | null;
  /** Seed number per model display name, for "(3) beat (2)". */
  seedOf: Map<string, number>;
}

const ROUND_LABEL: Record<'semifinal' | 'final' | 'third_place', string> = {
  semifinal: 'Semifinal',
  final: 'Final',
  third_place: 'Third place',
};

export function roundLabel(round: 'semifinal' | 'final' | 'third_place'): string {
  return ROUND_LABEL[round];
}

export interface WeekRecap {
  headline: string;
  shortPost: string;
  columnMd: string;
  numberCheckPassed: boolean;
  numberCheckNotes: string[];
  published: boolean;
}

/** Season row id, or null when there is no database or no such season. */
async function seasonId(season: number): Promise<string | null> {
  if (!SUPABASE_CONFIGURED) return null;
  const { data } = await supabase.from('seasons').select('id').eq('year', season).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/**
 * Every week that has been scored, newest first.
 *
 * Derived from what has been scored rather than from the schedule: a week exists on
 * this site once it has been scored, not once it has been played. The gap between
 * those two is real — Tuesday morning — and showing an empty week during it would
 * look like the league had a bad week rather than like the job had not run yet.
 *
 * Two sources, not one. `standings` covers the regular season; the playoff weeks
 * never write a standings row, by design, because they must not move the ranking the
 * bracket was seeded from. Reading `standings` alone — which is what this did — meant
 * `/results/15` and `/results/16` would have 404ed through the entire postseason,
 * including on the week the champion was decided.
 */
export async function scoredWeeks(season = SEASON): Promise<number[]> {
  const id = await seasonId(season);
  if (!id) return [];

  const { data: teams } = await supabase.from('teams').select('id').eq('season_id', id);
  const ids = (teams ?? []).map((t) => t.id as string);
  if (ids.length === 0) return [];

  const { data } = await supabase.from('standings').select('week').in('team_id', ids);
  const weeks = new Set((data ?? []).map((r) => r.week as number));

  const { data: playoffScores } = await supabase
    .from('lineup_scores')
    .select('week, lineups!inner(team_id)')
    .gt('week', LEAGUE.regularSeasonWeeks)
    .in('lineups.team_id', ids);
  for (const row of playoffScores ?? []) weeks.add(row.week as number);

  return [...weeks].sort((a, b) => b - a);
}

export async function loadWeekResults(
  week: number,
  season = SEASON,
): Promise<WeekResults | null> {
  const id = await seasonId(season);
  if (!id) return null;

  // Asked first, and not as an optimisation. `buildWrapFacts` builds anonymous labels
  // from draft slots, and before the draft every slot is null — so it THROWS rather
  // than returning nothing, and every `/results/[week]` URL served a 500 instead of a
  // 404 for the whole preseason. Found by curling the OG image on a season with no
  // draft in it; invisible against the rehearsal, which has one.
  if (!(await scoredWeeks(season)).includes(week)) return null;

  const facts = await buildWrapFacts(supabase, { seasonId: id, season, week });
  if (facts.teams.length === 0) return null;

  return {
    week,
    facts,
    matchups: pairUp(facts),
    recap: await loadRecap(id, week),
    playoff: isPlayoffWeek(week) ? await loadPlayoffView(id, week) : null,
  };
}

/**
 * The bracket, translated from team ids into the model names the site shows.
 *
 * Derived rather than stored, like everything else about the bracket: the seeds come
 * from the frozen field and the winners from the same `lineup_scores` the scoreline
 * above is built from, so a page cannot show a champion the scores disagree with.
 */
export async function loadPlayoffView(
  seasonRowId: string,
  week: number,
): Promise<PlayoffView | null> {
  const bracket = await loadBracket(supabase, seasonRowId);
  if (!bracket) return null;

  const { data: teams } = await supabase
    .from('teams')
    .select('id, models!inner(display_name)')
    .eq('season_id', seasonRowId);
  const nameOf = new Map(
    ((teams ?? []) as unknown as { id: string; models: { display_name: string } }[]).map((t) => [
      t.id,
      t.models.display_name,
    ]),
  );

  const games = week === SEMIFINAL_WEEK ? bracket.semifinals : bracket.championship;
  const roundOf = new Map<string, 'semifinal' | 'final' | 'third_place'>();
  for (const game of games) {
    const pair = [nameOf.get(game.homeTeamId), nameOf.get(game.awayTeamId)];
    if (pair.some((n) => !n)) continue;
    roundOf.set(pair.sort().join('|'), game.round);
  }

  // The title belongs to the week it was won in. Carried on every playoff page, the
  // semifinal page announced a champion decided a week after the games it was showing —
  // a spoiler on its own scoreline, and a page reporting something that had not happened
  // when those games were played.
  const decided = week === FINAL_WEEK;

  return {
    weekLabel: week === SEMIFINAL_WEEK ? 'Semifinals' : 'Final and third place',
    roundOf,
    champion: decided && bracket.championTeamId ? (nameOf.get(bracket.championTeamId) ?? null) : null,
    runnerUp: decided && bracket.runnerUpTeamId ? (nameOf.get(bracket.runnerUpTeamId) ?? null) : null,
    third: decided && bracket.thirdTeamId ? (nameOf.get(bracket.thirdTeamId) ?? null) : null,
    seedOf: new Map(
      bracket.seeds
        .map((teamId, i) => [nameOf.get(teamId), i + 1] as const)
        .filter((entry): entry is readonly [string, number] => Boolean(entry[0])),
    ),
  };
}

/**
 * Turn the per-team rows back into fixtures.
 *
 * Each team carries its own opponent and both scores, so a matchup appears twice — once
 * from each side. Deduplicated on the pair, keeping whichever side scored more, which
 * makes "winner" a property of the data rather than of the row order.
 */
export function pairUp(facts: WrapFacts): WeekMatchup[] {
  const byModel = new Map(facts.teams.map((t) => [t.model, t]));
  const seen = new Set<string>();
  const out: WeekMatchup[] = [];

  for (const team of facts.teams) {
    if (!team.opponent) continue;
    const opponent = byModel.get(team.opponent);
    if (!opponent) continue;

    const key = [team.model, opponent.model].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);

    const [winner, loser] = team.points >= opponent.points ? [team, opponent] : [opponent, team];
    out.push({
      winner,
      loser,
      margin: Number((winner.points - loser.points).toFixed(2)),
      tied: winner.points === loser.points,
    });
  }

  // Closest game first — it is the one worth reading about.
  return out.sort((a, b) => a.margin - b.margin);
}

async function loadRecap(seasonRowId: string, week: number): Promise<WeekRecap | null> {
  const { data } = await supabase
    .from('recaps')
    .select('headline, short_post, column_md, number_check_passed, number_check_notes, published')
    .eq('season_id', seasonRowId)
    .eq('week', week)
    .maybeSingle();
  if (!data) return null;

  return {
    headline: data.headline as string,
    shortPost: data.short_post as string,
    columnMd: data.column_md as string,
    numberCheckPassed: Boolean(data.number_check_passed),
    numberCheckNotes: (data.number_check_notes ?? []) as string[],
    published: Boolean(data.published),
  };
}

// ---------------------------------------------------------------------------
// The season table
// ---------------------------------------------------------------------------

export interface StandingsRow {
  model: string;
  modelKey: string;
  record: string;
  allPlay: string;
  pointsFor: number;
  rank: number;
  /** True when this team shares its rank — no coin flip is used (SPEC §14.2). */
  coRanked: boolean;
}

export interface SeasonSnapshot {
  season: number;
  /** Latest scored week, or null before the season starts. */
  throughWeek: number | null;
  rankingBasis: typeof RANKING_BASIS;
  playoffSpots: number;
  table: StandingsRow[];
  /** The model that won the final, once week 16 has been scored. Null before that. */
  champion: string | null;
}

/**
 * The league table as of the latest scored week.
 *
 * Ranked on head-to-head, per the §14.2 amendment. All-play is shown beside it and does
 * NOT rank — where the two disagree is the most interesting column on the page, and
 * burying it would hide the thing the format exists to expose.
 */
export async function loadSeasonSnapshot(season = SEASON): Promise<SeasonSnapshot> {
  const empty: SeasonSnapshot = {
    season,
    throughWeek: null,
    rankingBasis: RANKING_BASIS,
    playoffSpots: LEAGUE.playoffTeams,
    table: [],
    champion: null,
  };

  const id = await seasonId(season);
  if (!id) return empty;

  const { data: teamRows } = await supabase
    .from('teams')
    .select('id, models!inner(key, display_name)')
    .eq('season_id', id);
  const teams = (teamRows ?? []) as unknown as {
    id: string;
    models: { key: string; display_name: string };
  }[];
  if (teams.length === 0) return empty;

  const { data: rows } = await supabase
    .from('standings')
    .select('team_id, week, h2h_w, h2h_l, h2h_t, cum_allplay_w, cum_allplay_l, cum_pts, rank')
    .in('team_id', teams.map((t) => t.id))
    .order('week', { ascending: true });
  if (!rows || rows.length === 0) return empty;

  const throughWeek = Math.max(...rows.map((r) => r.week as number));
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if ((row.week as number) === throughWeek) latest.set(row.team_id as string, row);
  }

  const ranked = teams
    .map((team) => {
      const row = latest.get(team.id);
      const h2hW = Number(row?.h2h_w ?? 0);
      const h2hT = Number(row?.h2h_t ?? 0);
      return {
        model: team.models.display_name,
        modelKey: team.models.key,
        record: h2hT > 0 ? `${h2hW}-${row?.h2h_l ?? 0}-${h2hT}` : `${h2hW}-${row?.h2h_l ?? 0}`,
        allPlay: `${Number(row?.cum_allplay_w ?? 0)}-${Number(row?.cum_allplay_l ?? 0)}`,
        pointsFor: Number(row?.cum_pts ?? 0),
        rank: Number(row?.rank ?? 0),
        // Recomputed below, once the whole table is assembled.
        coRanked: false,
        // A tie is half a win, matching `h2hScore` — the site must order the table the
        // same way the engine ranks it, or the front page and the standings disagree.
        sortKey: h2hW + h2hT * 0.5,
      };
    })
    .sort((a, b) => b.sortKey - a.sortKey || b.pointsFor - a.pointsFor);

  const table: StandingsRow[] = ranked.map((row, i) => ({
    model: row.model,
    modelKey: row.modelKey,
    record: row.record,
    allPlay: row.allPlay,
    pointsFor: row.pointsFor,
    rank: row.rank || i + 1,
    coRanked: false,
  }));

  for (const row of table) {
    row.coRanked = table.some(
      (other) => other !== row && other.rank === row.rank,
    );
  }

  return {
    season,
    throughWeek,
    rankingBasis: RANKING_BASIS,
    playoffSpots: LEAGUE.playoffTeams,
    table,
    // Null until the final has been scored, which is the only moment it becomes true.
    champion: (await loadPlayoffView(id, FINAL_WEEK))?.champion ?? null,
  };
}

// ---------------------------------------------------------------------------
// The week in progress
// ---------------------------------------------------------------------------

export interface CurrentWeekTeam {
  model: string;
  modelKey: string;
  /**
   * Live points, while a slate is being played and before it has been scored.
   *
   * Null means no live row — before kickoff, or once Tuesday has made the week a
   * result and `/results/{week}` is the place to read it. Never authoritative: see the
   * header of `supabase/migrations/0011_live_scores.sql`.
   */
  livePoints: number | null;
  /** Starters with a Sleeper line yet, of the nine slots. */
  startersPlayed: number;
}

export interface CurrentWeekFixture {
  home: CurrentWeekTeam;
  away: CurrentWeekTeam;
}

/** What a live week would do to the table, if it ended right now. */
export interface ProjectedRank {
  rank: number;
  /** Positive is a climb. Zero means the live week does not move this team. */
  delta: number;
}

export interface LiveWeekState {
  /** When the numbers were last refreshed, ISO. */
  computedAt: string;
  /**
   * True when every game of the week is over — the overnight state, where the totals
   * have stopped moving and Tuesday has not yet made them official. Worth separating
   * from "under way", because "live" beside a number that cannot change is a lie.
   */
  complete: boolean;
  /** Of the eight teams × nine slots. */
  startersPlayed: number;
  startersTotal: number;
  /**
   * Where each team would sit if the week ended now, keyed by model key. Null before
   * any week has been scored, because there is no prior table to move within — in week
   * one the live points ARE the whole story and the fixtures carry it.
   */
  projected: Record<string, ProjectedRank> | null;
}

export interface CurrentWeekView {
  week: number;
  /** First kickoff of the week, ISO. */
  firstKickoff: string;
  /** Whether that kickoff is behind us, as of render time. */
  kickedOff: boolean;
  /** Of eight. Below eight means the lineup job has not finished, or a team is out. */
  lineupsSet: number;
  /**
   * How many of those the CODE decided rather than the model.
   *
   * Tracked separately and stated publicly because the deterministic fallback is a real
   * outcome, not a hidden one: a model that fails gets the projection-optimal lineup and
   * the site says so. Summing it into `lineupsSet` would publish our own failure mode as
   * eight models making eight decisions.
   */
  carriedForward: number;
  fixtures: CurrentWeekFixture[];
  /** The released weekend guide for this week, if a human has released one. */
  guide: { week: number; headline: string } | null;
  /** True once this week has been scored, i.e. it is history rather than in progress. */
  scored: boolean;
  /** Present only while the week is being played and has not been scored. */
  live: LiveWeekState | null;
}

/**
 * The week being played right now, or null before the season starts.
 *
 * This exists because `loadSeasonSnapshot().throughWeek === null` was doing two jobs
 * and could only answer one of them. It means "no week has been SCORED", which is true
 * before the season starts and equally true from Wednesday of week 1 until the
 * following Tuesday — so the front page announced "the season has not started" for six
 * days after it had, with eight locked lineups and a published weekend guide sitting
 * behind links nobody had a reason to click.
 *
 * "Current" is derived from kickoffs rather than from scores for exactly that reason:
 * the season starts when a ball is kicked, not when our Tuesday job gets round to it.
 */
export async function loadCurrentWeek(season = SEASON): Promise<CurrentWeekView | null> {
  const id = await seasonId(season);
  if (!id) return null;

  const now = new Date();

  const { data: teamRowsForWeek } = await supabase.from('teams').select('id').eq('season_id', id);
  const teamIds = (teamRowsForWeek ?? []).map((t) => t.id as string);
  if (teamIds.length === 0) return null;

  // The latest week this LEAGUE has acted on, which is the latest week holding lineups.
  //
  // Not "the latest week that has kicked off", which was the first thing tried and is
  // wrong by about seven hours: lineups lock at noon ET and the ball is kicked in the
  // evening, so on the afternoon of the opener — the exact moment the front page most
  // needs to say something — the NFL reading still answers "no week yet". The lineup
  // lock is also the more honest claim. It is the moment this league committed and
  // nothing can change, whatever the schedule does afterwards.
  const { data: acted } = await supabase
    .from('lineups')
    .select('week')
    .in('team_id', teamIds)
    .lte('week', LEAGUE.regularSeasonWeeks)
    .order('week', { ascending: false })
    .limit(1);

  const week = acted?.[0]?.week as number | undefined;
  if (!week) return null;

  const { data: firstGame } = await supabase
    .from('nfl_games')
    .select('kickoff_at')
    .eq('season', season)
    .eq('week', week)
    .not('kickoff_at', 'is', null)
    .order('kickoff_at', { ascending: true })
    .limit(1);
  const firstKickoff = (firstGame?.[0]?.kickoff_at as string | undefined) ?? now.toISOString();

  const { data: teamRows } = await supabase
    .from('teams')
    .select('id, models!inner(key, display_name)')
    .eq('season_id', id);
  const teams = (teamRows ?? []) as unknown as {
    id: string;
    models: { key: string; display_name: string };
  }[];
  const byId = new Map(teams.map((t) => [t.id, t]));

  // Live scores, if a refresh has written any for this week. Absent is the normal
  // state for most of the week and is not an error — before the first kickoff there is
  // nothing to show, and after Tuesday `/results/{week}` is the place to read it.
  const { data: liveRows } = await supabase
    .from('live_scores')
    .select('team_id, total_pts, starters_played, starters_total, computed_at')
    .eq('week', week)
    .in('team_id', teamIds);
  const live = new Map(
    (liveRows ?? []).map((r) => [
      r.team_id as string,
      {
        total: Number(r.total_pts),
        played: Number(r.starters_played ?? 0),
        total_slots: Number(r.starters_total ?? 0),
        computedAt: r.computed_at as string,
      },
    ]),
  );

  const named = (teamId: string): CurrentWeekTeam => {
    const team = byId.get(teamId);
    const score = live.get(teamId);
    return {
      model: team?.models.display_name ?? 'Unknown',
      modelKey: team?.models.key ?? '',
      livePoints: score ? score.total : null,
      startersPlayed: score ? score.played : 0,
    };
  };

  const { data: schedule } = await supabase
    .from('h2h_schedule')
    .select('home_team_id, away_team_id')
    .eq('season_id', id)
    .eq('week', week);

  const fixtures: CurrentWeekFixture[] = (schedule ?? []).map((row) => ({
    home: named(row.home_team_id as string),
    away: named(row.away_team_id as string),
  }));

  const { data: lineupRows } = await supabase
    .from('lineups')
    .select('carried_forward')
    .eq('week', week)
    .in('team_id', teamIds);
  const lineupCount = (lineupRows ?? []).length;
  const carriedForward = (lineupRows ?? []).filter((r) => r.carried_forward).length;

  // Only a RELEASED guide is linkable — an unreleased one renders nothing at /weekend.
  const { data: guideRow } = await supabase
    .from('weekend_guides')
    .select('week, headline')
    .eq('season_id', id)
    .eq('week', week)
    .eq('published', true)
    .maybeSingle();

  const { data: scoredRow } = await supabase
    .from('standings')
    .select('week')
    .eq('week', week)
    .in('team_id', teamIds)
    .limit(1);
  const scored = (scoredRow ?? []).length > 0;

  return {
    week,
    firstKickoff,
    kickedOff: new Date(firstKickoff) <= now,
    lineupsSet: lineupCount,
    carriedForward,
    fixtures,
    guide: guideRow
      ? { week: guideRow.week as number, headline: guideRow.headline as string }
      : null,
    scored,
    // Once a week is scored it is a result, and a stale live row beside the official
    // number would be the site disagreeing with itself in public.
    live:
      scored || live.size === 0
        ? null
        : {
            computedAt: [...live.values()]
              .map((v) => v.computedAt)
              .sort()
              .at(-1)!,
            complete: await weekIsComplete(season, week, now),
            startersPlayed: [...live.values()].reduce((sum, v) => sum + v.played, 0),
            startersTotal: [...live.values()].reduce((sum, v) => sum + v.total_slots, 0),
            projected: await projectRanks(teamIds, byId, fixtures, live, week),
          },
  };
}

/**
 * Whether every game of the week has been played, for labelling only.
 *
 * The site says "under way" or "all games in" on the strength of this, and the two
 * read very differently beside a total. Uses the same four-hour game length the
 * scoring resolver does, via the same function, so the page and the job cannot
 * disagree about when a week ended.
 */
async function weekIsComplete(season: number, week: number, now: Date): Promise<boolean> {
  const { data } = await supabase
    .from('nfl_games')
    .select('week, kickoff_at')
    .eq('season', season)
    .eq('season_type', 'regular')
    .eq('week', week)
    .not('kickoff_at', 'is', null);

  const kickoffs = (data ?? []).map((row) => ({
    week: row.week as number,
    kickoffAt: new Date(row.kickoff_at as string),
  }));
  if (kickoffs.length === 0) return false;
  return completedWeek(kickoffs, now) === week;
}

/**
 * Where the table would stand if the live week ended right now.
 *
 * Ranked the way the engine ranks — head-to-head, a tie worth half a win, points-for
 * as the tiebreak — because a projection ordered on a different basis from the real
 * table would move teams for reasons the real table would not.
 *
 * Returns null before any week has been scored. That is not a failure case: in week
 * one there is no prior table for a team to move within, so a "projected rank" would
 * just be this week's points wearing a rank's clothes, and the fixtures already say
 * that honestly.
 */
async function projectRanks(
  teamIds: string[],
  byId: Map<string, { id: string; models: { key: string; display_name: string } }>,
  fixtures: CurrentWeekFixture[],
  live: Map<string, { total: number }>,
  week: number,
): Promise<Record<string, ProjectedRank> | null> {
  const { data: rows } = await supabase
    .from('standings')
    .select('team_id, week, h2h_w, h2h_t, cum_pts, rank')
    .in('team_id', teamIds)
    .lt('week', week)
    .order('week', { ascending: true });
  if (!rows || rows.length === 0) return null;

  const throughWeek = Math.max(...rows.map((r) => r.week as number));
  const teams: ProjectionTeam[] = rows
    .filter((row) => (row.week as number) === throughWeek)
    .map((row) => ({
      teamId: row.team_id as string,
      h2hW: Number(row.h2h_w ?? 0),
      h2hT: Number(row.h2h_t ?? 0),
      cumPts: Number(row.cum_pts ?? 0),
      rank: Number(row.rank ?? 0),
    }));
  if (teams.length === 0) return null;

  const keyToId = new Map([...byId.values()].map((t) => [t.models.key, t.id]));
  const places = projectTable({
    teams,
    fixtures: fixtures
      .map((f) => ({
        homeTeamId: keyToId.get(f.home.modelKey) ?? '',
        awayTeamId: keyToId.get(f.away.modelKey) ?? '',
      }))
      .filter((f) => f.homeTeamId && f.awayTeamId),
    live: new Map([...live].map(([teamId, v]) => [teamId, v.total])),
  });

  const out: Record<string, ProjectedRank> = {};
  for (const [teamId, place] of places) {
    const key = byId.get(teamId)?.models.key;
    if (key) out[key] = place;
  }
  return out;
}
