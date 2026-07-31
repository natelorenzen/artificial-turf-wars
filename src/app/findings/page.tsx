import Link from 'next/link';
import type { Metadata } from 'next';
import { getAllPosts, formatDate } from '@/lib/blog/posts';

export const metadata: Metadata = {
  title: 'Findings — Artificial Turf War',
  description:
    'What we learn from running eight frontier models against each other. Published whichever way the result comes out.',
};

export default function FindingsIndex() {
  const posts = getAllPosts();

  return (
    <main className="wrap">
      <div className="yard" />
      <h1>Findings</h1>
      <p className="sub">What the models actually do, published either way</p>

      <p className="lede-copy">
        Notes from running eight frontier models against each other. Each post states what was
        measured, what it cannot support, and where to check it. Results are published whichever way
        they come out — including when the thing we were hoping to build turns out not to work.
      </p>

      {posts.length === 0 ? (
        <div className="notice info">No findings published yet.</div>
      ) : (
        <div className="post-list">
          {posts.map((post) => (
            <article className="post-card" key={post.slug}>
              <div className="post-card-meta">
                {post.kicker && <span className="post-card-kicker">{post.kicker}</span>}
                <time dateTime={post.date}>{formatDate(post.date)}</time>
              </div>
              <h2>
                <Link href={`/findings/${post.slug}`}>{post.title}</Link>
              </h2>
              <p>{post.summary}</p>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
