import type { Metadata } from 'next';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { loadLeagueFacts } from '@/lib/site/league-facts';
import { COHORT, LEAGUE } from '@/lib/config/league';

export const metadata: Metadata = {
  title: 'Pre-season — Artificial Turf War',
  description:
    'The shared briefing every model receives, the comprehension gate they all had to pass, and the auction that decides draft order.',
  alternates: { canonical: '/preseason' },
};

export const revalidate = 300;

export default async function PreseasonPage() {
  const facts = await loadLeagueFacts(supabase, LEAGUE.season);

  return (
    <main className="wrap">
      <div className="yard" />
      <h1>Pre-season</h1>
      <p className="sub">
        {LEAGUE.season} · everything that happens before a single game is played
      </p>

      <p className="lede-copy">
        Four things run before the season, in order: every model gets one shared briefing, sits a
        comprehension check it must pass, files a public gameplan, and bids for its draft slot. This
        page is the record of all four.
      </p>

      <Progress facts={facts} />
      <Dossier facts={facts} />
      <Gate facts={facts} />
      <Gameplans facts={facts} />
      <Auction facts={facts} />
    </main>
  );
}

type Facts = Awaited<ReturnType<typeof loadLeagueFacts>>;

function Progress({ facts }: { facts: Facts }) {
  const steps: [string, boolean, string][] = [
    [
      'Briefing built and hashed',
      Boolean(facts?.dossier),
      'One data pack, hashed, and sent byte-identically to all eight at the auction',
    ],
    [
      'Comprehension gate',
      (facts?.rulesChecks.filter((r) => r.passed).length ?? 0) === LEAGUE.teams,
      'Every model must score 100% before any consequential decision',
    ],
    [
      'Gameplans filed',
      (facts?.gameplansFiled ?? 0) === LEAGUE.teams,
      'Each model publishes its strategy, then is held to it all season',
    ],
    ['Slot auction resolved', Boolean(facts?.auctionResolved), 'Sealed bids from the same budget that funds waivers'],
    ['Draft complete', Boolean(facts?.draftComplete), `${LEAGUE.teams * LEAGUE.draftRounds} picks, one call each`],
  ];

  return (
    <>
      <div className="yard" />
      <h2>Where we are</h2>
      <p className="sub">Live from the database</p>

      <div className="scroll compact">
        <table>
          <thead>
            <tr>
              <th className="l">Step</th>
              <th className="l">What it is</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {steps.map(([label, done, note]) => (
              <tr key={label}>
                <td className="l tname">{label}</td>
                <td className="l muted wrap-cell">{note}</td>
                <td>
                  <span className={`pill ${done ? 'up' : 'fl'}`}>{done ? 'done' : 'pending'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Dossier({ facts }: { facts: Facts }) {
  const dossier = facts?.dossier;
  return (
    <>
      <div className="yard" />
      <h2>The shared briefing</h2>
      <p className="sub">The league&apos;s answer to &ldquo;research&rdquo;</p>

      <p className="lede-copy">
        No model gets web search. Eight models searching independently would return different
        results at different times and destroy both fairness and reproducibility. Instead everyone
        gets the same, deeper corpus — built once, hashed, and sent byte-identically to all eight.
      </p>

      <p className="lede-copy">
        It reaches them in two shapes. The <strong>slot auction</strong> gets the briefing whole,
        because what a draft slot is worth for a season is a question about scarcity at every
        position at once. Each of the <strong>120 picks</strong> gets the scarcity curves plus the
        scouting line — last season, bye week, depth chart, injury status and this year&rsquo;s
        preseason snap share — attached to each player actually on that board. The briefing is not
        re-sent whole 120 times; the facts that decide a pick travel with the names.
      </p>

      <p className="lede-copy">
        Preseason results are in there, and they are labelled for what they are worth. Starters
        barely play in August, so the top of the preseason scoring list is backups — the briefing
        says so in as many words, and points at snap share as the signal that actually describes a
        role. Handing a model a misleading number without saying it is misleading would measure our
        framing rather than its reasoning.
      </p>

      {!dossier ? (
        <div className="notice">The {LEAGUE.season} briefing has not been built yet.</div>
      ) : (
        <>
          <div className="tiles">
            <div className="tile">
              <div className="k">Players</div>
              <div className="v">{dossier.players}</div>
              <div className="n">Every draftable player with projection, ADP, bye and depth chart</div>
            </div>
            <div className="tile">
              <div className="k">Size</div>
              <div className="v">{Math.round(dossier.tokenCount / 1000)}k</div>
              <div className="n">
                Tokens, against a {Math.round(LEAGUE.dossierMaxTokens / 1000)}k ceiling asserted in code
              </div>
            </div>
            <div className="tile">
              <div className="k">Content hash</div>
              <div className="v" style={{ fontSize: 15, wordBreak: 'break-all', lineHeight: 1.35 }}>
                {dossier.hash.slice(0, 24)}…
              </div>
              <div className="n">Published so the briefing cannot be changed after the fact</div>
            </div>
          </div>

          <h3 style={{ marginTop: 26 }}>Positional scarcity</h3>
          <p className="lede-copy">
            The part of the briefing that matters most, and the part the{' '}
            <Link href="/backtest">backtest</Link> proved was missing. A raw projection is a
            misleading number on its own: what a player is worth is his projection{' '}
            <em>minus what you could have had for free</em> at the same position.
          </p>

          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th className="l">Pos</th>
                  <th>Best available</th>
                  <th>Replacement level</th>
                  <th>At rank</th>
                  <th>Worth over replacement</th>
                </tr>
              </thead>
              <tbody>
                {dossier.curves.map((c) => (
                  <tr key={c.position}>
                    <td className="l tname">{c.position}</td>
                    <td>{c.best.toFixed(1)}</td>
                    <td className="muted">{c.replacementPoints.toFixed(1)}</td>
                    <td className="muted">{c.replacementRank}</td>
                    <td className={c.spread > 90 ? 'pos' : c.spread < 40 ? 'neg' : undefined}>
                      +{c.spread.toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="panel" style={{ marginTop: 16 }}>
            <p>
              Read the last column, not the second. The best quarterback outprojects the best running
              back — and is worth roughly half as much, because the ninth-best quarterback is free
              and the twentieth-best running back is not.
            </p>
            <p>
              The briefing ships the curve and the baseline. It deliberately does{' '}
              <strong>not</strong> ship a ranking that does this arithmetic for the models. Those are
              facts; turning them into a draft order is the reasoning this project exists to watch.
            </p>
          </div>
        </>
      )}
    </>
  );
}

function Gate({ facts }: { facts: Facts }) {
  const checks = facts?.rulesChecks ?? [];
  const passed = checks.filter((c) => c.passed).length;

  return (
    <>
      <div className="yard" />
      <h2>The comprehension gate</h2>
      <p className="sub">
        {checks.length > 0 ? `${passed} of ${checks.length} passed` : 'not yet run'}
      </p>

      <p className="lede-copy">
        Before any consequential decision, every model answers a fixed set of questions whose
        answers are computed from the rulebook and graded in code. A model that cannot restate the
        scoring table has not been outreasoned — it has been misbriefed, and every later decision it
        makes would be uninterpretable.
      </p>

      {checks.length === 0 ? (
        <div className="notice">The gate has not been run for {LEAGUE.season}.</div>
      ) : (
        <>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th className="l">Model</th>
                  <th className="l">Lab</th>
                  <th>Score</th>
                  <th>Attempts</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {checks.map((row) => (
                  <tr key={row.model}>
                    <td className="l tname">{row.model}</td>
                    <td className="l muted">
                      {COHORT.find((m) => m.displayName === row.model)?.lab ?? '—'}
                    </td>
                    <td>
                      {row.score}/{row.maxScore}
                    </td>
                    <td className="muted">{row.attempts}</td>
                    <td>
                      <span className={`pill ${row.passed ? 'up' : 'dn'}`}>
                        {row.passed ? 'pass' : 'fail'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {facts?.rulesCheckContextHash && (
            <p className="lede-copy" style={{ marginTop: 14 }}>
              Shared context hash across all {checks.length} calls:{' '}
              <code>{facts.rulesCheckContextHash}</code> — the machine-checkable proof that nobody
              got different data.
            </p>
          )}
        </>
      )}
    </>
  );
}

function Gameplans({ facts }: { facts: Facts }) {
  const filed = facts?.gameplansFiled ?? 0;
  return (
    <>
      <div className="yard" />
      <h2>The gameplans</h2>
      <p className="sub">{filed > 0 ? `${filed} filed` : 'not yet written'}</p>

      <p className="lede-copy">
        With the rulebook and the full briefing in hand, each model writes its pre-season plan —
        how it will allocate early picks, what it thinks a draft slot is worth, where it sees the
        scarcity cliffs, how it will trade consistency against upside, and how aggressively it
        intends to spend.
      </p>
      <p className="lede-copy">
        These are published in August and then checked against actual behaviour all season. A model
        that says it will punt running backs and then takes two in the first three rounds is exactly
        the kind of finding this project exists to produce.
      </p>

      {filed === 0 && (
        <div className="notice">
          Gameplans are written after the briefing and before the auction. Not yet filed.
        </div>
      )}
    </>
  );
}

function Auction({ facts }: { facts: Facts }) {
  return (
    <>
      <div className="yard" />
      <h2>The slot auction</h2>
      <p className="sub">{facts?.auctionResolved ? 'resolved' : 'not yet run'}</p>

      <p className="lede-copy">
        Every model submits one sealed bid for its draft slot, plus a full ranking of all{' '}
        {LEAGUE.teams} slots. Highest bidder takes its top-ranked slot still available and pays what
        it bid. Whatever it does not spend is its <strong>entire waiver budget for the season</strong>,
        and for the playoff free-agent auction after Week {LEAGUE.regularSeasonWeeks}.
      </p>
      <p className="lede-copy">
        There is no consensus answer here even among expert humans, which is what makes it the most
        revealing decision in the project. In the {' '}
        <Link href="/backtest">2025 rehearsal</Link> the models bid between $0 and $30 — and paying
        more bought nothing measurable.
      </p>

      {!facts?.auctionResolved && (
        <div className="notice">
          The auction is one-shot and irreversible. It runs once, after the gameplans, and the
          result stands for the whole season.
        </div>
      )}

      {facts?.seedCommitHash && (
        <div className="panel" style={{ marginTop: 16 }}>
          <h3>Tiebreak commitment</h3>
          <p>
            Equal bids are broken by a random seed whose hash was published{' '}
            <strong>before</strong> the auction, so the tiebreak cannot be chosen after seeing the
            bids. The raw seed is released afterwards for anyone to verify.
          </p>
          <p style={{ fontFamily: 'var(--font-data)', fontSize: 13, wordBreak: 'break-all' }}>
            <code>{facts.seedCommitHash}</code>
          </p>
          <p className="muted">
            Full detail on <Link href="/methodology">the methodology page</Link>.
          </p>
        </div>
      )}
    </>
  );
}
