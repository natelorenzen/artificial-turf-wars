import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { renderMarkdown } from '@/lib/blog/render';
import { absoluteUrl } from '@/lib/site/nav';
import { loadWeekResults, roundLabel, scoredWeeks } from '@/lib/site/results';

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

      <h2>Results</h2>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              {playoff && <th className="l">Round</th>}
              <th className="l">Winner</th>
              <th />
              <th className="l">Loser</th>
              <th>Margin</th>
            </tr>
          </thead>
          <tbody>
            {matchups.map((m) => (
              <tr key={`${m.winner.model}-${m.loser.model}`}>
                {playoff && (
                  <td className="l muted">
                    {(() => {
                      const round = playoff.roundOf.get([m.winner.model, m.loser.model].sort().join('|'));
                      return round ? roundLabel(round) : '';
                    })()}
                  </td>
                )}
                <td className="l tname">
                  {playoff?.seedOf.has(m.winner.model) ? `(${playoff.seedOf.get(m.winner.model)}) ` : ''}
                  {m.winner.model} <strong>{m.winner.points}</strong>
                </td>
                <td className="muted">{m.tied ? 'tie' : 'def.'}</td>
                <td className="l muted">
                  {playoff?.seedOf.has(m.loser.model) ? `(${playoff.seedOf.get(m.loser.model)}) ` : ''}
                  {m.loser.model} {m.loser.points}
                </td>
                <td>{m.margin}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* The divergence the format exists to expose. Computed deterministically, not
          spotted by a model — a model asked to notice it would sometimes not, and the
          finding would vary week to week for no reason. */}
      {facts.luck.length > 0 && !playoff && (
        <>
          <div className="yard" />
          <h2>Where the schedule and the scoreboard disagree</h2>
          <p className="sub">Head-to-head decides the season. All-play says who managed best.</p>
          <div className="panel">
            {facts.luck.map((note) => (
              <p key={note.model}>
                <strong>{note.model}</strong> {note.note}.
              </p>
            ))}
          </div>
        </>
      )}

      <div className="yard" />
      <h2>Lineup efficiency</h2>
      <p className="sub">Points scored ÷ the best lineup that roster could have started</p>

      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th className="l">Team</th>
              <th>Scored</th>
              <th>Best possible</th>
              <th>Efficiency</th>
              <th>Left on bench</th>
              <th>All-play</th>
            </tr>
          </thead>
          <tbody>
            {[...facts.teams]
              .sort((a, b) => b.lineup_efficiency - a.lineup_efficiency)
              .map((team) => (
                <tr key={team.model}>
                  <td className="l tname">
                    {team.model}
                    {/* A lineup the model did not choose must never read as one it did. */}
                    {team.fallback_applied && <span className="tag">fallback</span>}
                    {team.empty_slots > 0 && <span className="tag">{team.empty_slots} empty</span>}
                  </td>
                  <td>{team.points}</td>
                  <td className="muted">{team.optimal_points}</td>
                  <td>{(team.lineup_efficiency * 100).toFixed(1)}%</td>
                  <td className="muted">{team.points_left_on_bench}</td>
                  <td className="muted">{team.allplay_week}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

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
            <div className="post-body" dangerouslySetInnerHTML={{ __html: column }} />
          ) : (
            <div className="notice info">
              This week&apos;s column is written but not yet released. Nothing publishes under a
              byline without a human reading it first.
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
