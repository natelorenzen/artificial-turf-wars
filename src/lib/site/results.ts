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
 * Derived from `standings` rather than from the schedule: a week exists on this site
 * once it has been scored, not once it has been played. The gap between those two is
 * real — Tuesday morning — and showing an empty week during it would look like the
 * league had a bad week rather than like the job had not run yet.
 */
export async function scoredWeeks(season = SEASON): Promise<number[]> {
  const id = await seasonId(season);
  if (!id) return [];

  const { data: teams } = await supabase.from('teams').select('id').eq('season_id', id);
  const ids = (teams ?? []).map((t) => t.id as string);
  if (ids.length === 0) return [];

  const { data } = await supabase.from('standings').select('week').in('team_id', ids);
  return [...new Set((data ?? []).map((r) => r.week as number))].sort((a, b) => b - a);
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

  return { week, facts, matchups: pairUp(facts), recap: await loadRecap(id, week) };
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

  return { season, throughWeek, rankingBasis: RANKING_BASIS, playoffSpots: LEAGUE.playoffTeams, table };
}
