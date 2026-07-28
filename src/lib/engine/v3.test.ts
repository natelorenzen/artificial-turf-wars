import { describe, expect, it } from 'vitest';
import { LEAGUE } from '@/lib/config/league';
import { assertNoLabelLeak, buildLabelMap, labelForSlot } from './labels';
import { splitPlayoffField, releaseEliminatedRosters, resolvePlayoffPool } from './playoff-pool';
import { rankStandings, type StandingInput } from './allplay';
import {
  buildDraftBoard,
  buildLookahead,
  buildStandingView,
  draftBoardNeeds,
  volatility,
} from '@/lib/prompt/context';
import { assertOverlayReproducible, assertSharedBase, hashSplitContext } from '@/lib/prompt/assemble';

const TEAMS = ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8'];

const identities = TEAMS.map((teamId, i) => ({ teamId, draftSlot: i + 1 }));
const labels = buildLabelMap(identities);

const standingRows: StandingInput[] = TEAMS.map((teamId, i) => ({
  teamId,
  h2hW: 14 - i * 2,
  h2hL: i * 2,
  h2hT: 0,
  allplayW: 0,
  allplayL: 0,
  cumPts: 1500 - i * 40,
}));
const standings = rankStandings(standingRows);

describe('anonymised team labels (SPEC §14.3)', () => {
  it('maps draft slots to stable letters', () => {
    expect(labelForSlot(1)).toBe('Team A');
    expect(labelForSlot(8)).toBe('Team H');
    expect(labels.get('t3')).toBe('Team C');
  });

  it('is stable across rebuilds — a rival must look the same in week 14 as week 1', () => {
    expect(buildLabelMap(identities)).toEqual(labels);
    expect(buildLabelMap([...identities].reverse())).toEqual(labels);
  });

  it('refuses a duplicate slot rather than showing two rivals under one name', () => {
    const broken = identities.map((t, i) => (i === 1 ? { ...t, draftSlot: 1 } : t));
    expect(() => buildLabelMap(broken)).toThrow(/assigned twice/);
  });

  it('catches a competitor identity leaking into a DATA block', () => {
    const clean = JSON.stringify({ opponent: { label: 'Team C', roster: [] } });
    const leaky = JSON.stringify({ opponent: { label: 'Kimi K3', roster: [] } });
    const forbidden = ['Kimi K3', 'moonshotai/kimi-k3', 'Claude Opus 5'];

    expect(() => assertNoLabelLeak(clean, forbidden)).not.toThrow();
    expect(() => assertNoLabelLeak(leaky, forbidden)).toThrow(/leaks competitor identity/);
  });
});

describe('opponent context (SPEC §14.3)', () => {
  it('reports scoring volatility so a model can judge a rival’s floor and ceiling', () => {
    expect(volatility([100, 100, 100])).toBe(0);
    expect(volatility([80, 120])).toBe(20);
    expect(volatility([100])).toBeNull(); // one week is not a distribution
  });

  it('shows the next opponents so "save it for next week" has something to point at', () => {
    const schedule = [
      { week: 3, homeTeamId: 't1', awayTeamId: 't2' },
      { week: 4, homeTeamId: 't3', awayTeamId: 't1' },
      { week: 5, homeTeamId: 't1', awayTeamId: 't4' },
      { week: 6, homeTeamId: 't5', awayTeamId: 't1' },
      { week: 7, homeTeamId: 't1', awayTeamId: 't6' },
    ];
    const lookahead = buildLookahead(
      schedule,
      't1',
      3,
      labels,
      new Map(standings.map((s) => [s.teamId, s])),
      new Map([['t3', [110, 130]]]),
      LEAGUE.lookaheadOpponents,
    );

    expect(lookahead).toHaveLength(LEAGUE.lookaheadOpponents);
    expect(lookahead[0]).toMatchObject({ week: 4, label: 'Team C', season_ppg: 120 });
    expect(lookahead.map((l) => l.week)).toEqual([4, 5, 6]);
    // Never the current week, and never a game this team is not in.
    expect(lookahead.every((l) => l.week > 3)).toBe(true);
  });

  it('gives the playoff-race arithmetic, including games back of the cutoff', () => {
    const view = buildStandingView(standings, 't6', labels, 10);
    expect(view.your_label).toBe('Team F');
    expect(view.weeks_remaining).toBe(LEAGUE.regularSeasonWeeks - 10);
    expect(view.playoff_spots).toBe(LEAGUE.playoffTeams);
    // t6 is 6th at 4-10; the 4-seed (t4) is at 8-6, so 4 wins back.
    expect(view.games_back_of_cutoff).toBe(4);
    expect(view.table).toHaveLength(LEAGUE.teams);
  });

  it('reports a team already inside the cutoff as zero back, never negative', () => {
    expect(buildStandingView(standings, 't1', labels, 10).games_back_of_cutoff).toBe(0);
  });

  it('never leaks a real team id into the standing view', () => {
    const serialized = JSON.stringify(buildStandingView(standings, 't6', labels, 10));
    expect(serialized).not.toContain('t6');
    expect(serialized).toContain('Team F');
  });
});

