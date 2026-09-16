import { describe, expect, it } from 'vitest';
import { waiverBrief, type PlayerContest, type TeamWaiverView, type WaiverBidView } from './waivers';

const bid = (model: string, player: string, amount: number, won: boolean): WaiverBidView => ({
  model,
  modelKey: model.toLowerCase(),
  add: { id: player, name: player, position: 'WR', nflTeam: 'XXX' },
  drop: { id: `${model}-drop`, name: 'Someone', position: 'WR' },
  bid: amount,
  won,
  losingReason: won ? null : 'outbid',
  reasoning: null,
});

const team = (model: string, bids: WaiverBidView[]): TeamWaiverView => ({
  model,
  modelKey: model.toLowerCase(),
  decisionId: null,
  headline: null,
  closestCall: null,
  confidence: null,
  fallback: false,
  bids,
  faabBefore: 100,
  faabAfter: 100,
});

describe('waiverBrief', () => {
  it('reports the real week-1 shape: a winner, a crowd, a shut-out and a team that sat', () => {
    const kimi = bid('Kimi', 'Diggs', 12, true);
    const muse = bid('Muse', 'Diggs', 7, false);
    const gemini = bid('Gemini', 'Diggs', 6, false);
    const contests: PlayerContest[] = [{ player: kimi.add, bids: [kimi, muse, gemini], winner: kimi, margin: 5 }];
    const brief = waiverBrief(contests, [
      team('Kimi', [kimi]),
      team('Muse', [muse]),
      team('Gemini', [gemini]),
      team('DeepSeek', []),
    ]);
    expect(brief).toEqual([
      '3 claims from 3 teams; 1 won.',
      'Biggest buy: Kimi paid $12 for Diggs.',
      'Most wanted: Diggs, 3 bids. Kimi won at $12, $5 clear of the next bid.',
      'Bid and won nothing: Muse, Gemini.',
      'Stood pat: DeepSeek.',
      '$12 spent across the league.',
    ]);
    // The false tweet this page exists beside.
    expect(brief.join(' ')).not.toContain('Every claim failed');
  });

  it('says plainly when nobody bid', () => {
    expect(waiverBrief([], [team('A', [])])).toEqual(['Nobody bid. Every team stood pat.']);
  });
});
