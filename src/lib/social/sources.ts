/**
 * What there is to post about right now.
 *
 * Every composer in `compose.ts` is a pure function of stored data. This file is the
 * part that decides which of them have anything to say today, and it is deliberately
 * conservative in one direction: it composes only RECENT news. A first run against a
 * season with a backlog in it must not queue five months of results, and a findings
 * post from three weeks ago is not an announcement.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getAllPosts } from '@/lib/blog/posts';
import { buildWrapFacts } from '@/lib/weekly/wrap';
import { LEAGUE } from '@/lib/config/league';
import {
  composeFinding,
  composePreview,
  composeResults,
  composeWaivers,
  composeWeekend,
  type ComposedPost,
  type WaiverOutcomeLine,
} from './compose';

/**
 * How recent a thing has to be to be worth announcing.
 *
 * Four days rather than seven: the weekly cycle is Tuesday to Thursday, so everything
 * this job composes is at most three days old in normal operation. Anything older is a
 * backlog, and a backlog is exactly what should not be broadcast.
 */
export const FRESH_DAYS = 4;

function daysAgo(iso: string, now: Date): number {
  return (now.getTime() - new Date(iso).getTime()) / 86_400_000;
}

/** The most recent week with a stored column. */
async function latestRecap(db: SupabaseClient, seasonId: string) {
  const { data, error } = await db
    .from('recaps')
    .select('week, short_post, number_check_passed, number_check_notes, created_at')
    .eq('season_id', seasonId)
    .order('week', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`recaps: ${error.message}`);
  return data;
}

async function resultsPost(
  db: SupabaseClient,
  seasonId: string,
  season: number,
  now: Date,
): Promise<ComposedPost | null> {
  const recap = await latestRecap(db, seasonId);
  if (!recap) return null;
  if (daysAgo(recap.created_at as string, now) > FRESH_DAYS) return null;

  const facts = await buildWrapFacts(db, { seasonId, season, week: recap.week as number });
  if (facts.teams.length === 0) return null;

  return composeResults({
    season,
    facts,
    recap: {
      shortPost: recap.short_post as string,
      numberCheckPassed: recap.number_check_passed as boolean,
      numberCheckNotes: (recap.number_check_notes ?? []) as string[],
    },
  });
}

/**
 * The waiver run, once it has been RESOLVED.
 *
 * Bids are sealed until Wednesday and a leaked bid would let a rival react to a number
 * nobody was meant to see, so this reads only rows whose `won` has been decided. An
 * unresolved run composes nothing rather than composing a post about who bid what.
 */
async function waiverPost(
  db: SupabaseClient,
  seasonId: string,
  now: Date,
): Promise<ComposedPost | null> {
  const { data: teams } = await db.from('teams').select('id, models!inner(display_name)').eq('season_id', seasonId);
  const nameOf = new Map(
    ((teams ?? []) as unknown as { id: string; models: { display_name: string } }[]).map((t) => [
      t.id,
      t.models.display_name,
    ]),
  );
  if (nameOf.size === 0) return null;

  // The FK is named explicitly because `waiver_bids` references `players` TWICE — the
  // player added and the player dropped — and PostgREST refuses to guess which. Left
  // implicit it fails at request time with "more than one relationship was found",
  // which no test catches because the ambiguity lives in the database, not the query.
  const { data, error } = await db
    .from('waiver_bids')
    .select('week, team_id, bid, won, created_at, players!waiver_bids_add_player_id_fkey(name)')
    .in('team_id', [...nameOf.keys()])
    .not('won', 'is', null)
    .order('week', { ascending: false })
    .limit(200);
  if (error) throw new Error(`waiver_bids: ${error.message}`);
  if (!data || data.length === 0) return null;

  const week = data[0].week as number;
  const forWeek = data.filter((row) => row.week === week);
  if (forWeek.some((row) => daysAgo(row.created_at as string, now) > FRESH_DAYS)) return null;

  const outcomes: WaiverOutcomeLine[] = forWeek.map((row) => ({
    model: nameOf.get(row.team_id as string) ?? 'Unknown',
    player: (row.players as unknown as { name: string }).name,
    bid: Number(row.bid),
    won: Boolean(row.won),
  }));

  return composeWaivers(week, outcomes);
}

