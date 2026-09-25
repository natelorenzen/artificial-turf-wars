/**
 * The picks bankroll: $100 of play money per model for the rest of the season, bet on
 * moneylines, never topped up. Pure functions — the commissioner is code (hard rule 1).
 *
 * Nothing here is stored as a verdict. A bet stores its stake, side and the price it
 * was offered; whether it won is recomputed from the game's score at read time, exactly
 * like a pick's grade, so a stat correction re-settles a bet instead of leaving a stale
 * balance behind.
 */

import { winProfit } from './odds';
import type { GameOutcome } from './grade';

export const STARTING_BANKROLL = 100;

/** Below this a model cannot place the minimum $1 bet and is out of the game. */
export const MIN_STAKE = 1;

export interface Bet {
  gameKey: string;
  team: string;
  /** Whole dollars. */
  stake: number;
  /** American price for `team` at the moment the bet was placed. */
  price: number;
}

export type BetResult = 'won' | 'lost' | 'push' | 'pending';

export function betResult(bet: Bet, outcome: GameOutcome | undefined): BetResult {
  if (!outcome || outcome.winner === null) return 'pending';
  if (outcome.winner === 'TIE') return 'push';
  return outcome.winner === bet.team ? 'won' : 'lost';
}

/** Net change to the bankroll once settled; null while the game is unscored. */
export function betPnl(bet: Bet, outcome: GameOutcome | undefined): number | null {
  const result = betResult(bet, outcome);
  if (result === 'pending') return null;
  if (result === 'push') return 0;
  return result === 'won' ? winProfit(bet.price, bet.stake) : -bet.stake;
}

export interface BankrollState {
  /** Starting money plus every settled result. */
  balance: number;
  /** Stakes on games not yet scored — spoken for, not available. */
  atRisk: number;
  /** What can be staked now: balance minus money already at risk. */
  available: number;
  staked: number;
  won: number;
  lost: number;
  push: number;
  pending: number;
  /** Settled profit over settled stakes. Null until a bet has settled. */
  roi: number | null;
}

const cents = (x: number) => Math.round(x * 100) / 100;

export function bankroll(bets: Bet[], outcomes: Map<string, GameOutcome>, start = STARTING_BANKROLL): BankrollState {
  let pnl = 0;
  let atRisk = 0;
  let staked = 0;
  let settledStake = 0;
  let won = 0;
  let lost = 0;
  let push = 0;
  let pending = 0;

  for (const bet of bets) {
    if (bet.stake <= 0) continue;
    staked += bet.stake;
    const result = betResult(bet, outcomes.get(bet.gameKey));
    if (result === 'pending') {
      atRisk += bet.stake;
      pending++;
      continue;
    }
    pnl += betPnl(bet, outcomes.get(bet.gameKey))!;
    settledStake += bet.stake;
    if (result === 'won') won++;
    else if (result === 'lost') lost++;
    else push++;
  }

  const balance = cents(start + pnl);
  return {
    balance,
    atRisk,
    available: cents(Math.max(0, balance - atRisk)),
    staked,
    won,
    lost,
    push,
    pending,
    roi: settledStake > 0 ? pnl / settledStake : null,
  };
}

/** The most a model may stake in total this week: whole dollars only. */
export function stakeLimit(available: number): number {
  return available >= MIN_STAKE ? Math.floor(available) : 0;
}
