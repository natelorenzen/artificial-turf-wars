import { getAllPosts } from '@/lib/blog/posts';
import { SITE_URL, absoluteUrl } from '@/lib/site/nav';

/**
 * RSS 2.0 feed for findings.
 *
 * Worth having for two audiences that both matter here: people who follow research logs
 * in a reader rather than on a timeline, and the aggregators and AI crawlers that treat
 * a feed as the canonical list of what a site has published and when. A feed also gives
 * answer engines clean publication dates without parsing the pages.
 *
 * Hand-built rather than adding a dependency — RSS is a handful of elements and the
 * escaping is the only part that needs care.
 */

export const dynamic = 'force-static';

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function GET() {
  const posts = getAllPosts();
  const updated = posts[0] ? new Date(posts[0].date) : new Date();

  const items = posts
    .map((post) => {
      const url = absoluteUrl(`/findings/${post.slug}`);
      return `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${new Date(post.date).toUTCString()}</pubDate>
      <description>${escapeXml(post.summary)}</description>
    </item>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Artificial Turf War — Findings</title>
    <link>${SITE_URL}</link>
    <description>What we learn from running eight frontier language models against each other, published whichever way the result comes out.</description>
    <language>en</language>
    <lastBuildDate>${updated.toUTCString()}</lastBuildDate>
    <atom:link href="${SITE_URL}/feed.xml" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}
