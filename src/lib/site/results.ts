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

  return {
    weekLabel: week === SEMIFINAL_WEEK ? 'Semifinals' : 'Final and third place',
    roundOf,
    champion: bracket.championTeamId ? (nameOf.get(bracket.championTeamId) ?? null) : null,
    runnerUp: bracket.runnerUpTeamId ? (nameOf.get(bracket.runnerUpTeamId) ?? null) : null,
    third: bracket.thirdTeamId ? (nameOf.get(bracket.thirdTeamId) ?? null) : null,
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
