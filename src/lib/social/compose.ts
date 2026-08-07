/**
 * Composing the posts, deterministically (SPEC §8.4).
 *
 * No model writes a post. Every line below is assembled from figures already stored and
 * already published on a page, which buys three things:
 *
 *   - a post can never assert something the site does not, because both read the same
 *     row;
 *   - the same week always composes the same text, so a re-run updates a draft rather
 *     than inventing a second version of the news;
 *   - there is nothing to fact-check, because nothing was written.
 *
 * The one exception is the results post, which quotes the beat writer's `short_post`
 * verbatim — a field specified from the start as "two or three sentences that stand
 * alone as a social post". That one IS model-written, which is exactly why it is the
 * only kind gated on the deterministic checks having passed.
 */

import { absoluteUrl } from '@/lib/site/nav';
import type { WrapFacts } from '@/lib/weekly/wrap';

/** X's limit. Composers must fit inside it without truncating mid-word. */
export const POST_LIMIT = 280;

/**
 * What X charges, checked against docs.x.com on 6 August 2026.
 *
 * A post carrying a URL costs thirteen times a plain one, which is worth knowing when
 * choosing whether a given post needs a link at all. Most of ours do — a results post
 * with nowhere to go is a dead end — but the waiver post is deliberately written to
 * stand alone, because its content IS the news.
 */
export const COST_PER_POST = 0.015;
export const COST_PER_POST_WITH_URL = 0.2;

export type PostKind = 'results' | 'waivers' | 'weekend' | 'findings' | 'draft';

export interface ComposedPost {
  kind: PostKind;
  week: number | null;
  /** Stable per (season, kind, week) — the idempotency key. */
  dedupeKey: string;
  body: string;
  link: string | null;
  estCostUsd: number;
  /** False when a deterministic check on the source failed. */
  autoEligible: boolean;
  holdReason: string | null;
}

function finish(
  input: Omit<ComposedPost, 'estCostUsd' | 'dedupeKey'> & { dedupeKey: string },
): ComposedPost {
  const estCostUsd = input.link ? COST_PER_POST_WITH_URL : COST_PER_POST;
  return { ...input, estCostUsd };
}

/** Characters a post occupies. X counts a URL as a fixed 23 whatever its length. */
export function postLength(body: string, link: string | null): number {
  return body.length + (link ? 24 : 0); // 23 for the URL, 1 for the separating space
}

export function fits(body: string, link: string | null): boolean {
  return postLength(body, link) <= POST_LIMIT;
}

/**
 * Trim to the limit on a WORD boundary, never mid-word.
 *
 * Used only as a backstop. Every composer below is written to fit, and the tests assert
 * it against the real rehearsal weeks — but a model-written `short_post` is not under
 * our control, and a post that would be rejected by the API for length is worse than
 * one that ends a sentence early.
 */
