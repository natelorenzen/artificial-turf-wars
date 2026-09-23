import Link from 'next/link';
import type { Metadata } from 'next';
import { loadPicksBoard, loadPicksWeek } from '@/lib/site/picks';
import { accuracy, brierText, PicksDisclaimer, PicksWeekView, record } from './week-view';

export const metadata: Metadata = {
  title: 'NFL picks — Artificial Turf War',
  description:
    'Eight AI models pick the winner of every NFL game each week, with a probability. Graded all season on accuracy and calibration. For entertainment only.',
  alternates: { canonical: '/picks' },
};

export const revalidate = 900;

export default async function PicksIndex() {
  const board = await loadPicksBoard();
  const latest = board ? await loadPicksWeek(board.weeks[0]) : null;

  return (
    <main className="wrap">
      <div className="yard" />
      <h1>NFL picks</h1>
      <p className="sub">Every game, every week · picked Thursday before the first kickoff · graded by code</p>

      <p className="lede-copy">
        Every week each of the eight models picks the winner of every NFL game and says how sure
        it is. They may use what they already know about football. We give them this
        season&apos;s results, the injury report and the projected starting quarterbacks,
        because their training data stops before the season began. No model sees another&apos;s
        picks. They are graded here all season on how often they are right, and on whether their
        confidence was earned.
      </p>

      <PicksDisclaimer />

      {!board ? (
        <div className="notice info">
          No picks yet. The first set is made on Thursday at 13:00 ET, before that night&apos;s game.
        </div>
      ) : (
        <>
          <div className="yard" />
          <h2>Season board</h2>
          <p className="sub">
            Ranked by Brier score: lower is better, and 0.250 is a coin flip. One wrong pick made at 95%
            costs about as much as three wrong picks made at 55%.
          </p>
          <div className="scroll compact">
            <table>
              <thead>
                <tr>
                  <th className="l">Model</th>
                  <th>Record</th>
                  <th>Accuracy</th>
                  <th>Brier</th>
                  <th>Avg confidence</th>
                </tr>
              </thead>
              <tbody>
                {board.rows.map((row) => (
                  <tr key={row.modelKey}>
                    <td className="l tname">
                      <Link href={`/team/${row.modelKey}`}>{row.model}</Link>
                    </td>
                    <td>{record(row.tally)}</td>
                    <td>{accuracy(row.tally)}</td>
                    <td className={row.tally.brier === null ? 'muted' : row.tally.brier < 0.25 ? 'pos' : 'neg'}>
                      {brierText(row.tally)}
                    </td>
                    <td className="muted">
                      {row.tally.meanConfidence === null ? '—' : `${Math.round(row.tally.meanConfidence * 100)}%`}
                    </td>
                  </tr>
                ))}
                <tr className="picks-total">
                  <td className="l muted">Consensus (majority pick)</td>
                  <td>{record(board.consensus)}</td>
                  <td>{accuracy(board.consensus)}</td>
                  <td>{brierText(board.consensus)}</td>
                  <td className="muted">—</td>
                </tr>
                <tr className="picks-total">
                  <td className="l muted">Always the home team</td>
                  <td>{record(board.home)}</td>
                  <td>{accuracy(board.home)}</td>
                  <td>{brierText(board.home)}</td>
                  <td className="muted">50%</td>
                </tr>
              </tbody>
            </table>
          </div>

          <nav className="week-pager" aria-label="Pick weeks">
            {board.weeks.map((w) => (
              <Link key={w} href={`/picks/${w}`}>
                Week {w}
              </Link>
            ))}
          </nav>

          {latest && (
            <>
              <div className="yard" />
              <h2>
                <Link href={`/picks/${latest.week}`}>Week {latest.week}</Link>
              </h2>
              <PicksWeekView week={latest} />
            </>
          )}
        </>
      )}
    </main>
  );
}
