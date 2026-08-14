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
import {
  composeFinding,
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
