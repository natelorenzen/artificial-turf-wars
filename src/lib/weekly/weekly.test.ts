import { describe, it, expect } from 'vitest';
import type { RosterEntry } from '@/lib/prompt/context';
import { rankStandings } from '@/lib/engine/allplay';
import { buildLabelMap } from '@/lib/engine/labels';
import { weeklyBase, weeklyOverlay, type WeeklyContext, type WeeklyTeam } from './context';
import {
  buildLineupContext,
  deterministicLineup,
  lineupProblem,
  lineupRoster,
  startableIds,
  toLineup,
} from './lineups';
import { buildWaiverContext, teamWaiverState } from './waivers';
import { lineupSchema } from '@/lib/schemas/decisions';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function entry(over: Partial<RosterEntry> & { player_id: string; position: string }): RosterEntry {
  return {
    name: `Player ${over.player_id}`,
    nfl_team: 'KC',
    projection: 10,
    season_ppg: 10,
    last3_ppg: 10,
    injury_status: null,
    is_on_bye: false,
    ...over,
  } as RosterEntry;
}

/** A legal 15-man roster: 2 QB, 4 RB, 4 WR, 2 TE, 1 K, 2 DEF. */
function roster(): RosterEntry[] {
  const out: RosterEntry[] = [];
  const add = (position: string, count: number, from: number) => {
    for (let i = 0; i < count; i++) {
      out.push(entry({ player_id: `${position}${from + i}`, position, projection: 20 - i }));
    }
  };
  add('QB', 2, 1);
  add('RB', 4, 1);
  add('WR', 4, 1);
  add('TE', 2, 1);
  add('K', 1, 1);
  add('DEF', 2, 1);
  return out;
}

function team(id: string, slot: number): WeeklyTeam {
  return {
    teamId: id,
    modelId: `model-${id}`,
    openrouterId: `lab/model-${id}`,
    displayName: `Model ${id}`,
    draftSlot: slot,
    label: '',
    faabRemaining: 60,
    waiverPriority: slot,
    frozen: false,
  };
}

function context(over: Partial<WeeklyContext> = {}): WeeklyContext {
  const teams = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => team(`t${n}`, n));
  const labels = buildLabelMap(teams.map((t) => ({ teamId: t.teamId, draftSlot: t.draftSlot })));
  for (const t of teams) t.label = labels.get(t.teamId)!;

  const schedule = [
    { week: 5, homeTeamId: 't1', awayTeamId: 't2' },
    { week: 5, homeTeamId: 't3', awayTeamId: 't4' },
    { week: 5, homeTeamId: 't5', awayTeamId: 't6' },
    { week: 5, homeTeamId: 't7', awayTeamId: 't8' },
    { week: 6, homeTeamId: 't1', awayTeamId: 't3' },
  ];

  const opponentOf = new Map<string, string | null>(teams.map((t) => [t.teamId, null]));
  for (const m of schedule.filter((s) => s.week === 5)) {
    opponentOf.set(m.homeTeamId, m.awayTeamId);
    opponentOf.set(m.awayTeamId, m.homeTeamId);
  }

  return {
    seasonId: 'season-1',
    season: 2026,
    week: 5,
    throughWeek: 4,
    teams,
    labels,
    rosters: new Map(teams.map((t) => [t.teamId, roster()])),
    standings: rankStandings(
      teams.map((t, i) => ({
        teamId: t.teamId,
        h2hW: 4 - Math.floor(i / 2),
        h2hL: Math.floor(i / 2),
        h2hT: 0,
        allplayW: 20 - i,
        allplayL: 8 + i,
        cumPts: 500 - i * 10,
      })),
    ),
    weeklyScores: new Map(teams.map((t) => [t.teamId, [110, 98, 121, 104]])),
    schedule,
    opponentOf,
    byeTeams: ['DET', 'PHI'],
    memoryBlocks: new Map(teams.map((t) => [t.teamId, `memory for ${t.label}`])),
    playoffRoundOf: new Map(),
    ...over,
  };
}

