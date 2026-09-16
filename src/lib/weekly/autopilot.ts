/**
 * The autopilot: the lineup the league's own code would have set, replayed exactly.
 *
 * Every lineup job seeds `deterministicLineup` for all eight teams before any model is
 * called. That is the ninth manager the Decision Score measures against, and the
 * question "what did this model's judgment add?" is only honest if the ninth manager is
 * rebuilt from THE SAME NUMBERS the models were given.
 *
 * `player_projections` cannot supply them. The daily ingest projects "the next week
 * with a kickoff still ahead", which from Friday to Monday night is the week that has
 * already locked, and it replaces those rows wholesale. Week 1 of 2026 locked on
 * 9 September and its projections were rewritten on the 14th — so a baseline read from
 * that table was judging models against numbers published five days after they had
 * decided. Muse Spark 1.2 started its highest projection at every slot and was scored
 * −33.1 against it.
 *
 * The stored prompt does not have that problem. Its DATA block is the exact input: each
 * rostered player's projection, injury status and bye flag at lock. So the autopilot is
 * replayed from there, through the same `lineupRoster` → `deterministicLineup` path the
 * cron uses, and cannot drift from what the cron would actually have done.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { lineupPlayerIds, type Lineup } from '@/lib/engine/lineup';
import type { RosterEntry } from '@/lib/prompt/context';
import { round2 } from '@/lib/scoring/engine';
import { deterministicLineup, lineupRoster } from '@/lib/weekly/deterministic';

export interface LockedWeek {
  /** Projection per player as the models saw it. Null means Sleeper had none. */
  projections: Map<string, number | null>;
  /** Each team's roster at lock, from its own prompt or, failing that, its opponent's. */
  rosterOf: Map<string, RosterEntry[]>;
}

const DATA_START = '=== DATA ===';
const DATA_END = '=== END DATA ===';

/** The JSON between the DATA markers, or null if the prompt has none. */
export function dataBlock(userPrompt: string): unknown {
  const start = userPrompt.indexOf(DATA_START);
  const end = userPrompt.indexOf(DATA_END, start);
  if (start < 0 || end < 0) return null;
  try {
    return JSON.parse(userPrompt.slice(start + DATA_START.length, end));
  } catch {
    return null;
  }
}

interface LineupData {
  you?: { your_roster?: RosterEntry[]; opponent?: { roster?: RosterEntry[] } | null };
}

/**
 * Everything the lineup prompts of one week said, keyed by team.
 *
 * A team whose own call never happened (a pure fallback has no decision row) is still
 * recovered: its roster was shown in full to its opponent, from the same base data.
 */
export async function loadLockedWeek(
  db: SupabaseClient,
  week: number,
  teamIds: string[],
  seasonId: string,
): Promise<LockedWeek> {
  const { data: lineupRows } = await db
    .from('lineups')
    .select('team_id, decisions(user_prompt, type)')
    .eq('week', week)
    .in('team_id', teamIds);

  const { data: fixtures } = await db
    .from('h2h_schedule')
    .select('home_team_id, away_team_id')
    .eq('season_id', seasonId)
    .eq('week', week);
  const opponentOf = new Map<string, string>();
  for (const f of fixtures ?? []) {
    opponentOf.set(f.home_team_id as string, f.away_team_id as string);
    opponentOf.set(f.away_team_id as string, f.home_team_id as string);
  }

  const projections = new Map<string, number | null>();
  const own = new Map<string, RosterEntry[]>();
  const shown = new Map<string, RosterEntry[]>();

  for (const row of lineupRows ?? []) {
    const decision = row.decisions as unknown as { user_prompt: string | null; type: string } | null;
    if (!decision?.user_prompt || decision.type !== 'lineup') continue;
    const data = dataBlock(decision.user_prompt) as LineupData | null;
    const mine = data?.you?.your_roster;
    const theirs = data?.you?.opponent?.roster;
    const teamId = row.team_id as string;

    if (mine) own.set(teamId, mine);
    const opponentId = opponentOf.get(teamId);
    if (theirs && opponentId) shown.set(opponentId, theirs);

    for (const entry of [...(mine ?? []), ...(theirs ?? [])]) {
      projections.set(entry.player_id, entry.projection);
    }
  }

  const rosterOf = new Map<string, RosterEntry[]>();
  for (const teamId of teamIds) {
    const roster = own.get(teamId) ?? shown.get(teamId);
    if (roster) rosterOf.set(teamId, roster);
  }
  return { projections, rosterOf };
}

/** Exactly what the lineup cron seeds before it calls anyone. */
export function autopilotLineup(roster: RosterEntry[]): Lineup {
  return deterministicLineup(lineupRoster(roster));
}

export interface AutopilotSwap {
  /** Started by the model, not by the autopilot. */
  started: { playerId: string; points: number | null; projected: number | null } | null;
  /** Started by the autopilot, benched by the model. */
  benched: { playerId: string; points: number | null; projected: number | null } | null;
  /** started − benched, once both are scored. */
  delta: number | null;
}

export interface AutopilotComparison {
  /** Points the autopilot's lineup scored. Null until the week is scored. */
  autopilotPoints: number | null;
  /** Model minus autopilot. Zero exactly when the two lineups are the same nine. */
  delta: number | null;
  swaps: AutopilotSwap[];
}

/**
 * Where the model's nine differ from the autopilot's, and what the difference was worth.
 *
 * Only the differing players matter: everyone both lineups started cancels. Swaps are
 * paired by position so they read as decisions ("Waddle over Flowers"); a FLEX shuffle
 * that moves a position leaves an unpaired leftover, shown on its own.
 */
export function compareToAutopilot(input: {
  chosen: Lineup;
  autopilot: Lineup;
  positionOf: (playerId: string) => string;
  projected: (playerId: string) => number | null;
  /** Null when the week has not been scored. */
  actual: ((playerId: string) => number) | null;
}): AutopilotComparison {
  const { chosen, autopilot, positionOf, projected, actual } = input;
  const mine = lineupPlayerIds(chosen).filter((id): id is string => Boolean(id));
  const auto = lineupPlayerIds(autopilot).filter((id): id is string => Boolean(id));
  const autoSet = new Set(auto);
  const mineSet = new Set(mine);

  const side = (playerId: string) => ({
    playerId,
    points: actual ? round2(actual(playerId)) : null,
    projected: projected(playerId),
  });

  const ins = mine.filter((id) => !autoSet.has(id)).map(side);
  const outs = auto.filter((id) => !mineSet.has(id)).map(side);

  const swaps: AutopilotSwap[] = [];
  const remaining = [...outs];
  for (const started of ins) {
    const samePos = remaining.findIndex((o) => positionOf(o.playerId) === positionOf(started.playerId));
    const index = samePos >= 0 ? samePos : remaining.length > 0 ? 0 : -1;
    const benched = index >= 0 ? remaining.splice(index, 1)[0] : null;
    swaps.push(pair(started, benched));
  }
  for (const benched of remaining) swaps.push(pair(null, benched));

  if (!actual) return { autopilotPoints: null, delta: null, swaps };

  const autopilotPoints = round2(auto.reduce((sum, id) => sum + actual(id), 0));
  const chosenPoints = round2(mine.reduce((sum, id) => sum + actual(id), 0));
  return { autopilotPoints, delta: round2(chosenPoints - autopilotPoints), swaps };
}

function pair(started: AutopilotSwap['started'], benched: AutopilotSwap['benched']): AutopilotSwap {
  const delta =
    started?.points != null || benched?.points != null
      ? round2((started?.points ?? 0) - (benched?.points ?? 0))
      : null;
  return { started, benched, delta };
}