/** The weekend guide, which announces itself only once a human has released it. */
async function weekendPost(
  db: SupabaseClient,
  seasonId: string,
  now: Date,
): Promise<ComposedPost | null> {
  const { data, error } = await db
    .from('weekend_guides')
    .select('week, headline, standfirst, published, created_at')
    .eq('season_id', seasonId)
    .order('week', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`weekend_guides: ${error.message}`);
  if (!data) return null;
  if (daysAgo(data.created_at as string, now) > FRESH_DAYS) return null;

  return composeWeekend({
    week: data.week as number,
    headline: data.headline as string,
    standfirst: data.standfirst as string,
    published: data.published as boolean,
  });
}

/**
 * Saturday only: the matchup worth watching, going into the weekend.
 *
 * Gated on the DAY rather than on a separate cron entry, because the social job
 * already runs daily at 16:00 ET and one more entry on the same path would be a second
 * place for this to be turned off. Every other day of the week this composes nothing.
 *
 * The weekday is read in ET, not UTC. The job fires at 20:00 UTC, which is Saturday in
 * both zones today — but the fixed UTC hour moves an hour against ET when DST ends on
 * 1 November, and a rule that happens to hold for eight weeks of a fourteen-week
 * season is the kind that fails in the second half.
 */
async function previewPost(
  db: SupabaseClient,
  seasonId: string,
  season: number,
  now: Date,
): Promise<ComposedPost | null> {
  const weekdayET = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    timeZone: 'America/New_York',
  }).format(now);
  if (weekdayET !== 'Sat') return null;

  const { data: teamRows } = await db
    .from('teams')
    .select('id, models!inner(display_name)')
    .eq('season_id', seasonId);
  const teams = (teamRows ?? []) as unknown as {
    id: string;
    models: { display_name: string };
  }[];
  if (teams.length === 0) return null;
  const teamIds = teams.map((t) => t.id);
  const nameOf = new Map(teams.map((t) => [t.id, t.models.display_name]));

  // The week the league has acted on — the same definition the front page uses.
  const { data: acted } = await db
    .from('lineups')
    .select('week')
    .in('team_id', teamIds)
    .lte('week', LEAGUE.regularSeasonWeeks)
    .order('week', { ascending: false })
    .limit(1);
  const week = acted?.[0]?.week as number | undefined;
  if (!week) return null;

  // A week already scored is history, and a preview of it would be a post about
  // something everybody can already read the result of.
  const { data: scored } = await db
    .from('standings')
    .select('week')
    .eq('week', week)
    .in('team_id', teamIds)
    .limit(1);
  if ((scored ?? []).length > 0) return null;

  const { data: schedule } = await db
    .from('h2h_schedule')
    .select('home_team_id, away_team_id')
    .eq('season_id', seasonId)
    .eq('week', week);
  if (!schedule || schedule.length === 0) return null;

  const projected = await projectedTotals(db, season, week, teamIds);
  if (projected.size === 0) return null;

  // Ranks going into the week, i.e. through the last week that was scored.
  const ranks = await ranksBefore(db, teamIds, week);
  const live = await liveTotals(db, week, teamIds);

  const basis: 'standings' | 'projection' = ranks.size > 0 ? 'standings' : 'projection';

  const candidates = schedule.map((row) => {
    const homeId = row.home_team_id as string;
    const awayId = row.away_team_id as string;
    const homePts = projected.get(homeId) ?? 0;
    const awayPts = projected.get(awayId) ?? 0;
    return {
      homeId,
      awayId,
      homePts,
      awayPts,
      margin: Math.abs(homePts - awayPts),
      // Lower is higher-stakes. An unranked team sorts last rather than first.
      stakes: (ranks.get(homeId) ?? 99) + (ranks.get(awayId) ?? 99),
    };
  });

  // Highest stakes, tie-broken by the closest projection — and on the projection basis
  // the margin IS the rule. Both orderings are total, so the pick is deterministic.
  const pick = [...candidates].sort((a, b) =>
    basis === 'standings' ? a.stakes - b.stakes || a.margin - b.margin : a.margin - b.margin,
  )[0];
  if (!pick) return null;

  return composePreview({
    week,
    basis,
    outOf: candidates.length,
    home: {
      model: nameOf.get(pick.homeId) ?? 'Unknown',
      rank: ranks.get(pick.homeId) ?? null,
      projected: pick.homePts,
      live: live.get(pick.homeId) ?? null,
    },
    away: {
      model: nameOf.get(pick.awayId) ?? 'Unknown',
      rank: ranks.get(pick.awayId) ?? null,
      projected: pick.awayPts,
      live: live.get(pick.awayId) ?? null,
    },
  });
}

