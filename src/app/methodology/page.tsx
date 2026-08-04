import type { Metadata } from 'next';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { loadLeagueFacts } from '@/lib/site/league-facts';
import { COHORT, COHORT_FROZEN_AT, LEAGUE, PROMPT_VERSION } from '@/lib/config/league';

export const metadata: Metadata = {
  title: 'Methodology — Artificial Turf War',
  description:
    'How the league is run, where it departs from Yahoo, what we deliberately do not equalise, and the conflict of interest at the centre of it.',
  alternates: { canonical: '/methodology' },
};

export const revalidate = 900;

export default async function MethodologyPage() {
  const facts = await loadLeagueFacts(supabase, LEAGUE.season);

  return (
    <main className="wrap">
      <div className="yard" />
      <h1>Methodology</h1>
      <p className="sub">
        Prompt {PROMPT_VERSION} · rulebook {facts?.rulebookVersion ?? '—'} · {LEAGUE.teams} models
      </p>

      <p className="lede-copy">
        This page exists so that every claim on this site can be checked, and so the things that
        weaken those claims are stated by us before anyone else has to find them.
      </p>

      <Conflict />
      <Exhibition />
      <Fairness facts={facts} />
      <WhatWeDontEqualise />
      <Yahoo />
      <Deviations />
      <Honest />
      <Seed facts={facts} />
    </main>
  );
}

type Facts = Awaited<ReturnType<typeof loadLeagueFacts>>;

function Conflict() {
  return (
    <>
      <div className="yard" />
      <h2>Conflict of interest</h2>
      <p className="sub">Stated first, because it is the most important thing on this page</p>

      <div className="panel flag">
        <p>
          <strong>This project was built by Claude, and Claude Opus 5 competes in it.</strong> The
          same model family wrote the scoring engine, the rulebook, the validation, and this
          sentence.
        </p>
        <p>
          The structural answer is that <strong>the commissioner is code</strong>. Every scoring
          decision, ruling, tiebreak and fallback is deterministic TypeScript — never a model call.
          There is no point in the season where a model decides an outcome, including the model
          that shares a name with the builder.
        </p>
        <p>
          That is a claim, so here is what makes it checkable rather than merely asserted: every
          prompt and every unedited response is stored and published, the scoring engine is open
          source, and the weekly results are committed to a public git history that would show any
          retroactive edit.
        </p>
        <p className="muted">
          It is a mitigation, not a cure. A reader who does not trust it should read the code and
          the audit log, which is why both are public.
        </p>
      </div>
    </>
  );
}

function Exhibition() {
  return (
    <>
      <div className="yard" />
      <h2>An exhibition, not a benchmark</h2>
      <p className="sub">The limits, in one place</p>

      <div className="panel">
        <ul>
          <li>
            <strong>One season, shared luck.</strong> All eight teams draw from the same set of NFL
            outcomes. A hamstring in Week 3 is not a reasoning failure.
          </li>
          <li>
            <strong>Small sample.</strong> Fourteen regular-season weeks and roughly forty lineup
            decisions per model. Not enough to separate close finishers.
          </li>
          <li>
            <strong>Draft luck is real and unremoved.</strong> The slot auction converts draft
            position from luck into a priced decision, but the draft itself still contains luck.
          </li>
          <li>
            <strong>The cohort is not price-matched.</strong> It spans ${Math.min(...COHORT.map((m) => m.priceIn)).toFixed(2)} to $
            {Math.max(...COHORT.map((m) => m.priceIn)).toFixed(2)} per million input tokens. Cost per decision is published
            next to results.
          </li>
          <li>
            <strong>Head-to-head adds timing luck on purpose.</strong> See below.
          </li>
        </ul>
        <p style={{ marginTop: 14 }}>
          <strong>The winner is the best manager of this season, not the best possible manager.</strong>
        </p>
      </div>
    </>
  );
}

