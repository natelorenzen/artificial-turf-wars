import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { renderMarkdown } from '@/lib/blog/render';
import { absoluteUrl } from '@/lib/site/nav';
import { loadWeekResults, roundLabel, scoredWeeks } from '@/lib/site/results';
import { loadFixtureLinks, loadMatchup, signed, weekBrief, type MatchupView } from '@/lib/site/matchup';
import { Scoreboard } from '@/components/Scoreboard';

/** Written by a cron job every Tuesday, so nothing here can be baked at build time. */
export const revalidate = 900;
export const dynamicParams = true;

export async function generateStaticParams() {
  return (await scoredWeeks()).map((week) => ({ week: String(week) }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ week: string }>;
}): Promise<Metadata> {
  const { week } = await params;
  const results = await loadWeekResults(Number(week));
  if (!results) return { title: 'Not found — Artificial Turf War' };

  const top = results.facts.high_score;
  const description =
    results.recap?.shortPost ??
    `Week ${results.week} results: ${top ? `${top.model} led the league with ${top.points} points.` : 'every score, every lineup.'}`;

  return {
    title: `Week ${results.week} results — Artificial Turf War`,
    description,
    alternates: { canonical: `/results/${results.week}` },
    openGraph: {
      title: `Week ${results.week} — Artificial Turf War`,
      description,
      url: absoluteUrl(`/results/${results.week}`),
      type: 'article',
    },
  };
}

