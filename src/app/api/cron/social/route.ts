import { assertCronAuth, cronErrorResponse } from '@/lib/cron/guard';
import { supabaseServer } from '@/lib/supabase-server';
import { LEAGUE } from '@/lib/config/league';
import { seasonIdFor } from '@/lib/scoring/week';
import { estimateCost } from '@/lib/social/compose';
import { composeDue } from '@/lib/social/sources';
import {
  releasableDrafts,
  releaseDrafts,
  sendingConfigured,
  upsertDraft,
} from '@/lib/social/queue';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Daily 16:00 ET — compose whatever is new, then release what has cleared its checks.
 *
 * Deliberately one daily job rather than one per kind. Everything it can post about is
 * produced by a job earlier the same day — the column on Tuesday, the waiver run on
 * Wednesday, the guide on Thursday — so a single late-afternoon pass catches each of
 * them a few hours after it lands, and there is one place to look when a post does not
 * appear rather than three.
 *
 * Composing is always safe to repeat: every post is keyed on `(season, dedupe_key)` and
 * re-composing the same news updates the draft. Sending is not repeatable, which is why
 * it is a separate step gated on `auto_eligible`, capped per run, and why a post that
 * has already gone out stops matching the draft query entirely.
 *
 * No model is called here. Every line of every post is assembled from figures already
 * stored and already published on a page — except the results post, which quotes the
 * beat writer's `short_post` verbatim and is therefore the one kind that can be held.
 */
export async function GET(request: Request) {
  try {
    assertCronAuth(request);

    const db = supabaseServer();
    const season = Number(process.env.SEASON_YEAR ?? LEAGUE.season);
    const seasonId = await seasonIdFor(db, season);

    const { posts, errors } = await composeDue(db, seasonId, season);

    const queued: { kind: string; autoEligible: boolean; holdReason: string | null }[] = [];
    for (const post of posts) {
      const stored = await upsertDraft(db, seasonId, post);
      // Null means a row for this news already went out. Not an error — it is the
      // idempotency working.
      if (!stored) continue;
      queued.push({ kind: post.kind, autoEligible: post.autoEligible, holdReason: post.holdReason });
    }

    // Credentials absent is a SKIP, not a failure. The queue still fills, so when the
    // account is connected the drafts are already there and checkable — and a job that
    // 500s every day for a month is a job whose log nobody reads.
    const credentials = sendingConfigured();
    if (!credentials) {
      return Response.json({
        ok: true,
        season,
        composed: posts.length,
        queued: queued.length,
        released: 0,
        skipped: 'X credentials are not configured — composed and queued only',
        held: queued.filter((q) => !q.autoEligible),
        errors,
      });
    }

    const due = await releasableDrafts(db, seasonId);
    const outcomes = await releaseDrafts(db, due, credentials);

    return Response.json({
      ok: true,
      season,
      composed: posts.length,
      queued: queued.length,
      released: outcomes.filter((o) => o.posted).length,
      failed: outcomes.filter((o) => !o.posted),
      // What the sent posts cost, from the same per-kind figures stored on each row.
      costUsd: estimateCost(posts.filter((p) => outcomes.some((o) => o.posted && o.kind === p.kind))),
      held: queued.filter((q) => !q.autoEligible),
      errors,
    });
  } catch (err) {
    return cronErrorResponse(err);
  }
}
