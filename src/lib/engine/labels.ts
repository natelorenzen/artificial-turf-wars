/**
 * Anonymised, stable opponent labels (SPEC §14.3).
 *
 * Models now see their opponent's roster, the draft board, and rival rosters at
 * waivers. They must NOT see which lab is which.
 *
 * The reason is not squeamishness. §8.1 #7 keeps models from tailoring behaviour to a
 * specific rival, and without it the season stops measuring fantasy reasoning and
 * starts measuring how these models behave toward each other's brands — a different
 * and much less interesting experiment, and one that would contaminate every result.
 *
 * Labels are derived from DRAFT SLOT, which is deliberate:
 *   - stable for the whole season, so a model can build a picture of "Team C" over 14
 *     weeks, which is the entire point of showing rivals at all;
 *   - consistent with the draft board a model already sees, so the two never disagree;
 *   - derivable by anyone from published auction results, so it leaks nothing that is
 *     not already public — it withholds only the lab identity.
 */

import { LEAGUE } from '@/lib/config/league';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Draft slot 1 → "Team A". */
export function labelForSlot(slot: number): string {
  if (!Number.isInteger(slot) || slot < 1 || slot > ALPHABET.length) {
    throw new Error(`labelForSlot: slot ${slot} out of range`);
  }
  return `Team ${ALPHABET[slot - 1]}`;
}

export interface TeamIdentity {
  teamId: string;
  draftSlot: number;
}

/**
 * Build the teamId → label map for a season. Throws on duplicate or missing slots,
 * because a collision would silently show two rivals under one name.
 */
export function buildLabelMap(teams: TeamIdentity[]): Map<string, string> {
  const slots = new Set<number>();
  const map = new Map<string, string>();

  for (const team of teams) {
    if (slots.has(team.draftSlot)) {
      throw new Error(`buildLabelMap: draft slot ${team.draftSlot} assigned twice`);
    }
    slots.add(team.draftSlot);
    map.set(team.teamId, labelForSlot(team.draftSlot));
  }

  if (teams.length !== LEAGUE.teams) {
    throw new Error(`buildLabelMap: expected ${LEAGUE.teams} teams, got ${teams.length}`);
  }
  return map;
}

/**
 * The label a model uses for ITSELF. Models are not told which model they are
 * (§8.1 #7), but they must be able to find themselves on the draft board and in the
 * standings, so they get their own label plainly.
 */
export function selfLabel(labels: Map<string, string>, teamId: string): string {
  const label = labels.get(teamId);
  if (!label) throw new Error(`selfLabel: no label for team ${teamId}`);
  return label;
}

/**
 * Guard for anything about to enter a DATA block. Model display names and OpenRouter
 * ids must never reach a prompt — one leak and every later decision is suspect.
 */
export function assertNoLabelLeak(serialized: string, forbidden: readonly string[]): void {
  const hits = forbidden.filter((needle) => needle && serialized.includes(needle));
  if (hits.length > 0) {
    throw new Error(
      `DATA block leaks competitor identity: ${hits.join(', ')}. Opponents must appear ` +
        'only as anonymised labels (SPEC §14.3).',
    );
  }
}