describe('draft board (SPEC §14.3)', () => {
  const picks = [
    { pickOverall: 2, round: 1, teamId: 't2', playerId: 'p2', name: 'Two', position: 'RB' },
    { pickOverall: 1, round: 1, teamId: 't1', playerId: 'p1', name: 'One', position: 'WR' },
    { pickOverall: 9, round: 2, teamId: 't8', playerId: 'p3', name: 'Three', position: 'RB' },
  ];

  it('shows every team’s picks in draft order, under anonymous labels', () => {
    const board = buildDraftBoard(picks, labels);
    expect(board.map((p) => p.pick_overall)).toEqual([1, 2, 9]);
    expect(board[0].team_label).toBe('Team A');
    expect(board[2].team_label).toBe('Team H');
    expect(JSON.stringify(board)).not.toContain('"t1"');
  });

  it('summarises what each rival has taken, so positional runs are readable', () => {
    expect(draftBoardNeeds(buildDraftBoard(picks, labels))).toEqual({
      'Team A': { WR: 1 },
      'Team B': { RB: 1 },
      'Team H': { RB: 1 },
    });
  });
});

describe('split context hashing (SPEC §14.6)', () => {
  const base = { week: 5, players: [{ id: 'p1', proj: 12.2 }] };

  it('agrees on the base while every team gets its own overlay', () => {
    const hashes = TEAMS.map((teamId) => hashSplitContext({ base, overlay: { teamId } }));
    expect(new Set(hashes.map((h) => h.baseHash)).size).toBe(1);
    expect(() => assertSharedBase(hashes, 'week 5 lineups')).not.toThrow();
  });

  it('flags a week where the league-wide data was not identical', () => {
    const hashes = [
      hashSplitContext({ base, overlay: { teamId: 'a' } }),
      hashSplitContext({ base: { ...base, week: 6 }, overlay: { teamId: 'b' } }),
    ];
    expect(() => assertSharedBase(hashes, 'week 5 lineups')).toThrow(/distinct BASE context hashes/);
  });

  it('flags two teams that were handed the same per-team block', () => {
    const hashes = [
      hashSplitContext({ base, overlay: { teamId: 'a' } }),
      hashSplitContext({ base, overlay: { teamId: 'a' } }),
    ];
    expect(() => assertSharedBase(hashes, 'week 5 lineups')).toThrow(/same per-team block/);
  });

  it('replays each overlay to prove it was a deterministic function of the snapshot', () => {
    const rebuild = (teamId: string) => ({ teamId, opponent: `opp-${teamId}` });
    const sent = TEAMS.map((teamId) => ({
      teamId,
      overlayHash: hashSplitContext({ base, overlay: rebuild(teamId) }).overlayHash,
    }));

    expect(() => assertOverlayReproducible(sent, rebuild, 'week 5')).not.toThrow();

    const tampered = [...sent];
    tampered[3] = { ...tampered[3], overlayHash: 'deadbeef' };
    expect(() => assertOverlayReproducible(tampered, rebuild, 'week 5')).toThrow(/does not replay/);
  });
});

describe('playoff pool (SPEC §14.5)', () => {
  it('splits the field on the published standings order', () => {
    const field = splitPlayoffField(standings);
    expect(field.qualified).toEqual(['t1', 't2', 't3', 't4']);
    expect(field.eliminated).toEqual(['t5', 't6', 't7', 't8']);
  });

  it('refuses to release the pool when the cutoff is genuinely co-ranked', () => {
    const tied = rankStandings(
      TEAMS.map((teamId, i) => ({
        teamId,
        h2hW: i < 5 ? 8 : 2,
        h2hL: i < 5 ? 6 : 12,
        h2hT: 0,
        allplayW: 0,
        allplayL: 0,
        cumPts: i < 5 ? 1200 : 900,
      })),
    );
    expect(() => splitPlayoffField(tied)).toThrow(/ambiguous/);
  });

  it('releases every player on an eliminated roster and nobody else', () => {
    const field = splitPlayoffField(standings);
    const rosters = [
      { teamId: 't1', playerId: 'keep1' },
      { teamId: 't5', playerId: 'free1' },
      { teamId: 't8', playerId: 'free2' },
    ];
    const released = releaseEliminatedRosters(field, rosters);
    expect(released.map((r) => r.playerId)).toEqual(['free1', 'free2']);
  });

  it('lets an unspent budget buy the pool, and rejects an eliminated team’s bid', () => {
    const field = splitPlayoffField(standings);
    const teams = [
      { teamId: 't1', faabRemaining: 4, waiverPriority: 1, roster: ['a1'] },
      { teamId: 't2', faabRemaining: 55, waiverPriority: 2, roster: ['b1'] },
      { teamId: 't5', faabRemaining: 90, waiverPriority: 3, roster: ['e1'] },
    ];
    const { outcomes, rejected } = resolvePlayoffPool(
      [
        { teamId: 't1', addPlayerId: 'free1', dropPlayerId: 'a1', bid: 4 },
        { teamId: 't2', addPlayerId: 'free1', dropPlayerId: 'b1', bid: 40 },
        { teamId: 't5', addPlayerId: 'free1', dropPlayerId: 'e1', bid: 90 },
      ],
      teams,
      field,
    );

    // The eliminated team's $90 never enters the auction at all.
    expect(rejected.map((r) => r.teamId)).toEqual(['t5']);
    // The team that hoarded all season wins; the one that spent to survive cannot answer.
    expect(outcomes.find((o) => o.won)!.teamId).toBe('t2');
    expect(outcomes.find((o) => o.teamId === 't1')!.losingReason).toBe('outbid');
  });
});
