import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import type { Metadata } from 'next';
import { absoluteUrl } from '@/lib/site/nav';
import {
  loadMatchup,
  signed,
  type BenchPlayer,
  type BoxPlayer,
  type MatchupSide,
  type MatchupView,
} from '@/lib/site/matchup';

/** Live scores refresh several times a game day; the official ones on Tuesday and Thursday. */
export const revalidate = 900;
export const dynamicParams = true;

/** Nothing prebuilt: each game page is rendered on first request and cached as above. */
export async function generateStaticParams() {
  return [];
}

type Params = Promise<{ week: string; matchup: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { week, matchup } = await params;
  const view = await loadMatchup(Number(week), matchup);
  if (!view) return { title: 'Not found — Artificial Turf War' };

  const title = `${view.home.model} vs ${view.away.model}, week ${view.week} — Artificial Turf War`;
  const description = view.story[0] ?? `Week ${view.week} box score, slot by slot.`;
  return {
    title,
    description,
    alternates: { canonical: `/results/${view.week}/${view.slug}` },
    openGraph: { title, description, url: absoluteUrl(`/results/${view.week}/${view.slug}`), type: 'article' },
  };
}

const STATUS_LABEL: Record<MatchupView['status'], string> = {
  final: 'Final',
  provisional: 'Provisional · re-scored Thursday',
  live: 'Live · unofficial',
  upcoming: 'Lineups locked · not yet played',
};

const pts = (n: number | null) => (n === null ? '—' : n.toFixed(2));

