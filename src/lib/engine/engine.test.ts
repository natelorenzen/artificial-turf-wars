import { describe, expect, it } from 'vitest';
import { LEAGUE } from '@/lib/config/league';
import { auctionDiscriminates, resolveAuction } from './auction';
import { allPlayWeek, h2hWeek, playoffSeeds, rankStandings, semifinalMatchups } from './allplay';
import { fallbackPick, narrowAvailable, rosterNeeds, slotPickNumbers, snakeOrder, topPerPosition } from './draft';
import { resolveWaivers, validateWaiverClaims } from './faab';
import { evaluateLineup, optimalLineup, scoreLineup, validateLineup, type LineupPlayer } from './lineup';
import { generateH2HSchedule } from './schedule';
import { commitHash, seededShuffle } from './rng';

const TEAMS = ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8'];
const SEED = 'gridiron-2026-seed';

describe('seeded rng', () => {
  it('is reproducible from the seed', () => {
    expect(seededShuffle(TEAMS, SEED)).toEqual(seededShuffle(TEAMS, SEED));
  });

  it('differs by seed and commits to a publishable hash', () => {
    expect(seededShuffle(TEAMS, SEED)).not.toEqual(seededShuffle(TEAMS, 'other'));
    expect(commitHash(SEED)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('H2H schedule', () => {
  const schedule = generateH2HSchedule(TEAMS, SEED);

  it('is a balanced double round-robin over the whole regular season', () => {
    expect(new Set(schedule.map((m) => m.week)).size).toBe(LEAGUE.regularSeasonWeeks);
    expect(schedule).toHaveLength((LEAGUE.regularSeasonWeeks * LEAGUE.teams) / 2);
  });

  it('pairs every team with every other exactly twice, with sides swapped', () => {
    for (let i = 0; i < TEAMS.length; i++) {
      for (let j = i + 1; j < TEAMS.length; j++) {
        const games = schedule.filter(
          (m) =>
            (m.homeTeamId === TEAMS[i] && m.awayTeamId === TEAMS[j]) ||
            (m.homeTeamId === TEAMS[j] && m.awayTeamId === TEAMS[i]),
        );
        expect(games).toHaveLength(2);
        expect(games[0].homeTeamId).not.toBe(games[1].homeTeamId);
      }
    }
  });

  it('gives every team exactly one game a week — nobody sits', () => {
    for (let week = 1; week <= LEAGUE.regularSeasonWeeks; week++) {
      const inWeek = schedule.filter((m) => m.week === week);
      const playing = inWeek.flatMap((m) => [m.homeTeamId, m.awayTeamId]);
      expect(new Set(playing).size).toBe(LEAGUE.teams);
    }
  });

  it('refuses an odd team count', () => {
    expect(() => generateH2HSchedule(TEAMS.slice(0, 7), SEED)).toThrow(/even team count/);
  });
});

describe('all-play', () => {
  it('runs 0-7 to 7-0 across eight teams', () => {
    const scores = TEAMS.map((teamId, i) => ({ teamId, points: 100 + i }));
    const records = allPlayWeek(scores);
    expect(records.find((r) => r.teamId === 't8')).toMatchObject({ wins: 7, losses: 0 });
    expect(records.find((r) => r.teamId === 't1')).toMatchObject({ wins: 0, losses: 7 });
  });

  it('awards half a win each on an exact tie', () => {
    const records = allPlayWeek([
      { teamId: 'a', points: 100 },
      { teamId: 'b', points: 100 },
      { teamId: 'c', points: 90 },
    ]);
    expect(records.find((r) => r.teamId === 'a')).toMatchObject({ wins: 1.5, losses: 0.5 });
    expect(records.find((r) => r.teamId === 'b')).toMatchObject({ wins: 1.5, losses: 0.5 });
    expect(records.find((r) => r.teamId === 'c')).toMatchObject({ wins: 0, losses: 2 });
  });

  it('treats 112.30 and 112.3 as the same score', () => {
    const records = allPlayWeek([
      { teamId: 'a', points: 112.3 },
      { teamId: 'b', points: 112.30000001 },
    ]);
    expect(records[0].wins).toBe(0.5);
  });

  it('records a head-to-head tie as a tie, not as a half win', () => {
    const out = h2hWeek([{ homeTeamId: 'a', awayTeamId: 'b' }], [
      { teamId: 'a', points: 100 },
      { teamId: 'b', points: 100 },
    ]);
    expect(out.get('a')).toBe('T');
    expect(out.get('b')).toBe('T');
  });
});

describe('standings', () => {
  it('ranks on all-play, tiebreaks on points', () => {
    const ranked = rankStandings([
      { teamId: 'a', allplayW: 40, allplayL: 30, cumPts: 1200 },
      { teamId: 'b', allplayW: 40, allplayL: 30, cumPts: 1300 },
      { teamId: 'c', allplayW: 45, allplayL: 25, cumPts: 1100 },
    ]);
    expect(ranked.map((r) => r.teamId)).toEqual(['c', 'b', 'a']);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('declares co-ranked teams rather than flipping a coin', () => {
    const ranked = rankStandings([
      { teamId: 'a', allplayW: 40, allplayL: 30, cumPts: 1200 },
      { teamId: 'b', allplayW: 40, allplayL: 30, cumPts: 1200 },
    ]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 1]);
    expect(ranked.every((r) => r.coRanked)).toBe(true);
  });

  it('seeds the playoff from the same order the site shows', () => {
    const ranked = rankStandings(
      TEAMS.map((teamId, i) => ({ teamId, allplayW: i, allplayL: 7 - i, cumPts: 1000 + i })),
    );
    const seeds = playoffSeeds(ranked, LEAGUE.playoffTeams);
    expect(seeds).toHaveLength(4);
    expect(semifinalMatchups(seeds)).toEqual([
      { homeTeamId: seeds[0], awayTeamId: seeds[3] },
      { homeTeamId: seeds[1], awayTeamId: seeds[2] },
    ]);
  });
});

describe('slot auction', () => {
  const prefs = (first: number) => [first, ...[1, 2, 3, 4, 5, 6, 7, 8].filter((s) => s !== first)];

  it('awards slots in bid order, each team taking its top available preference', () => {
    const { awards } = resolveAuction(
      [
        { teamId: 't1', bid: 62, slotPreference: prefs(4) },
        { teamId: 't2', bid: 40, slotPreference: prefs(4) },
        { teamId: 't3', bid: 30, slotPreference: prefs(1) },
        { teamId: 't4', bid: 25, slotPreference: prefs(8) },
        { teamId: 't5', bid: 20, slotPreference: prefs(1) },
        { teamId: 't6', bid: 10, slotPreference: prefs(8) },
        { teamId: 't7', bid: 5, slotPreference: prefs(2) },
        { teamId: 't8', bid: 0, slotPreference: prefs(3) },
      ],
      SEED,
    );
    const by = new Map(awards.map((a) => [a.teamId, a]));
    expect(by.get('t1')!.assignedSlot).toBe(4);
    expect(by.get('t2')!.assignedSlot).toBe(1); // 4 gone, next preference is 1
    expect(by.get('t3')!.assignedSlot).toBe(2); // 1 gone
    expect(by.get('t4')!.assignedSlot).toBe(8);
    expect(by.get('t1')!.faabRemaining).toBe(LEAGUE.budgetTotal - 62);
  });

  it('breaks equal bids on the seed and says so', () => {
    const entries = TEAMS.map((teamId) => ({ teamId, bid: 25, slotPreference: prefs(1) }));
    const a = resolveAuction(entries, SEED);
    const b = resolveAuction(entries, SEED);
    expect(a.awards.map((x) => x.teamId)).toEqual(b.awards.map((x) => x.teamId));
    expect(a.awards.every((x) => x.tiebroken)).toBe(true);
    expect(resolveAuction(entries, 'different').awards.map((x) => x.teamId)).not.toEqual(
      a.awards.map((x) => x.teamId),
    );
  });

  it('gives a failed response a $0 bid and a seed-ordered slot, flagged publicly', () => {
    const entries = TEAMS.map((teamId, i) =>
      i === 0
        ? { teamId, bid: null, slotPreference: null }
        : { teamId, bid: 30 - i, slotPreference: prefs(1) },
    );
    const { awards } = resolveAuction(entries, SEED);
    const failed = awards.find((a) => a.teamId === 't1')!;
    expect(failed.bid).toBe(0);
    expect(failed.fallbackApplied).toBe(true);
    expect(failed.faabRemaining).toBe(LEAGUE.budgetTotal);
  });

  it('rejects a slot_preference that is not a permutation', () => {
    const entries = TEAMS.map((teamId, i) =>
      i === 0
        ? { teamId, bid: 50, slotPreference: [1, 1, 2, 3, 4, 5, 6, 7] }
        : { teamId, bid: 10, slotPreference: prefs(1) },
    );
    expect(resolveAuction(entries, SEED).awards.find((a) => a.teamId === 't1')!.fallbackApplied).toBe(true);
  });

  it('seeds waiver priority in reverse draft-slot order', () => {
    const { awards } = resolveAuction(
      TEAMS.map((teamId, i) => ({ teamId, bid: 80 - i * 10, slotPreference: prefs(i + 1) })),
      SEED,
    );
    const last = awards.find((a) => a.assignedSlot === LEAGUE.teams)!;
    const first = awards.find((a) => a.assignedSlot === 1)!;
    expect(last.waiverPriority).toBe(1);
    expect(first.waiverPriority).toBe(LEAGUE.teams);
  });

  it('flags a clustered auction as non-discriminating (the Phase 4 gate)', () => {
    const clustered = resolveAuction(
      TEAMS.map((teamId) => ({ teamId, bid: 30, slotPreference: prefs(1) })),
      SEED,
    );
    expect(auctionDiscriminates(clustered).ok).toBe(false);

    const spread = resolveAuction(
      TEAMS.map((teamId, i) => ({ teamId, bid: i * 12, slotPreference: prefs(1) })),
      SEED,
    );
    expect(auctionDiscriminates(spread).ok).toBe(true);
  });
});

describe('snake draft', () => {
  it('runs 120 picks over 15 rounds and reverses every round', () => {
    const order = snakeOrder();
    expect(order).toHaveLength(LEAGUE.teams * LEAGUE.draftRounds);
    expect(order[0]).toMatchObject({ round: 1, pickOverall: 1, slot: 1 });
    expect(order[7]).toMatchObject({ round: 1, pickOverall: 8, slot: 8 });
    expect(order[8]).toMatchObject({ round: 2, pickOverall: 9, slot: 8 });
  });

  it('gives slot 1 picks 1 and 16, and slot 8 picks 8 and 9 back to back', () => {
    const numbers = slotPickNumbers();
    expect(numbers[1].slice(0, 2)).toEqual([1, 16]);
    expect(numbers[8].slice(0, 2)).toEqual([8, 9]);
    expect(numbers[4].slice(0, 2)).toEqual([4, 13]);
  });

  it('reports roster needs in slot terms', () => {
    const needs = rosterNeeds([
      { playerId: 'a', position: 'RB' },
      { playerId: 'b', position: 'WR' },
      { playerId: 'c', position: 'RB' },
      { playerId: 'd', position: 'RB' },
    ]);
    expect(needs.RB).toBe('2/2');
    expect(needs.FLEX).toBe('1/1');
    expect(needs.QB).toBe('0/1');
  });

  const pool = [
    { playerId: 'wr1', name: 'WR One', position: 'WR' as const, projSeasonPoints: 300 },
    { playerId: 'rb1', name: 'RB One', position: 'RB' as const, projSeasonPoints: 290 },
    { playerId: 'k1', name: 'K One', position: 'K' as const, projSeasonPoints: 150 },
    { playerId: 'def1', name: 'DEF One', position: 'DEF' as const, projSeasonPoints: 140 },
    { playerId: 'qb1', name: 'QB One', position: 'QB' as const, projSeasonPoints: 360 },
    { playerId: 'te1', name: 'TE One', position: 'TE' as const, projSeasonPoints: 200 },
  ];

  it('leaves rounds 1-12 unconstrained', () => {
    const { narrowed, pool: p } = narrowAvailable(pool, [], 12);
    expect(narrowed).toBe(false);
    expect(p).toHaveLength(pool.length);
  });

  it('narrows the pool from round 13 to only the positions a team still needs', () => {
    const roster = [
      { playerId: 'x', position: 'WR' as const },
      { playerId: 'y', position: 'RB' as const },
      { playerId: 'z', position: 'QB' as const },
      { playerId: 'w', position: 'TE' as const },
    ];
    const { narrowed, pool: p, missing } = narrowAvailable(pool, roster, 13);
    expect(narrowed).toBe(true);
    expect(missing.sort()).toEqual(['DEF', 'K']);
    expect(p.map((x) => x.position).sort()).toEqual(['DEF', 'K']);
  });

  it('falls back to a needed position before raw projection', () => {
    const roster = [
      { playerId: 'x', position: 'WR' as const },
      { playerId: 'y', position: 'RB' as const },
      { playerId: 'z', position: 'QB' as const },
      { playerId: 'w', position: 'TE' as const },
      { playerId: 'v', position: 'DEF' as const },
    ];
    expect(fallbackPick(pool, roster, 13).playerId).toBe('k1');
    // Early rounds: highest projection wins outright.
    expect(fallbackPick(pool, [], 3).playerId).toBe('qb1');
  });

  it('orders the available pool deterministically by projection (list-order bias)', () => {
    const top = topPerPosition(pool, 1);
    expect(top.map((p) => p.playerId)).toEqual(['qb1', 'wr1', 'rb1', 'te1', 'k1', 'def1']);
  });
});

describe('lineup', () => {
  const roster: LineupPlayer[] = [
    { playerId: 'qb1', position: 'QB', points: 22 },
    { playerId: 'qb2', position: 'QB', points: 18 },
    { playerId: 'rb1', position: 'RB', points: 20 },
    { playerId: 'rb2', position: 'RB', points: 14 },
    { playerId: 'rb3', position: 'RB', points: 13 },
    { playerId: 'wr1', position: 'WR', points: 19 },
    { playerId: 'wr2', position: 'WR', points: 16 },
    { playerId: 'wr3', position: 'WR', points: 15 },
    { playerId: 'te1', position: 'TE', points: 11 },
    { playerId: 'te2', position: 'TE', points: 4 },
    { playerId: 'k1', position: 'K', points: 9 },
    { playerId: 'def1', position: 'DEF', points: 7 },
  ];

  const good = {
    qb: 'qb1',
    rb: ['rb1', 'rb2'],
    wr: ['wr1', 'wr2'],
    te: 'te1',
    flex: 'wr3',
    k: 'k1',
    def: 'def1',
  };

  it('accepts a legal lineup', () => {
    expect(validateLineup(good, roster)).toBeNull();
  });

  it('rejects a duplicated player, a foreign player, and an illegal slot', () => {
    expect(validateLineup({ ...good, flex: 'wr1' }, roster)).toMatch(/more than one slot/);
    expect(validateLineup({ ...good, qb: 'nobody' }, roster)).toMatch(/not on this roster/);
    expect(validateLineup({ ...good, flex: 'qb2' }, roster)).toMatch(/flex must be/);
    expect(validateLineup({ ...good, k: 'te2' }, roster)).toMatch(/k slot/);
  });

  it('finds the true optimum, including the FLEX', () => {
    const { total, lineup } = optimalLineup(roster);
    // qb1 22 + rb1 20 + rb2 14 + wr1 19 + wr2 16 + te1 11 + flex wr3 15 + k 9 + def 7
    expect(total).toBe(133);
    expect(lineup.flex).toBe('wr3');
  });

  it('never picks a FLEX that beats a dedicated starter it should have replaced', () => {
    // TE-heavy roster: the second TE must not be preferred over a better RB3.
    const { lineup } = optimalLineup([
      ...roster.filter((p) => p.playerId !== 'wr3'),
      { playerId: 'te3', position: 'TE', points: 12 },
    ]);
    expect(lineup.flex).toBe('rb3'); // 13 beats te3's 12
  });

  it('excludes players on bye from the optimum', () => {
    const { lineup } = optimalLineup(
      roster.map((p) => (p.playerId === 'wr3' ? { ...p, isOnBye: true } : p)),
    );
    expect(lineup.flex).toBe('rb3');
  });

  it('scores an unfilled slot as an explicit empty, not a quiet zero', () => {
    const { total, perSlot } = scoreLineup(
      { ...good, k: null },
      new Map(roster.map((p) => [p.playerId, p.points])),
    );
    expect(total).toBe(124);
    expect(perSlot.find((s) => s.slot === 'K')).toMatchObject({ empty: true, points: 0 });
  });

  it('computes lineup efficiency and points left on the bench', () => {
    const evaluation = evaluateLineup({ ...good, flex: 'rb3' }, roster);
    expect(evaluation.optimal).toBe(133);
    expect(evaluation.actual).toBe(131);
    expect(evaluation.pointsLeftOnBench).toBe(2);
    expect(evaluation.efficiency).toBeCloseTo(131 / 133, 4);
    expect(evaluation.flexDelta).toBe(-2); // started rb3 (13) over wr3 (15)
  });

  it('treats a roster that cannot score as fully efficient rather than 0/0', () => {
    const zeroed = roster.map((p) => ({ ...p, points: 0 }));
    expect(evaluateLineup(good, zeroed).efficiency).toBe(1);
  });
});

describe('FAAB resolution', () => {
  const baseTeams = [
    { teamId: 'a', faabRemaining: 60, waiverPriority: 1, roster: ['a1', 'a2'] },
    { teamId: 'b', faabRemaining: 60, waiverPriority: 2, roster: ['b1', 'b2'] },
    { teamId: 'c', faabRemaining: 5, waiverPriority: 3, roster: ['c1', 'c2'] },
  ];

  it('awards the player to the highest bid and records the loser', () => {
    const { outcomes } = resolveWaivers(
      [
        { teamId: 'a', addPlayerId: 'p1', dropPlayerId: 'a1', bid: 23 },
        { teamId: 'b', addPlayerId: 'p1', dropPlayerId: 'b1', bid: 41 },
      ],
      baseTeams,
    );
    expect(outcomes.find((o) => o.teamId === 'b')!.won).toBe(true);
    expect(outcomes.find((o) => o.teamId === 'a')).toMatchObject({ won: false, losingReason: 'outbid' });
  });

  it('breaks a tied bid on the rolling list and labels it a tiebreak', () => {
    const { outcomes } = resolveWaivers(
      [
        { teamId: 'b', addPlayerId: 'p1', dropPlayerId: 'b1', bid: 30 },
        { teamId: 'a', addPlayerId: 'p1', dropPlayerId: 'a1', bid: 30 },
      ],
      baseTeams,
    );
    expect(outcomes.find((o) => o.won)!.teamId).toBe('a'); // priority 1
    expect(outcomes.find((o) => !o.won)!.losingReason).toBe('tiebreak');
  });

  it('drops a winner to the bottom of the rolling list', () => {
    const { teams } = resolveWaivers(
      [{ teamId: 'a', addPlayerId: 'p1', dropPlayerId: 'a1', bid: 10 }],
      baseTeams,
    );
    expect(teams.map((t) => t.teamId)).toEqual(['b', 'c', 'a']);
    expect(teams.find((t) => t.teamId === 'a')!.waiverPriority).toBe(3);
  });

  it('debits the winning bid and leaves losing bids unspent', () => {
    const { teams } = resolveWaivers(
      [
        { teamId: 'a', addPlayerId: 'p1', dropPlayerId: 'a1', bid: 23 },
        { teamId: 'b', addPlayerId: 'p1', dropPlayerId: 'b1', bid: 41 },
      ],
      baseTeams,
    );
    expect(teams.find((t) => t.teamId === 'b')!.faabRemaining).toBe(19);
    expect(teams.find((t) => t.teamId === 'a')!.faabRemaining).toBe(60);
  });

  it('mutates the roster atomically: the add lands, the drop leaves', () => {
    const { teams } = resolveWaivers(
      [{ teamId: 'a', addPlayerId: 'p1', dropPlayerId: 'a1', bid: 10 }],
      baseTeams,
    );
    const a = teams.find((t) => t.teamId === 'a')!;
    expect(a.roster).toContain('p1');
    expect(a.roster).not.toContain('a1');
    expect(a.roster).toHaveLength(2);
  });

  it('rejects a claim whose drop is not on the roster', () => {
    const { outcomes } = resolveWaivers(
      [{ teamId: 'a', addPlayerId: 'p1', dropPlayerId: 'not-mine', bid: 10 }],
      baseTeams,
    );
    expect(outcomes[0]).toMatchObject({ won: false, losingReason: 'invalid_drop' });
  });

  it('stops a team from winning past its remaining budget across multiple claims', () => {
    const { outcomes } = resolveWaivers(
      [
        { teamId: 'c', addPlayerId: 'p1', dropPlayerId: 'c1', bid: 5 },
        { teamId: 'c', addPlayerId: 'p2', dropPlayerId: 'c2', bid: 5 },
      ],
      baseTeams,
    );
    expect(outcomes.filter((o) => o.won)).toHaveLength(1);
    expect(outcomes.find((o) => !o.won)!.losingReason).toBe('insufficient_budget');
  });

  it('treats an empty claim list as a valid decision', () => {
    const { outcomes, teams } = resolveWaivers([], baseTeams);
    expect(outcomes).toEqual([]);
    expect(teams.map((t) => t.waiverPriority)).toEqual([1, 2, 3]);
  });

  it('rejects a response whose bids exceed the budget before anything is applied', () => {
    const team = { teamId: 'a', faabRemaining: 20, waiverPriority: 1, roster: Array.from({ length: 15 }, (_, i) => `p${i}`) };
    const error = validateWaiverClaims(
      [
        { teamId: 'a', addPlayerId: 'x', dropPlayerId: 'p0', bid: 15 },
        { teamId: 'a', addPlayerId: 'y', dropPlayerId: 'p1', bid: 15 },
      ],
      team,
      new Set(['x', 'y']),
    );
    expect(error).toMatch(/bids total \$30/);
  });
});
