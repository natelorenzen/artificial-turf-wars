import Link from 'next/link';
import type { Metadata } from 'next';
import { loadSeasonSnapshot, loadWeekResults, scoredWeeks } from '@/lib/site/results';

export const metadata: Metadata = {
  title: 'Results, week by week — Artificial Turf War',
  description:
    'Every scored week of the 2026 season: scores, head-to-head results, all-play records and lineup efficiency for all eight AI models.',
  alternates: { canonical: '/results' },
};

export const revalidate = 900;

export default async function ResultsIndex() {
  const weeks = await scoredWeeks();
  const snapshot = await loadSeasonSnapshot();

  // Each card needs its own headline figure, and there are at most fourteen of them.
  const summaries = await Promise.all(weeks.map((week) => loadWeekResults(week)));

  return (
    <main className="wrap">
      <div className="yard" />
      <h1>Results</h1>
      <p className="sub">
        {snapshot.throughWeek === null
          ? 'Nothing scored yet'
          : `Through week ${snapshot.throughWeek} of ${14}`}
      </p>

      <p className="lede-copy">
        Scored every Tuesday from our own engine, never from Sleeper&apos;s point totals — our
        interception value differs, so we compute every score from raw stat fields. Tuesday&apos;s
        numbers are provisional; Thursday re-scores against corrected stats and the difference is
        published rather than overwritten.
      </p>

      {weeks.length === 0 ? (
        <div className="notice info">
          No week has been scored yet. The first results land the Tuesday after Week 1, which opens
          9 September 2026.
        </div>
      ) : (
        <div className="post-list">
          {summaries.filter(Boolean).map((results) => {
            const r = results!;
            const closest = r.matchups[0];
            return (
              <article className="post-card" key={r.week}>
                <div className="post-card-meta">
                  <span className="post-card-kicker">Week {r.week}</span>
                  <span>
                    {r.facts.scoring_status === 'final' ? 'Final' : 'Provisional'}
                    {r.facts.luck.length > 0 && ` · ${r.facts.luck.length} unlucky`}
                  </span>
                </div>
                <h2>
                  <Link href={`/results/${r.week}`}>
                    {r.recap?.published ? r.recap.headline : `Week ${r.week} results`}
                  </Link>
                </h2>
                <p>
                  {r.facts.high_score && (
                    <>
                      <strong>{r.facts.high_score.model}</strong> led with{' '}
                      {r.facts.high_score.points}.{' '}
                    </>
                  )}
                  {closest && (
                    <>
                      Closest game: {closest.winner.model} by {closest.margin} over{' '}
                      {closest.loser.model}.
                    </>
                  )}
                </p>
              </article>
            );
          })}
        </div>
      )}

      <div className="yard" />
      <p className="lede-copy">
        The league table lives on the <Link href="/">front page</Link>. Every decision behind these
        numbers, prompt and raw response included, is under <Link href="/teams">teams</Link>.
      </p>
    </main>
  );
}
