import { describe, expect, it } from 'vitest';
import {
  buildScoutingIndex,
  dossierAgeHours,
  isDossierStale,
  lookupScouting,
  scoutingCoverageNote,
  UNSCOUTED,
  type StoredDossier,
} from './scouting';
import { buildPickContext, type DraftState } from '@/lib/engine/draft-runner';
import type { Dossier, DossierPlayer } from './dossier';

function player(over: Partial<DossierPlayer> & { player_id: string }): DossierPlayer {
  return {
    name: 'A Player',
    position: 'RB',
    nfl_team: 'SF',
    proj_season_points: 200,
    last_season_points: 180,
    adp: 20,
    positional_rank: 3,
    bye_week: 9,
    depth_chart_order: 1,
    injury_status: null,
    preseason: null,
    ...over,
  } as DossierPlayer;
}

function stored(players: DossierPlayer[]): StoredDossier {
  return {
    hash: 'abc123',
    tokenCount: 100,
    builtAt: new Date().toISOString(),
    dossier: {
      season: 2026,
      league: {} as Dossier['league'],
      scarcity_curves: [
        {
          position: 'RB',
          points_by_rank: [{ rank: 1, proj_season_points: 300 }],
          replacement_rank: 20,
          replacement_points: 120,
          spread_over_replacement: 180,
        },
      ],
      players,
      byes_by_team: {},
      notes: ['a note'],
    },
  };
}

describe('scouting index', () => {
  it('indexes every dossier player by id', () => {
    const index = buildScoutingIndex(stored([player({ player_id: '1' }), player({ player_id: '2' })]));
    expect(index.covered).toBe(2);
    expect(lookupScouting(index, '1').scouted).toBe(true);
  });

  it('distinguishes "not in the scouted set" from "played no preseason snaps"', () => {
    // The distinction this project has already published three model decisions as
    // failures for collapsing. A missing player and a rested player are opposite
    // facts and must not both read as an absent preseason line.
    const rested = player({ player_id: 'rested', preseason: null });
    const index = buildScoutingIndex(stored([rested]));

    expect(lookupScouting(index, 'rested')).toMatchObject({ scouted: true, preseason: null });
    expect(lookupScouting(index, 'never-heard-of-him')).toMatchObject({ scouted: false, preseason: null });
  });

  it('falls back to UNSCOUTED rather than throwing when no dossier is loaded', () => {
    expect(lookupScouting(null, 'anyone')).toEqual(UNSCOUTED);
  });

  it('states the coverage rule in a note, so null is never read as "did not play"', () => {
    const note = scoutingCoverageNote(buildScoutingIndex(stored([player({ player_id: '1' })])));
    expect(note).toContain('NOT');
    expect(note).toContain('preseason:null');
  });
});

// ---------------------------------------------------------------------------
// The regression this whole module exists for
// ---------------------------------------------------------------------------

function draftState(over: Partial<DraftState> = {}): DraftState {
  return {
    seasonId: 's1',
    season: 2026,
    teams: [
      { teamId: 't1', modelId: 'm1', openrouterId: 'o1', displayName: 'M1', draftSlot: 1, label: 'Team A' },
    ],
    picks: [],
    pool: [
      { playerId: 'p1', name: 'Star Back', position: 'RB', projSeasonPoints: 300, adp: 1 },
      { playerId: 'p2', name: 'Deep Guy', position: 'RB', projSeasonPoints: 90, adp: 300 },
    ],
    ...over,
  };
}

describe('the pick DATA block carries the dossier', () => {
  it('merges scouting onto every player shown on the board', () => {
    const index = buildScoutingIndex(
      stored([
        player({
          player_id: 'p1',
          injury_status: 'Questionable',
          bye_week: 7,
          preseason: {
            games_played: 2,
            off_snaps: 45,
            team_off_snaps: 71,
            snap_share_pct: 63.4,
            rush_att: 23,
            targets: 2,
            points_ppr: 15.6,
          },
        }),
      ]),
    );

    const context = buildPickContext(draftState({ scouting: index }), draftState().teams[0], 1, 1);
    const shown = context.data.available.find((p) => p.player_id === 'p1')!;

    expect(shown).toMatchObject({ scouted: true, injury_status: 'Questionable', bye_week: 7 });
    expect(shown.preseason?.snap_share_pct).toBe(63.4);
  });

  it('ships the scarcity curves with every pick, not only in the briefing', () => {
    // Five of the first eight picks in the 2025 rehearsal were quarterbacks in a
    // league that starts one. The curve is the fact that prevents it, so it belongs
    // in front of the model at the moment of the pick.
    const context = buildPickContext(
      draftState({ scouting: buildScoutingIndex(stored([player({ player_id: 'p1' })])) }),
      draftState().teams[0],
      1,
      1,
    );
    expect(context.data.scarcity_curves).toHaveLength(1);
    expect(context.data.scarcity_curves[0].replacement_points).toBe(120);
  });

  it('carries the reading notes, including the preseason coverage rule', () => {
    const context = buildPickContext(
      draftState({ scouting: buildScoutingIndex(stored([player({ player_id: 'p1' })])) }),
      draftState().teams[0],
      1,
      1,
    );
    expect(context.data.data_notes).toContain('a note');
    expect(context.data.data_notes.some((n) => n.includes('scouted:false'))).toBe(true);
  });

  it('still builds a legal DATA block when no dossier exists, for rehearsal seasons', () => {
    const context = buildPickContext(draftState(), draftState().teams[0], 1, 1);
    expect(context.data.available[0]).toMatchObject({ scouted: false });
    expect(context.data.scarcity_curves).toEqual([]);
    expect(context.data.data_notes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Staleness — the second half of "the dossier never reached anyone"
// ---------------------------------------------------------------------------

describe('dossier staleness', () => {
  const now = new Date('2026-08-24T15:00:00Z');
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();

  it('measures age in hours', () => {
    expect(dossierAgeHours(hoursAgo(6), now)).toBeCloseTo(6);
    expect(dossierAgeHours(hoursAgo(48), now)).toBeCloseTo(48);
  });

  it('passes a briefing rebuilt the morning of the draft', () => {
    expect(isDossierStale(hoursAgo(4), 48, now)).toBe(false);
  });

  it('passes a briefing rebuilt the evening before', () => {
    // The realistic workflow. A guard that blocks this would just get overridden by
    // habit, and an override used by habit is not a guard.
    expect(isDossierStale(hoursAgo(20), 48, now)).toBe(false);
  });

  it('refuses the failure it exists for: a rebuild that never happened', () => {
    // 16 Aug's dossier against a 24 Aug draft. Between 29 July and 16 Aug, 23 of the
    // 119 players inside ADP 120 changed injury status; final cuts land the same week.
    expect(isDossierStale(hoursAgo(8 * 24), 48, now)).toBe(true);
  });

  it('treats a missing or unparseable timestamp as unusably old, not brand new', () => {
    // The dangerous default. Reading a broken timestamp as age 0 would let the guard
    // wave through exactly the case it cannot evaluate.
    expect(isDossierStale(null, 48, now)).toBe(true);
    expect(isDossierStale('not a date', 48, now)).toBe(true);
    expect(dossierAgeHours(null, now)).toBe(Number.POSITIVE_INFINITY);
  });

  it('does not call a future-dated dossier stale', () => {
    // Clock skew between this machine and Postgres must not refuse a briefing built
    // seconds ago — that turns a safety guard into an outage on the one day it must
    // not fail.
    expect(isDossierStale(new Date(now.getTime() + 30_000).toISOString(), 48, now)).toBe(false);
  });
});
