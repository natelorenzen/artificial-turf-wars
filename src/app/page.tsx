import Link from 'next/link';
import { COHORT } from '@/lib/config/league';
import { formatDate, getAllPosts } from '@/lib/blog/posts';
import { loadCurrentWeek, loadSeasonSnapshot } from '@/lib/site/results';

export const metadata = {
  title: 'Artificial Turf War — eight AI models, one fantasy season',
  alternates: { canonical: '/' },
};

/**
 * Standings are written every Tuesday and live scores several times a game day, so this
 * cannot be static. Fifteen minutes is comfortably inside the live refresh cadence —
 * Vercel Hobby fires a cron anywhere within its hour, so a shorter window here would
 * only re-render the same numbers.
 */
export const revalidate = 900;

export default async function Home() {
  // Findings are the only part of this site that changes before the season starts, so
  // the newest one gets a slot on the front page rather than living only in the nav.
  const [latest] = getAllPosts();
  const snapshot = await loadSeasonSnapshot();
  const current = await loadCurrentWeek();

  // Where the live week would leave the table. Null in week one — there is no prior
  // table to move within — and null the moment the week is scored for real, at which
  // point the table itself is the answer.
  const projected = current?.live?.projected ?? null;

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
              {current.scored
                ? ' · final'
                : current.live?.complete
                  ? ' · all games in'
                  : current.kickedOff
                    ? ' · under way'
                    : ' · lineups locked'}
            </h2>
            <p className="sub">
              {current.lineupsSet}/{COHORT.length} lineups set
              {current.carriedForward === 0
                ? ', every one the model\u2019s own decision'
                : `, ${current.carriedForward} of them decided by the fallback`}{' '}
              · first kickoff {kickoffET} ET
            </p>

            <div className="scroll narrow">
              <table>
                <thead>
                  <tr>
                    <th className="l">Home</th>
                    {current.live && <th>Pts</th>}
                    {current.live && <th>Pts</th>}
                    <th className="l">Away</th>
                  </tr>
                </thead>
                <tbody>
                  {current.fixtures.map((f) => {
                    // Only mark a leader once BOTH sides have a number. Ahead 40-0
                    // because the other team's players kick off tomorrow is not
                    // leading, and bolding it would say it was.
                    const both = f.home.livePoints !== null && f.away.livePoints !== null;
                    const homeAhead = both && f.home.livePoints! > f.away.livePoints!;
                    const awayAhead = both && f.away.livePoints! > f.home.livePoints!;
                    return (
                      <tr key={`${f.home.modelKey}-${f.away.modelKey}`}>
                        <td className="l tname">
                          <Link href={`/team/${f.home.modelKey}`}>{f.home.model}</Link>
                        </td>
                        {current.live && (
                          <td className={homeAhead ? 'ahead' : 'muted'}>
                            {f.home.livePoints === null ? '—' : f.home.livePoints.toFixed(1)}
                          </td>
                        )}
                        {current.live && (
                          <td className={awayAhead ? 'ahead' : 'muted'}>
                            {f.away.livePoints === null ? '—' : f.away.livePoints.toFixed(1)}
                          </td>
                        )}
                        <td className="l tname">
                          <Link href={`/team/${f.away.modelKey}`}>{f.away.model}</Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Said plainly, wherever these numbers appear. They are a courtesy to
                somebody watching on a Sunday afternoon, they are overwritten on every
                refresh, and no standing, record, FAAB balance or bracket seed is
                derived from them. */}
            {current.live && (
              <p className="sub" style={{ marginTop: 10 }}>
                Live · {current.live.startersPlayed}/{current.live.startersTotal} starters have
                played · updated{' '}
                {new Intl.DateTimeFormat('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                  timeZone: 'America/New_York',
                }).format(new Date(current.live.computedAt))}{' '}
                ET.{' '}
                {current.live.complete
                  ? 'Every game is in. These become official on Tuesday.'
                  : 'Unofficial and still moving — the week is scored on Tuesday.'}
              </p>
            )}

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
              {projected && ` · "if" is week ${current!.week} as it stands right now`}
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
                    {projected && <th>If</th>}
                  </tr>
                </thead>
                <tbody>
                  {snapshot.table.map((row) => {
                    const move = projected?.[row.modelKey] ?? null;
                    return (
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
                        {/* The live week folded in, ranked on the same basis the engine
                            uses so a projected move never has a cause the real table
                            would not have. Nothing here is stored. */}
                        {projected && (
                          <td className={move && move.delta > 0 ? 'pos' : move && move.delta < 0 ? 'neg' : 'muted'}>
                            {move === null
                              ? '—'
                              : move.delta === 0
                                ? `${move.rank}`
                                : `${move.rank} ${move.delta > 0 ? '▲' : '▼'}${Math.abs(move.delta)}`}
                          </td>
                        )}
                      </tr>
                    );
                  })}
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
