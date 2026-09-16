import Link from 'next/link';
import { matchupHref } from '@/lib/site/matchup';

export interface ScoreboardSide {
  model: string;
  modelKey: string;
  /** Null before a side has a number. Rendered as a dash, never as zero. */
  points: number | null;
  /** Small line under the name: a record, a projection, an efficiency. */
  note?: string | null;
}

export interface ScoreboardGame {
  home: ScoreboardSide;
  away: ScoreboardSide;
  /** Small caption on the card: "Final", "Closest game", "Live". */
  label?: string | null;
}

/**
 * The week's games as cards, each one a link into its box score.
 *
 * `decided` controls whether the higher score is marked as a WIN (amber) or only as
 * AHEAD (weight). A live lead is not a result, and colouring it like one would say it was.
 */
export function Scoreboard({
  week,
  games,
  decided,
}: {
  week: number;
  games: ScoreboardGame[];
  decided: boolean;
}) {
  return (
    <div className="board">
      {games.map((game) => {
        const both = game.home.points !== null && game.away.points !== null;
        const homeAhead = both && game.home.points! > game.away.points!;
        const awayAhead = both && game.away.points! > game.home.points!;
        return (
          <Link
            key={`${game.home.modelKey}-${game.away.modelKey}`}
            href={matchupHref(week, game.home.modelKey, game.away.modelKey)}
            className="board-card"
          >
            {game.label && <span className="board-label">{game.label}</span>}
            <Row side={game.home} ahead={homeAhead} decided={decided} />
            <Row side={game.away} ahead={awayAhead} decided={decided} />
            <span className="board-cta">Box score →</span>
          </Link>
        );
      })}
    </div>
  );
}

function Row({ side, ahead, decided }: { side: ScoreboardSide; ahead: boolean; decided: boolean }) {
  const cls = ahead ? (decided ? 'won' : 'ahead') : '';
  return (
    <span className={`board-row ${cls}`}>
      <span className="board-team">
        <span className="board-name">{side.model}</span>
        {side.note && <span className="board-note">{side.note}</span>}
      </span>
      <span className="board-pts">
        {side.points === null ? '—' : side.points.toFixed(2)}
        {ahead && decided && <span className="board-w">W</span>}
      </span>
    </span>
  );
}
