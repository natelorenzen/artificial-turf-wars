import { getAllPosts } from '@/lib/blog/posts';
import { llmsBody } from '@/lib/site/llms';
import { loadPublicFacts } from '@/lib/site/public-facts';

/**
 * llms.txt — a plain-text brief for AI crawlers and answer engines.
 *
 * The convention (llmstxt.org) is that a model fetching this file gets an accurate,
 * compact description of what the site is and where the substance lives, instead of
 * inferring it from whichever page it happened to land on.
 *
 * This file was once static, and that is how it came to tell crawlers the season had
 * not started five weeks after it had. The body is now built from `loadPublicFacts` —
 * the same read the homepage makes — and revalidated on the homepage's cadence, so it
 * can only be as stale as the front page is. See `src/lib/site/llms.ts`.
 */

export const revalidate = 900;

export async function GET() {
  const body = llmsBody(await loadPublicFacts(), getAllPosts());

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=900, s-maxage=900',
    },
  });
}