/**
 * Each team's projected total for the week, from its LOCKED lineup.
 *
 * The lineup a model actually set, not the best one available — the post is about what
 * these teams are fielding, and projecting an optimal lineup nobody chose would flatter
 * every team equally and describe none of them.
 */
async function projectedTotals(
  db: SupabaseClient,
  season: number,
  week: number,
  teamIds: string[],
): Promise<Map<string, number>> {
  const { data: lineups } = await db
    .from('lineups')
    .select('team_id, qb, rb, wr, te, flex, k, def')
    .eq('week', week)
    .in('team_id', teamIds);
  if (!lineups || lineups.length === 0) return new Map();

  const starters = new Map<string, string[]>();
  const everyone = new Set<string>();
  for (const row of lineups) {
    const ids = [
      row.qb,
      ...((row.rb ?? []) as string[]),
      ...((row.wr ?? []) as string[]),
      row.te,
      row.flex,
      row.k,
      row.def,
    ].filter((id): id is string => Boolean(id));
    starters.set(row.team_id as string, ids);
    ids.forEach((id) => everyone.add(id));
  }

  const points = new Map<string, number>();
  const ids = [...everyone];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db
      .from('player_projections')
      .select('player_id, proj_pts')
      .eq('season', season)
      .eq('week', week)
      .in('player_id', ids.slice(i, i + 200));
    if (error) throw new Error(`player_projections: ${error.message}`);
    for (const row of data ?? []) {
      if (row.proj_pts === null) continue;
      points.set(row.player_id as string, Number(row.proj_pts));
    }
  }

  const out = new Map<string, number>();
  for (const [teamId, ids] of starters) {
    const total = ids.reduce((sum, id) => sum + (points.get(id) ?? 0), 0);
    out.set(teamId, Number(total.toFixed(2)));
  }
  return out;
}

/** Standings rank through the last week scored before `week`, or empty in week one. */
async function ranksBefore(
  db: SupabaseClient,
  teamIds: string[],
  week: number,
): Promise<Map<string, number>> {
  const { data } = await db
    .from('standings')
    .select('team_id, week, rank')
    .in('team_id', teamIds)
    .lt('week', week)
    .order('week', { ascending: true });
  if (!data || data.length === 0) return new Map();

  const through = Math.max(...data.map((r) => r.week as number));
  const out = new Map<string, number>();
  for (const row of data) {
    if ((row.week as number) !== through) continue;
    const rank = Number(row.rank ?? 0);
    if (rank > 0) out.set(row.team_id as string, rank);
  }
  return out;
}

/** Points already banked this week, if a live refresh has run. */
async function liveTotals(
  db: SupabaseClient,
  week: number,
  teamIds: string[],
): Promise<Map<string, number>> {
  const { data } = await db
    .from('live_scores')
    .select('team_id, total_pts')
    .eq('week', week)
    .in('team_id', teamIds);
  return new Map((data ?? []).map((r) => [r.team_id as string, Number(r.total_pts)]));
}

/** The newest findings post, if it is new. */
function findingsPost(now: Date): ComposedPost | null {
  const [latest] = getAllPosts();
  if (!latest) return null;
  if (daysAgo(latest.date, now) > FRESH_DAYS) return null;

  return composeFinding({
    slug: latest.slug,
    title: latest.title,
    summary: latest.summary,
    kicker: latest.kicker ?? null,
  });
}

/**
 * Everything worth queueing on this run.
 *
 * Each source is independent and a failure in one must not cost the others their post,
 * so they settle separately. A source that throws is reported rather than swallowed —
 * "the waiver post could not be built" is a thing worth seeing in the cron log.
 */
export async function composeDue(
  db: SupabaseClient,
  seasonId: string,
  season: number,
  now = new Date(),
): Promise<{ posts: ComposedPost[]; errors: string[] }> {
  const sources: [string, () => Promise<ComposedPost | null>][] = [
    ['results', () => resultsPost(db, seasonId, season, now)],
    ['waivers', () => waiverPost(db, seasonId, now)],
    ['weekend', () => weekendPost(db, seasonId, now)],
    ['preview', () => previewPost(db, seasonId, season, now)],
    ['findings', async () => findingsPost(now)],
  ];

  const posts: ComposedPost[] = [];
  const errors: string[] = [];

  for (const [name, build] of sources) {
    try {
      const post = await build();
      if (post) posts.push(post);
    } catch (err) {
      errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { posts, errors };
}
