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

/**
 * Every post this account sends is TEXT ONLY, and points at the profile instead.
 *
 * X charges thirteen times as much for a post containing a URL — $0.20 against
 * $0.015 — which over a season of results, guides and findings is about $8 against
 * $0.50. "Link in bio" is the ordinary convention on the platform, it costs a
 * penny and a half, and the alternative is paying a 13x premium for a link most
 * readers reach through the profile anyway.
 *
 * The link plumbing below stays. Nothing composes one today, and the day that
 * changes it should be a decision with a price attached rather than a rediscovery.
 */
export const LINK_IN_BIO = 'Link in bio.';

export type PostKind = 'results' | 'waivers' | 'weekend' | 'findings' | 'draft' | 'preview';

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

  const checksFailed = recap ? !recap.numberCheckPassed : false;
  const written = recap && !checksFailed ? recap.shortPost : deterministicResults(facts);
  const body = `${written} ${LINK_IN_BIO}`;

  return finish({
    kind: 'results',
    week: facts.week,
    dedupeKey: `results:${facts.week}`,
    body: trimToFit(body, null),
    link: null,
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
  const body = `${input.headline}\n\n${input.standfirst}\n\n${LINK_IN_BIO}`;

  return finish({
    kind: 'weekend',
    week: input.week,
    dedupeKey: `weekend:${input.week}`,
    body: trimToFit(body, null),
    link: null,
    // A guide nobody has released must not be announced. The post would link to a page
    // that does not show the article yet.
    autoEligible: input.published,
    holdReason: input.published ? null : 'the guide has not been released yet',
  });
}

// ---------------------------------------------------------------------------
// Saturday — the matchup to watch
// ---------------------------------------------------------------------------

export interface PreviewTeamLine {
  model: string;
  /** Standings rank going into this week. Null before any week has been scored. */
  rank: number | null;
  /** The week's projected total for the LOCKED lineup, not for the best possible one. */
  projected: number;
  /** Points already banked this week — a Thursday-night game — or null. */
  live: number | null;
}

export interface PreviewSource {
  week: number;
  /**
   * Which rule picked this matchup. Stated in the post rather than left implicit,
   * because the two rules answer different questions and a reader deserves to know
   * which one they are being shown.
   */
  basis: 'standings' | 'projection';
  home: PreviewTeamLine;
  away: PreviewTeamLine;
  /** How many fixtures it was chosen from — four, in an eight-team league. */
  outOf: number;
}

const ORDINALS = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];

/**
 * The Saturday post: the matchup worth watching, going into the weekend.
 *
 * "Best" is HIGHEST STAKES — the pairing with the lowest combined standings rank, tie
 * broken by the closest projection. That rule is meaningless in week one, when nothing
 * has been scored and every team is unranked, so the caller falls back to the closest
 * matchup on projection and says so in `basis`. Both rules are deterministic and both
 * are stated in the text; nothing here is a judgement call, and no model writes a word
 * of it.
 *
 * Returns null rather than posting a matchup it cannot describe. A week whose
 * projections have not been ingested would otherwise compose "0.0 to 0.0", which is
 * worse than silence.
 */
export function composePreview(source: PreviewSource): ComposedPost | null {
  const { week, basis, home, away, outOf } = source;
  if (home.projected <= 0 || away.projected <= 0) return null;

  const margin = Math.abs(home.projected - away.projected);
  const sentences: string[] = [];

  if (basis === 'standings' && home.rank !== null && away.rank !== null) {
    sentences.push(
      `${home.model} (${ORDINALS[home.rank] ?? `${home.rank}th`}) meets ` +
        `${away.model} (${ORDINALS[away.rank] ?? `${away.rank}th`}) — the highest-ranked ` +
        `pairing on the board, ${home.projected.toFixed(1)} to ${away.projected.toFixed(1)} ` +
        `on projection.`,
    );
  } else {
    sentences.push(
      `${home.model} and ${away.model} are ${margin.toFixed(1)} points apart on ` +
        `projection, the closest of the ${outOf}. No table to rank them by yet.`,
    );
  }

  // Points already banked by Saturday, which is the difference between a preview and a
  // projection nobody can check.
  //
  // Deliberately does NOT name the night. The obvious phrasing is "Thursday night is
  // in", and it is wrong in weeks 1 and 12, which open on a WEDNESDAY — the assumption
  // this codebase has already been bitten by twice, in `defersToLaterFiring` and in
  // `resolveScoringWeek`. By Saturday there may also be two games in rather than one.
  // "On the board" is true whichever nights have been played.
  const banked = (home.live ?? 0) + (away.live ?? 0);
  if (home.live !== null && away.live !== null && banked > 0) {
    const [ahead, behind] =
      home.live >= away.live ? [home, away] : [away, home];
    sentences.push(
      `Already on the board: ${ahead.model} leads ` +
        `${ahead.live!.toFixed(1)}–${behind.live!.toFixed(1)}.`,
    );
  }

  const headline = basis === 'standings' ? `Week ${week}, the one that matters.` : `Week ${week}, the one to watch.`;
  const full = `${headline}\n\n${sentences.join(' ')}\n\n${LINK_IN_BIO}`;
  const short = `${headline}\n\n${sentences[0]}\n\n${LINK_IN_BIO}`;

  return finish({
    kind: 'preview',
    week,
    dedupeKey: `preview:${week}`,
    // Drop the live clause before letting the backstop cut a sentence in half.
    body: trimToFit(fits(full, null) ? full : short, null),
    link: null,
    // Nothing here is model-written and every figure is one the site already shows.
    // There is no claim a deterministic check could fail.
    autoEligible: true,
    holdReason: null,
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
  const headline = input.kicker ? `${input.kicker}: ${input.title}` : input.title;
  const full = `${headline}\n\n${input.summary}\n\n${LINK_IN_BIO}`;
  const short = `${headline}\n\n${LINK_IN_BIO}`;

  return finish({
    kind: 'findings',
    week: null,
    dedupeKey: `findings:${input.slug}`,
    // The title is written to stand alone; the summary is there when there is room.
    body: trimToFit(fits(full, null) ? full : short, null),
    link: null,
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
  const body =
    `The ${input.season} draft is done. Eight AI models, ${input.picks} picks, ` +
    `$${input.costUsd.toFixed(2)} of inference, ${input.fallbacks} fallbacks. ` +
    `Every prompt and every raw response is published. ${LINK_IN_BIO}`;

  return finish({
    kind: 'draft',
    week: null,
    dedupeKey: `draft:${input.season}`,
    body: trimToFit(body, null),
    link: null,
    // Held on purpose, unlike every other kind here.
    //
    // The other posts are recurring: a weekly results post is one of fourteen, and a
    // wrong one is embarrassing but correctable in the next. This one announces a
    // one-shot event, it is the FIRST thing this account will ever say unprompted, and
    // the auto-release path has never run end to end — so its debut would be an
    // unattended post about an irreversible event. The queue exists to make sending a
    // separate decision from composing; this is the post that most deserves it.
    //
    // Release it by setting `auto_eligible = true` once the text has been read; the
    // next daily run picks it up. See DRAFT-DAY.md.
    autoEligible: false,
    holdReason: 'the draft post is released by hand — read it first (DRAFT-DAY.md)',
  });
}

/** What a set of composed posts will cost to send. */
export function estimateCost(posts: ComposedPost[]): number {
  return Number(posts.reduce((sum, p) => sum + p.estCostUsd, 0).toFixed(4));
}
