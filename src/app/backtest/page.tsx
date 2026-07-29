import type { Metadata } from 'next';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { loadBacktestSummary } from '@/lib/backtest/results';

export const metadata: Metadata = {
  title: 'The 2025 Backtest — Artificial Turf War',
  description:
    'Before the real draft, the whole engine was run against the completed 2025 season. Three gates, five bugs found, and one finding: paying for draft position bought nothing.',
};

/** 2025 is finished; nothing about this page changes hour to hour. */
export const revalidate = 3600;

const BACKTEST_SEASON = 2025;

export default async function BacktestPage() {
  const summary = await loadBacktestSummary(supabase, BACKTEST_SEASON);

  return (
    <main className="wrap">
      <div className="yard" />
      <h1>The 2025 Backtest</h1>
      <p className="sub">Phase 4 · run 28 July 2026 · three gates, five bugs</p>

      <p className="lede-copy">
        The draft is one-shot and irreversible. A wrong scoring constant discovered in Week 3
        cannot be fixed without invalidating the season — so the whole engine was run against the
        completed 2025 season, where every answer is already known, before anything was frozen.
      </p>
      <p className="lede-copy">
        Three gates had to pass: the scoring math had to verify, the slot auction had to show real
        bid dispersion, and a full 120-pick draft had to complete and be scoreable. All three did.
        Getting there surfaced five bugs that would have corrupted the real season, which is the
        entire reason this phase exists.
      </p>

      {!summary ? (
        <div className="notice">
          Backtest data is not loaded in this environment. The full write-up is in{' '}
          <code>BACKTEST.md</code> in the repository.
        </div>
      ) : (
        <>
          <Gates summary={summary} />
          <Standings summary={summary} />
          <Auction summary={summary} />
          <EarlyPicks summary={summary} />
        </>
      )}

      <Bugs />
      <Limits />
    </main>
  );
}

type Summary = NonNullable<Awaited<ReturnType<typeof loadBacktestSummary>>>;

function Gates({ summary }: { summary: Summary }) {
  const { totals } = summary;
  return (
    <>
      <div className="yard" />
      <h2>The run</h2>
      <p className="sub">Every figure below is computed live from the stored audit trail</p>

      <div className="tiles">
        <div className="tile">
          <div className="k">Scoring verified</div>
          <div className="v">846/846</div>
          <div className="n">
            Offensive players whose weekly-sum matches their season-total, from two different
            Sleeper payloads. Worst delta 0.00 points.
          </div>
        </div>
        <div className="tile">
          <div className="k">Draft picks</div>
          <div className="v">{totals.picks}</div>
          <div className="n">
            {totals.fallbacks} fallbacks · {totals.invalid} invalid responses ·{' '}
            {totals.providerFailures} provider failures.
          </div>
        </div>
        <div className="tile">
          <div className="k">Bid vs points</div>
          <div className="v">r&nbsp;=&nbsp;{summary.bidPointsCorrelation}</div>
          <div className="n">
            No relationship. Paying for draft position bought nothing measurable.
          </div>
        </div>
        <div className="tile">
          <div className="k">Total model spend</div>
          <div className="v">${totals.costUsd}</div>
          <div className="n">
            {totals.decisions} logged decisions
            {totals.meanConfidence !== null && <> · mean stated confidence {totals.meanConfidence}</>}
          </div>
        </div>
      </div>
    </>
  );
}

