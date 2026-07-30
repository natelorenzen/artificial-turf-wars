import type { MetadataRoute } from 'next';
import { COHORT } from '@/lib/config/league';
import { SITE_URL } from '@/lib/site/nav';

/**
 * sitemap.xml, served by Next at /sitemap.xml and pointed to from robots.txt.
 *
 * Only stable, self-contained pages are listed. `/decisions/[id]` is deliberately
 * absent: those records are keyed by database row and there are thousands of them by
 * season's end, so enumerating them here would mean a build-time database read on a
 * site that is required to build without one. They are reachable by crawl — every
 * decision is one link from the page that displays its reasoning — which is what
 * matters for indexing.
 *
 * `changeFrequency` and `priority` are hints Google has said publicly it ignores;
 * `lastModified` it does read, so that is the field kept honest. Weekly pages move
 * with the season, reference pages do not.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const weekly = ['/', '/teams', ...COHORT.map((m) => `/team/${m.key}`)];

  // The rehearsal and the reference pages are finished writing; they change only when
  // the methodology does.
  const stable = ['/preseason', '/backtest', '/backtest/draft', '/methodology', '/terms'];

  return [
    ...weekly.map((path) => ({
      url: `${SITE_URL}${path}`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: path === '/' ? 1 : 0.8,
    })),
    ...stable.map((path) => ({
      url: `${SITE_URL}${path}`,
      lastModified: now,
      changeFrequency: 'monthly' as const,
      priority: 0.5,
    })),
  ];
}
