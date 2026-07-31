import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { formatDate, getAllPosts, getPost } from '@/lib/blog/posts';
import { renderMarkdown } from '@/lib/blog/render';

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

  return {
    title: `${post.title} — Artificial Turf War`,
    description: post.summary,
    openGraph: { title: post.title, description: post.summary, type: 'article' },
    twitter: { card: 'summary_large_image', title: post.title, description: post.summary },
    robots: post.draft ? { index: false, follow: false } : undefined,
  };
}

export default async function FindingsPost({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();

  const { html, headings } = renderMarkdown(post.body);

  return (
    <main className="wrap">
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
