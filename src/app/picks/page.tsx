import Link from 'next/link';
import type { Metadata } from 'next';
import { loadPicksBoard, loadPicksWeek } from '@/lib/site/picks';
import { accuracy, brierText, money, PicksDisclaimer, PicksWeekView, record, signedMoney } from './week-view';
import { STARTING_BANKROLL } from '@/lib/picks/bankroll';

export const metadata: Metadata = {
  title: 'NFL picks — Artificial Turf War',
  description:
    'Eight AI models pick the winner of every NFL game each week, with a probability, and bet $100 of play money on the moneylines for the rest of the season. For entertainment only.',
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
      <p className="sub">Every game, every week · picked before the first kickoff · graded and settled by code</p>

      <p className="lede-copy">
        Every week each of the eight models picks the winner of every NFL game and says how sure
        it is. They may use what they already know about football. We give them this
        season&apos;s results, the injury report and the projected starting quarterbacks,
        because their training data stops before the season began. No model sees another&apos;s
        picks. They are graded here all season on how often they are right, and on whether their
        confidence was earned.
      </p>
      <p className="lede-copy">
        From week 3 they also see the market&apos;s moneyline for every game, and each has $
        {STARTING_BANKROLL} of play money to bet with for the rest of the season, on either team or
        none. No top-ups. Whoever has the most money at the end wins.
      </p>

      <PicksDisclaimer />

      {!board ? (
        <div className="notice info">
          No picks yet. Each week&apos;s set is made before that week&apos;s first kickoff.
        </div>
      ) : (
        <>
          <div className="yard" />
          <h2>Bankroll</h2>
          <p className="sub">
            ${STARTING_BANKROLL} each, from week 3, bet on moneylines · money on a game not yet scored is shown at risk
          </p>
          <div className="scroll compact">
            <table>
              <thead>
                <tr>
                  <th className="l">Model</th>
                  <th>Balance</th>
                  <th>Profit</th>
                  <th>Bets</th>
                  <th>Staked</th>
                  <th>ROI</th>
                  <th>At risk</th>
                </tr>
              </thead>
              <tbody>
                {[...board.rows]
                  .sort((a, b) => b.bankroll.balance - a.bankroll.balance || a.model.localeCompare(b.model))
                  .map((row) => {
                    const b = row.bankroll;
                    const profit = b.balance - STARTING_BANKROLL;
                    return (
                      <tr key={row.modelKey}>
                        <td className="l tname">
                          <Link href={`/team/${row.modelKey}`}>{row.model}</Link>
                        </td>
                        <td>{money(b.balance)}</td>
                        <td className={profit > 0 ? 'pos' : profit < 0 ? 'neg' : 'muted'}>{signedMoney(profit)}</td>
                        <td>{b.won + b.lost + b.push + b.pending === 0 ? '—' : `${b.won}–${b.lost}${b.push ? `–${b.push}` : ''}`}</td>
                        <td className="muted">{money(b.staked)}</td>
                        <td className="muted">{b.roi === null ? '—' : `${(b.roi * 100).toFixed(1)}%`}</td>
                        <td className="muted">{b.atRisk > 0 ? money(b.atRisk) : '—'}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>

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
                {board.market && (
                  <tr className="picks-total">
                    <td className="l muted">The market (favourite, margin removed)</td>
                    <td>{record(board.market)}</td>
                    <td>{accuracy(board.market)}</td>
                    <td>{brierText(board.market)}</td>
                    <td className="muted">
                      {board.market.meanConfidence === null ? '—' : `${Math.round(board.market.meanConfidence * 100)}%`}
                    </td>
                  </tr>
                )}
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