// ---------------------------------------------------------------------------

describe('startable players', () => {
  it('excludes bye and Out, keeps Questionable', () => {
    const players = lineupRoster([
      entry({ player_id: 'a', position: 'RB' }),
      entry({ player_id: 'b', position: 'RB', is_on_bye: true }),
      entry({ player_id: 'c', position: 'RB', injury_status: 'Out' }),
      entry({ player_id: 'd', position: 'RB', injury_status: 'IR' }),
      entry({ player_id: 'e', position: 'RB', injury_status: 'Questionable' }),
    ]);
    expect(startableIds(players)).toEqual(['a', 'e']);
  });

  it('carries a missing projection as 0 for sorting but leaves the DATA field null', () => {
    const entries = [entry({ player_id: 'a', position: 'RB', projection: null })];
    expect(lineupRoster(entries)[0].points).toBe(0);
    expect(entries[0].projection).toBeNull();
  });
});

describe('the deterministic fallback', () => {
  it('never starts a player on bye or ruled out', () => {
    const entries = roster().map((p) =>
      p.player_id === 'RB1' ? { ...p, is_on_bye: true } : p.player_id === 'WR1' ? { ...p, injury_status: 'Out' } : p,
    );
    const lineup = deterministicLineup(lineupRoster(entries));
    const named = [lineup.qb, ...lineup.rb, ...lineup.wr, lineup.te, lineup.flex, lineup.k, lineup.def];
    expect(named).not.toContain('RB1');
    expect(named).not.toContain('WR1');
  });

  it('leaves a slot empty rather than starting an ineligible player', () => {
    // Both kickers unavailable: the honest answer is an empty K slot scoring 0, shown
    // as empty, not a WR jammed into it.
    const entries = roster()
      .filter((p) => p.position !== 'K')
      .concat(entry({ player_id: 'K1', position: 'K', is_on_bye: true }));
    expect(deterministicLineup(lineupRoster(entries)).k).toBeNull();
  });
});

describe('lineup legality', () => {
  const players = lineupRoster(roster());
  const legal = {
    qb: 'QB1',
    rb: ['RB1', 'RB2'],
    wr: ['WR1', 'WR2'],
    te: 'TE1',
    flex: 'RB3',
    k: 'K1',
    def: 'DEF1',
  };

  it('accepts a legal lineup', () => {
    expect(lineupProblem(legal, players)).toBeNull();
  });

  it('rejects a player started in two slots', () => {
    expect(lineupProblem({ ...legal, flex: 'RB1' }, players)).toMatch(/more than one slot/);
  });

  it('rejects a wrong-position starter', () => {
    expect(lineupProblem({ ...legal, te: 'WR3' }, players)).toMatch(/te slot/);
  });

  it('rejects a flex that is not RB/WR/TE', () => {
    expect(lineupProblem({ ...legal, flex: 'DEF2' }, players)).toMatch(/flex must be/);
  });

  it('rejects a player who is not on the roster', () => {
    expect(lineupProblem({ ...legal, qb: 'QB9' }, players)).toMatch(/not on this roster/);
  });

  it('rejects a starter on bye, and says why', () => {
    const withBye = lineupRoster(
      roster().map((p) => (p.player_id === 'RB1' ? { ...p, is_on_bye: true } : p)),
    );
    expect(lineupProblem(legal, withBye)).toMatch(/RB1 cannot be started \(on bye\)/);
  });

  it('rejects a starter ruled out, and says why', () => {
    const withOut = lineupRoster(
      roster().map((p) => (p.player_id === 'K1' ? { ...p, injury_status: 'Out' } : p)),
    );
    expect(lineupProblem(legal, withOut)).toMatch(/K1 cannot be started \(listed Out\)/);
  });

  it('copies the response verbatim rather than repairing it', () => {
    const response = {
      ...legal,
      headline: 'h',
      key_factors: ['a'],
      closest_call: 'c',
      what_would_change_it: 'w',
      confidence: 0.5,
    };
    expect(toLineup(response)).toEqual(legal);
  });
});

