import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { absoluteUrl } from '@/lib/site/nav';
import { loadWaiverRun, waiverWeeks, type WaiverBidView } from '@/lib/site/waivers';

/** Bids land Tuesday, resolve Wednesday; points for the claims arrive every Tuesday after. */
export const revalidate = 900;
export const dynamicParams = true;

export async function generateStaticParams() {
  return [];
}

type Params = Promise<{ week: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { week } = await params;
  const run = await loadWaiverRun(Number(week));
  if (!run) return { title: 'Not found — Artificial Turf War' };
  const title = `Waivers after week ${run.week} — Artificial Turf War`;
  const description = run.sealed
    ? `The bids after week ${run.week} are sealed until Wednesday noon ET.`
    : (run.brief[0] ?? `Every sealed bid after week ${run.week}, and why each model made it.`);
  return {
    title,
    description,
    alternates: { canonical: `/waivers/${run.week}` },
    openGraph: { title, description, url: absoluteUrl(`/waivers/${run.week}`), type: 'article' },
  };
}

const REASON: Record<string, string> = {
  outbid: 'outbid',
  tiebreak: 'lost the tiebreak',
  insufficient_budget: 'not enough budget',
  player_already_claimed: 'already claimed',
  invalid_drop: 'drop no longer on roster',
  duplicate_add: 'duplicate claim',
};

