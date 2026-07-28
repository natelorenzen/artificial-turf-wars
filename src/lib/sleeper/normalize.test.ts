import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildCalibration,
  deriveByeWeeks,
  normalizeProjectionStats,
  projectSeasonPoints,
} from './normalize';
import type { SleeperStatRecord } from './client';

const CACHE = resolve(__dirname, '../../../tools/.cache');

function fixture(name: string): SleeperStatRecord[] | null {
  const path = resolve(CACHE, name);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

describe('DEF projection normalization', () => {
  it('maps projection TD fields onto canonical stat keys', () => {
    const stats = { def_fum_td: 2, pass_int_td: 1, def_kr_td: 1, pr_td: 1, sack: 52, int: 15 };
    const norm = normalizeProjectionStats('DEF', stats);
    expect(norm.def_td).toBe(3);
    expect(norm.def_st_td).toBe(2);
  });

  it('does not award a phantom shutout when pts_allow is unprojected', () => {
    const rec = { player_id: 'LAR', team: 'LAR', stats: { sack: 52 } } as unknown as SleeperStatRecord;
    const withoutCalibration = projectSeasonPoints('DEF', rec, {
      shortFgPerLongFg: 1,
      defPointsAllowedPerGame: {},
      defPointsAllowedPerGameDefault: 0,
      gamesPerSeason: 17,
      sourceSeason: 0,
    });
    expect(withoutCalibration.points).toBe(52); // sacks only, no +10 band
  });
});

describe('K projection normalization', () => {
  it('reconstructs the missing short field goals', () => {
    const stats = { fgm_40_49: 9, fgm_50p: 8, xpm: 42 };
    // Without correction the engine sees fgm=0 and pays nothing for 0-39.
    expect(normalizeProjectionStats('K', stats, {
      shortFgPerLongFg: 0,
      defPointsAllowedPerGame: {},
      defPointsAllowedPerGameDefault: 0,
      gamesPerSeason: 17,
      sourceSeason: 0,
    }).fgm).toBe(17);

    const corrected = normalizeProjectionStats('K', stats, {
      shortFgPerLongFg: 1,
      defPointsAllowedPerGame: {},
      defPointsAllowedPerGameDefault: 0,
      gamesPerSeason: 17,
      sourceSeason: 0,
    });
    expect(corrected.fgm).toBe(34); // 17 long + 17 short
  });
});

describe('bye weeks', () => {
  it('marks every absent team as on bye for that week', () => {
    const games = [
      { week: 1, home: 'A', away: 'B' },
      { week: 1, home: 'C', away: 'D' },
      { week: 2, home: 'A', away: 'C' },
      { week: 3, home: 'B', away: 'D' },
    ];
    const { byes, teams } = deriveByeWeeks(games);
    expect(teams).toEqual(['A', 'B', 'C', 'D']);
    expect(byes).toEqual({ B: 2, D: 2, A: 3, C: 3 });
  });
});

describe('calibration against real 2025 data', () => {
  const def = fixture('act_2025_DEF.json');
  const k = fixture('act_2025_K.json');
  const runIf = def && k ? it : it.skip;

  runIf('produces a plausible short-FG ratio and per-team DEF estimates', () => {
    const cal = buildCalibration(2025, def!, k!);

    // Roughly 1.5-2.5 short field goals per long one across the league.
    expect(cal.shortFgPerLongFg).toBeGreaterThan(0.8);
    expect(cal.shortFgPerLongFg).toBeLessThan(3);

    // All 32 defenses resolve, and per-game points-allowed sits in a sane range.
    expect(Object.keys(cal.defPointsAllowedPerGame)).toHaveLength(32);
    for (const value of Object.values(cal.defPointsAllowedPerGame)) {
      expect(value).toBeGreaterThan(-4);
      expect(value).toBeLessThan(10);
    }
  });

  runIf('handles the 2025 Seattle line that is missing safe and pts_allow_28_34', () => {
    const sea = def!.find((r) => (r.team ?? r.player_id) === 'SEA');
    expect(sea).toBeDefined();
    expect(sea!.stats!.safe).toBeUndefined();
    expect(sea!.stats!.pts_allow_28_34).toBeUndefined();
    const cal = buildCalibration(2025, [sea!], k!);
    expect(Number.isNaN(cal.defPointsAllowedPerGame.SEA)).toBe(false);
  });
});