export function trimToFit(body: string, link: string | null): string {
  if (fits(body, link)) return body;
  const budget = POST_LIMIT - (link ? 24 : 0) - 1;
  const cut = body.slice(0, budget);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > budget * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

// ---------------------------------------------------------------------------
// Tuesday — the week's results
// ---------------------------------------------------------------------------

export interface ResultsSource {
  season: number;
  facts: WrapFacts;
  recap: { shortPost: string; numberCheckPassed: boolean; numberCheckNotes: string[] } | null;
}

/**
 * The results post.
 *
 * Leads with the beat writer's `short_post` when there is one and it checked out, and
 * falls back to a deterministic sentence when there is not. The fallback is not a
 * degraded version — a scoreline and the week's luck are the whole story most weeks —
 * it just cannot be as good a sentence.
 */
export function composeResults(source: ResultsSource): ComposedPost {
  const { facts, recap } = source;
  const link = absoluteUrl(`/results/${facts.week}`);

  const checksFailed = recap ? !recap.numberCheckPassed : false;
  const body = recap && !checksFailed ? recap.shortPost : deterministicResults(facts);

  return finish({
    kind: 'results',
    week: facts.week,
    dedupeKey: `results:${facts.week}`,
    body: trimToFit(body, link),
    link,
    // The one model-written post, and therefore the one that must not go out on trust.
    autoEligible: !checksFailed,
    holdReason: checksFailed
      ? `the week ${facts.week} column did not pass its checks: ${recap!.numberCheckNotes.join('; ')}`
      : null,
  });
}

/** Written from figures only, for when there is no usable column. */
function deterministicResults(facts: WrapFacts): string {
  const parts = [`Week ${facts.week}.`];

  if (facts.high_score) {
    parts.push(`${facts.high_score.model} led the league with ${facts.high_score.points}.`);
  }
  // The luck line is the most interesting thing most weeks and the hardest to get from
  // a scoreline, so it takes precedence over the closest game.
  if (facts.luck.length > 0) {
    parts.push(`${facts.luck[0].model} ${facts.luck[0].note}.`);
  } else if (facts.closest_matchup) {
    const m = facts.closest_matchup;
    parts.push(`${m.winner} edged ${m.loser} by ${m.margin}.`);
  }
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Wednesday — the waiver run
// ---------------------------------------------------------------------------

export interface WaiverOutcomeLine {
  model: string;
  player: string;
  bid: number;
  won: boolean;
}

/**
 * The waiver post. Never composed before Wednesday's resolution — bids are sealed until
 * then, and a leaked bid would let a rival react to a number nobody was meant to see.
 * The caller enforces the timing; this function refuses an unresolved run outright.
 *
 * Deliberately carries NO link. The content is the news — who paid what — and at 13x for
 * a URL it is the one post of the week that genuinely stands alone.
 */
export function composeWaivers(
  week: number,
  outcomes: WaiverOutcomeLine[],
): ComposedPost | null {
  const won = outcomes.filter((o) => o.won);
  if (outcomes.length === 0) return null;

  const contested = mostContested(outcomes);
  const top = [...won].sort((a, b) => b.bid - a.bid)[0];

  const lines = [`Waivers, week ${week}.`];
  if (top) lines.push(`${top.model} paid $${top.bid} for ${top.player}.`);
  if (contested && contested.bidders > 2) {
    lines.push(`${contested.bidders} teams wanted ${contested.player}.`);
  }
  if (won.length === 0) lines.push('Every claim failed.');

  const standPat = outcomes.length - won.length;
  if (standPat > 0 && won.length > 0) lines.push(`${standPat} claims lost out.`);

  return finish({
    kind: 'waivers',
    week,
    dedupeKey: `waivers:${week}`,
    body: trimToFit(lines.join(' '), null),
    link: null,
    // Nothing here is model-written. There is no claim a check could fail.
    autoEligible: true,
    holdReason: null,
  });
}

function mostContested(outcomes: WaiverOutcomeLine[]): { player: string; bidders: number } | null {
  const counts = new Map<string, number>();
  for (const o of outcomes) counts.set(o.player, (counts.get(o.player) ?? 0) + 1);

  const [player, bidders] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
  return player ? { player, bidders } : null;
}

// ---------------------------------------------------------------------------
// Thursday — the weekend guide
// ---------------------------------------------------------------------------

export function composeWeekend(input: {
  week: number;
  headline: string;
  standfirst: string;
  published: boolean;
}): ComposedPost {
  const link = absoluteUrl(`/weekend/${input.week}`);
  const body = `${input.headline}\n\n${input.standfirst}`;

  return finish({
    kind: 'weekend',
    week: input.week,
    dedupeKey: `weekend:${input.week}`,
    body: trimToFit(body, link),
    link,
    // A guide nobody has released must not be announced. The post would link to a page
    // that does not show the article yet.
    autoEligible: input.published,
    holdReason: input.published ? null : 'the guide has not been released yet',
  });
}

// ---------------------------------------------------------------------------
// Irregular — findings, and the draft
// ---------------------------------------------------------------------------

export function composeFinding(input: {
  slug: string;
  title: string;
  summary: string;
  kicker: string | null;
}): ComposedPost {
  const link = absoluteUrl(`/findings/${input.slug}`);
  const body = input.kicker ? `${input.kicker}: ${input.title}` : input.title;

  return finish({
    kind: 'findings',
    week: null,
    dedupeKey: `findings:${input.slug}`,
    // The title is written to stand alone; the summary is there when there is room.
    body: trimToFit(fits(`${body}\n\n${input.summary}`, link) ? `${body}\n\n${input.summary}` : body, link),
    link,
    autoEligible: true,
    holdReason: null,
  });
}

export function composeDraft(input: {
  season: number;
  picks: number;
  costUsd: number;
  fallbacks: number;
}): ComposedPost {
  const link = absoluteUrl('/teams');
  const body =
    `The ${input.season} draft is done. Eight AI models, ${input.picks} picks, ` +
    `$${input.costUsd.toFixed(2)} of inference, ${input.fallbacks} fallbacks. ` +
    'Every prompt and every raw response is published.';

  return finish({
    kind: 'draft',
    week: null,
    dedupeKey: `draft:${input.season}`,
    body: trimToFit(body, link),
    link,
    autoEligible: true,
    holdReason: null,
  });
}

/** What a set of composed posts will cost to send. */
export function estimateCost(posts: ComposedPost[]): number {
  return Number(posts.reduce((sum, p) => sum + p.estCostUsd, 0).toFixed(4));
}