export default async function MatchupPage({ params }: { params: Params }) {
  const { week, matchup } = await params;
  const weekNumber = Number(week);
  if (!Number.isInteger(weekNumber)) notFound();

  const view = await loadMatchup(weekNumber, matchup);
  if (!view) {
    // Nobody remembers which side was home. The same game, named the other way round,
    // goes to the one canonical page rather than a 404.
    const [a, b] = matchup.split('-vs-');
    if (a && b && (await loadMatchup(weekNumber, `${b}-vs-${a}`))) {
      permanentRedirect(`/results/${weekNumber}/${b}-vs-${a}`);
    }
    notFound();
  }

  const { home, away, status } = view;
  const scored = status === 'final' || status === 'provisional';
  const hasPoints = home.points !== null && away.points !== null;
  const homeWins = hasPoints && home.points! > away.points!;
  const awayWins = hasPoints && away.points! > home.points!;
  // The split bar under the score. Projections stand in before kickoff, so the bar is
  // never empty, and the label under it says which it is.
  const barHome = hasPoints ? home.points! : home.projected;
  const barAway = hasPoints ? away.points! : away.projected;
  const homeShare = barHome + barAway > 0 ? (barHome / (barHome + barAway)) * 100 : 50;

  return (
    <main className="wrap">
      <div className="yard" />
      <p className="crumb">
        {scored ? (
          <Link href={`/results/${view.week}`}>← Week {view.week} results</Link>
        ) : (
          <Link href="/">← This week</Link>
        )}
      </p>

      <section className="box-head" aria-label="Score">
        <div className="box-status">
          Week {view.week} · {STATUS_LABEL[status]}
          {view.computedAt &&
            ` · updated ${new Intl.DateTimeFormat('en-US', {
              weekday: 'short',
              hour: 'numeric',
              minute: '2-digit',
              timeZone: 'America/New_York',
            }).format(new Date(view.computedAt))} ET`}
        </div>
        <div className="box-score">
          <TeamHead side={home} align="l" won={homeWins && status !== 'live'} ahead={homeWins} />
          <div className="box-vs">{hasPoints ? '–' : 'vs'}</div>
          <TeamHead side={away} align="r" won={awayWins && status !== 'live'} ahead={awayWins} />
        </div>
        <div className="box-proj">
          <span>{home.projected.toFixed(2)}</span>
          <span className="muted">Projected at lock</span>
          <span>{away.projected.toFixed(2)}</span>
        </div>
        <div className="box-bar" aria-hidden>
          <span className="h" style={{ width: `${homeShare}%` }} />
          <span className="a" />
        </div>
      </section>

      {view.story.length > 0 && (
        <>
          <div className="yard" />
          <h2>{status === 'upcoming' ? 'The setup' : status === 'live' ? 'So far' : 'How it was decided'}</h2>
          <p className="sub">Computed from the box score below by the league&apos;s code — not written by a model</p>
          <div className="panel">
            <ul className="story">
              {view.story.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </>
      )}

      <div className="yard" />
      <h2>Starters</h2>
      <p className="sub">
        {scored
          ? 'Points, with the projection each lineup was set against underneath. The higher score in each slot is lit.'
          : status === 'live'
            ? 'Live points as of the last refresh, with projections underneath. Starters who have not played show —.'
            : 'Projected points for each starter. Scores fill in once games are played.'}
      </p>

      <div className="scroll narrow">
        <table className="box">
          <thead>
            <tr>
              <th className="l">{home.model}</th>
              <th>Pts</th>
              <th className="c">Pos</th>
              <th className="l">Pts</th>
              <th>{away.model}</th>
            </tr>
          </thead>
          <tbody>
            {home.starters.map((h, i) => {
              const a = away.starters[i];
              const hp = h.player?.points ?? null;
              const ap = a?.player?.points ?? null;
              const homeLit = hp !== null && ap !== null && hp > ap;
              const awayLit = hp !== null && ap !== null && ap > hp;
              return (
                <tr key={`${h.slot}-${i}`}>
                  <td className={`l box-player${homeLit ? ' lit-l' : ''}`}>
                    <PlayerCell player={h.player} />
                  </td>
                  <td className="box-pts">
                    <b className={homeLit ? 'win' : undefined}>{pts(hp)}</b>
                    <small>{h.player?.projected == null ? '' : h.player.projected.toFixed(1)}</small>
                  </td>
                  <td className="c box-slot">{h.slot}</td>
                  <td className="l box-pts">
                    <b className={awayLit ? 'win' : undefined}>{pts(ap)}</b>
                    <small>{a?.player?.projected == null ? '' : a.player.projected.toFixed(1)}</small>
                  </td>
                  <td className={`box-player${awayLit ? ' lit-r' : ''}`}>
                    <PlayerCell player={a?.player ?? null} right />
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="l">Total</td>
              <td className="box-pts">
                <b className={homeWins ? 'win' : undefined}>{pts(home.points)}</b>
              </td>
              <td />
              <td className="l box-pts">
                <b className={awayWins ? 'win' : undefined}>{pts(away.points)}</b>
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="yard" />
      <h2>Bench</h2>
      <p className="sub">
        {scored
          ? 'Who sat. A flagged player outscored a starter at a slot they could have filled.'
          : 'Who sat. Bench points are only scored on Tuesday.'}
      </p>
      <div className="grid2">
        <BenchTable side={home} scored={scored} />
        <BenchTable side={away} scored={scored} />
      </div>

      {(home.autopilot || away.autopilot) && (
        <>
          <div className="yard" />
          <h2>Lineup calls</h2>
          <p className="sub">
            Before any model is asked, the league&apos;s code sets a lineup from the projections alone — the
            autopilot. These are the places each model overruled it
            {scored ? ', and what that was worth.' : '.'}
          </p>
          <div className="grid2">
            {[home, away].map((side) => (
              <CallsCard key={side.modelKey} side={side} scored={scored} />
            ))}
          </div>
        </>
      )}

      <div className="yard" />
      <h2>What they said when they set it</h2>
      <p className="sub">Each model&apos;s own words at lineup lock, before a ball was kicked</p>
      <div className="grid2">
        {[home, away].map((side) => (
          <div className="telestrator" key={side.modelKey}>
            <div className="tel-hd">
              <b>{side.model}</b>
              {side.lineup.confidence !== null && (
                <span>Confidence {(side.lineup.confidence * 100).toFixed(0)}%</span>
              )}
              {side.lineup.fallback && <span className="tag">fallback</span>}
            </div>
            {side.lineup.fallback && (
              <p>
                This lineup was set by the league&apos;s deterministic code, not by the model — its
                answer was missing or unusable.
              </p>
            )}
            {side.lineup.headline && <p className="lede">{side.lineup.headline}</p>}
            {side.lineup.closestCall && (
              <p>
                <strong>Closest call:</strong> {side.lineup.closestCall}
              </p>
            )}
            <div className="tel-ft">
              {side.lineup.decisionId && (
                <Link href={`/decisions/${side.lineup.decisionId}`}>Full prompt and response →</Link>
              )}
              <Link href={`/team/${side.modelKey}`}>Team page →</Link>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}

function TeamHead({
  side,
  align,
  won,
  ahead,
}: {
  side: MatchupSide;
  align: 'l' | 'r';
  won: boolean;
  ahead: boolean;
}) {
  return (
    <div className={`box-team ${align}`}>
      <Link href={`/team/${side.modelKey}`} className="box-name">
        {side.model}
      </Link>
      <div className="box-meta">
        {side.record && <span>{side.record}</span>}
        {side.rank !== null && <span>#{side.rank}</span>}
        {won && <span className="box-w">W</span>}
      </div>
      <div className={`box-big${ahead ? ' ahead' : ''}${won ? ' won' : ''}`}>
        {side.points === null ? '0.00' : side.points.toFixed(2)}
      </div>
    </div>
  );
}

function PlayerCell({ player, right }: { player: BoxPlayer | null; right?: boolean }) {
  if (!player) return <span className="neg">Empty slot</span>;
  const meta = [player.nflTeam && player.position !== 'DEF' ? player.nflTeam : null, player.position, player.opponent]
    .filter(Boolean)
    .join(' · ');
  return (
    <span className={right ? 'pc r' : 'pc'}>
      <span className="pc-name">{player.name}</span>
      <span className="pc-meta">{meta}</span>
    </span>
  );
}

function CallsCard({ side, scored }: { side: MatchupSide; scored: boolean }) {
  const auto = side.autopilot;
  return (
    <div className="scroll narrow calls">
      <table>
        <thead>
          <tr>
            <th className="l">{side.model}</th>
            <th>{scored ? 'Worth' : 'Proj'}</th>
          </tr>
        </thead>
        <tbody>
          {!auto && (
            <tr>
              <td className="l muted" colSpan={2}>
                No stored prompt to replay the autopilot from.
              </td>
            </tr>
          )}
          {auto && auto.swaps.length === 0 && (
            <tr>
              <td className="l muted" colSpan={2}>
                Started exactly the autopilot&apos;s nine{side.lineup.fallback ? ' — this lineup was the autopilot.' : '.'}
              </td>
            </tr>
          )}
          {auto?.swaps.map((swap, i) => (
            <tr key={i}>
              <td className="l call-cell">
                {swap.started && (
                  <span className="call-in">
                    Started <b>{swap.started.name}</b>
                    <small>
                      {swap.started.position} · proj {swap.started.projected?.toFixed(1) ?? '—'}
                      {scored && ` · scored ${pts(swap.started.points)}`}
                    </small>
                  </span>
                )}
                {swap.benched && (
                  <span className="call-out">
                    {swap.started ? 'over' : 'Benched'} <b>{swap.benched.name}</b>
                    <small>
                      {swap.benched.position} · proj {swap.benched.projected?.toFixed(1) ?? '—'}
                      {scored && ` · scored ${pts(swap.benched.points)}`}
                    </small>
                  </span>
                )}
              </td>
              <td className={deltaClass(scored ? swap.delta : null)}>
                {scored
                  ? swap.delta === null
                    ? '—'
                    : signed(swap.delta)
                  : signed(round1((swap.started?.projected ?? 0) - (swap.benched?.projected ?? 0)))}
              </td>
            </tr>
          ))}
        </tbody>
        {auto && scored && auto.delta !== null && (
          <tfoot>
            <tr>
              <td className="l">
                vs autopilot
                <small className="muted calls-foot">
                  autopilot scored {pts(auto.points)}
                  {side.optimal !== null && side.points !== null &&
                    ` · ${(side.optimal - side.points).toFixed(2)} left on bench in hindsight`}
                </small>
              </td>
              <td className={deltaClass(auto.delta)}>
                <b>{signed(auto.delta)}</b>
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

const round1 = (n: number) => Math.round(n * 100) / 100;
const deltaClass = (n: number | null) => (n === null || n === 0 ? 'muted' : n > 0 ? 'pos' : 'neg');

function BenchTable({ side, scored }: { side: MatchupSide; scored: boolean }) {
  return (
    <div className="scroll narrow">
      <table className="bench">
        <thead>
          <tr>
            <th className="l">{side.model}</th>
            <th>Proj</th>
            <th>Pts</th>
          </tr>
        </thead>
        <tbody>
          {side.bench.length === 0 && (
            <tr>
              <td className="l muted" colSpan={3}>
                No bench recorded
              </td>
            </tr>
          )}
          {side.bench.map((p: BenchPlayer) => (
            <tr key={p.playerId} className={p.outscored ? 'miss' : undefined}>
              <td className="l box-player">
                <PlayerCell player={p} />
                {p.outscored && (
                  <span className="miss-note">
                    Outscored {p.outscored.name} ({p.outscored.slot}, {p.outscored.points.toFixed(2)})
                  </span>
                )}
              </td>
              <td className="muted">{p.projected === null ? '—' : p.projected.toFixed(1)}</td>
              <td>{scored ? pts(p.points) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
