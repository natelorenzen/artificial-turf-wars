import Link from 'next/link';
import { COHORT } from '@/lib/config/league';
import { formatDate, getAllPosts } from '@/lib/blog/posts';
import { loadSeasonSnapshot } from '@/lib/site/results';

export const metadata = {
  title: 'Artificial Turf War — eight AI models, one fantasy season',
  alternates: { canonical: '/' },
};

/** The standings are written by a cron job every Tuesday, so this cannot be static. */
export const revalidate = 900;

export default async function Home() {
  // Findings are the only part of this site that changes before the season starts, so
  // the newest one gets a slot on the front page rather than living only in the nav.
  const [latest] = getAllPosts();
  const snapshot = await loadSeasonSnapshot();

  return (
    <>
      {/* Full-bleed, and therefore outside `.wrap`. Boxed to the content column it read
          as one more panel among the tiles and tables; edge to edge it reads as the
          title card it is meant to be. */}
      <section className="hero">
        <div className="hero-inner">
          <h1>
            Eight AI models.
            <br />
            One NFL fantasy season.
          </h1>
          <p className="sub">Watch them think</p>
        </div>
      </section>

      <main className="wrap">
        <p className="lede-copy">
          Eight frontier language models each run a fantasy football team for the 2026 season with
          no human help. They draft, set a lineup every week, and bid against each other on waivers.
          Real NFL results score them. Every prompt and every raw response is published.
        </p>

        {snapshot.throughWeek === null ? (
          <div className="notice info">
            The season has not started. NFL Week 1 opens 9 September 2026 and the draft runs late
            August.
          </div>
        ) : (
          <>
            <div className="yard" />
            <h2>Standings</h2>
            <p className="sub">
              Through week {snapshot.throughWeek} · head-to-head ranks · top {snapshot.playoffSpots}{' '}
              make the playoffs
            </p>

            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th className="l">Team</th>
                    <th>Record</th>
                    <th>All-play</th>
                    <th>Points for</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.table.map((row) => (
                    <tr key={row.modelKey}>
                      <td>
                        {row.rank}
                        {/* Co-ranked teams are declared, never separated by a coin flip. */}
                        {row.coRanked && <span className="tag">tied</span>}
                      </td>
                      <td className="l tname">
                        <Link href={`/team/${row.modelKey}`}>{row.model}</Link>
                      </td>
                      <td>{row.record}</td>
                      <td className="muted">{row.allPlay}</td>
                      <td className="muted">{row.pointsFor}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="lede-copy" style={{ marginTop: 14 }}>
              Head-to-head decides the season. All-play — your score against every other team every
              week — is the timing-luck-free read on who actually managed best, and where the two
              disagree is the most interesting thing on this page.{' '}
              <Link href="/results">Week by week</Link>.
            </p>
          </>
        )}

        <div className="yard" />
        <h2>Already banked</h2>
        <p className="sub">Verified against live data, not mocked</p>

        <div className="tiles">
          <div className="tile">
            <div className="k">Rules gate</div>
            <div className="v">8/8</div>
            <div className="n">
              Every model scored 17/17 on the comprehension check, first attempt, from one shared
              byte-identical briefing.
            </div>
          </div>
          <div className="tile">
            <div className="k">Backtest</div>
            <div className="v">3/3</div>
            <div className="n">
              All gates met against the completed 2025 season. Five bugs found that would have
              corrupted the real one.
            </div>
          </div>
          <div className="tile">
            <div className="k">Draft picks simulated</div>
            <div className="v">120</div>
            <div className="n">Zero fallbacks. Zero invalid responses.</div>
          </div>
        </div>

        <p className="lede-copy" style={{ marginTop: 24 }}>
          The full write-up, including every bug and what it would have cost, is on the{' '}
          <Link href="/backtest">backtest page</Link>.
        </p>

        <div className="yard" />
        <h2>The cohort</h2>
        <p className="sub">One team per lab · each lab&apos;s current top-tier general model</p>

        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th className="l">Team</th>
                <th className="l">Lab</th>
                <th>Context</th>
                <th>$/M in</th>
                <th>$/M out</th>
              </tr>
            </thead>
            <tbody>
              {COHORT.map((m) => (
                <tr key={m.key}>
                  <td className="l tname">
                    <Link href={`/team/${m.key}`}>{m.displayName}</Link>
                  </td>
                  <td className="l muted">{m.lab}</td>
                  <td className="muted">{Math.round(m.contextWindow / 1000)}k</td>
                  <td>${m.priceIn.toFixed(2)}</td>
                  <td className="muted">
                    {m.priceOut === null ? '—' : `$${m.priceOut.toFixed(2)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="lede-copy" style={{ marginTop: 14 }}>
          Model IDs are pinned before the draft and never swapped mid-season, even if a lab ships
          something newer in October. A mid-season swap would invalidate the comparison.
        </p>

        <div className="yard" />
        <h2>Latest finding</h2>
        <p className="sub">What we learn along the way, published either way</p>

        {latest ? (
          <article className="post-card">
            <div className="post-card-meta">
              {latest.kicker && <span className="post-card-kicker">{latest.kicker}</span>}
              <time dateTime={latest.date}>{formatDate(latest.date)}</time>
            </div>
            <h2>
              <Link href={`/findings/${latest.slug}`}>{latest.title}</Link>
            </h2>
            <p>{latest.summary}</p>
          </article>
        ) : (
          <div className="notice info">No findings published yet.</div>
        )}

        <p className="lede-copy" style={{ marginTop: 14 }}>
          Every finding says what it measured and what it cannot support.{' '}
          <Link href="/findings">All findings</Link>.
        </p>

        <div className="yard" />
        <h2>This is an exhibition, not a benchmark</h2>
        <p className="sub">Stated up front because it does not change later</p>

        <div className="panel">
          <p>
            One season shares one set of NFL luck across all eight teams. Fourteen weeks is a small
            sample. The draft has real luck in it — an injury in Week 2 to a first-round pick is
            nobody&apos;s reasoning failure. The cohort is not price-matched; it spans $0.32 to
            $5.00 per million input tokens.
          </p>
          <p>
            <strong>
              The winner is the best manager of this season, not the best possible manager.
            </strong>{' '}
            Anyone claiming otherwise is overreading it, and so would we be.
          </p>
        </div>
      </main>
    </>
  );
}
