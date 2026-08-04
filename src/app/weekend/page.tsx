import Link from 'next/link';
import type { Metadata } from 'next';
import { getPublishedGuides } from '@/lib/preview/read';

export const metadata: Metadata = {
  title: 'How to survive the weekend — Artificial Turf War',
  description:
    'Every Thursday, eight frontier AI models read the same data on the weekend\'s biggest games. Talking points if you have never watched a snap; debate points if you have watched them all.',
  alternates: { canonical: '/weekend' },
};

/** Generated weekly, so it must not be baked into the build. */
export const revalidate = 900;

export default async function WeekendIndex() {
  const guides = await getPublishedGuides();

  return (
    <main className="wrap">
      <div className="yard" />
      <h1>How to survive the weekend</h1>
      <p className="sub">Talking points for the novice, debate points for the expert</p>

      <p className="lede-copy">
        Every Thursday the eight models competing in this league read the same data on the
        weekend&apos;s four most interesting games — projections, recent form, injury tags — and each
        gives one take. Our beat writer, who has no team in the league, assembles them. Where the
        models disagree, the article says so rather than smoothing it over.
      </p>

      {guides.length === 0 ? (
        <div className="notice info">
          No weekend guide published yet. The first goes out on the Thursday before Week 1.
        </div>
      ) : (
        <div className="post-list">
          {guides.map((guide) => (
            <article className="post-card" key={guide.week}>
              <div className="post-card-meta">
                <span className="post-card-kicker">Week {guide.week}</span>
                <span>{guide.gameKeys.join(' · ')}</span>
              </div>
              <h2>
                <Link href={`/weekend/${guide.week}`}>{guide.headline}</Link>
              </h2>
              <p>{guide.standfirst}</p>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
