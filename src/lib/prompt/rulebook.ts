/**
 * The League Rulebook (SPEC §4.1-iii).
 *
 * GENERATED from `src/lib/config/league.ts`, never hand-written, so the rules the
 * models are told cannot drift from the code that enforces them. Injected verbatim
 * and byte-identically into every call to all eight models, all season.
 *
 * The problem this solves (SPEC §4.1-i): told only "respect PPR", models fill the
 * gaps from training priors that differ by lab — one assumes half-PPR, another full —
 * and nothing tells them the objective is all-play, which changes correct strategy.
 * Every rule that could affect a decision is stated explicitly, in full, every time.
 */

import {
  DEF_POINTS_ALLOWED_BANDS,
  DEF_SCORING,
  KICKER_SCORING,
  LEAGUE,
  OFFENSE_SCORING,
  RULEBOOK_VERSION,
  SLOTS,
  STARTERS_COUNT,
} from '@/lib/config/league';

function line(label: string, value: string, width = 24) {
  const dots = '.'.repeat(Math.max(1, width - label.length));
  return `  ${label} ${dots} ${value}`;
}

/** Yahoo's printed slot order, not object key order. */
const SLOT_ORDER = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF'] as const;

export function generateRulebook(): string {
  const opponents = LEAGUE.teams - 1;

  const slotLine = SLOT_ORDER.map((slot) => `${SLOTS[slot]} ${slot}`).join(', ');

  const bands = DEF_POINTS_ALLOWED_BANDS.map((b) => `${b.label} = ${b.points}`);

  return `=== LEAGUE RULEBOOK ${RULEBOOK_VERSION} ===

OBJECTIVE (this is what you are optimizing):
Maximize your cumulative ALL-PLAY record over ${LEAGUE.regularSeasonWeeks} weeks. Each week your
starting lineup's total points is compared against all ${opponents} other teams. You
earn one win for every team you outscore, so a weekly result runs from 0-${opponents}
to ${opponents}-0. Season rank is cumulative all-play record; ties break on cumulative
total points. An exact scoring tie awards half a win to each team.
Because you are measured against all ${opponents} opponents every week rather than one,
consistent scoring is more valuable than high-variance upside. You are not
trying to beat one opponent; you are trying to finish above as many teams as
possible every single week.
A head-to-head record is also published, but it does NOT determine rank.

TEAMS: ${LEAGUE.teams}. You are one of them. You cannot see other teams' rosters,
lineups, or reasoning.

SEASON: NFL weeks 1-${LEAGUE.regularSeasonWeeks}.

ROSTER (${LEAGUE.rosterSize} players):
Starters (${STARTERS_COUNT}): ${slotLine}
  FLEX may be ${LEAGUE.flexEligible.join(', ')}.
Bench: ${LEAGUE.benchSize}. Bench players score nothing.
There are no IR slots. An unfilled starting slot scores 0.

SCORING (per player, per week):
${line('Passing yards', `${OFFENSE_SCORING.pass_yd} each  (1 per ${Math.round(1 / OFFENSE_SCORING.pass_yd)})`)}
${line('Passing TD', String(OFFENSE_SCORING.pass_td))}
${line('Interception thrown', String(OFFENSE_SCORING.pass_int))}
${line('Rushing yards', `${OFFENSE_SCORING.rush_yd} each   (1 per ${Math.round(1 / OFFENSE_SCORING.rush_yd)})`)}
${line('Rushing TD', String(OFFENSE_SCORING.rush_td))}
${line('Reception', `${OFFENSE_SCORING.rec.toFixed(1)}        (FULL PPR)`)}
${line('Receiving yards', `${OFFENSE_SCORING.rec_yd} each   (1 per ${Math.round(1 / OFFENSE_SCORING.rec_yd)})`)}
${line('Receiving TD', String(OFFENSE_SCORING.rec_td))}
${line('Fumble lost', String(OFFENSE_SCORING.fum_lost))}
${line('2-point conversion', String(OFFENSE_SCORING.rush_2pt))}
  Kicker: FG 0-39 = ${KICKER_SCORING.fg_0_39}, FG 40-49 = ${KICKER_SCORING.fg_40_49}, FG 50+ = ${KICKER_SCORING.fg_50p}, extra point = ${KICKER_SCORING.xpm}
  DEF/ST: sack ${DEF_SCORING.sack}, interception ${DEF_SCORING.int}, fumble recovery ${DEF_SCORING.fum_rec}, safety ${DEF_SCORING.safe},
          blocked kick ${DEF_SCORING.blk_kick}, defensive TD ${DEF_SCORING.def_td}, special-teams TD ${DEF_SCORING.def_st_td}
  DEF/ST points allowed: ${bands.slice(0, 4).join(', ')},
          ${bands.slice(4).join(', ')}
  A kick-return or punt-return touchdown is credited to the DEF/ST unit that
  scored it, NOT to the individual returner. One return TD is worth exactly
  ${DEF_SCORING.def_st_td} points in this league.

BUDGET (one budget, two uses):
You start with $${LEAGUE.budgetTotal}. It never replenishes and must last the whole season.
  1. Before the draft you bid from it for your draft slot.
  2. Whatever remains is your FAAB budget for weekly waiver claims.
Spending on draft position directly reduces your ability to add players
later. That tradeoff is yours to price.

DRAFT: ${LEAGUE.draftRounds}-round ${LEAGUE.draftType}, ${LEAGUE.teams} teams, one player per round.
From round ${LEAGUE.softCapRound}, if you still have no player at a required starting position
(${LEAGUE.flexEligible.join('/')}/QB/K/DEF), your available pool is narrowed to only the positions
you still need, and you will be told this has happened.

WAIVERS (weekly):
Sealed bids. Highest bid wins a player; ties break on waiver priority
(seeded in reverse draft-slot order; a successful claim drops you to the
bottom). Your roster is always exactly ${LEAGUE.rosterSize}, so every add requires a drop.
A $0 bid is legal. Bidding nothing at all is legal.

PLAYOFFS: weeks ${LEAGUE.playoffWeeks.join('-')}, top ${LEAGUE.playoffTeams} teams by all-play record, head-to-head
bracket. Week 17 is not played.

NOT AVAILABLE THIS SEASON: trades, IR slots, open free agency between
waiver runs, and roster moves at any time other than the weekly waiver
window.
=== END RULEBOOK ===`;
}

/** Cached: the rulebook is byte-identical for every call, so build it once. */
let cached: string | null = null;
export function rulebook(): string {
  if (cached === null) cached = generateRulebook();
  return cached;
}
