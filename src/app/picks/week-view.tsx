import Link from "next/link";
import type { PickResult, PickTally } from "@/lib/picks/grade";
import type { BetView } from "@/lib/site/picks";
import type { PicksWeek } from "@/lib/site/picks";
import { dissentKeys } from "@/lib/picks/dissent";

const pct = (p: number) => `${Math.round(p * 100)}%`;

export function money(x: number): string {
  return `$${x.toFixed(2)}`;
}

export function signedMoney(x: number): string {
  const r = Math.round(x * 100) / 100;
  return r > 0 ? `+$${r.toFixed(2)}` : r < 0 ? `−$${Math.abs(r).toFixed(2)}` : '$0.00';
}

const price = (p: number) => (p > 0 ? `+${p}` : String(p));

export function record(t: PickTally): string {
  return t.push > 0 ? `${t.won}–${t.lost}–${t.push}` : `${t.won}–${t.lost}`;
}

export function accuracy(t: PickTally): string {
  return t.accuracy === null ? "—" : `${(t.accuracy * 100).toFixed(1)}%`;
}

export function brierText(t: PickTally): string {
  return t.brier === null ? "—" : t.brier.toFixed(3);
}

function betText(bet: BetView): string {
  return `$${bet.stake} ${bet.team} ${price(bet.price)}`;
}

