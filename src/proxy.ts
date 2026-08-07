import { NextResponse, type NextRequest } from 'next/server';

/**
 * Case-insensitive URLs.
 *
 * Next matches routes case-sensitively, so `/faq` renders and `/FAQ` 404s. That is not a
 * theoretical problem: people capitalise acronyms when they type them, iOS capitalises
 * the first letter of a sentence, and every one of those visitors currently gets a 404
 * on a page that exists.
 *
 * Every route on this site is lowercase, and so is every dynamic segment that reaches
 * one — findings slugs, model keys, and Postgres UUIDs are all lowercase by
 * construction. So "lowercase it and redirect" cannot break a URL that would otherwise
 * have worked.
 *
 * 308 rather than 302: the lowercase form is the canonical one, it is what `sitemap.xml`
 * and every canonical tag already advertise, and a permanent redirect is what stops the
 * two spellings accumulating as separate entries in a search index.
 *
 * Named `proxy.ts` — Next 16's name for what used to be `middleware.ts`. Both are still
 * recognised at 16.2.1; this is the one that is not on its way out.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const lowercased = pathname.toLowerCase();

  if (lowercased !== pathname) {
    return NextResponse.redirect(new URL(`${lowercased}${search}`, request.url), 308);
  }
  return NextResponse.next();
}

export const config = {
  /**
   * Skip anything that is not a page.
   *
   * `_next` is build output whose filenames are case-sensitive and often mixed-case —
   * rewriting those would break the site rather than fix it. The file extensions cover
   * generated assets served from the app directory (`opengraph-image`, `icon`,
   * `sitemap.xml`, `robots.txt`, `feed.xml`) plus anything in `public`.
   */
  matcher: ['/((?!_next/|api/|.*\\.[a-zA-Z0-9]+$).*)'],
};
