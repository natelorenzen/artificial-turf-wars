import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { formatPrice } from '@/lib/picks/odds';
import { loadVideoBrief, type Labeled, type Quote } from '@/lib/site/video-brief';

/**
 * The video brief, readable. The same document as /data/week/N/video.json, rendered
 * field for field, so a presenter reading this page and a script reading the JSON are
 * reading one thing. Every number shows the status it was read at.
 */
export const revalidate = 900;
export const dynamicParams = true;

export async function generateStaticParams() {
  return [];
}

type Params = Promise<{ week: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { week } = await params;
  return {
    title: `Week ${week} brief — Artificial Turf War`,
    description: `The week ${week} brief: matchups and stakes, every model's picks and biggest bet, and last week in numbers. Built at 11:00 AM Pacific on Thursday.`,
    alternates: { canonical: `/week/${week}/brief` },
  };
}

function N<T extends number | string>({ v, fmt }: { v: Labeled<T> | null; fmt?: (x: T) => string }) {
  if (!v) return <>—</>;
  return (
    <>
      {fmt ? fmt(v.value) : String(v.value)} <span className="muted">({v.status})</span>
    </>
  );
}

function Q({ q }: { q: Quote | null }) {
  if (!q) return <span className="muted">—</span>;
  if (q.text === null) {
    return (
      <span className="muted">
        {q.words} words, too long to quote whole — <a href={q.source}>read it in full</a>
      </span>
    );
  }
  return <>&ldquo;{q.text}&rdquo;</>;
}

