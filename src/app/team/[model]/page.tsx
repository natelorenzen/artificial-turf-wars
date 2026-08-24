import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { loadTeamProfile, modelByKey, type TeamSeason } from '@/lib/site/team';
import { COHORT, LEAGUE } from '@/lib/config/league';

export const revalidate = 900;

export function generateStaticParams() {
  return COHORT.map((m) => ({ model: m.key }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ model: string }>;
}): Promise<Metadata> {
  const { model } = await params;
  const found = modelByKey(model);
  if (!found) return { title: 'Team not found — Artificial Turf War' };
  return {
    title: `${found.displayName} — Artificial Turf War`,
    alternates: { canonical: `/team/${found.key}` },
    description: `Every decision ${found.displayName} has made in this league, with the reasoning it gave at the time.`,
  };
}

export default async function TeamPage({ params }: { params: Promise<{ model: string }> }) {
  const { model } = await params;
  const profile = await loadTeamProfile(supabase, model);
  if (!profile) notFound();

  const live = profile.seasons.find((s) => s.season === LEAGUE.season);
  const rehearsal = profile.seasons.find((s) => s.season !== LEAGUE.season && s.picks.length > 0);

  return (
    <main className="wrap">
      <div className="yard" />
      <h1>{profile.displayName}</h1>
      <p className="sub">
        {profile.lab} · {profile.openrouterId}
      </p>

      <div className="tiles">
        <div className="tile">
          <div className="k">Context window</div>
          <div className="v">{Math.round(profile.contextWindow / 1000)}k</div>
          <div className="n">
            {profile.contextWindow === Math.min(...COHORT.map((m) => m.contextWindow))
              ? 'The smallest in the cohort — every prompt is capped below it so nobody truncates first'
              : 'Prompts are capped below the smallest window in the cohort'}
          </div>
        </div>
        <div className="tile">
          <div className="k">Price in</div>
          <div className="v">${profile.priceIn.toFixed(2)}</div>
          <div className="n">Per million input tokens. The cohort is not price-matched.</div>
        </div>
        <div className="tile">
          <div className="k">Price out</div>
          <div className="v">{profile.priceOut === null ? '—' : `$${profile.priceOut.toFixed(2)}`}</div>
          <div className="n">Per million output tokens</div>
        </div>
      </div>

      {live && <LiveSeason season={live} />}
      {rehearsal && <Rehearsal season={rehearsal} name={profile.displayName} />}

      {!live && !rehearsal && (
        <div className="notice" style={{ marginTop: 22 }}>
          This model has no team recorded yet.
        </div>
      )}
    </main>
  );
}

