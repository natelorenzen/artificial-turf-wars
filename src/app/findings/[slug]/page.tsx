import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { formatDate, getAllPosts, getPost } from '@/lib/blog/posts';
import { absoluteUrl } from '@/lib/site/nav';
import { renderMarkdown } from '@/lib/blog/render';
import { BreadcrumbJsonLd, PostJsonLd } from '@/components/JsonLd';

/**
 * Drafts are deliberately reachable by direct URL but excluded from
 * `generateStaticParams`, the index and the sitemap — so a post can be shared for
 * review before it is published, without being indexed.
 */
export function generateStaticParams() {
  return getAllPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return { title: 'Not found — Artificial Turf War' };

  const url = absoluteUrl(`/findings/${post.slug}`);

  return {
    title: `${post.title} — Artificial Turf War`,
    description: post.summary,
    alternates: { canonical: `/findings/${post.slug}` },
    openGraph: {
      title: post.title,
      description: post.summary,
      type: 'article',
      // Restated here because a page-level `openGraph` REPLACES the layout's rather
      // than merging into it — without this, every post silently lost its og:url.
      url,
      siteName: 'Artificial Turf War',
      publishedTime: new Date(post.date).toISOString(),
      authors: ['Artificial Turf War'],
    },
    twitter: { card: 'summary_large_image', title: post.title, description: post.summary },
    robots: post.draft ? { index: false, follow: false } : undefined,
  };
}

export default async function FindingsPost({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();

  const { html, headings } = renderMarkdown(post.body);
  // Resolved rather than hand-written into the markdown, so the pointer carries the
  // later post's real title and cannot drift if that title changes.
  const followUp = post.followUp ? getPost(post.followUp) : null;

  return (
    <main className="wrap">
      <PostJsonLd post={post} />
      <BreadcrumbJsonLd
        trail={[
          { name: 'Findings', path: '/findings' },
          { name: post.title, path: `/findings/${post.slug}` },
        ]}
      />
      <div className="yard" />

      {post.draft && (
        <div className="notice">
          Draft — not published, not indexed, and reachable only by direct link.
        </div>
      )}

      <article className="post">
        <header className="post-head">
          <div className="post-card-meta">
            {post.kicker && <span className="post-card-kicker">{post.kicker}</span>}
            <time dateTime={post.date}>{formatDate(post.date)}</time>
          </div>
          <h1>{post.title}</h1>
          <p className="post-summary">{post.summary}</p>
        </header>

        {followUp && (
          <aside className="post-followup">
            <span className="post-followup-label">Newer findings</span>
            <p>
              {post.followUpNote}{' '}
              <Link href={`/findings/${followUp.slug}`}>{followUp.title}</Link>
            </p>
            <p className="post-followup-fine">
              This post is left as it was published on {formatDate(post.date)}. We do not
              rewrite findings after the fact — we publish the newer ones and link them.
            </p>
          </aside>
        )}

        {headings.length > 2 && (
          <nav className="post-contents" aria-label="Contents">
            <span className="post-contents-label">Contents</span>
            <ol>
              {headings.map((h) => (
                <li key={h.id}>
                  <a href={`#${h.id}`}>{h.text}</a>
                </li>
              ))}
            </ol>
          </nav>
        )}

        {/* Trusted content: post bodies are markdown files in this repository, and the
            renderer has inline HTML disabled so quoted model output cannot execute. */}
        <div className="post-body" dangerouslySetInnerHTML={{ __html: html }} />

        {post.evidence && (
          <footer className="post-evidence">
            <strong>Check it yourself:</strong> {post.evidence}
          </footer>
        )}
      </article>

      <p className="lede-copy" style={{ marginTop: 28 }}>
        <Link href="/findings">← All findings</Link>
      </p>
    </main>
  );
}
