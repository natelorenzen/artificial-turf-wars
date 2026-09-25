import { describe, expect, it } from 'vitest';
import {
  brier,
  consensusPicks,
  gameOutcomes,
  gradePick,
  homeTeamPicks,
  tally,
  teamRecords,
  type Fixture,
} from './grade';

const fixtures: Fixture[] = [
  { gameKey: 'CHI@CAR', away: 'CHI', home: 'CAR' },
  { gameKey: 'TB@CIN', away: 'TB', home: 'CIN' },
  { gameKey: 'NO@DET', away: 'NO', home: 'DET' },
  { gameKey: 'KC@BUF', away: 'KC', home: 'BUF' },
];

// Week 1, 2026, as Sleeper's DEF `pts_allow` has it. CHI 59, CAR 37 is the published
// final score of that game.
const allowed = new Map([
  ['CAR', 59],
  ['CHI', 37],
  ['CIN', 21],
  ['TB', 27],
  ['DET', 30],
  ['NO', 31],
  // KC@BUF not played yet.
]);

describe('gameOutcomes', () => {
  const outcomes = gameOutcomes(fixtures, allowed);

  it('reads each side\'s score off the OTHER side\'s defence', () => {
    expect(outcomes[0]).toMatchObject({ awayScore: 59, homeScore: 37, winner: 'CHI' });
    expect(outcomes[1]).toMatchObject({ awayScore: 21, homeScore: 27, winner: 'CIN' });
    expect(outcomes[2]).toMatchObject({ awayScore: 30, homeScore: 31, winner: 'DET' });
  });

  it('leaves a game with a missing defence pending, never a result', () => {
    expect(outcomes[3]).toMatchObject({ awayScore: null, homeScore: null, winner: null });
  });

  it('calls a tie a tie', () => {
    const [tie] = gameOutcomes([fixtures[0]], new Map([['CAR', 20], ['CHI', 20]]));
    expect(tie.winner).toBe('TIE');
  });
});

describe('grading', () => {
  const byKey = new Map(gameOutcomes(fixtures, allowed).map((o) => [o.gameKey, o]));

  it('grades won, lost, and pending', () => {
    expect(gradePick({ gameKey: 'CHI@CAR', pick: 'CHI', winProb: 0.6 }, byKey.get('CHI@CAR'))).toBe('won');
    expect(gradePick({ gameKey: 'CHI@CAR', pick: 'CAR', winProb: 0.6 }, byKey.get('CHI@CAR'))).toBe('lost');
    expect(gradePick({ gameKey: 'KC@BUF', pick: 'KC', winProb: 0.6 }, byKey.get('KC@BUF'))).toBe('pending');
  });

  it('punishes a confident miss far more than a timid one', () => {
    expect(brier(0.95, 'lost')).toBeCloseTo(0.9025);
    expect(brier(0.55, 'lost')).toBeCloseTo(0.3025);
    expect(brier(0.5, 'won')).toBe(0.25);
    expect(brier(0.5, 'lost')).toBe(0.25);
    expect(brier(0.8, 'push')).toBeCloseTo(0.09);
    expect(brier(0.8, 'pending')).toBeNull();
  });

  it('tallies a set, leaving pending picks out of every rate', () => {
    const t = tally(
      [
        { gameKey: 'CHI@CAR', pick: 'CHI', winProb: 0.6 },
        { gameKey: 'TB@CIN', pick: 'TB', winProb: 0.7 },
        { gameKey: 'NO@DET', pick: 'DET', winProb: 0.8 },
        { gameKey: 'KC@BUF', pick: 'BUF', winProb: 0.9 },
      ],
      byKey,
    );
    expect(t).toMatchObject({ won: 2, lost: 1, push: 0, pending: 1 });
    expect(t.accuracy).toBeCloseTo(2 / 3);
    expect(t.brier).toBeCloseTo((0.16 + 0.49 + 0.04) / 3);
    expect(t.meanConfidence).toBeCloseTo(0.7);
  });

  it('scores the home-team baseline at exactly 0.25 Brier', () => {
    const t = tally(homeTeamPicks(fixtures), byKey);
    expect(t).toMatchObject({ won: 2, lost: 1, pending: 1 });
    expect(t.brier).toBe(0.25);
  });
});

describe('consensusPicks', () => {
  it('takes the majority, at the mean probability of the majority', () => {
    const [c] = consensusPicks(
      [fixtures[0]],
      [
        [{ gameKey: 'CHI@CAR', pick: 'CHI', winProb: 0.6 }],
        [{ gameKey: 'CHI@CAR', pick: 'CHI', winProb: 0.8 }],
        [{ gameKey: 'CHI@CAR', pick: 'CAR', winProb: 0.9 }],
      ],
    );
    expect(c).toMatchObject({ pick: 'CHI', agree: 2, of: 3 });
    expect(c.winProb).toBeCloseTo(0.7);
  });

  it('breaks a split vote on summed probability, deterministically', () => {
    const [c] = consensusPicks(
      [fixtures[0]],
      [
        [{ gameKey: 'CHI@CAR', pick: 'CHI', winProb: 0.55 }],
        [{ gameKey: 'CHI@CAR', pick: 'CAR', winProb: 0.75 }],
      ],
    );
    expect(c.pick).toBe('CAR');
  });
});

describe('teamRecords', () => {
  it('builds a record, both sides of every scored game', () => {
    const records = teamRecords([{ week: 1, outcomes: gameOutcomes(fixtures, allowed) }]);
    expect(records.get('CHI')).toMatchObject({ wins: 1, losses: 0, pointsFor: 59, pointsAgainst: 37 });
    expect(records.get('CAR')).toMatchObject({ wins: 0, losses: 1, pointsFor: 37, pointsAgainst: 59 });
    expect(records.get('CHI')!.games[0]).toMatchObject({ opponent: 'CAR', at: 'away', result: 'W' });
    // An unplayed game gives nobody a record.
    expect(records.has('KC')).toBe(false);
  });
});
