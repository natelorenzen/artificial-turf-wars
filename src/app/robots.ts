import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site/nav';

/**
 * robots.txt, served by Next at /robots.txt.
 *
 * The `Sitemap:` line is the actual discovery mechanism — a sitemap nothing points at
 * is a file nobody fetches. Search Console submission is faster for the first crawl,
 * but this is what keeps it found afterwards.
 *
 * `/api/` is disallowed because those routes are cron endpoints: they are useless to a
 * crawler and a crawled one would be a wasted invocation. They already refuse
 * unauthenticated callers, so this is tidiness rather than a control.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: '/api/' },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
