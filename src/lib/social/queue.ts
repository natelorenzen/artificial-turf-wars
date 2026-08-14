/**
 * The outbound queue: compose, store as a draft, release separately.
 *
 * The discipline is the same one `recaps` and `weekend_guides` use, for a stronger
 * reason. A wrong column is a page you can correct; a wrong post is already in
 * somebody's timeline. So nothing is composed at send time and nothing is sent that
 * was not stored first — every post exists as a row, with its source and its checks,
 * before it exists on X.
 *
 * Two independent gates stand between composing and sending:
 *
 *   1. `auto_eligible` — false when a deterministic check on the SOURCE failed. The
 *      results post quotes the beat writer, and week 5 of the rehearsal produced a
 *      column asserting DeepSeek "fell to" GPT-5.6 Sol when DeepSeek had won.
 *   2. `RELEASE_LIMIT` — no run may send more than a few posts. A first run against a
 *      season's backlog should not empty the whole queue into a timeline at once, and
 *      a bug that composes fifty drafts should cost three posts, not fifty.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ComposedPost } from './compose';
import { postToX, xCredentials, type XCredentials } from './x';

/** The most posts one invocation will send. */
export const RELEASE_LIMIT = 3;

export interface QueuedPost {
  id: string;
  kind: string;
  week: number | null;
  body: string;
  link: string | null;
  estCostUsd: number;
  autoEligible: boolean;
  holdReason: string | null;
  status: string;
}

/**
 * Store a composed post as a draft, or update the draft already there.
 *
 * Keyed on `(season_id, dedupe_key)`, so re-composing the same news updates the draft
 * instead of queueing a second copy. A post that has already gone out is never touched
 * — `status` moves to `posted` and this stops matching it, which is the point: the text
 * on X and the text in the row must stay the same text.
 */
export async function upsertDraft(
  db: SupabaseClient,
  seasonId: string,
  post: ComposedPost,
): Promise<{ id: string; updated: boolean } | null> {
  const { data: existing, error: readError } = await db
    .from('social_posts')
    .select('id, status')
    .eq('season_id', seasonId)
    .eq('dedupe_key', post.dedupeKey)
    .maybeSingle();
  if (readError) throw new Error(`social_posts read: ${readError.message}`);

  if (existing && existing.status !== 'draft') return null;

  const row = {
    season_id: seasonId,
    kind: post.kind,
    week: post.week,
    dedupe_key: post.dedupeKey,
    body: post.body,
    link: post.link,
    est_cost_usd: post.estCostUsd,
    auto_eligible: post.autoEligible,
    hold_reason: post.holdReason,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await db
    .from('social_posts')
    .upsert(row, { onConflict: 'season_id,dedupe_key' })
    .select('id')
    .single();
  if (error) throw new Error(`social_posts upsert: ${error.message}`);

  return { id: data.id as string, updated: Boolean(existing) };
}

/** Drafts cleared to send, oldest first. */
export async function releasableDrafts(
  db: SupabaseClient,
  seasonId: string,
  limit = RELEASE_LIMIT,
): Promise<QueuedPost[]> {
  const { data, error } = await db
    .from('social_posts')
    .select('id, kind, week, body, link, est_cost_usd, auto_eligible, hold_reason, status')
    .eq('season_id', seasonId)
    .eq('status', 'draft')
    .eq('auto_eligible', true)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`social_posts read: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    kind: row.kind as string,
    week: row.week as number | null,
    body: row.body as string,
    link: row.link as string | null,
    estCostUsd: Number(row.est_cost_usd ?? 0),
    autoEligible: row.auto_eligible as boolean,
    holdReason: row.hold_reason as string | null,
    status: row.status as string,
  }));
}

export interface ReleaseOutcome {
  id: string;
  kind: string;
  posted: boolean;
  remoteId: string | null;
  error: string | null;
}

/**
 * Send the cleared drafts.
 *
 * The link is appended to the body at send time rather than stored joined, because X
 * counts a URL as a fixed 23 characters however long it is and `postLength` already
 * budgets for exactly that. Keeping them apart is also what lets the cost column stay
 * honest: a post with a link costs thirteen times one without.
 */
export async function releaseDrafts(
  db: SupabaseClient,
  posts: QueuedPost[],
  credentials: XCredentials,
): Promise<ReleaseOutcome[]> {
  const outcomes: ReleaseOutcome[] = [];

  for (const post of posts) {
    const text = post.link ? `${post.body}\n\n${post.link}` : post.body;
    const result = await postToX(credentials, text);

    const update = result.ok
      ? {
          status: 'posted',
          posted_at: new Date().toISOString(),
          remote_id: result.remoteId,
          error: null,
          updated_at: new Date().toISOString(),
        }
      : {
          // Left as `failed` rather than returned to `draft`. A draft is something
          // nobody has tried to send; this is something that was tried and refused,
          // and collapsing the two would have the next run retry it silently forever.
          status: 'failed',
          error: result.error,
          updated_at: new Date().toISOString(),
        };

    const { error } = await db.from('social_posts').update(update).eq('id', post.id);
    if (error) throw new Error(`social_posts update: ${error.message}`);

    outcomes.push({
      id: post.id,
      kind: post.kind,
      posted: result.ok,
      remoteId: result.ok ? result.remoteId : null,
      error: result.ok ? null : result.error,
    });
  }

  return outcomes;
}

/** Whether this deployment can send at all. Null credentials is a skip, not a failure. */
export function sendingConfigured(): XCredentials | null {
  return xCredentials();
}
