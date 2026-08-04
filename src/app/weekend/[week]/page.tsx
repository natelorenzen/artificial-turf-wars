import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { renderMarkdown } from '@/lib/blog/render';
import { getGuide, getGuideTakes } from '@/lib/preview/read';
import { absoluteUrl } from '@/lib/site/nav';

/** Published weekly by a cron job, so nothing here can be baked at build time. */
export const revalidate = 900;
export const dynamicParams = true;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ week: string }>;
}): Promise<Metadata> {
  const { week } = await params;
  const guide = await getGuide(Number(week));
  if (!guide) return { title: 'Not found — Artificial Turf War' };

  return {
    title: `${guide.headline} — Artificial Turf War`,
    description: guide.standfirst,
    alternates: { canonical: `/weekend/${guide.week}` },
    openGraph: {
      title: guide.headline,
      description: guide.standfirst,
      url: absoluteUrl(`/weekend/${guide.week}`),
      type: 'article',
    },
  };
}

export default async function WeekendGuidePage({
  params,
}: {
  params: Promise<{ week: string }>;
}) {
  const { week } = await params;
  const weekNumber = Number(week);
  if (!Number.isInteger(weekNumber)) notFound();

  const guide = await getGuide(weekNumber);
  if (!guide) notFound();

  const { html } = renderMarkdown(guide.columnMd);
  const takes = await getGuideTakes(weekNumber);

  // Group the receipts by game, in the order the article discusses them.
  const byGame = new Map<string, typeof takes>();
  for (const take of takes) {
    const list = byGame.get(take.gameKey) ?? [];
    list.push(take);
    byGame.set(take.gameKey, list);
  }

  return (
    <main className="wrap">
      <div className="yard" />
      <article className="post">
        <div className="post-meta">
          <span className="post-card-kicker">Week {guide.week}</span>
        </div>
        <h1>{guide.headline}</h1>
        <p className="sub">{guide.standfirst}</p>

        <div className="post-body" dangerouslySetInnerHTML={{ __html: html }} />
      </article>

      {/*
        The receipts. The article is a synthesis by one model of what eight others
        said; publishing the underlying takes is what makes that synthesis checkable
        rather than something a reader has to take on trust.
      */}
      {byGame.size > 0 && (
        <section className="post">
          <h2>Every take behind this</h2>
          <p className="lede-copy">
            The eight models each read the same data block per game. This is what each
            of them actually said, before the beat writer assembled it.
          </p>

          {[...byGame.entries()].map(([gameKey, gameTakes]) => (
            <div key={gameKey}>
              <h3>{gameKey}</h3>
              <div className="scroll compact">
                <table>
                  <thead>
                    <tr>
                      <th>Model</th>
                      <th>For the novice</th>
                      <th>For the expert</th>
                      <th>Conf.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gameTakes.map((take) => (
                      <tr key={`${gameKey}-${take.modelName}`}>
                        <td>{take.modelName}</td>
                        <td>{take.novicePoint}</td>
                        <td>{take.expertPoint}</td>
                        <td>{take.confidence?.toFixed(2) ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </section>
      )}

      <p className="lede-copy">
        <Link href="/weekend">← Every weekend guide</Link>
      </p>
    </main>
  );
}