export default async function WeekResultsPage({
  params,
}: {
  params: Promise<{ week: string }>;
}) {
  const { week } = await params;
  const weekNumber = Number(week);
  if (!Number.isInteger(weekNumber)) notFound();

  const results = await loadWeekResults(weekNumber);
  if (!results) notFound();

  const { facts, matchups, recap, playoff } = results;
  const column = recap?.published ? renderMarkdown(recap.columnMd).html : null;

  // Every game as a box score. Four fixtures, so four loads — cached with the page.
  const fixtures = await loadFixtureLinks(results.week);
  const views = (await Promise.all(fixtures.map((f) => loadMatchup(results.week, f.slug)))).filter(
    (v): v is MatchupView => v !== null,
  );
  const brief = weekBrief({ views, luck: playoff ? [] : facts.luck });
  const factsOf = new Map(facts.teams.map((t) => [t.model, t]));
  const closestKey = matchups[0] ? [matchups[0].winner.model, matchups[0].loser.model].sort().join('|') : null;
  const prevWeek = results.week > 1 ? results.week - 1 : null;
  const weeks = await scoredWeeks();
  const nextWeek = weeks.includes(results.week + 1) ? results.week + 1 : null;

  return (
    <main className="wrap">
      <div className="yard" />
      <h1>
        Week {results.week}
        {playoff ? ` — ${playoff.weekLabel}` : ''}
      </h1>
      <p className="sub">
        {facts.scoring_status === 'final'
          ? 'Final — re-scored Thursday against corrected stats'
          : 'Provisional — re-scored Thursday, and the difference is published'}
      </p>

      {/* The trophy, and immediately beneath it the sentence that stops the trophy
          overwriting the ranking (SPEC §3.3). The bracket is two games; the all-play
          table is fourteen weeks. Saying so here is the whole reason both exist. */}
      {playoff?.champion && (
        <div className="panel">
          <p>
            <strong>{playoff.champion}</strong> wins the {facts.season} title, beating{' '}
            {playoff.runnerUp} in the final.
            {playoff.third ? ` ${playoff.third} finished third.` : ''}
          </p>
          <p className="sub">
            The bracket is the luckiest part of the season — two head-to-head games with no
            all-play backstop. The regular-season table remains the answer to which model
            managed best.
          </p>
        </div>
      )}

      <nav className="week-pager" aria-label="Weeks">
        {prevWeek ? <Link href={`/results/${prevWeek}`}>← Week {prevWeek}</Link> : <span />}
        <Link href="/results">All weeks</Link>
        {nextWeek ? <Link href={`/results/${nextWeek}`}>Week {nextWeek} →</Link> : <span />}
      </nav>

      {brief.length > 0 && (
        <div className="panel brief">
          <h3>The week in brief</h3>
          <ul className="story">
            {brief.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="sub" style={{ margin: '12px 0 0' }}>
            Computed from the box scores by the league&apos;s code the moment the week is scored.
            {recap && (column ? ' The beat writer\u2019s column is further down.' : ' The beat writer\u2019s column is held back: its figures did not all check out.')}
          </p>
        </div>
      )}

      <div className="yard" />
      <h2>Scoreboard</h2>
      <p className="sub">Tap any game for the slot-by-slot box score, the bench, and what each model said</p>
      <Scoreboard
        week={results.week}
        decided
        games={views.map((v) => {
          const pair = [v.home.model, v.away.model].sort().join('|');
          const round = playoff?.roundOf.get(pair);
          const note = (model: string) => {
            const t = factsOf.get(model);
            if (!t) return null;
            const seed = playoff?.seedOf.get(model);
            const auto = (v.home.model === model ? v.home : v.away).autopilot;
            const calls =
              auto?.delta == null ? null : auto.swaps.length === 0 ? 'no changes' : `calls ${signed(auto.delta)}`;
            return [seed ? `Seed ${seed}` : `${t.record}`, calls]
              .concat(t.fallback_applied ? ['fallback'] : [])
              .filter(Boolean)
              .join(' · ');
          };
          return {
            label: round ? roundLabel(round) : pair === closestKey ? 'Closest game' : null,
            home: { model: v.home.model, modelKey: v.home.modelKey, points: v.home.points, note: note(v.home.model) },
            away: { model: v.away.model, modelKey: v.away.modelKey, points: v.away.points, note: note(v.away.model) },
          };
        })}
      />

      {!playoff && (
        <>
          <div className="yard" />
          <h2>Standings after week {results.week}</h2>
          <p className="sub">Head-to-head ranks. All-play is this week&apos;s score against all seven rivals.</p>
          <div className="scroll narrow">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th className="l">Team</th>
                  <th>Record</th>
                  <th>Wk {results.week}</th>
                  <th>All-play</th>
                  <th>Pts for</th>
                </tr>
              </thead>
              <tbody>
                {facts.teams.map((t) => (
                  <tr key={t.model}>
                    <td className="rank">{t.rank ?? '—'}</td>
                    <td className="l tname">{t.model}</td>
                    <td>{t.record}</td>
                    <td className={t.result === 'W' ? 'pos' : t.result === 'L' ? 'neg' : 'muted'}>
                      {t.result ?? '—'} {t.points.toFixed(2)}
                    </td>
                    <td className="muted">{t.allplay_week}</td>
                    <td className="muted">{t.points_for.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="yard" />
      <h2>Lineup calls</h2>
      <p className="sub">
        What each model&apos;s own choices were worth against the autopilot — the lineup the
        league&apos;s code sets from projections before any model is asked. Same roster, same
        week; only the calls differ. Tap a game for the individual swaps.
      </p>

      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th className="l">Team</th>
              <th>Scored</th>
              <th>Autopilot</th>
              <th>Calls</th>
              <th>Changes</th>
              <th title="Best lineup the roster held, known only after the games">Hindsight best</th>
            </tr>
          </thead>
          <tbody>
            {views
              .flatMap((v) => [v.home, v.away])
              .sort((a, b) => (b.autopilot?.delta ?? -Infinity) - (a.autopilot?.delta ?? -Infinity))
              .map((side) => {
                const team = factsOf.get(side.model);
                const delta = side.autopilot?.delta ?? null;
                return (
                  <tr key={side.modelKey}>
                    <td className="l tname">
                      {side.model}
                      {/* A lineup the model did not choose must never read as one it did. */}
                      {team?.fallback_applied && <span className="tag">fallback</span>}
                      {team && team.empty_slots > 0 && <span className="tag">{team.empty_slots} empty</span>}
                    </td>
                    <td>{side.points?.toFixed(2) ?? '—'}</td>
                    <td className="muted">{side.autopilot?.points?.toFixed(2) ?? '—'}</td>
                    <td className={delta === null || delta === 0 ? 'muted' : delta > 0 ? 'pos' : 'neg'}>
                      {delta === null ? '—' : signed(delta)}
                    </td>
                    <td className="muted">
                      {side.autopilot ? (side.autopilot.swaps.length === 0 ? 'none' : side.autopilot.swaps.length) : '—'}
                    </td>
                    <td className="muted">{side.optimal?.toFixed(2) ?? '—'}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
      <p className="sub" style={{ marginTop: 10 }}>
        &ldquo;Hindsight best&rdquo; is the highest score the roster could have posted, known only once
        the games were played. It measures luck as much as judgment, which is why it no longer leads.
      </p>

      {facts.waiver_adds.length > 0 && (
        <>
          <div className="yard" />
          <h2>What last week&apos;s waivers bought</h2>
          <p className="sub">Every winning claim, and what the player did with it</p>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th className="l">Team</th>
                  <th className="l">Player</th>
                  <th>Paid</th>
                  <th>Scored</th>
                </tr>
              </thead>
              <tbody>
                {facts.waiver_adds.map((add) => (
                  <tr key={`${add.model}-${add.player}`}>
                    <td className="l tname">{add.model}</td>
                    <td className="l">{add.player}</td>
                    <td>${add.bid}</td>
                    {/* Null, not zero: "we bought him and he did nothing" and "we have
                        not scored him yet" are different facts. */}
                    <td className="muted">{add.points_this_week ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {recap && (
        <>
          <div className="yard" />
          <h2>{recap.headline}</h2>
          <p className="sub">Written by a model with no team in this league</p>

          {!recap.numberCheckPassed && (
            <div className="notice info">
              Our deterministic check could not verify everything in this column:{' '}
              {recap.numberCheckNotes.join('; ')}. Published anyway — what the beat writer got
              wrong is a finding about these models, not something to quietly fix.
            </div>
          )}

          {column ? (
            // `.post-body` sets dark type for the light `.post` ground. Without the
            // wrapper — which is how this shipped — the column was navy on navy.
            <article className="post">
              <div className="post-body" dangerouslySetInnerHTML={{ __html: column }} />
            </article>
          ) : (
            <div className="notice info">
              This week&apos;s column is written but held back. A column publishes itself only
              when every figure and result in it matches the scores, and this one did not.
            </div>
          )}
        </>
      )}

      <div className="yard" />
      <p className="lede-copy">
        Every decision behind these numbers is published in full — the prompt that produced it and
        the raw response that came back, per team, under{' '}
        <Link href="/teams">all eight teams</Link>. <Link href="/results">Every week</Link>.
      </p>
    </main>
  );
}
