import Link from 'next/link';
import type { Metadata } from 'next';
import { LEAGUE } from '@/lib/config/league';
import { describeLineupSkill } from '@/lib/engine/decision-score';
import { loadRatings } from '@/lib/site/ratings';

export const metadata: Metadata = {
  title: 'Skill board — Artificial Turf War',
  description:
    'Which AI model manages best once the luck is removed: forecast calibration, lineup efficiency and all-play record for all eight models, scored every week.',
  alternates: { canonical: '/ratings' },
};

export const revalidate = 900;

const pct = (n: number | null) => (n === null ? '—' : `${(n * 100).toFixed(1)}%`);
const signed = (n: number | null) => (n === null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(1)}`);

export default async function RatingsPage() {
  const board = await loadRatings();

  return (
    <main className="wrap">
      <div className="yard" />
      <h1>Skill board</h1>
      <p className="sub">Who is managing best, with the luck taken out</p>

      <p className="lede-copy">
        Head-to-head decides the season, and head-to-head over {LEAGUE.regularSeasonWeeks} weeks is
        mostly noise. A model can start the right nine players and lose by forty because somebody
        else&apos;s tight end scored three times. The <Link href="/results">standings</Link> answer
        who won. This page answers three questions that survive the variance.
      </p>

      {board.rows.length === 0 ? (
        <div className="notice info">
          Nothing to score yet. The board fills in from the first week the models set a lineup.
        </div>
      ) : (
        <>
          <div className="yard" />
          <h2>Decision score</h2>
          <p className="sub">
            Points added over the deterministic manager that could have replaced them
          </p>

          <p className="lede-copy">
            Every job in this league computes an answer before it calls anybody — the lineup cron
            seeds the best-projection lineup for all eight teams before the first model call, and
            the draft has a highest-projected-available fallback. Together those are a ninth
            manager, playing the same league from the same data with no judgment in it at all.
            So the eval is simply: <strong>how many points did each model add over the version of
            itself that was a sort?</strong> A model that starts its highest projections every week
            scores zero here however it finishes, because a <code>.sort()</code> would have played
            the identical season.
          </p>

          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th className="l">Model</th>
                  <th>Decision score</th>
                  <th>Lineups</th>
                  <th>Draft</th>
                  <th>Calibration</th>
                  <th className="l">Reads as</th>
                </tr>
              </thead>
              <tbody>
                {board.rows.map((row) => (
                  <tr key={row.modelKey}>
                    <td className="l tname">
                      <Link href={`/team/${row.modelKey}`}>{row.model}</Link>
                      {row.decision.provisional && <span className="muted"> · provisional</span>}
                    </td>
                    <td>
                      <strong>{signed(row.decision.total)}</strong>
                    </td>
                    <td>{signed(row.decision.lineup.total)}</td>
                    <td>{signed(row.decision.draftDelta)}</td>
                    <td>
                      {row.calibration.forecasts > 0 ? row.calibration.skillScore.toFixed(3) : '—'}
                    </td>
                    <td className="l muted">{describeLineupSkill(row.decision.lineup)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="sub">
            The model and its baseline hold the <strong>same roster</strong> in the{' '}
            <strong>same week</strong> against the <strong>same outcomes</strong>, so whatever luck
            the week contained hits both and cancels. What survives the subtraction is only what
            the model chose. It is not luck-free — a model that correctly benches a player who then
            scores 30 is charged for it — which is why &ldquo;within the noise&rdquo; is printed
            beside any figure that fourteen weeks cannot distinguish from chance.
          </p>

          <div className="yard" />
          <h2>Calibration</h2>
          <p className="sub">
            Every lineup carries a stated probability of beating that week&apos;s opponent. Those
            are forecasts, and forecasts can be graded.
          </p>

          <p className="lede-copy">
            A model that says 0.9 and wins nine times in ten is calibrated whatever its record. One
            that says 0.9 and wins half its games is overconfident even if it is top of the table.
            And one that answers 0.5 every week is impossible to fault and tells you nothing — which
            is what <strong>movement</strong> catches.
          </p>

          {board.forecasts === 0 ? (
            <div className="notice info">
              No forecast has been graded yet.
              {board.excludedForecasts > 0 && (
                <>
                  {' '}
                  {board.excludedForecasts} earlier answer
                  {board.excludedForecasts === 1 ? ' is' : 's are'} deliberately excluded: they were
                  given before the prompt defined what the number meant, so they are not answers to
                  this question.
                </>
              )}
            </div>
          ) : (
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th className="l">Model</th>
                    <th>Forecasts</th>
                    <th>Brier</th>
                    <th>Skill</th>
                    <th>Movement</th>
                    <th className="l">Reads as</th>
                  </tr>
                </thead>
                <tbody>
                  {board.rows.map((row) => (
                    <tr key={row.modelKey}>
                      <td className="l tname">
                        <Link href={`/team/${row.modelKey}`}>{row.model}</Link>
                      </td>
                      <td>{row.calibration.forecasts || '—'}</td>
                      <td>{row.calibration.forecasts ? row.calibration.brier.toFixed(3) : '—'}</td>
                      <td>
                        {row.calibration.forecasts ? row.calibration.skillScore.toFixed(3) : '—'}
                      </td>
                      <td>
                        {row.calibration.forecasts ? row.calibration.resolution.toFixed(3) : '—'}
                      </td>
                      <td className="l muted">{row.calibrationNote}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="sub">
            <strong>Brier</strong> is mean squared forecast error — lower is better, and 0.250 is
            what you get by calling every week a coin flip. <strong>Skill</strong> compares each
            model against a forecaster that always predicts the league&apos;s base win rate;
            positive means the varying forecasts beat simply knowing that everybody wins about half
            the time. <strong>Movement</strong> is how far the forecasts travel from their own
            average — a hedger scores zero.
          </p>

          <div className="yard" />
          <h2>Lineup skill</h2>
          <p className="sub">
            Points started as a share of the best available from the roster held. No opponent enters
            this number at all.
          </p>

          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th className="l">Model</th>
                  <th>Lineup efficiency</th>
                  <th>All-play</th>
                  <th>Weeks</th>
                </tr>
              </thead>
              <tbody>
                {[...board.rows]
                  .sort((a, b) => (b.lineupSkill ?? 0) - (a.lineupSkill ?? 0))
                  .map((row) => (
                    <tr key={row.modelKey}>
                      <td className="l tname">
                        <Link href={`/team/${row.modelKey}`}>{row.model}</Link>
                      </td>
                      <td>{pct(row.lineupSkill)}</td>
                      <td>{pct(row.allPlay)}</td>
                      <td>{row.weeksScored || '—'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          <p className="sub">
            <strong>Lineup efficiency</strong> is the purest skill measure here — it asks only
            whether the model started its best nine, and is unaffected by who it played or how the
            players did relative to expectation. <strong>All-play</strong> is the win rate against
            all seven rivals every week, which removes the schedule but keeps the players&apos; own
            variance.
          </p>
        </>
      )}

      <div className="yard" />
      <div className="panel">
        <p>
          <strong>Why some answers are not scored.</strong> Until 14 August 2026 the{' '}
          <code>confidence</code> field was undefined — it appeared in the output example as{' '}
          <code>0.5</code> and nothing told a model what the number meant. Every model answered
          anyway. Grading those against real results and publishing a lab as overconfident would be
          an accusation built on a question nobody asked, so they are excluded by prompt version
          rather than quietly averaged in.
        </p>
        <p className="sub">
          Nothing on this page involves a model call. Every figure is arithmetic over published
          rows and can be recomputed by anyone who doubts it. See{' '}
          <Link href="/methodology">methodology</Link>.
        </p>
      </div>
    </main>
  );
}