describe('the split context claim (SPEC §14.6)', () => {
  it('gives all eight an identical base block', () => {
    const ctx = context();
    const bases = ctx.teams.map((t) => buildLineupContext(ctx, t.teamId).hashes.baseHash);
    expect(new Set(bases).size).toBe(1);
  });

  it('gives no two teams the same overlay', () => {
    const ctx = context();
    const overlays = ctx.teams.map((t) => buildLineupContext(ctx, t.teamId).hashes.overlayHash);
    expect(new Set(overlays).size).toBe(ctx.teams.length);
  });

  it('replays each overlay byte-for-byte from (context, teamId)', () => {
    const ctx = context();
    for (const t of ctx.teams) {
      expect(buildLineupContext(ctx, t.teamId).hashes.overlayHash).toBe(
        buildLineupContext(ctx, t.teamId).hashes.overlayHash,
      );
    }
  });

  it('keeps the base stable when roster row order changes', () => {
    // Postgres does not promise row order. If that leaked into the base hash, the
    // shared-context assertion would fail at random and prove nothing when it passed.
    const a = context();
    const b = context({
      rosters: new Map([...a.rosters].map(([id, list]) => [id, [...list].reverse()])),
    });
    expect(weeklyBase(a)).toEqual(weeklyBase(b));
  });

  it('shows a model its opponent under an anonymous label, never a lab name', () => {
    const ctx = context();
    const overlay = weeklyOverlay(ctx, 't1');
    expect(overlay.opponent?.label).toBe('Team B');
    expect(JSON.stringify(overlay)).not.toContain('Model t2');
  });

  it('shows the opponent roster but no opponent lineup', () => {
    const overlay = weeklyOverlay(context(), 't1');
    expect(overlay.opponent?.roster.length).toBe(15);
    expect(JSON.stringify(overlay.opponent)).not.toContain('"qb"');
  });

  it('never carries our win probability into the block (SPEC §6.4)', () => {
    const serialized = JSON.stringify(buildLineupContext(context(), 't1').data).toLowerCase();
    for (const forbidden of ['win_prob', 'p_a_wins', 'playoff_odds', 'title_odds']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('survives week 1, when nothing has been played', () => {
    const ctx = context({
      week: 1,
      throughWeek: 0,
      standings: rankStandings(
        context().teams.map((t) => ({
          teamId: t.teamId,
          h2hW: 0,
          h2hL: 0,
          h2hT: 0,
          allplayW: 0,
          allplayL: 0,
          cumPts: 0,
        })),
      ),
      weeklyScores: new Map(context().teams.map((t) => [t.teamId, []])),
      schedule: [{ week: 1, homeTeamId: 't1', awayTeamId: 't2' }],
      opponentOf: new Map([['t1', 't2'], ['t2', 't1']]),
    });
    const overlay = weeklyOverlay(ctx, 't1');
    expect(overlay.your_record).toBe('0-0');
    expect(overlay.opponent?.season_ppg).toBeNull();
    expect(overlay.opponent?.score_volatility).toBeNull();
  });
});

describe('the waiver DATA block', () => {
  const freeAgents: RosterEntry[] = [
    entry({ player_id: 'FA1', position: 'RB', projection: 12.4 }),
    entry({ player_id: 'FA2', position: 'DEF', projection: 7.1 }),
  ];
  const input = (ctx = context()) => ({ context: ctx, freeAgents, bidWeek: 4 });

  it('gives all eight an identical base and no two the same overlay', () => {
    const ctx = context();
    const blocks = ctx.teams.map((t) => buildWaiverContext(input(ctx), t.teamId).hashes);
    expect(new Set(blocks.map((h) => h.baseHash)).size).toBe(1);
    expect(new Set(blocks.map((h) => h.overlayHash)).size).toBe(ctx.teams.length);
  });

  it('shows every rival roster, under labels rather than lab names', () => {
    const ctx = context();
    const base = buildWaiverContext(input(ctx), 't1').base as {
      league_rosters: { label: string; roster: unknown[] }[];
    };
    expect(base.league_rosters).toHaveLength(8);
    expect(base.league_rosters.map((r) => r.label)).toContain('Team H');
    expect(JSON.stringify(base.league_rosters)).not.toContain('Model t');
  });

  it('puts the free-agent pool in the base, where all eight see the same one', () => {
    const ctx = context();
    const base = buildWaiverContext(input(ctx), 't1').base as { available_players: unknown[] };
    expect(base.available_players).toEqual(freeAgents);
  });

  it('builds the state the FAAB engine validates against from the same roster', () => {
    const ctx = context();
    const state = teamWaiverState(ctx, ctx.teams[0]);
    expect(state.roster).toHaveLength(15);
    expect(state.faabRemaining).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// Regression: 2025 week 6, 6 August 2026.
//
// Houston and Minnesota on bye left three of eight teams unable to field nine. Two
// models noticed and said so — one with JSON null, one with the string "null" — and
// both were recorded as failures and handed a fallback for being right.
// ---------------------------------------------------------------------------

describe('regression — an empty slot is a legal answer', () => {
  const full = lineupRoster(roster());

  /** A roster whose only DEF is on bye: nothing eligible is left for that slot. */
  const noDefence = lineupRoster(
    roster().map((p) => (p.position === 'DEF' ? { ...p, is_on_bye: true } : p)),
  );

  const base = {
    qb: 'QB1',
    rb: ['RB1', 'RB2'],
    wr: ['WR1', 'WR2'],
    te: 'TE1',
    flex: 'RB3',
    k: 'K1',
    def: 'DEF1',
  };

  it('parses a JSON null slot — GPT-5.6 Sol sent this for te and k', () => {
    const parsed = lineupSchema.safeParse({
      ...base,
      te: null,
      k: null,
      headline: 'h',
      key_factors: ['a'],
      closest_call: 'c',
      what_would_change_it: 'w',
      confidence: 0.5,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.te).toBeNull();
  });

  it('parses the STRING "null" as empty — Qwen3.7 Plus sent this for def', () => {
    // It passed the old schema as a player id and then failed roster validation with
    // "null is not on this roster", which reported a correct read of a bye as a failure.
    const parsed = lineupSchema.safeParse({
      ...base,
      def: 'null',
      headline: 'h',
      key_factors: ['a'],
      closest_call: 'c',
      what_would_change_it: 'w',
      confidence: 0.5,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.def).toBeNull();
  });

  it('accepts an empty slot the roster genuinely cannot fill', () => {
    expect(lineupProblem({ ...base, def: null }, noDefence)).toBeNull();
  });

  it('rejects an empty slot while an eligible player sits on the bench', () => {
    // The other half. Leaving FLEX empty with four eligible players is the most
    // gradeable mistake in the game and must not pass as a legal lineup.
    expect(lineupProblem({ ...base, flex: null }, full)).toMatch(
      /flex left empty with \d+ eligible player/,
    );
  });

  it('does not count a player already starting elsewhere as available', () => {
    // Only one kicker, and he is in the K slot. An empty second slot he cannot also
    // fill is unavoidable, not a choice.
    expect(lineupProblem({ ...base, rb: ['RB1', null] }, lineupRoster([
      entry({ player_id: 'QB1', position: 'QB' }),
      entry({ player_id: 'RB1', position: 'RB' }),
      entry({ player_id: 'WR1', position: 'WR' }),
      entry({ player_id: 'WR2', position: 'WR' }),
      entry({ player_id: 'TE1', position: 'TE' }),
      entry({ player_id: 'RB3', position: 'RB' }),
      entry({ player_id: 'K1', position: 'K' }),
      entry({ player_id: 'DEF1', position: 'DEF' }),
    ]))).toBeNull();
  });

  it('still rejects a wholly empty lineup when the roster is full', () => {
    expect(lineupProblem({ qb: null, rb: [null, null], wr: [null, null], te: null, flex: null, k: null, def: null }, full)).not.toBeNull();
  });
});
