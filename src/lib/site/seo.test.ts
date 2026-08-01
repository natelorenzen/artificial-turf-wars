import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SITE_URL, absoluteUrl } from '@/lib/site/nav';

/**
 * SEO regressions are silent by nature — nothing throws, the page still renders, and you
 * find out weeks later from a traffic graph. These are the two mistakes this codebase
 * has already made once each, plus the one that would be worst.
 */

const APP = join(process.cwd(), 'src', 'app');

function pageFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...pageFiles(path));
    else if (entry === 'page.tsx') out.push(path);
  }
  return out;
}

describe('canonical URLs', () => {
  it('every page declares its own canonical', () => {
    // A page without one is not broken, but it competes with any other URL that can
    // reach it — query strings, the apex host — for the same content.
    const missing = pageFiles(APP)
      .filter((f) => !readFileSync(f, 'utf8').includes('canonical'))
      .map((f) => f.replace(process.cwd() + '/', ''));

    expect(missing, `pages with no canonical: ${missing.join(', ')}`).toEqual([]);
  });

  it('the root layout never sets a canonical', () => {
    /*
     * Layout metadata merges into every page. A canonical here would declare every page
     * on the site a duplicate of one path, which is the single most destructive thing
     * that can be done to organic traffic in one line.
     */
    const layout = readFileSync(join(APP, 'layout.tsx'), 'utf8');
    const inMetadata = layout
      .slice(layout.indexOf('export const metadata'), layout.indexOf('function Footer'))
      // Strip comments first — this file explains at length WHY there is no canonical
      // here, and matching the bare word would fail on the explanation.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(inMetadata).not.toMatch(/canonical\s*:/);
  });

  it('the feed link is a real <link>, not layout metadata', () => {
    /*
     * A page-level `alternates` REPLACES the layout's rather than merging, so declaring
     * the feed through `metadata.alternates` removed it from every page that set its own
     * canonical — which is all of them. It lives in the layout body instead.
     */
    const layout = readFileSync(join(APP, 'layout.tsx'), 'utf8');
    expect(layout).toMatch(/rel="alternate"[\s\S]*application\/rss\+xml/);
  });
});

describe('site URL', () => {
  it('is the www host production actually serves', () => {
    // The apex 308s to www. Advertising the apex in canonicals, the sitemap and OG tags
    // sends every crawler and social scraper through a redirect they may not follow.
    expect(SITE_URL).toBe('https://www.artificialturfwar.com');
  });

  it('builds absolute URLs without doubling slashes', () => {
    expect(absoluteUrl('/faq')).toBe('https://www.artificialturfwar.com/faq');
    expect(absoluteUrl('faq')).toBe('https://www.artificialturfwar.com/faq');
    expect(absoluteUrl()).toBe('https://www.artificialturfwar.com/');
  });
});
