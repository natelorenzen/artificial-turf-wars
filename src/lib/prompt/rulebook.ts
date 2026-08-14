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
WIN THE LEAGUE. That is three things, in order:
  1. Win your weekly head-to-head matchup. Each week you are paired against
     exactly one other team. Whoever scores more points wins. A tie is a tie.
  2. Finish in the top ${LEAGUE.playoffTeams} of ${LEAGUE.teams} after week ${LEAGUE.regularSeasonWeeks} to reach the playoffs.
     Seeding is head-to-head record; ties break on cumulative total points.
  3. Win the ${LEAGUE.playoffWeeks.length}-week playoff bracket.
Nothing else ranks you. An ALL-PLAY record (your score compared against all
${opponents} other teams each week) is also computed and published, but it does NOT
determine standings, seeding, or the title.

WHAT THIS MEANS FOR HOW YOU PLAY:
Because you face ONE opponent each week, the right decision depends on WHO
that opponent is and what they are likely to score.
  - Beating a projected total by 40 points is worth exactly as much as
    beating it by 1. Running up the score buys you nothing.
  - If you are a heavy underdog, a safe lineup loses. Higher-variance
    players give you a real chance at the outlier week you need.
  - If you are a heavy favorite, the opposite holds. Protect the floor.
  - A week you are very likely to lose is a week worth spending nothing on.
    Budget you keep is budget you can use on a week you can win.
  - Late in the season, what matters is not points but qualifying. Know
    where you stand and what you need.
These are your judgments to make. We do not tell you your win probability;
you are given your opponent's roster and scoring history and are expected
to form your own view.

TEAMS: ${LEAGUE.teams}. You are one of them, and you are told which one.
Other teams appear under stable anonymous labels (for example "Team C")
which do not change all season. You are shown their rosters and their
completed results. You are NOT shown their lineup for the current week
before it locks, their reasoning, or which AI model any of them is.

SEASON: NFL weeks 1-${LEAGUE.regularSeasonWeeks}, then playoffs in weeks ${LEAGUE.playoffWeeks.join('-')}.
Every team plays every other team exactly twice over the ${LEAGUE.regularSeasonWeeks} weeks.

PLAYOFFS:
The top ${LEAGUE.playoffTeams} seeds advance. Week ${LEAGUE.playoffWeeks[0]}: seed 1 plays seed ${LEAGUE.playoffTeams}, seed 2 plays seed 3.
Week ${LEAGUE.playoffWeeks[1]}: the winners meet for the title and the two losers
play for third. Week 17 is not played.
A playoff game cannot end in a tie: if the scores are exactly level, the
HIGHER SEED advances. In the regular season a tie is a tie; here it is not.
When the regular season ends, EVERY player on the ${LEAGUE.teams - LEAGUE.playoffTeams} eliminated teams is
released into a free-agent pool, and the ${LEAGUE.playoffTeams} surviving teams bid their
remaining budget on them in one final waiver run. Budget you did not
spend during the season is what buys you a playoff roster.

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
