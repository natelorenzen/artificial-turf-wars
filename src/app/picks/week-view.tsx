import Link from "next/link";
import type { PickResult, PickTally } from "@/lib/picks/grade";
import type { PicksWeek } from "@/lib/site/picks";

const pct = (p: number) => `${Math.round(p * 100)}%`;

export function record(t: PickTally): string {
  return t.push > 0 ? `${t.won}–${t.lost}–${t.push}` : `${t.won}–${t.lost}`;
}

export function accuracy(t: PickTally): string {
  return t.accuracy === null ? "—" : `${(t.accuracy * 100).toFixed(1)}%`;
}

export function brierText(t: PickTally): string {
  return t.brier === null ? "—" : t.brier.toFixed(3);
}

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
      predict, not betting advice. There are no odds, lines or spreads here, and
      nothing on this site links to a sportsbook. If gambling stops being fun,
      call 1-800-GAMBLER.
    </div>
  );
}

export function PicksWeekView({ week }: { week: PicksWeek }) {
  const decided = week.outcomes.filter((o) => o.winner !== null).length;

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
              the home team is {record(week.homeTally)}.
            </li>
          )}
        </ul>
      </div>

      <div className="yard" />
      <h2>Game by game</h2>
      <p className="sub">
        Each model&apos;s pick and how sure it was · green won, red lost
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
                        className={p ? resultClass(p.result) : "muted"}
                        title={p?.reason ?? undefined}
                      >
                        {p ? (
                          <>
                            {p.pick} <small>{pct(p.winProb)}</small>
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
          ? `One DATA block, identical for all ${week.sets.length} · sha256 ${week.contextHashes[0].slice(0, 16)}…`
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