const pts = (n: number) => n.toFixed(2);
const pct = (n: number) => `${n.toFixed(1)}%`;
const dollars = (n: number) => `$${n}`;
const signedPts = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)} pts`;

export default async function BriefPage({ params }: { params: Params }) {
  const { week } = await params;
  const weekNumber = Number(week);
  if (!Number.isInteger(weekNumber) || weekNumber < 1) notFound();

  const result = await loadVideoBrief(weekNumber);
  if (!result.ok) {
    if (result.status === 404) notFound();
    return (
      <main className="wrap">
        <div className="yard" />
        <h1>Week {weekNumber} brief</h1>
        <div className="notice info">
          Not built yet: {result.reason}.
          {result.availableAt && (
            <>
              {' '}
              Available from{' '}
              {new Intl.DateTimeFormat('en-US', {
                weekday: 'long',
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                timeZone: 'America/Los_Angeles',
                timeZoneName: 'short',
              }).format(new Date(result.availableAt))}
              .
            </>
          )}
        </div>
      </main>
    );
  }

  const b = result.brief;

  return (
    <main className="wrap">
      <div className="yard" />
      <h1>Week {b.week} brief</h1>
      <p className="sub">
        As of {b.asOfLabel} · every number labelled live, provisional or final ·{' '}
        <a href={`/data/week/${b.week}/video.json`}>JSON</a>
      </p>

      <div className="yard" />
      <h2>Matchups</h2>
      <p className="sub">Record and rank through last week · stakes by record alone, against today&apos;s playoff line</p>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th className="l">Team</th>
              <th>Record</th>
              <th>Rank</th>
              <th className="l">If win</th>
              <th className="l">If loss</th>
            </tr>
          </thead>
          <tbody>
            {b.matchups.flatMap((m) =>
              [m.home, m.away].map((t, i) => (
                <tr key={t.modelKey}>
                  <td className="l tname">
                    {i === 1 && <span className="muted">v </span>}
                    <Link href={m.url.replace(/^https?:\/\/[^/]+/, '')}>{t.model}</Link>
                  </td>
                  <td>
                    <N v={t.record} />
                  </td>
                  <td>
                    <N v={t.rank} />
                  </td>
                  <td className="l muted">{t.stakes ? `${t.stakes.ifWin.record}, ${t.stakes.ifWin.versusLine} the line` : '—'}</td>
                  <td className="l muted">{t.stakes ? `${t.stakes.ifLoss.record}, ${t.stakes.ifLoss.versusLine} the line` : '—'}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>

      <div className="yard" />
      <h2>Picks</h2>
      <p className="sub">Each model&apos;s headline, verbatim · three most confident picks · biggest bet · bankroll</p>
      <div className="post-list">
        {b.picks.map((p) => (
          <article className="post-card" key={p.modelKey}>
            <h2>{p.model}</h2>
            <p>
              <Q q={p.headline} />
            </p>
            <p className="muted">
              {p.topPicks.map((t, i) => (
                <span key={t.game}>
                  {i > 0 && ' · '}
                  {t.team} ({t.game}) <N v={t.winPct} fmt={pct} />
                </span>
              ))}
            </p>
            <p className="muted">
              Biggest bet:{' '}
              {p.biggestBet ? (
                <>
                  {p.biggestBet.team} <N v={p.biggestBet.odds} fmt={formatPrice} />, stake{' '}
                  <N v={p.biggestBet.stake} fmt={dollars} />
                </>
              ) : (
                'none'
              )}
              {p.bankroll && (
                <>
                  {' '}
                  · bankroll <N v={p.bankroll.balance} fmt={(n) => `$${n.toFixed(2)}`} />, at risk{' '}
                  <N v={p.bankroll.atRiskThisWeek} fmt={dollars} />
                </>
              )}
            </p>
          </article>
        ))}
      </div>

      <div className="yard" />
      <h2>Bet and upset of the week</h2>
      <p className="sub">Chosen by rule, not by us: {b.rules.betOfTheWeek}; {b.rules.upsetOfTheWeek}</p>
      <div className="panel">
        <p>
          <strong>Bet of the week:</strong>{' '}
          {b.betOfTheWeek ? (
            <>
              {b.betOfTheWeek.model} — {b.betOfTheWeek.team} <N v={b.betOfTheWeek.odds} fmt={formatPrice} />, stake{' '}
              <N v={b.betOfTheWeek.stake} fmt={dollars} />
            </>
          ) : (
            'no bets this week'
          )}
        </p>
        <p>
          <strong>Upset of the week:</strong>{' '}
          {b.upsetOfTheWeek ? (
            <>
              {b.upsetOfTheWeek.model} — {b.upsetOfTheWeek.team} ({b.upsetOfTheWeek.game}), model{' '}
              <N v={b.upsetOfTheWeek.modelPct} fmt={pct} />, market <N v={b.upsetOfTheWeek.marketPct} fmt={pct} />, edge{' '}
              <N v={b.upsetOfTheWeek.edgePts} fmt={signedPts} />
            </>
          ) : (
            'no pick claimed a positive edge'
          )}
        </p>
      </div>

      <div className="yard" />
      <h2>Against the grain</h2>
      {b.againstTheGrain.length === 0 ? (
        <p className="sub">No model broke from the panel this week.</p>
      ) : (
        <ul className="claims">
          {b.againstTheGrain.map((d) => (
            <li key={`${d.game}|${d.modelKey}`}>
              <strong>{d.model}</strong> — {d.team} ({d.game}), {d.panel} · model <N v={d.modelPct} fmt={pct} /> · market{' '}
              <N v={d.marketPct} fmt={pct} /> · edge <N v={d.edgePts} fmt={signedPts} />
            </li>
          ))}
        </ul>
      )}

      <div className="yard" />
      <h2>Say this</h2>
      <ul className="claims">
        {b.sayThis.map((s) => (
          <li key={s.game}>
            <strong>{s.game}</strong> — <Q q={s.line} />
          </li>
        ))}
      </ul>

      {b.lastWeek && (
        <>
          <div className="yard" />
          <h2>Last week</h2>
          <p className="sub">
            Week {b.lastWeek.week} · {b.lastWeek.status}
          </p>
          <ul className="claims">
            <li>
              High score: {b.lastWeek.highScore.model}, <N v={b.lastWeek.highScore.points} fmt={pts} />. Low:{' '}
              {b.lastWeek.lowScore.model}, <N v={b.lastWeek.lowScore.points} fmt={pts} />.
            </li>
            {b.lastWeek.biggestWin && (
              <li>
                Biggest win: {b.lastWeek.biggestWin.winner} over {b.lastWeek.biggestWin.loser} by{' '}
                <N v={b.lastWeek.biggestWin.margin} fmt={pts} />.
              </li>
            )}
            <li>
              Closest game: {b.lastWeek.closestGame.winner} over {b.lastWeek.closestGame.loser} by{' '}
              <N v={b.lastWeek.closestGame.margin} fmt={pts} />.
            </li>
            {b.lastWeek.bestLineupCalls && (
              <li>
                Best lineup calls: {b.lastWeek.bestLineupCalls.model}, <N v={b.lastWeek.bestLineupCalls.vsAutopilot} fmt={pts} /> over the autopilot.
              </li>
            )}
            {b.lastWeek.worstLineupCalls && (
              <li>
                Worst lineup calls: {b.lastWeek.worstLineupCalls.model}, <N v={b.lastWeek.worstLineupCalls.vsAutopilot} fmt={pts} /> against the autopilot.
              </li>
            )}
            {b.lastWeek.mostLeftOnBench && (
              <li>
                Most left on the bench: {b.lastWeek.mostLeftOnBench.model}, <N v={b.lastWeek.mostLeftOnBench.points} fmt={pts} />.
              </li>
            )}
            {b.lastWeek.playerOfTheWeek && (
              <li>
                Player of the week: {b.lastWeek.playerOfTheWeek.name} ({b.lastWeek.playerOfTheWeek.position}),{' '}
                <N v={b.lastWeek.playerOfTheWeek.points} fmt={pts} /> for {b.lastWeek.playerOfTheWeek.model}.
              </li>
            )}
          </ul>
        </>
      )}

      {b.waivers && (
        <>
          <div className="yard" />
          <h2>Waivers</h2>
          <p className="sub">The run after week {b.waivers.run} · budgets after it resolved</p>
          <ul className="claims">
            {b.waivers.winningClaims.length === 0 ? (
              <li>No winning claims.</li>
            ) : (
              b.waivers.winningClaims.map((c) => (
                <li key={`${c.model}|${c.added}`}>
                  {c.model} added {c.added} ({c.position}) for <N v={c.bid} fmt={dollars} />, dropping {c.dropped}.
                </li>
              ))
            )}
          </ul>
          <p className="muted">
            {b.waivers.budgets.map((t, i) => (
              <span key={t.modelKey}>
                {i > 0 && ' · '}
                {t.model} <N v={t.faab} fmt={dollars} />
              </span>
            ))}
          </p>
        </>
      )}

      <div className="yard" />
      <p className="lede-copy">{b.disclaimer}</p>
    </main>
  );
}