/** Signed percentage points, e.g. +18 pts. */
const pts = (x: number) => {
  const r = Math.round(x * 100);
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r)} pts`;
};

function resultClass(result: PickResult): string | undefined {
  return result === "won"
    ? "pos"
    : result === "lost"
      ? "neg"
      : result === "push"
        ? "muted"
        : undefined;
}

export function PicksDisclaimer() {
  return (
    <div className="notice info">
      For entertainment only. This is a public record of what eight AI models
      predict, not betting advice. The bankroll is play money: no real bets are
      placed, the prices are a median across books, and nothing on this site
      links to a sportsbook. If gambling stops being fun, call 1-800-GAMBLER.
    </div>
  );
}

export function PicksWeekView({ week }: { week: PicksWeek }) {
  const decided = week.outcomes.filter((o) => o.winner !== null).length;
  const dissentCells = dissentKeys(week.dissents);

  return (
    <>
      <div className="panel brief">
        <h3>Week {week.week} so far</h3>
        <ul className="story">
          <li>
            {decided === 0
              ? `${week.outcomes.length} games, none played yet. Every pick below was locked before the first kickoff.`
              : `${decided} of ${week.outcomes.length} games final.`}
          </li>
          {decided > 0 && week.sets[0] && (
            <li>
              {decided === week.outcomes.length
                ? "Best this week"
                : "Best so far"}
              : {week.sets[0].model}, {record(week.sets[0].tally)}. The
              consensus pick is {record(week.consensusTally)}; always picking
              the home team is {record(week.homeTally)}
              {week.marketTally ? `; the market favourite is ${record(week.marketTally)}` : ""}.
            </li>
          )}
          {week.sets.some((s) => s.weekBets.staked > 0) && (
            <li>
              {week.sets.reduce((n, s) => n + s.weekBets.won + s.weekBets.lost + s.weekBets.push + s.weekBets.pending, 0)} bets,
              ${week.sets.reduce((n, s) => n + s.weekBets.staked, 0)} staked in total.
            </li>
          )}
        </ul>
      </div>

      <div className="yard" />
      <h2>Against the grain</h2>
      <p className="sub">
        Every pick that went against the rest of the panel. The moneyline is in
        the prompt, so most picks restate the market; these are where a model
        claimed to know something the market does not. The edge is the model&apos;s own
        probability minus the market&apos;s, margin removed — what it asserted,
        not our forecast.
      </p>
      {week.dissents.length === 0 ? (
        <div className="panel">
          <p className="muted">
            No model broke from the panel this week: every game was unanimous or
            split evenly.
          </p>
        </div>
      ) : (
        <div className="panel">
          <ul className="claims dissents">
            {week.dissents.map((d) => {
              const [away, home] = d.pick.gameKey.split("@");
              const other = d.pick.pick === away ? home : away;
              const against = d.agree === d.of - 1 ? `alone against ${d.agree}` : `${d.of - d.agree} against ${d.agree}`;
              return (
                <li key={`${d.pick.gameKey}|${d.modelKey}`}>
                  <span className={resultClass(d.pick.result)}>
                    <strong>{d.model}</strong> — {d.pick.pick} over {other}, {pct(d.pick.winProb)}
                  </span>
                  {d.marketProb !== null && d.claimedEdge !== null && (
                    <span className="muted">
                      {" "}· market {pct(d.marketProb)}, edge {pts(d.claimedEdge)}
                    </span>
                  )}
                  <span className="muted"> · {against}</span>
                  {d.pick.bet && (
                    <span className={resultClass(d.pick.bet.result)}>
                      {" "}· bet {betText(d.pick.bet)}
                      {d.pick.bet.pnl !== null && ` (${signedMoney(d.pick.bet.pnl)})`}
                    </span>
                  )}
                  {d.pick.reason && <span className="claim-why">{d.pick.reason}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="yard" />
      <h2>Game by game</h2>
      <p className="sub">
        Each model&apos;s pick and how sure it was, and its bet if it made one ·
        green won, red lost · outlined against the panel
      </p>
      <div className="scroll">
        <table className="picks-grid">
          <thead>
            <tr>
              <th className="l">Game</th>
              <th>Final</th>
              <th>Consensus</th>
              {week.sets.map((s) => (
                <th key={s.modelKey}>{s.model}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {week.outcomes.map((o) => {
              const c = week.consensus.find((x) => x.gameKey === o.gameKey);
              return (
                <tr key={o.gameKey}>
                  <td className="l tname">
                    {o.away} @ {o.home}
                  </td>
                  <td className="muted">
                    {o.winner === null
                      ? "—"
                      : `${o.away} ${o.awayScore}–${o.homeScore} ${o.home}`}
                  </td>
                  <td className={c ? resultClass(c.result) : undefined}>
                    {c ? (
                      <>
                        {c.pick}{" "}
                        <small>
                          {c.agree}/{c.of}
                        </small>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  {week.sets.map((s) => {
                    const p = s.picks.get(o.gameKey);
                    return (
                      <td
                        key={s.modelKey}
                        className={
                          [
                            p ? resultClass(p.result) : "muted",
                            dissentCells.has(`${o.gameKey}|${s.modelKey}`) ? "dissent" : undefined,
                          ]
                            .filter(Boolean)
                            .join(" ") || undefined
                        }
                        title={p?.reason ?? undefined}
                      >
                        {p ? (
                          <>
                            {p.pick} <small>{pct(p.winProb)}</small>
                            {p.bet && (
                              <>
                                <br />
                                <small className={resultClass(p.bet.result)}>{betText(p.bet)}</small>
                              </>
                            )}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            <tr className="picks-total">
              <td className="l">Record</td>
              <td className="muted">Home team {record(week.homeTally)}</td>
              <td>{record(week.consensusTally)}</td>
              {week.sets.map((s) => (
                <td key={s.modelKey}>{record(s.tally)}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="yard" />
      <h2>Model by model</h2>
      <p className="sub">Every pick with the reason the model gave for it</p>
      <div className="stack">
        {week.sets.map((s) => (
          <div className="telestrator" key={s.modelKey}>
            <div className="tel-hd">
              <b>{s.model}</b>
              <span>{record(s.tally)}</span>
              {s.tally.brier !== null && (
                <span>Brier {brierText(s.tally)}</span>
              )}
              {s.bankrollAvailable !== null && (
                <span>
                  staked ${s.weekBets.staked} of {money(s.bankrollAvailable)}
                  {s.weekBets.won + s.weekBets.lost + s.weekBets.push > 0 &&
                    ` · ${signedMoney(s.weekBets.balance)}`}
                </span>
              )}
              {!s.valid && (
                <span className="tag">
                  {s.providerFailure ? "provider outage" : "no valid picks"}
                </span>
              )}
            </div>
            {s.headline && <p className="lede">{s.headline}</p>}
            {!s.valid && s.validationError && (
              <p className="muted">{s.validationError}</p>
            )}
            {s.picks.size > 0 && (
              <details className="disclose">
                <summary>All {s.picks.size} picks, with reasons</summary>
                <ul className="claims picks-reasons">
                  {[...s.picks.values()].map((p) => (
                    <li key={p.gameKey}>
                      <span className={resultClass(p.result)}>
                        {p.pick} {pct(p.winProb)}
                      </span>{" "}
                      <strong>{p.gameKey.replace("@", " @ ")}</strong>
                      {p.bet && (
                        <span className={resultClass(p.bet.result)}>
                          {" "}· bet {betText(p.bet)}
                          {p.bet.pnl !== null && ` (${signedMoney(p.bet.pnl)})`}
                        </span>
                      )}
                      {p.reason && (
                        <span className="claim-why">{p.reason}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <div className="tel-ft">
              <Link href={`/team/${s.modelKey}`}>Team page →</Link>
            </div>
            {s.rawResponse && (
              <details className="disclose">
                <summary>Raw response</summary>
                <pre>{s.rawResponse}</pre>
              </details>
            )}
          </div>
        ))}
      </div>

      <div className="yard" />
      <h2>What every model was sent</h2>
      <p className="sub">
        {week.contextHashes.length === 1
          ? `One DATA block, identical for all ${week.sets.length} · sha256 ${week.contextHashes[0].slice(0, 16)}… · each model's own bankroll is stated after the block, outside the hash`
          : `${week.contextHashes.length} different DATA blocks this week — they should be identical. This is a defect in our code.`}
      </p>
      {week.systemPrompt && (
        <details className="disclose">
          <summary>System prompt</summary>
          <pre>{week.systemPrompt}</pre>
        </details>
      )}
      {week.userPrompt && (
        <details className="disclose">
          <summary>Prompt with the DATA block</summary>
          <pre>{week.userPrompt}</pre>
        </details>
      )}
    </>
  );
}