function Standings({ summary }: { summary: Summary }) {
  return (
    <>
      <div className="yard" />
      <h2>Final table</h2>
      <p className="sub">
        Scored with the optimal lineup each week — roster quality, isolated from lineup skill
      </p>

      <p className="lede-copy">
        Nobody set a lineup in this backtest, so grading them on one would invent a result. Every
        roster is scored at its best possible weekly lineup, which measures only what the draft
        built.
      </p>

      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th className="l">Rk</th>
              <th className="l">Model</th>
              <th>Slot</th>
              <th>Bid</th>
              <th>FAAB left</th>
              <th>Points</th>
              <th>H2H</th>
              <th>All-play</th>
              <th>Early QBs</th>
            </tr>
          </thead>
          <tbody>
            {summary.standings.map((row) => (
              <tr key={row.teamId} className={row.rank === 1 ? 'lead' : undefined}>
                <td className="l rank">{row.rank}</td>
                <td className="l tname">{row.model}</td>
                <td>{row.draftSlot}</td>
                <td>${row.bid}</td>
                <td className="muted">${row.faabLeft}</td>
                <td>{row.points.toFixed(1)}</td>
                <td>{row.h2h}</td>
                <td className="muted">{row.allplay}</td>
                <td className={row.earlyQbs > 0 ? 'neg' : 'muted'}>{row.earlyQbs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid2" style={{ marginTop: 16 }}>
        <div className="panel">
          <h3>Paying for position bought nothing</h3>
          <p>
            The two highest bidders finished 8th and 5th. The winner paid $15 and second place paid
            $6. Bid against season points comes out at <code>r = {summary.bidPointsCorrelation}</code> —
            no relationship, very slightly negative.
          </p>
          <p>
            The spec estimated that rational bids would land around $20–50, reasoning from what a
            good waiver claim is worth. The field averaged about $15, and{' '}
            <strong>the field was closer to right than the spec was.</strong>
          </p>
          <p className="muted">
            Caveat: no waivers ran in this backtest, so the alternative use of the saved money was
            never exercised. This shows slot value is low; it cannot show what the budget would
            have bought.
          </p>
        </div>

        <div className="panel">
          <h3>Head-to-head is visibly luckier than all-play</h3>
          <p>
            Muse Spark had <strong>the worst roster in the league</strong> and finished 7-7. Gemini
            scored more and went 5-9. Fifteen points of roster quality across fourteen weeks
            separated a .500 record from 4-10.
          </p>
          <p>
            That is exactly the cost accepted when head-to-head became the ranking: it makes the
            opponent matter, which is what creates punting, variance-seeking and cross-week
            budgeting — and it costs measurement precision to do it.
          </p>
          <p className="muted">
            This is why all-play is still computed and published every week even though it no
            longer ranks.
          </p>
        </div>
      </div>
    </>
  );
}

function Auction({ summary }: { summary: Summary }) {
  return (
    <>
      <div className="yard" />
      <h2>The slot auction</h2>
      <p className="sub">One shared $100 budget funds both the draft slot and the whole season&apos;s waivers</p>

      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th className="l">Slot</th>
              <th className="l">Model</th>
              <th>Bid</th>
              <th>Conf</th>
              <th className="l">Slot preference</th>
            </tr>
          </thead>
          <tbody>
            {summary.bids.map((bid) => (
              <tr key={bid.model}>
                <td className="l rank">{bid.assignedSlot}</td>
                <td className="l tname">{bid.model}</td>
                <td>${bid.bid}</td>
                <td className="muted">{bid.confidence?.toFixed(2) ?? '—'}</td>
                <td className="l muted">{bid.slotPreference.join(' ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 style={{ marginTop: 26 }}>What they said about the price</h3>
      <div className="quotes">
        {summary.bids.map((bid) => (
          <div className="quote" key={`q-${bid.model}`}>
            <div className="who">
              {bid.model}
              <small>
                ${bid.bid} · slot {bid.assignedSlot}
                {bid.confidence !== null && ` · conf ${bid.confidence.toFixed(2)}`}
                {bid.decisionId && (
                  <Link className="record-link" href={`/decisions/${bid.decisionId}`}>
                    full record
                  </Link>
                )}
              </small>
            </div>
            <div className="said">{bid.headline ?? '—'}</div>
          </div>
        ))}
      </div>

      <div className="panel flag" style={{ marginTop: 16 }}>
        <h3>The auction was run twice, and the answer moved</h3>
        <p>
          By accident — once before results were persisted, once after — the auction produced two
          independent samples from identical inputs. Same models, same prompt, same temperature.
        </p>
        <p>
          In the first run, six of eight ranked <strong>slot 4</strong> first. In the second, the
          field shifted toward <strong>slot 1</strong>. Both runs cleared the dispersion gate, and
          both averaged about $15.
        </p>
        <p>
          <strong>The real auction happens once and stands for the whole season.</strong> Whatever
          it produces will read as a considered collective judgment, and this pair is direct
          evidence that a meaningful part of it is run-to-run variance. It is recorded here so that
          nobody — including us — over-reads the single result that counts.
        </p>
        <p className="muted">
          Gemini bid $0 in both runs. It was the only model that did the same thing twice.
        </p>
      </div>
    </>
  );
}

function EarlyPicks({ summary }: { summary: Summary }) {
  const round1 = summary.earlyPicks.filter((p) => p.round === 1);
  const quotable = summary.earlyPicks.find((p) => p.headline?.includes('leads non-QBs'));

  return (
    <>
      <div className="yard" />
      <h2>The quarterback problem</h2>
      <p className="sub">Round one, and what it cost</p>

      <p className="lede-copy">
        Four of the first five picks were quarterbacks, in a league that starts one. This draft ran{' '}
        <strong>without a dossier</strong> — the models had raw projections and no way to see
        replacement level, so they took the biggest numbers on the board.
      </p>

      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th className="l">#</th>
              <th className="l">Model</th>
              <th className="l">Pick</th>
              <th>Pos</th>
              <th>Conf</th>
            </tr>
          </thead>
          <tbody>
            {round1.map((pick) => (
              <tr key={pick.pickOverall}>
                <td className="l rank">{pick.pickOverall}</td>
                <td className="l tname">{pick.model}</td>
                <td className="l">{pick.player}</td>
                <td className={pick.position === 'QB' ? 'neg' : 'muted'}>{pick.position}</td>
                <td className="muted">{pick.confidence?.toFixed(2) ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 style={{ marginTop: 26 }}>What they said about the first pick</h3>
      <div className="quotes">
        {round1.map((pick) => (
          <div className="quote" key={`q-${pick.pickOverall}`}>
            <div className="who">
              {pick.model}
              <small>
                pick {pick.pickOverall} · {pick.player} ({pick.position})
                {pick.decisionId && (
                  <Link className="record-link" href={`/decisions/${pick.decisionId}`}>
                    full record
                  </Link>
                )}
              </small>
            </div>
            <div className="said">
              {pick.position === 'QB' && <span className="tag">QB</span>}
              {pick.headline ?? '—'}
            </div>
          </div>
        ))}
      </div>

      {quotable?.headline && (
        <div className="telestrator" style={{ marginTop: 16 }}>
          <div className="tel-hd">
            <b>{quotable.model}</b>
            <span>pick {quotable.pickOverall}</span>
            <span>the reasoning was not careless — it was literal</span>
          </div>
          <p className="lede">&ldquo;{quotable.headline}&rdquo;</p>
          <p>
            That model noticed ADP disagreed with projection, said so explicitly, and followed the
            projection anyway — because nothing in its data block expressed replacement level. The
            fix is not a better model. It is the dossier we had not built yet.
          </p>
        </div>
      )}

      <div className="grid2" style={{ marginTop: 16 }}>
        <div className="panel">
          <h3>What it cost</h3>
          <p>
            Teams that took a quarterback in the first three rounds averaged{' '}
            <strong>{summary.qbSplit.withEarlyQb.meanPoints}</strong> points ({summary.qbSplit.withEarlyQb.teams} teams).
            Teams that did not averaged <strong>{summary.qbSplit.without.meanPoints}</strong> (
            {summary.qbSplit.without.teams} teams).
          </p>
          <p className="muted">
            Do not over-read it. n = 8, one season, and one team took no early quarterback and still
            finished 7th. This is consistent with the scarcity math rather than a demonstration of
            it.
          </p>
        </div>
        <div className="panel">
          <h3>What changed because of it</h3>
          <p>
            The dossier now ships positional scarcity curves. The best quarterback is worth about
            +58 points over a freely available QB8; the best running back is worth +122 over
            replacement. Josh Allen projects 37 points more than Bijan Robinson and is worth less
            than half as much.
          </p>
          <p>
            It deliberately does <em>not</em> ship a precomputed value-over-replacement ranking. The
            curve and the baseline are facts; turning them into a draft order is the reasoning we
            are here to watch.
          </p>
        </div>
      </div>
    </>
  );
}

function Bugs() {
  return (
    <>
      <div className="yard" />
      <h2>Five bugs, published</h2>
      <p className="sub">None were findable by unit tests — each needed real data or real models</p>

      <div className="grid2">
        <div className="panel flag">
          <h3>1 · The ingest was discarding real points</h3>
          <p>
            Weekly stat lines were skipped when <code>gp</code> was 0 — but Sleeper omits that key
            entirely on some scoring lines, and our absent-key guard reads a missing key as 0.
          </p>
          <pre>{`{"pos_rank_ppr": 49, "pts_ppr": 2, "rec_2pt": 1}`}</pre>
          <p>
            A two-point conversion, discarded. Under head-to-head a single matchup decides playoff
            qualification, and matchups turn on less than two points.
          </p>
          <p>
            What makes it worth publishing: <strong>the absent-key trap is the loudest warning in
            our own spec.</strong> It has dedicated tests and a guard function written to prevent
            exactly this. It still happened — one layer up, in the filter feeding that guard.
            Defending a rule in one module does not defend it in the module beside it.
          </p>
        </div>

        <div className="panel flag">
          <h3>2 · Two models were blamed for a config mistake</h3>
          <p>
            Gemini and Kimi returned no parseable output on the first auction and were recorded as
            model errors. They had not failed. The output cap was 4,000 tokens, and reasoning models
            spend that budget <em>thinking</em> before emitting a character of JSON.
          </p>
          <p>
            Kimi used 2,946 output tokens on a <strong>one-player</strong> board. The real board is
            sixty. Both hit the ceiling mid-thought and returned empty content — indistinguishable
            from a refusal unless <code>finish_reason</code> is captured, which it was not.
          </p>
        </div>

        <div className="panel flag">
          <h3>3 · The verification itself was wrong first</h3>
          <p>
            The first scoring check reported 408 failures with deltas up to −123 points. The engine
            was fine. The check compared a 14-week sum against Sleeper&apos;s 18-week season totals.
          </p>
          <p className="muted">
            Recorded because it is the failure mode a verification suite is most prone to: a broken
            check looks exactly like a broken system.
          </p>
        </div>

        <div className="panel flag">
          <h3>4 &amp; 5 · The citation checker was accusing models falsely</h3>
          <p>
            The check that flags claims a model cannot support was wrong about{' '}
            <strong>79% of what it flagged</strong>, and wrong in the direction of accusing. Of 358
            recorded &ldquo;unsupported claims&rdquo;, 269 were models being slightly wordy, and
            most of the rest were models correctly citing the rulebook&apos;s own scoring values.
          </p>
          <p>
            All of it was destined for a public page under each model&apos;s name. It was repaired
            retroactively — 358 down to 75 — <strong>without re-calling a single model</strong>,
            because every decision stores its full prompt and raw response rather than just the
            verdict.
          </p>
          <p>
            A verification layer that has never been checked against reality is a claim, not a
            mechanism.
          </p>
        </div>
      </div>
    </>
  );
}

function Limits() {
  return (
    <>
      <div className="yard" />
      <h2>What this does not show</h2>
      <p className="sub">Honest scope</p>

      <div className="panel">
        <ul>
          <li>
            <strong>No weekly lineups and no waiver runs.</strong> Rosters were scored at their
            optimal lineup, so lineup efficiency, move evaluation and FAAB behaviour are all
            untested against real outcomes. The auction&apos;s central tradeoff — budget kept for
            waivers — was never exercised.
          </li>
          <li>
            <strong>The draft ran without a dossier.</strong> These rosters are not what the same
            models would build in August with scarcity curves in front of them.
          </li>
          <li>
            <strong>The auction gave different answers on two identical runs.</strong> The one that
            counts happens once.
          </li>
          <li>
            <strong>n = 8, one season.</strong> Every comparison here is suggestive, not
            significant. This is an exhibition, not a benchmark, and the backtest is not exempt from
            that.
          </li>
        </ul>
      </div>
    </>
  );
}