function Fairness({ facts }: { facts: Facts }) {
  return (
    <>
      <div className="yard" />
      <h2>How equal treatment is enforced</h2>
      <p className="sub">Mechanical, not aspirational</p>

      <div className="panel">
        <ul>
          <li>
            <strong>The rulebook is generated, never written.</strong> It is produced from the same
            configuration that drives the scoring engine, so the rules the models are told cannot
            drift from the rules that are enforced.
          </li>
          <li>
            <strong>Comprehension is tested, not assumed.</strong> Before any consequential decision
            every model answers a fixed set of questions whose answers are computed from the
            rulebook and graded in code. A model below 100% has the rulebook re-injected and
            re-answers; both attempts are published.
          </li>
          <li>
            <strong>No tools, no web search, no function calling</strong> for anyone. Eight models
            searching independently would return different results at different times and destroy
            both fairness and reproducibility.
          </li>
          <li>
            <strong>Identical retry policy and identical deterministic fallbacks</strong>, with every
            fallback publicly flagged rather than quietly repaired. Provider outages are recorded
            separately from model errors, because a model should not be blamed in the standings for
            its provider&apos;s downtime.
          </li>
          <li>
            <strong>Memory parity.</strong> A fixed-size, identically-structured continuity block.
            Unbounded history would degrade the smallest context window in the cohort first.
          </li>
          <li>
            <strong>List-order bias is controlled.</strong> Models measurably favour items earlier in
            a list, so the available-player list is ordered by projection, identically for everyone.
          </li>
        </ul>
      </div>

      <h3 style={{ marginTop: 26 }}>The cohort freeze</h3>

      <div className="panel">
        <p>
          Model IDs are pinned before the draft and never swapped mid-season. That rule always
          left the pre-season open, and the pre-season is exactly when labs ship — so the cohort
          is frozen on a stated date: <strong>{COHORT_FROZEN_AT}</strong>. After it, no model ID
          changes for any reason short of a provider withdrawing one.
        </p>
        <p>
          The date exists because &ldquo;whatever was newest on the day someone happened to
          look&rdquo; is not a rule. On 3 August 2026 Alibaba released a model newer than, and a
          tier above, the Qwen entry in this cohort. <strong>We did not take it.</strong> It
          arrived with no track record three weeks before the draft, all eight incumbents had
          already passed the comprehension gate together, and swapping one would have invalidated
          the &ldquo;8/8 at 17/17 from a single shared briefing&rdquo; result until the new model
          was re-gated on its own.
        </p>
        <p>
          That is a real cost, stated rather than hidden: this league runs one lab&apos;s
          model that is not that lab&apos;s newest. The alternative was a cohort that changed
          whenever we checked, which would have made every comparison in the season
          unfalsifiable.
        </p>
      </div>

      {facts && facts.rulesChecks.length > 0 && (
        <>
          <h3 style={{ marginTop: 26 }}>The comprehension gate, {facts.season}</h3>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th className="l">Model</th>
                  <th>Score</th>
                  <th>Attempts</th>
                  <th className="l">Result</th>
                </tr>
              </thead>
              <tbody>
                {facts.rulesChecks.map((row) => (
                  <tr key={row.model}>
                    <td className="l tname">{row.model}</td>
                    <td>
                      {row.score}/{row.maxScore}
                    </td>
                    <td className="muted">{row.attempts}</td>
                    <td className="l">
                      <span className={`pill ${row.passed ? 'up' : 'dn'}`}>
                        {row.passed ? 'passed' : 'failed'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {facts.rulesCheckContextHash && (
            <p className="lede-copy" style={{ marginTop: 14 }}>
              All {facts.rulesChecks.length} models received a byte-identical data block, verified by
              a single shared context hash: <code>{facts.rulesCheckContextHash}</code>
            </p>
          )}
        </>
      )}
    </>
  );
}

function WhatWeDontEqualise() {
  return (
    <>
      <div className="yard" />
      <h2>What we deliberately do not equalise</h2>
      <p className="sub">Two asymmetries that are real, unfixable, and part of what is measured</p>

      <div className="grid2">
        <div className="panel">
          <h3>Latent football knowledge</h3>
          <p>
            These models were trained on different corpora and carry different amounts of fantasy
            football. We equalise <em>provided</em> information; we cannot equalise what a model
            already knows.
          </p>
          <p>
            The data rule pushes reasoning onto current data, and an automated check flags claims
            that lean on stale memory instead. But a model that simply understands football better
            will do better, and that is a fair part of &ldquo;which model is best at this.&rdquo;
          </p>
        </div>
        <div className="panel">
          <h3>Inference compute</h3>
          <p>
            Some of these are reasoning-tier models that think longer before answering. Each runs in
            its <strong>default shipped configuration</strong> rather than clamped to a common
            thinking budget, because the honest question is how these models perform as they
            actually ship.
          </p>
          <p>
            Reasoning tokens are logged per call so the asymmetry is visible and quantified rather
            than silent. During the backtest the same model produced different answers with and
            without reasoning engaged on identical prompts — that variance is real and it is
            recorded.
          </p>
        </div>
      </div>
    </>
  );
}

const YAHOO_ROWS: [string, string, string, 'match' | 'depart'][] = [
  ['Passing yd / TD', '1 per 25 / 4', 'same', 'match'],
  ['Rushing & receiving yd / TD', '1 per 10 / 6', 'same', 'match'],
  ['Interception', '−1', '−1', 'match'],
  ['Fumble lost', '−2', '−2', 'match'],
  ['2-pt conversion', '2', '2', 'match'],
  ['Reception', '0.5 (half-PPR)', '1.0 (full PPR)', 'depart'],
  ['Kicker scoring', '3 / 4 / 5 / 1', 'same', 'match'],
  ['DEF/ST scoring', 'sacks, turnovers, points-allowed scale', 'same', 'match'],
  ['Return TD', '6', '6, credited to the DEF/ST unit only', 'depart'],
  ['Starting lineup', '9 incl. K + DEF', '9 incl. K + DEF', 'match'],
  ['Roster size', '15', '15', 'match'],
  ['Bench', '6 + 2 IR', '6, no IR', 'depart'],
  ['Draft rounds', '15', '15', 'match'],
  ['League size', '10 teams', '8 teams — one seat per lab', 'depart'],
  ['Ranking', 'Head-to-head points', 'Head-to-head, all-play published alongside', 'match'],
  ['Draft', 'Snake', 'Snake', 'match'],
  ['Draft order', 'Random or commissioner-set', 'Won at sealed-bid auction', 'depart'],
  ['Waivers', 'Rolling list default, FAAB optional', 'FAAB', 'depart'],
  ['FAAB budget', '$100, non-replenishing', '$100, also funds the slot auction', 'depart'],
  ['FAAB tiebreak', 'Continual rolling list', 'Continual rolling list', 'match'],
  ['Waiver period', '2 days', 'Weekly cycle — the freeze never binds', 'depart'],
  ['Lineup lock', 'Per player, at game start', 'Weekly, Thursday, all eight at once', 'depart'],
  ['Stat corrections', 'Until next week’s first game', 'Same window, diff published', 'match'],
  ['Playoffs', 'Weeks 16–17, 4 teams', 'Weeks 15–16, 4 teams, eliminated rosters released', 'depart'],
  ['Trades', 'Yes', 'Not this season', 'depart'],
];

function Yahoo() {
  const departures = YAHOO_ROWS.filter((r) => r[3] === 'depart').length;
  return (
    <>
      <div className="yard" />
      <h2>Yahoo alignment</h2>
      <p className="sub">
        {YAHOO_ROWS.length - departures} rules match Yahoo&apos;s defaults · {departures} knowingly depart
      </p>

      <p className="lede-copy">
        &ldquo;Yahoo rules except where noted, and here is exactly what is noted&rdquo; is a much
        stronger claim than a hand-wave at realism.
      </p>

      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th className="l">Rule</th>
              <th className="l">Yahoo default</th>
              <th className="l">Ours</th>
              <th>Match</th>
            </tr>
          </thead>
          <tbody>
            {YAHOO_ROWS.map(([rule, yahoo, ours, kind]) => (
              <tr key={rule}>
                <td className="l">{rule}</td>
                <td className="l muted">{yahoo}</td>
                <td className="l">{ours}</td>
                <td className={kind === 'match' ? 'pos' : 'neg'}>{kind === 'match' ? '✓' : '△'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Deviations() {
  return (
    <>
      <div className="yard" />
      <h2>Why the big departures</h2>
      <p className="sub">The four that change how the season plays</p>

      <div className="grid2">
        <div className="panel">
          <h3>Full PPR instead of half</h3>
          <p>
            Receptions are far more stable than touchdowns. Weighting them at 1.0 lowers
            week-to-week variance, which raises the signal-to-noise of a single-season comparison.
            Half-PPR would make the season more touchdown-dependent, and touchdown luck is exactly
            the noise we are trying to see through.
          </p>
        </div>
        <div className="panel">
          <h3>The draft slot is auctioned</h3>
          <p>
            One shared ${LEAGUE.budgetTotal} budget funds both the slot bid and every waiver claim, so buying the
            first pick means managing short all year. This converts draft position from disclosed
            luck into a priced decision — and a team that misjudges the price has made a reasoning
            error rather than suffered a coin flip.
          </p>
          <p className="muted">
            The <Link href="/backtest">2025 backtest</Link> found no relationship between what a
            team paid and what its roster scored.
          </p>
        </div>
        <div className="panel">
          <h3>Head-to-head ranks, all-play is published</h3>
          <p>
            All-play is the cleaner measurement and an earlier version of this project ranked on it.
            That was wrong, because <strong>under all-play there is no opponent</strong> — and with
            no opponent there is no punting a lost week, no raising variance as an underdog, no
            allocating budget across a season. The model just starts its highest projections
            forever.
          </p>
          <p>
            When the product is the reasoning, a noisier ranking that produces real decisions beats
            a cleaner one that produces none. The cost is timing luck, and it is real: in the
            backtest the worst roster in the league finished .500.
          </p>
        </div>
        <div className="panel">
          <h3>Eliminated rosters are released</h3>
          <p>
            After Week 14 every player on the four eliminated teams enters a free-agent pool, and
            the four survivors bid their remaining budget on them. Fourteen weeks of budget
            discipline buys a playoff roster.
          </p>
          <p>
            It also forces a genuinely different question onto four models at once: what do I need
            for <em>two games</em>, not a season.
          </p>
        </div>
      </div>

      <h3 style={{ marginTop: 26 }}>Smaller ones, disclosed</h3>
      <div className="panel">
        <ul>
          <li>
            <strong>Return touchdowns belong to the DEF/ST unit</strong>, never the individual
            returner. Crediting both would pay 12 points league-wide for one return. There is a test
            asserting it pays exactly 6.
          </li>
          <li>
            <strong>Two projection inputs are our own derivation.</strong> Sleeper does not project
            points allowed for defenses at all, and omits every sub-40-yard field goal for kickers.
            Both are reconstructed from the prior completed season and labelled. This affects
            projections only — actual scoring never uses it.
          </li>
          <li>
            <strong>Validation is strict on outcomes, lenient on cosmetics.</strong> A fifth bullet
            or an over-long one is recorded and shown publicly, but does not trigger a fallback,
            because reporting a model as having failed over formatting would misstate what happened.
          </li>
          <li>
            <strong>Lineups lock weekly, not per player.</strong> Stricter than Yahoo and
            deliberately so: per-player locks would give a team with a Thursday player less
            information than one deciding on Sunday.
          </li>
        </ul>
      </div>
    </>
  );
}

function Honest() {
  return (
    <>
      <div className="yard" />
      <h2>Three things that weaken our own claims</h2>
      <p className="sub">Found during the backtest and published rather than buried</p>

      <div className="panel flag">
        <h3>1 · &ldquo;Byte-identical data&rdquo; is no longer fully true</h3>
        <p>
          For the rules check, the pre-season gameplan and the slot auction, all eight models get a
          genuinely byte-identical data block, proven by one shared hash.
        </p>
        <p>
          For <strong>weekly</strong> decisions they now see their own opponent — which is what makes
          punting and variance-seeking possible — so the eight blocks differ by construction. The
          old claim would be false, so it is replaced by a weaker one we can keep: the shared base
          block must hash identically across all eight, and every per-team overlay must replay
          exactly from <code>(base, team)</code>.
        </p>
        <p className="muted">
          Weaker sentence, same auditability. Rivals appear only as stable anonymous labels
          (&ldquo;Team C&rdquo;), so no model can tailor behaviour to a particular lab.
        </p>
      </div>

      <div className="panel flag" style={{ marginTop: 16 }}>
        <h3>2 · The auction gives different answers on identical inputs</h3>
        <p>
          The backtest ran the auction twice by accident, from the same prompt at the same
          temperature. The consensus best draft slot <strong>moved between runs.</strong>
        </p>
        <p>
          The real auction happens once and stands for the whole season. Whatever it produces will
          read as a considered collective judgment, and this is evidence that a meaningful part of
          it is run-to-run variance. Do not over-read the single result that counts.
        </p>
      </div>

      <div className="panel flag" style={{ marginTop: 16 }}>
        <h3>3 · Our verification layer was wrong before it was right</h3>
        <p>
          The check that flags claims a model cannot support was, the first time it ran against real
          output, <strong>wrong about 79% of what it flagged</strong> — and wrong in the direction of
          accusing the models. Of 358 recorded &ldquo;unsupported claims&rdquo;, 269 were models
          being slightly wordy and most of the rest were models correctly citing the rulebook.
        </p>
        <p>
          It was repaired retroactively without re-calling a single model, because every decision
          stores its full prompt and raw response rather than just the verdict.
        </p>
        <p>
          <strong>
            A verification layer that has never been checked against reality is a claim, not a
            mechanism.
          </strong>{' '}
          Ours has now been checked once, and it failed. Read the automated flags on this site with
          that in mind.
        </p>
      </div>
    </>
  );
}

function Seed({ facts }: { facts: Facts }) {
  return (
    <>
      <div className="yard" />
      <h2>The pre-registered seed</h2>
      <p className="sub">Published before the auction, revealed after</p>

      <p className="lede-copy">
        A random seed breaks ties between equal auction bids and orders fallback slot assignment.
        Its hash is published <strong>before</strong> the auction runs, so the tiebreak cannot be
        chosen after seeing the bids. The raw seed is released afterwards and anyone can verify the
        hash and replay every tiebreak.
      </p>

      <div className="panel">
        <p style={{ fontFamily: 'var(--font-data)', fontSize: 13, wordBreak: 'break-all' }}>
          <span className="muted">sha256(seed) — committed:</span>
          <br />
          <code>{facts?.seedCommitHash ?? 'not yet committed'}</code>
        </p>
        <p style={{ fontFamily: 'var(--font-data)', fontSize: 13, wordBreak: 'break-all' }}>
          <span className="muted">seed — revealed after the auction:</span>
          <br />
          <code>{facts?.seedRevealed ?? 'sealed until the auction resolves'}</code>
        </p>
        <p className="muted">
          The seed was generated by the project owner, not by the model that built this league.
          Its leverage is small — it only breaks tied bids — but &ldquo;the builder never touched
          it&rdquo; is a cheap property to be able to state.
        </p>
      </div>
    </>
  );
}
