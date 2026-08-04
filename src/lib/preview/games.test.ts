import { describe, expect, it } from 'vitest';
import { gameDataBlock, interestScore, selectionDiscriminates, type GameContext, type PreviewPlayer } from './games';

function player(overrides: Partial<PreviewPlayer> = {}): PreviewPlayer {
  return {
    playerId: 'p1',
    name: 'A Player',
    position: 'WR',
    team: 'CIN',
    projPts: 10,
    recentPts: [],
    injuryStatus: null,
    depthChartOrder: null,
    rosteredBy: null,
    ...overrides,
  };
}

function context(overrides: Partial<GameContext> = {}): GameContext {
  return {
    fixture: { gameKey: 'TB@CIN', away: 'TB', home: 'CIN', kickoffAt: null },
    away: [player()],
    home: [player({ playerId: 'p2', team: 'CIN' })],
    projectedTotal: 20,
    leagueStake: 0,
    starPower: 20,
    imbalance: 0,
    ...overrides,
  };
}

describe('interest score', () => {
  it('ignores projected total entirely', () => {
    // The bug this guards: every team contributes its best N players, so the total
    // lands within a couple of points for every fixture and ranking on it is noise.
    const a = context({ projectedTotal: 198.8, starPower: 50, imbalance: 2 });
    const b = context({ projectedTotal: 120.0, starPower: 50, imbalance: 2 });
    expect(interestScore(a)).toBe(interestScore(b));
  });

  it('puts a game our own league holds players in above a flashier one it does not', () => {
    const ourGame = context({ leagueStake: 4, starPower: 45, imbalance: 5 });
    const flashier = context({ leagueStake: 0, starPower: 60, imbalance: 1 });
    expect(interestScore(ourGame)).toBeGreaterThan(interestScore(flashier));
  });

  it('prefers an even matchup to a mismatch at equal star power', () => {
    const even = context({ starPower: 50, imbalance: 1 });
    const mismatch = context({ starPower: 50, imbalance: 30 });
    expect(interestScore(even)).toBeGreaterThan(interestScore(mismatch));
  });
});

describe('selection gate', () => {
  const withScore = (starPower: number) => context({ starPower, imbalance: 0 });

  it('flags a cut that lands between two effectively tied games', () => {
    // Four games all within noise: choosing "the top 4" of these is arbitrary.
    const contexts = [
      withScore(50.0), withScore(49.9), withScore(49.85), withScore(49.8), withScore(49.79),
    ];
    const gate = selectionDiscriminates(contexts, 4);
    expect(gate.ok).toBe(false);
    expect(gate.reason).toMatch(/arbitrary|tied/);
  });

  it('passes when the chosen games genuinely separate from the rest', () => {
    const contexts = [withScore(60), withScore(55), withScore(52), withScore(50), withScore(40)];
    const gate = selectionDiscriminates(contexts, 4);
    expect(gate.ok).toBe(true);
  });

  it('does not complain when there is no selection to make', () => {
    const gate = selectionDiscriminates([withScore(50), withScore(49)], 4);
    expect(gate.ok).toBe(true);
    expect(gate.reason).toMatch(/no selection/);
  });
});

describe('the DATA block', () => {
  const built = () =>
    gameDataBlock(
      context({
        away: [player({ playerId: 'a1', name: 'Away Guy', team: 'TB', projPts: 14.5, recentPts: [12.1, 9.4], rosteredBy: 'Team C' })],
        home: [player({ playerId: 'h1', name: 'Home Guy', team: 'CIN', projPts: 18.2, injuryStatus: 'Questionable' })],
        leagueStake: 1,
      }),
      5,
    );

  it('carries projections, form and injury status through', () => {
    const data = built();
    expect(data.away_players[0]).toMatchObject({
      player_id: 'a1',
      proj_pts_this_week: 14.5,
      last_weeks_actual: [12.1, 9.4],
      rostered_in_this_league_by: 'Team C',
    });
    expect(data.home_players[0].injury_status).toBe('Questionable');
  });

  it('tells the model in-band that no team-level data exists', () => {
    // Without this the model has no way to know the omission is deliberate, and
    // "no betting line in the data" reads identically to "I should supply one".
    const notes = built().data_notes.join(' ');
    expect(notes).toMatch(/No team records, scores, betting lines or weather/);
    expect(notes).toMatch(/Do not assert any/);
  });

  it('never exposes a lab name through league ownership', () => {
    // Ownership must be an anonymous label (SPEC §14.3) — a real model name here
    // would tell a competitor exactly who holds which player.
    const data = built();
    expect(data.away_players[0].rostered_in_this_league_by).toMatch(/^Team [A-H]$/);
    expect(JSON.stringify(data)).not.toMatch(/Anthropic|OpenAI|Claude|Gemini|DeepSeek/);
  });
});
