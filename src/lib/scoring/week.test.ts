import { describe, expect, it } from 'vitest';
import { accumulateStandings, type WeeklyTotal } from './week';

/** Four teams is enough for every case here and keeps the fixtures readable. */
const TEAMS = ['t1', 't2', 't3', 't4'].map((teamId) => ({ teamId, faabRemaining: 50 }));

function weekly(spec: Record<string, Record<number, number>>): Map<string, Map<number, WeeklyTotal>> {
  const out = new Map<string, Map<number, WeeklyTotal>>();
  for (const [teamId, byWeek] of Object.entries(spec)) {
    const inner = new Map<number, WeeklyTotal>();
    for (const [week, total] of Object.entries(byWeek)) {
      inner.set(Number(week), { total, kickerPts: 0 });
    }
    out.set(teamId, inner);
  }
  return out;
}

const scheduleWeek = (week: number) => [
  { week, homeTeamId: 't1', awayTeamId: 't2' },
  { week, homeTeamId: 't3', awayTeamId: 't4' },
];

describe('cumulative standings', () => {
  it('carries points and records forward across weeks', () => {
    const { standings, rows } = accumulateStandings({
      teams: TEAMS,
      weekly: weekly({
        t1: { 1: 100, 2: 90 },
        t2: { 1: 80, 2: 95 },
        t3: { 1: 120, 2: 60 },
        t4: { 1: 70, 2: 110 },
      }),
      matchups: [...scheduleWeek(1), ...scheduleWeek(2)],
      throughWeek: 2,
    });

    const t1 = standings.find((s) => s.teamId === 't1')!;
    expect(t1.cumPts).toBe(190);
    // Beat t2 in week 1 (100-80), lost in week 2 (90-95).
    expect(t1.h2hW).toBe(1);
    expect(t1.h2hL).toBe(1);

    // One row per team per scored week.
    expect(rows).toHaveLength(8);
    const t1Week2 = rows.find((r) => r.team_id === 't1' && r.week === 2)!;
    expect(t1Week2.cum_pts).toBe(190);
    expect(t1Week2.week_pts).toBe(90);
  });

  it('ranks on head-to-head, not on points', () => {
    // t3 outscores everyone but loses both its matchups; t1 wins both with less.
    const { standings } = accumulateStandings({
      teams: TEAMS,
      weekly: weekly({
        t1: { 1: 100, 2: 100 },
        t2: { 1: 10, 2: 10 },
        t3: { 1: 200, 2: 200 },
        t4: { 1: 300, 2: 300 },
      }),
      matchups: [...scheduleWeek(1), ...scheduleWeek(2)],
      throughWeek: 2,
    });

    const t1 = standings.find((s) => s.teamId === 't1')!;
    const t3 = standings.find((s) => s.teamId === 't3')!;
    // This is the entire v3 amendment in one assertion: t3 scored 400 to t1's 200
    // and still ranks below it, because H2H is the basis (SPEC §14.2).
    expect(t1.h2hW).toBe(2);
    expect(t3.h2hW).toBe(0);
    expect(t1.rank).toBeLessThan(t3.rank);
    expect(t3.cumPts).toBeGreaterThan(t1.cumPts);
  });

  it('awards half a win to each side of an all-play tie', () => {
    const { standings } = accumulateStandings({
      teams: TEAMS,
      weekly: weekly({ t1: { 1: 100 }, t2: { 1: 100 }, t3: { 1: 50 }, t4: { 1: 25 } }),
      matchups: scheduleWeek(1),
      throughWeek: 1,
    });

    const t1 = standings.find((s) => s.teamId === 't1')!;
    // Beats t3 and t4, ties t1/t2 → 2 + 0.5.
    expect(t1.allplayW).toBe(2.5);
    expect(t1.allplayL).toBe(0.5);
  });

  it('records a head-to-head tie as a tie rather than picking a winner', () => {
    const { standings } = accumulateStandings({
      teams: TEAMS,
      weekly: weekly({ t1: { 1: 100 }, t2: { 1: 100 }, t3: { 1: 80 }, t4: { 1: 60 } }),
      matchups: scheduleWeek(1),
      throughWeek: 1,
    });

    const t1 = standings.find((s) => s.teamId === 't1')!;
    expect(t1.h2hT).toBe(1);
    expect(t1.h2hW).toBe(0);
    expect(t1.h2hL).toBe(0);
  });

  it('skips an unscored week instead of recording a week of zeros', () => {
    // Week 2 has no scores at all — a bye in the data, not four shutouts.
    const { rows, standings } = accumulateStandings({
      teams: TEAMS,
      weekly: weekly({ t1: { 1: 100 }, t2: { 1: 80 }, t3: { 1: 120 }, t4: { 1: 70 } }),
      matchups: [...scheduleWeek(1), ...scheduleWeek(2)],
      throughWeek: 2,
    });

    expect(rows.every((r) => r.week === 1)).toBe(true);
    // Nobody was handed an all-play loss for a week that was never played.
    expect(standings.find((s) => s.teamId === 't1')!.allplayL).toBe(1);
  });

  it('propagates a corrected earlier week into every later cumulative total', () => {
    const base = {
      teams: TEAMS,
      matchups: [...scheduleWeek(1), ...scheduleWeek(2)],
      throughWeek: 2,
    };
    const before = accumulateStandings({
      ...base,
      weekly: weekly({ t1: { 1: 100, 2: 90 }, t2: { 1: 80, 2: 95 }, t3: { 1: 120, 2: 60 }, t4: { 1: 70, 2: 110 } }),
    });
    // Thursday's final pass revises t1's week 1 down by 30, flipping that matchup.
    const after = accumulateStandings({
      ...base,
      weekly: weekly({ t1: { 1: 70, 2: 90 }, t2: { 1: 80, 2: 95 }, t3: { 1: 120, 2: 60 }, t4: { 1: 70, 2: 110 } }),
    });

    expect(before.standings.find((s) => s.teamId === 't1')!.h2hW).toBe(1);
    expect(after.standings.find((s) => s.teamId === 't1')!.h2hW).toBe(0);
    expect(after.standings.find((s) => s.teamId === 't1')!.cumPts).toBe(160);
  });

  it('stamps rank and FAAB on the latest week only', () => {
    const { rows } = accumulateStandings({
      teams: TEAMS,
      weekly: weekly({ t1: { 1: 100, 2: 90 }, t2: { 1: 80, 2: 95 }, t3: { 1: 120, 2: 60 }, t4: { 1: 70, 2: 110 } }),
      matchups: [...scheduleWeek(1), ...scheduleWeek(2)],
      throughWeek: 2,
    });

    expect(rows.filter((r) => r.week === 1).every((r) => r.rank === undefined)).toBe(true);
    expect(rows.filter((r) => r.week === 2).every((r) => typeof r.rank === 'number')).toBe(true);
    expect(rows.find((r) => r.week === 2)!.faab_remaining).toBe(50);
  });
});
