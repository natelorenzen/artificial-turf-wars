import type { Metadata } from 'next';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { loadDraftBoard, type BoardPick } from '@/lib/backtest/results';
import { LEAGUE } from '@/lib/config/league';

export const metadata: Metadata = {
  title: 'The 2025 backtest draft board — Artificial Turf Wars',
  description:
    'All 120 picks from the backtest draft, with the reason each model gave for taking the player it took.',
};

export const revalidate = 3600;

const SEASON = 2025;

export default async function BacktestDraftPage() {
  const board = await loadDraftBoard(supabase, SEASON);
  const rounds = [...new Set(board.map((p) => p.round))].sort((a, b) => a - b);

  const fallbacks = board.filter((p) => p.fallbackApplied).length;
  const narrowed = board.filter((p) => p.poolNarrowed).length;
  const flagged = board.filter((p) => p.unsupportedClaims.length > 0).length;

  return (
    <main className="wrap">
      <div className="yard" />
      <h1>The backtest draft board</h1>
      <p className="sub">
        {SEASON} · {board.length} picks · every reason as the model gave it
      </p>

      <p className="lede-copy">
        This is the full board from the <Link href="/backtest">2025 backtest</Link> — the rehearsal
        run, not the real thing. Each pick shows what the model chose and the one-sentence reason it
        gave at the time, unedited.
      </p>

      {board.length === 0 ? (
        <div className="notice">No draft has been recorded for {SEASON}.</div>
      ) : (
        <>
          <div className="tiles">
            <div className="tile">
              <div className="k">Picks</div>
              <div className="v">{board.length}</div>
              <div className="n">
                {LEAGUE.teams} teams × {LEAGUE.draftRounds} rounds, snake order
              </div>
            </div>
            <div className="tile">
              <div className="k">Fallbacks applied</div>
              <div className="v">{fallbacks}</div>
              <div className="n">
                Picks where the model returned something illegal and deterministic code chose
                instead.
              </div>
            </div>
            <div className="tile">
              <div className="k">Pool narrowed</div>
              <div className="v">{narrowed}</div>
              <div className="n">
                From round {LEAGUE.softCapRound}, a team missing a required position has its board
                restricted — and is told so.
              </div>
            </div>
            <div className="tile">
              <div className="k">Claims flagged</div>
              <div className="v">{flagged}</div>
              <div className="n">
                Picks with at least one stated reason our checker could not tie to the data or the
                rulebook.
              </div>
            </div>
          </div>

          <div className="notice info" style={{ marginTop: 18 }}>
            This draft ran before the dossier existed, so the models had raw projections and no view
            of replacement level. Four of the first five picks were quarterbacks.
          </div>

          {rounds.map((round) => (
            <Round key={round} round={round} picks={board.filter((p) => p.round === round)} />
          ))}
        </>
      )}
    </main>
  );
}

function Round({ round, picks }: { round: number; picks: BoardPick[] }) {
  return (
    <>
      <div className="yard" />
      <h2>Round {round}</h2>
      <p className="sub">
        Picks {picks[0]?.pickOverall}–{picks[picks.length - 1]?.pickOverall}
      </p>

      <div className="quotes">
        {picks.map((pick) => (
          <div className="quote" key={pick.pickOverall}>
            <div className="who">
              {pick.player}
              <small>
                #{pick.pickOverall} · {pick.position} · {pick.model}
                {pick.confidence !== null && ` · conf ${pick.confidence.toFixed(2)}`}
                {pick.decisionId && (
                  <Link className="record-link" href={`/decisions/${pick.decisionId}`}>
                    full record
                  </Link>
                )}
              </small>
            </div>
            <div className="said">
              {pick.fallbackApplied && <span className="tag">fallback</span>}
              {pick.poolNarrowed && <span className="tag">pool narrowed</span>}
              {pick.headline ?? <span className="muted">no reason recorded</span>}
              {pick.unsupportedClaims.length > 0 && (
                <div className="flags">
                  {pick.unsupportedClaims.map((claim) => (
                    <div key={claim}>⚑ {claim}</div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