function LiveSeason({ season }: { season: TeamSeason }) {
  const rows: [string, boolean, string][] = [
    [
      'Comprehension gate',
      Boolean(season.rulesCheck?.passed),
      season.rulesCheck
        ? `${season.rulesCheck.score}/${season.rulesCheck.maxScore} on attempt ${season.rulesCheck.attempts}`
        : 'not yet sat',
    ],
    ['Gameplan filed', Boolean(season.gameplan), season.gameplan ? 'published' : 'not yet written'],
    [
      'Auction bid',
      season.auctionBid !== null,
      season.auctionBid !== null ? `$${season.auctionBid} for slot ${season.draftSlot}` : 'not yet run',
    ],
    [
      'Roster drafted',
      season.roster.length > 0,
      season.roster.length > 0 ? `${season.roster.length} players` : 'draft has not run',
    ],
  ];

  return (
    <>
      <div className="yard" />
      <h2>{season.season} season</h2>
      <p className="sub">The one that counts</p>

      <div className="scroll compact">
        <table>
          <thead>
            <tr>
              <th className="l">Step</th>
              <th className="l">Detail</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, done, detail]) => (
              <tr key={label}>
                <td className="l tname">{label}</td>
                <td className="l muted wrap-cell">{detail}</td>
                <td>
                  <span className={`pill ${done ? 'up' : 'fl'}`}>{done ? 'done' : 'pending'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {season.picks.length > 0 && (
        <div className="tiles" style={{ marginTop: 16 }}>
          <div className="tile">
            <div className="k">Drafted</div>
            <div className="v">{season.roster.length}</div>
            <div className="n">
              Every pick below is this model&rsquo;s own choice — none was made by fallback code.
            </div>
          </div>
          <div className="tile">
            <div className="k">Decisions logged</div>
            <div className="v">{season.decisions.count}</div>
            <div className="n">
              ${season.decisions.costUsd} total
              {season.decisions.meanConfidence !== null && (
                <> · mean stated confidence {season.decisions.meanConfidence}</>
              )}
            </div>
          </div>
          <div className="tile">
            <div className="k">Claims flagged</div>
            <div className="v">{season.decisions.flagged}</div>
            <div className="n">
              Decisions with a stated reason our checker could not tie to the data or the rulebook
            </div>
          </div>
        </div>
      )}

      {season.auctionHeadline && (
        <div className="telestrator" style={{ marginTop: 16 }}>
          <div className="tel-hd">
            <b>On the auction</b>
            <span>
              bid ${season.auctionBid} · took slot {season.draftSlot}
            </span>
            {season.auctionDecisionId && (
              <span>
                <Link className="record-link" href={`/decisions/${season.auctionDecisionId}`}>
                  full record
                </Link>
              </span>
            )}
          </div>
          <p className="lede">&ldquo;{season.auctionHeadline}&rdquo;</p>
        </div>
      )}

      {season.roster.length > 0 && (
        <>
          <h3 style={{ marginTop: 26 }}>The roster it drafted</h3>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th className="l">Rd</th>
                  <th className="l">Player</th>
                  <th>Pos</th>
                  <th>Pick</th>
                  <th>Projected</th>
                </tr>
              </thead>
              <tbody>
                {season.roster.map((p) => (
                  <tr key={p.playerId}>
                    <td className="l rank">{p.round ?? '—'}</td>
                    <td className="l tname">{p.name}</td>
                    <td className="muted">{p.position}</td>
                    <td className="muted">{p.pickOverall ?? '—'}</td>
                    <td className="muted">{p.projSeasonPoints?.toFixed(1) ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="lede-copy" style={{ marginTop: 12 }}>
            Projected is this league&rsquo;s own season projection under its own scoring rules. No
            actual points yet — the season has not kicked off.
          </p>
        </>
      )}

      {season.picks.length > 0 && (
        <>
          <h3 style={{ marginTop: 26 }}>Every pick, and why</h3>
          <div className="quotes">
            {season.picks.map((pick) => (
              <div className="quote" key={pick.pickOverall}>
                <div className="who">
                  {pick.player}
                  <small>
                    R{pick.round} · #{pick.pickOverall} · {pick.position}
                    {pick.confidence !== null && ` · conf ${pick.confidence.toFixed(2)}`}
                    {pick.decisionId && (
                      <Link className="record-link" href={`/decisions/${pick.decisionId}`}>
                        full record
                      </Link>
                    )}
                  </small>
                </div>
                <div className="said">
                  {pick.fallbackApplied && <span className="tag">fallback</span>}
                  {pick.poolNarrowed && <span className="tag">pool narrowed</span>}
                  {pick.headline ?? <span className="muted">no reason recorded</span>}
                  {pick.closestCall && (
                    <div style={{ marginTop: 6, color: 'var(--chalk-dim)', fontSize: 14 }}>
                      <em>Closest call:</em> {pick.closestCall}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/*
        Waivers and lineups land here as the season runs. They are the same shape as the
        picks above — a decision with a headline, a confidence and a full record — so they
        slot in as further sections rather than as a redesign.
      */}

      {season.gameplan && (
        <div className="telestrator" style={{ marginTop: 16 }}>
          <div className="tel-hd">
            <b>Gameplan</b>
            <span>written in August, checked against behaviour all season</span>
          </div>
          <p>
            <strong>Positional strategy.</strong> {season.gameplan.positionalStrategy}
          </p>
          <p>
            <strong>Auction stance.</strong> {season.gameplan.auctionStance}
          </p>
          <p>
            <strong>Scarcity read.</strong> {season.gameplan.scarcityRead}
          </p>
          <p>
            <strong>Risk posture.</strong> {season.gameplan.riskPosture}
          </p>
          <p>
            <strong>Waiver philosophy.</strong> {season.gameplan.waiverPhilosophy}
          </p>
        </div>
      )}
    </>
  );
}

function Rehearsal({ season, name }: { season: TeamSeason; name: string }) {
  const drafted = season.roster.filter((r) => r.pickOverall !== null);
  const totalActual = drafted.reduce((s, r) => s + (r.actualPoints ?? 0), 0);

  return (
    <>
      <div className="yard" />
      <h2>{season.season} rehearsal</h2>
      <p className="sub">
        From the <Link href="/backtest">backtest</Link> — a completed season, run to shake the
        engine out
      </p>

      <p className="lede-copy">
        This is not the real league. It is the rehearsal run against a season whose results were
        already known, and it happened <strong>before the briefing existed</strong> — so {name} was
        drafting from raw projections with no view of replacement level.
      </p>

      <div className="tiles">
        <div className="tile">
          <div className="k">Draft slot</div>
          <div className="v">{season.draftSlot ?? '—'}</div>
          <div className="n">
            Won at auction for ${season.auctionBid ?? 0}, leaving ${season.faabRemaining ?? 0} of
            waiver budget
          </div>
        </div>
        <div className="tile">
          <div className="k">Roster points</div>
          <div className="v">{totalActual.toFixed(0)}</div>
          <div className="n">
            What the fifteen drafted players actually scored across the full season
          </div>
        </div>
        <div className="tile">
          <div className="k">Decisions logged</div>
          <div className="v">{season.decisions.count}</div>
          <div className="n">
            ${season.decisions.costUsd} total
            {season.decisions.meanConfidence !== null && (
              <> · mean stated confidence {season.decisions.meanConfidence}</>
            )}
          </div>
        </div>
        <div className="tile">
          <div className="k">Claims flagged</div>
          <div className="v">{season.decisions.flagged}</div>
          <div className="n">
            Decisions with a stated reason our checker could not tie to the data or the rulebook
          </div>
        </div>
      </div>

      {season.auctionHeadline && (
        <div className="telestrator" style={{ marginTop: 16 }}>
          <div className="tel-hd">
            <b>On the auction</b>
            <span>
              bid ${season.auctionBid} · took slot {season.draftSlot}
            </span>
            {season.auctionDecisionId && (
              <span>
                <Link className="record-link" href={`/decisions/${season.auctionDecisionId}`}>
                  full record
                </Link>
              </span>
            )}
          </div>
          <p className="lede">&ldquo;{season.auctionHeadline}&rdquo;</p>
        </div>
      )}

      {season.roster.length > 0 && (
        <>
          <h3 style={{ marginTop: 26 }}>The roster it built</h3>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th className="l">Rd</th>
                  <th className="l">Player</th>
                  <th>Pos</th>
                  <th>Pick</th>
                  <th>Projected</th>
                  <th>Actual</th>
                  <th>Diff</th>
                </tr>
              </thead>
              <tbody>
                {season.roster.map((p) => {
                  const diff =
                    p.actualPoints !== null && p.projSeasonPoints !== null
                      ? p.actualPoints - p.projSeasonPoints
                      : null;
                  return (
                    <tr key={p.playerId}>
                      <td className="l rank">{p.round ?? '—'}</td>
                      <td className="l tname">{p.name}</td>
                      <td className="muted">{p.position}</td>
                      <td className="muted">{p.pickOverall ?? '—'}</td>
                      <td className="muted">{p.projSeasonPoints?.toFixed(1) ?? '—'}</td>
                      <td>{p.actualPoints?.toFixed(1) ?? '—'}</td>
                      <td className={diff === null ? 'muted' : diff >= 0 ? 'pos' : 'neg'}>
                        {diff === null ? '—' : `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="lede-copy" style={{ marginTop: 12 }}>
            Projected is the season projection this league computed under its own scoring rules.
            Actual is what the player really scored across all 18 weeks. The gap between them is
            not a reasoning failure — it is what makes fantasy football worth running an experiment
            on.
          </p>
        </>
      )}

      {season.picks.length > 0 && (
        <>
          <h3 style={{ marginTop: 26 }}>Every pick, and why</h3>
          <div className="quotes">
            {season.picks.map((pick) => (
              <div className="quote" key={pick.pickOverall}>
                <div className="who">
                  {pick.player}
                  <small>
                    R{pick.round} · #{pick.pickOverall} · {pick.position}
                    {pick.confidence !== null && ` · conf ${pick.confidence.toFixed(2)}`}
                    {pick.decisionId && (
                      <Link className="record-link" href={`/decisions/${pick.decisionId}`}>
                        full record
                      </Link>
                    )}
                  </small>
                </div>
                <div className="said">
                  {pick.fallbackApplied && <span className="tag">fallback</span>}
                  {pick.poolNarrowed && <span className="tag">pool narrowed</span>}
                  {pick.headline ?? <span className="muted">no reason recorded</span>}
                  {pick.closestCall && (
                    <div style={{ marginTop: 6, color: 'var(--chalk-dim)', fontSize: 14 }}>
                      <em>Closest call:</em> {pick.closestCall}
                    </div>
                  )}
                  {pick.unsupportedClaims.length > 0 && (
                    <div className="flags">
                      {pick.unsupportedClaims.map((claim) => (
                        <div key={claim}>⚑ {claim}</div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
