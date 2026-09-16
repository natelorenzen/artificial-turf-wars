/**
 * The deterministic half of lineup-setting: shaping a roster and the fallback lineup.
 *
 * Split from `lineups.ts` so that read-only code — the site's autopilot replay — can use
 * the exact function the lineup cron seeds with, without pulling in the model client.
 */

import { fallbackLineup, isStartable, type Lineup, type LineupPlayer } from '@/lib/engine/lineup';
import type { RosterEntry } from '@/lib/prompt/context';

/**
 * The roster as the lineup engine sees it: projections in the `points` field, because
 * a lineup is set against projections and graded against actuals.
 *
 * A null projection becomes 0 here and stays null in the DATA block. Those are not
 * inconsistent — the engine needs a number to sort by, and the model needs to know the
 * number is missing rather than genuinely zero.
 */
export function lineupRoster(entries: RosterEntry[]): LineupPlayer[] {
  return entries.map((entry) => ({
    playerId: entry.player_id,
    position: entry.position as LineupPlayer['position'],
    points: entry.projection ?? 0,
    isOnBye: entry.is_on_bye,
    injuryStatus: entry.injury_status,
  }));
}

/** Ids a model is allowed to name: not on bye, not Out/Inactive/IR (SPEC §4.4). */
export function startableIds(roster: LineupPlayer[]): string[] {
  return roster.filter(isStartable).map((p) => p.playerId).sort();
}

/**
 * The deterministic answer, used whenever a model does not supply a usable one.
 *
 * Built from startable players only. `optimalLineup` filters byes but not injuries,
 * because as the SCORING denominator it must measure the best lineup that could have
 * been set — and a player listed Out on Thursday sometimes plays on Sunday. As a
 * FALLBACK the opposite is true: starting someone we were told is out is a choice
 * nobody made on purpose.
 */
export function deterministicLineup(roster: LineupPlayer[]): Lineup {
  return fallbackLineup(roster.filter(isStartable));
}

