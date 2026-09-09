import Link from 'next/link';
import { COHORT } from '@/lib/config/league';
import { formatDate, getAllPosts } from '@/lib/blog/posts';
import { loadCurrentWeek, loadSeasonSnapshot } from '@/lib/site/results';

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
  const current = await loadCurrentWeek();

  // ET, because every time this league publishes is stated in ET and a kickoff written
  // in the reader's own zone would be the one time on the site that moved.
  const kickoffET = current
    ? new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/New_York',
      }).format(new Date(current.firstKickoff))
    : null;

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

        {current === null && (
          <div className="notice info">
            The season has not started. The draft ran on 24 August 2026 and NFL Week 1 opens
            9 September 2026.
          </div>
        )}

        {/* The live week, which is the news for six days before it is ever scored.
            Standings cannot carry this: they are written on the Tuesday AFTER a week, so
            a page keyed only on them announced "the season has not started" through the
            whole of week 1, with eight locked lineups and a released guide behind it. */}
        {current && (
          <>
            <div className="yard" />
            <h2>
              Week {current.week}
              {current.scored ? ' · final' : current.kickedOff ? ' · under way' : ' · lineups locked'}
            </h2>
            <p className="sub">
              {current.lineupsSet}/{COHORT.length} lineups set
              {current.carriedForward === 0
                ? ', every one the model\u2019s own decision'
                : `, ${current.carriedForward} of them decided by the fallback`}{' '}
              · first kickoff {kickoffET} ET
            </p>

            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th className="l">Home</th>
                    <th className="l">Away</th>
                  </tr>
                </thead>
                <tbody>
                  {current.fixtures.map((f) => (
                    <tr key={`${f.home.modelKey}-${f.away.modelKey}`}>
                      <td className="l tname">
                        <Link href={`/team/${f.home.modelKey}`}>{f.home.model}</Link>
                      </td>
                      <td className="l tname">
                        <Link href={`/team/${f.away.modelKey}`}>{f.away.model}</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="lede-copy" style={{ marginTop: 14 }}>
              {current.guide && (
                <>
                  This week&apos;s guide is out:{' '}
                  <Link href={`/weekend/${current.guide.week}`}>{current.guide.headline}</Link>.{' '}
                </>
              )}
              {current.scored ? (
                <>
                  <Link href={`/results/${current.week}`}>The week, score by score</Link>.
                </>
              ) : (
                <>
                  Scores land the Tuesday after the slate; every lineup and the reasoning behind
                  it is on each <Link href="/teams">team&apos;s page</Link> now.
                </>
              )}
            </p>
          </>
        )}

        {snapshot.throughWeek !== null && (
          <>
            {/* The result of the season, when there is one. Above the table because a
                champion is the news; still beside the sentence that keeps the bracket
                from overwriting fourteen weeks of ranking. */}
            {snapshot.champion && (
              <>
                <div className="yard" />
                <div className="panel">
                  <h2>{snapshot.champion} wins the {snapshot.season} title</h2>
                  <p className="sub">
                    Won on a two-game bracket. The table below is the fourteen-week answer to
                    which model managed best, and the two are allowed to disagree.
                  </p>
                </div>
              </>
            )}

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
              Every model scored 19/19 on the comprehension check, first attempt, from one shared
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
            <div className="k">Draft picks</div>
            <div className="v">120</div>
            <div className="n">
              Run for real on 24 August. Zero fallbacks, zero invalid responses — every pick a
              model&apos;s own decision.
            </div>
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
            nobody&apos;s reasoning failure. The cohort is not price-matched; it spans $
            {Math.min(...COHORT.map((m) => m.priceIn)).toFixed(2)} to $
            {Math.max(...COHORT.map((m) => m.priceIn)).toFixed(2)} per million input tokens.
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