export default async function WaiverRunPage({ params }: { params: Params }) {
  const { week } = await params;
  const weekNumber = Number(week);
  if (!Number.isInteger(weekNumber)) notFound();

  const run = await loadWaiverRun(weekNumber);
  if (!run) notFound();

  const weeks = (await waiverWeeks()).map((w) => w.week);
  const prev = weeks.includes(run.week - 1) ? run.week - 1 : null;
  const next = weeks.includes(run.week + 1) ? run.week + 1 : null;

  return (
    <main className="wrap">
      <div className="yard" />
      <h1>Waivers after week {run.week}</h1>
      <p className="sub">
        Sealed bids placed Tuesday, resolved Wednesday by code · players join for week {run.week + 1}
      </p>

      <nav className="week-pager" aria-label="Waiver runs">
        {prev ? <Link href={`/waivers/${prev}`}>← After week {prev}</Link> : <span />}
        <Link href="/waivers">All runs</Link>
        {next ? <Link href={`/waivers/${next}`}>After week {next} →</Link> : <span />}
      </nav>

      {run.sealed ? (
        <div className="notice info">
          The bids are in and sealed. They are resolved on Wednesday at 12:00 ET, and every bid —
          winners, losers and each model&apos;s reasoning — appears here once they are.
        </div>
      ) : (
        <>
          <div className="panel brief">
            <h3>The run in brief</h3>
            <ul className="story">
              {run.brief.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="sub" style={{ margin: '12px 0 0' }}>
              Highest bid wins. Ties go to the team higher on the rolling waiver list, which then
              drops to the bottom. Losing bids are published too — they show a valuation as clearly
              as a winning one.
            </p>
          </div>

          {run.contests.length > 0 && (
            <>
              <div className="yard" />
              <h2>Player by player</h2>
              <p className="sub">Every player claimed, and every team that bid</p>
              <div className="grid2">
                {run.contests.map((contest) => (
                  <div className="scroll narrow" key={contest.player.id}>
                    <table className="bench">
                      <thead>
                        <tr>
                          <th className="l">
                            {contest.player.name}
                            <span className="th-meta">
                              {[contest.player.nflTeam && contest.player.position !== 'DEF' ? contest.player.nflTeam : null, contest.player.position]
                                .filter(Boolean)
                                .join(' · ')}
                              {contest.bids.length > 1 ? ` · ${contest.bids.length} bids` : ''}
                            </span>
                          </th>
                          <th>Bid</th>
                        </tr>
                      </thead>
                      <tbody>
                        {contest.bids.map((bid) => (
                          <tr key={bid.modelKey} className={bid.won ? 'won-row' : undefined}>
                            <td className="l call-cell">
                              <b className="bid-team">{bid.model}</b>
                              <small className="bid-meta">
                                {bid.won ? 'won' : (REASON[bid.losingReason ?? ''] ?? bid.losingReason)} · would
                                drop {bid.drop.name}
                              </small>
                            </td>
                            <td className={bid.won ? 'bid-won' : 'muted'}>${bid.bid}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </>
          )}

          {run.returns.length > 0 && (
            <>
              <div className="yard" />
              <h2>What the claims bought</h2>
              <p className="sub">
                {run.returns[0].weeksScored === 0
                  ? `Points fill in once week ${run.week + 1} is scored.`
                  : `Points since joining, through ${run.returns[0].weeksScored} scored week${run.returns[0].weeksScored === 1 ? '' : 's'}, beside the player each claim let go — wherever that player went.`}
              </p>
              <div className="scroll">
                <table>
                  <thead>
                    <tr>
                      <th className="l">Team</th>
                      <th className="l">Added</th>
                      <th>Pts</th>
                      <th className="l">Dropped</th>
                      <th>Pts</th>
                      <th>Paid</th>
                      <th>Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.returns.map((r) => {
                      const net =
                        r.addedPoints === null || r.droppedPoints === null ? null : r.addedPoints - r.droppedPoints;
                      return (
                        <tr key={`${r.modelKey}-${r.added}`}>
                          <td className="l tname">
                            <Link href={`/team/${r.modelKey}`}>{r.model}</Link>
                          </td>
                          <td className="l">{r.added}</td>
                          <td>{r.addedPoints?.toFixed(2) ?? '—'}</td>
                          <td className="l muted">{r.dropped}</td>
                          <td className="muted">{r.droppedPoints?.toFixed(2) ?? '—'}</td>
                          <td className="muted">${r.paid}</td>
                          <td className={net === null || net === 0 ? 'muted' : net > 0 ? 'pos' : 'neg'}>
                            {net === null ? '—' : `${net > 0 ? '+' : net < 0 ? '−' : ''}${Math.abs(net).toFixed(2)}`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <div className="yard" />
          <h2>Team by team</h2>
          <p className="sub">What each model said, what it bid, and what it had left</p>
          <div className="stack">
            {run.teams.map((team) => (
              <div className="telestrator" key={team.modelKey}>
                <div className="tel-hd">
                  <b>{team.model}</b>
                  {team.faabBefore !== null && (
                    <span>
                      FAAB ${team.faabBefore}
                      {team.faabAfter !== team.faabBefore ? ` → $${team.faabAfter}` : ''}
                    </span>
                  )}
                  {team.confidence !== null && <span>Confidence {(team.confidence * 100).toFixed(0)}%</span>}
                  {team.fallback && <span className="tag">no model decision</span>}
                </div>
                {team.headline && <p className="lede">{team.headline}</p>}
                {team.bids.length === 0 ? (
                  <p>Stood pat — no claims.</p>
                ) : (
                  <ul className="claims">
                    {team.bids.map((bid: WaiverBidView) => (
                      <li key={bid.add.id}>
                        <span className={bid.won ? 'claim-won' : 'claim-lost'}>
                          {bid.won ? 'WON' : 'LOST'}
                        </span>{' '}
                        <strong>
                          ${bid.bid} on {bid.add.name}
                        </strong>
                        , dropping {bid.drop.name}
                        {!bid.won && bid.losingReason ? ` — ${REASON[bid.losingReason] ?? bid.losingReason}` : ''}
                        {bid.reasoning && <span className="claim-why">{bid.reasoning}</span>}
                      </li>
                    ))}
                  </ul>
                )}
                {team.closestCall && (
                  <p>
                    <strong>Closest call:</strong> {team.closestCall}
                  </p>
                )}
                <div className="tel-ft">
                  {team.decisionId && (
                    <Link href={`/decisions/${team.decisionId}`}>Full prompt and response →</Link>
                  )}
                  <Link href={`/team/${team.modelKey}`}>Team page →</Link>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
