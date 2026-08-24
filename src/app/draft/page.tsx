import type { Metadata } from 'next';
import { DatasetJsonLd } from '@/components/JsonLd';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { loadDraftBoard, type BoardPick } from '@/lib/backtest/results';
import { LEAGUE } from '@/lib/config/league';

/**
 * The live draft board. Same loader and same shape as `/backtest/draft`, which is
 * deliberate: `loadDraftBoard` was written to serve both, so this page was already
 * exercised against 120 real picks before it ever rendered the season that counts.
 *
 * The one thing this page says that the backtest page cannot: every pick here is a
 * model's own decision. Getting to zero fallbacks took three fixes on the day, and the
 * fallback tile below is the number that has to stay at zero for that claim to hold.
 */
export const metadata: Metadata = {
  title: 'The 2026 draft board — Artificial Turf War',
  description:
    'All 120 picks of the 2026 draft, with the reason each model gave for taking the player it took. No pick on this board was made by fallback code.',
  alternates: { canonical: '/draft' },
};

export const revalidate = 3600;

const SEASON = LEAGUE.season;

export default async function DraftBoardPage() {
  const board = await loadDraftBoard(supabase, SEASON);
  const rounds = [...new Set(board.map((p) => p.round))].sort((a, b) => a - b);

  const fallbacks = board.filter((p) => p.fallbackApplied).length;
  const narrowed = board.filter((p) => p.poolNarrowed).length;
  const flagged = board.filter((p) => p.unsupportedClaims.length > 0).length;

  return (
    <main className="wrap">
      <DatasetJsonLd
        name="Artificial Turf War — 2026 draft board"
        description="All 120 picks of the 2026 draft made by eight frontier language models, each with the model's stated reasoning, confidence and the projection data available to it at the time."
        path="/draft"
        keywords={[
          'large language models',
          'LLM evaluation',
          'AI decision making',
          'fantasy football',
          'model comparison',
        ]}
      />
      <div className="yard" />
      <h1>The 2026 draft board</h1>
      <p className="sub">
        {SEASON} · {board.length} picks · every reason as the model gave it
      </p>

      <p className="lede-copy">
        The real thing. Eight models, fifteen rounds, one shared briefing of 332 players. Each pick
        shows what the model chose and the one-sentence reason it gave, unedited — and every pick
        links to the full stored record, including the prompt it was answering.
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
                Picks where deterministic code chose instead of the model. This board is the first
                to reach zero, and it took three fixes on the day.
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
            Conditions changed once during this draft. Picks 1–51 ran with no cap on internal
            reasoning and picks 52–120 with one, after two picks were lost to models spending an
            entire output budget thinking and returning nothing. The boundary is checkable rather
            than asserted: no decision after pick 51 exceeds 14,000 reasoning tokens.{' '}
            <Link href="/findings/thinking-until-there-was-no-room-to-answer">
              What that cost, and why
            </Link>
            .
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
