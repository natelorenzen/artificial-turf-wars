import { describe, expect, it } from 'vitest';
import type { RosterEntry } from '@/lib/prompt/context';
import { autopilotLineup, compareToAutopilot, dataBlock } from './autopilot';

const entry = (player_id: string, position: string, projection: number | null, extra: Partial<RosterEntry> = {}): RosterEntry => ({
  player_id,
  name: player_id,
  position,
  nfl_team: 'XXX',
  projection,
  season_ppg: null,
  last3_ppg: null,
  injury_status: null,
  is_on_bye: false,
  ...extra,
});

const roster: RosterEntry[] = [
  entry('qb1', 'QB', 20),
  entry('qb2', 'QB', 15),
  entry('rb1', 'RB', 18),
  entry('rb2', 'RB', 14),
  entry('rb3', 'RB', 13),
  entry('wr1', 'WR', 17),
  entry('wr2', 'WR', 16),
  entry('wr3', 'WR', 12),
  entry('wrOut', 'WR', 30, { injury_status: 'Out' }),
  entry('te1', 'TE', 10),
  entry('te2', 'TE', 9),
  entry('k1', 'K', 7),
  entry('d1', 'DEF', 8),
];

describe('dataBlock', () => {
  it('reads the JSON between the DATA markers the prompt assembler writes', () => {
    const prompt = `RULES\n\n=== DATA ===\n\n{"you":{"your_roster":[]}}\n\n=== END DATA ===\n\nTASK`;
    expect(dataBlock(prompt)).toEqual({ you: { your_roster: [] } });
    expect(dataBlock('no data here')).toBeNull();
    expect(dataBlock('=== DATA ===\n{broken\n=== END DATA ===')).toBeNull();
  });
});

describe('autopilotLineup', () => {
  it('is the cron fallback: best projection per slot, never a player listed Out', () => {
    const lineup = autopilotLineup(roster);
    expect(lineup.qb).toBe('qb1');
    expect(lineup.rb).toEqual(['rb1', 'rb2']);
    expect(lineup.wr).toEqual(['wr1', 'wr2']);
    expect(lineup.flex).toBe('rb3');
    expect(lineup.te).toBe('te1');
    expect([lineup.wr, lineup.flex].flat()).not.toContain('wrOut');
  });
});

describe('compareToAutopilot', () => {
  const positionOf = (id: string) => roster.find((e) => e.player_id === id)!.position;
  const projected = (id: string) => roster.find((e) => e.player_id === id)!.projection;
  const actual: Record<string, number> = { rb3: 20, wr3: 2, te1: 9, te2: 3 };
  const points = (id: string) => actual[id] ?? 10;

  it('is zero, with no swaps, when the model started the autopilot nine', () => {
    const auto = autopilotLineup(roster);
    const c = compareToAutopilot({ chosen: auto, autopilot: auto, positionOf, projected, actual: points });
    expect(c).toEqual({ autopilotPoints: c.autopilotPoints, delta: 0, swaps: [] });
  });

  it('pairs swaps by position, falls back across positions for FLEX, and sums only the differences', () => {
    const auto = autopilotLineup(roster);
    const chosen = { ...auto, te: 'te2', flex: 'wr3' };
    const c = compareToAutopilot({ chosen, autopilot: auto, positionOf, projected, actual: points });

    expect(c.swaps.map((s) => [s.started?.playerId, s.benched?.playerId, s.delta])).toEqual([
      ['te2', 'te1', -6],
      ['wr3', 'rb3', -18],
    ]);
    expect(c.delta).toBe(-24);
    expect(c.swaps[0].started?.projected).toBe(9);
  });

  it('lists the swaps but claims no value before the week is scored', () => {
    const auto = autopilotLineup(roster);
    const c = compareToAutopilot({ chosen: { ...auto, te: 'te2' }, autopilot: auto, positionOf, projected, actual: null });
    expect(c.delta).toBeNull();
    expect(c.autopilotPoints).toBeNull();
    expect(c.swaps).toHaveLength(1);
    expect(c.swaps[0].delta).toBeNull();
  });
});
