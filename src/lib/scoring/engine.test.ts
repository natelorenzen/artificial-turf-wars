import { describe, expect, it } from 'vitest';
import { fieldGoalBands, pointsAllowedPoints, scorePlayerWeek } from './engine';

describe('offense', () => {
  it('scores the rulebook comprehension example: 6 rec, 82 yds, 1 TD = 20.2', () => {
    const { points } = scorePlayerWeek('WR', { rec: 6, rec_yd: 82, rec_td: 1 });
    expect(points).toBe(20.2);
  });

  it('uses Yahoo -1 for interceptions, not v1 -2', () => {
    const { points } = scorePlayerWeek('QB', { pass_yd: 300, pass_td: 2, pass_int: 2 });
    // 12 + 8 - 2
    expect(points).toBe(18);
  });

  it('scores 2-point conversions', () => {
    expect(scorePlayerWeek('RB', { rush_2pt: 1 }).points).toBe(2);
    expect(scorePlayerWeek('WR', { rec_2pt: 1 }).points).toBe(2);
    expect(scorePlayerWeek('QB', { pass_2pt: 1 }).points).toBe(2);
  });

  it('treats a missing stat key as zero rather than NaN', () => {
    const { points } = scorePlayerWeek('RB', { rush_yd: 55 });
    expect(points).toBe(5.5);
    expect(Number.isNaN(points)).toBe(false);
  });

  it('never returns NaN for an empty or null stat line', () => {
    expect(scorePlayerWeek('WR', {}).points).toBe(0);
    expect(scorePlayerWeek('WR', null).points).toBe(0);
    expect(scorePlayerWeek('WR', undefined).points).toBe(0);
  });

  it('is full PPR, not half', () => {
    expect(scorePlayerWeek('WR', { rec: 10 }).points).toBe(10);
  });
});

describe('return touchdowns', () => {
  it('pays exactly 6 league-wide for one kick-return TD', () => {
    // The returner's own record carries `st_td`; the team unit carries `def_st_td`.
    // Only the DEF/ST unit is paid, so the play is worth 6 in total, never 12.
    const returner = scorePlayerWeek('WR', { st_td: 1 });
    const unit = scorePlayerWeek('DEF', { def_st_td: 1, pts_allow: 21 });
    expect(returner.points).toBe(0);
    expect(unit.points).toBe(6); // 6 for the TD, 0 for the 21-27 band
    expect(returner.points + unit.points).toBe(6);
  });
});

describe('kicker', () => {
  it('derives the 0-39 band by subtraction so a sub-20-yard FG is not dropped', () => {
    // 3 made, one of them from 18 yards. No fgm_0_19 key exists in Sleeper.
    const stats = { fgm: 3, fgm_20_29: 1, fgm_30_39: 1, fgm_40_49: 0, fgm_50p: 0, xpm: 2 };
    expect(fieldGoalBands(stats).fg0_39).toBe(3);
    expect(scorePlayerWeek('K', stats).points).toBe(11); // 3*3 + 2*1
  });

  it('does not double-count long kicks via fgm_50_59 and fgm_50p', () => {
    const stats = { fgm: 2, fgm_50_59: 1, fgm_50p: 1, fgm_40_49: 1, xpm: 0 };
    // one 40-49 (4) + one 50+ (5), zero left for the 0-39 band
    expect(fieldGoalBands(stats)).toEqual({ fg0_39: 0, fg40_49: 1, fg50p: 1 });
    expect(scorePlayerWeek('K', stats).points).toBe(9);
  });

  it('clamps a malformed feed rather than paying negative field goals', () => {
    expect(fieldGoalBands({ fgm: 1, fgm_40_49: 2, fgm_50p: 1 }).fg0_39).toBe(0);
  });
});

describe('defense', () => {
  it('bands points allowed from the raw integer', () => {
    expect(pointsAllowedPoints(0).points).toBe(10);
    expect(pointsAllowedPoints(6).points).toBe(7);
    expect(pointsAllowedPoints(7).points).toBe(4);
    expect(pointsAllowedPoints(20).points).toBe(1);
    expect(pointsAllowedPoints(27).points).toBe(0);
    expect(pointsAllowedPoints(34).points).toBe(-1);
    expect(pointsAllowedPoints(35).points).toBe(-4);
    expect(pointsAllowedPoints(70).points).toBe(-4);
  });

  it('scores the 2025 Seattle shape: no safe key, no pts_allow_28_34 key', () => {
    const stats = { sack: 4, int: 2, fum_rec: 1, pts_allow: 13 };
    const { points } = scorePlayerWeek('DEF', stats);
    // 4 + 4 + 2 + 4(band 7-13)
    expect(points).toBe(14);
    expect(Number.isNaN(points)).toBe(false);
  });

  it('applies the shutout band to a defense with a totally empty line', () => {
    // No pts_allow key at all reads as 0, which is a shutout. This is why the
    // ingest layer must refuse to write a DEF row that has no pts_allow field.
    expect(scorePlayerWeek('DEF', {}).points).toBe(10);
  });

  it('scores a full defensive line correctly', () => {
    const stats = {
      sack: 5,
      int: 3,
      fum_rec: 2,
      safe: 1,
      blk_kick: 1,
      def_td: 1,
      pts_allow: 3,
    };
    // 5 + 6 + 4 + 2 + 2 + 6 + 7
    expect(scorePlayerWeek('DEF', stats).points).toBe(32);
  });
});
