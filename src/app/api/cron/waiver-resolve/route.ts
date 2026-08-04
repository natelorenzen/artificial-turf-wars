import { assertCronAuth, assertBeforeKickoff, cronErrorResponse } from '@/lib/cron/guard';
import { supabaseServer } from '@/lib/supabase-server';
import { resolveWaivers, type TeamWaiverState, type WaiverClaim } from '@/lib/engine/faab';
import { resolveScoringWeek, seasonIdFor } from '@/lib/scoring/week';
import { LEAGUE } from '@/lib/config/league';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Wednesday 12:00 ET — resolve the sealed FAAB bids submitted on Tuesday (SPEC §4.5).
 *
 * Fully deterministic: no model is called here. The bids were the decision; this job
 * only applies the published rule to them, which is what lets a spectator replay the
 * whole run from `waiver_bids` alone.
 *
 * The kickoff guard DOES apply, unlike the scoring jobs: this job must complete
 * before the week it is transacting into begins, or a team's roster changes under a
 * lineup that is already locked.
 */
export async function GET(request: Request) {
  try {
    assertCronAuth(request);

    const db = supabaseServer();
    const season = Number(process.env.SEASON_YEAR ?? '2026');
    const seasonId = await seasonIdFor(db, season);

    // Bids were submitted for the week just played; they transact into the next one.
    const playedWeek = await resolveScoringWeek(db, season);
    if (playedWeek === null) {
      return Response.json({ ok: true, skipped: 'season has not started', season });
    }
    const targetWeek = playedWeek + 1;
    if (targetWeek > LEAGUE.regularSeasonWeeks) {
      return Response.json({ ok: true, skipped: 'regular season is over', season, playedWeek });
    }
    await assertBeforeKickoff(db, season, targetWeek);

    // --- load the sealed bids ------------------------------------------------
    const { data: bidRows, error: bidError } = await db
      .from('waiver_bids')
      .select('id, team_id, add_player_id, drop_player_id, bid')
      .eq('week', playedWeek);
    if (bidError) throw new Error(`waiver_bids: ${bidError.message}`);

    if (!bidRows || bidRows.length === 0) {
      return Response.json({ ok: true, season, week: playedWeek, claims: 0, note: 'no bids submitted' });
    }

    // --- current team state --------------------------------------------------
    const { data: teamRows, error: teamError } = await db
      .from('teams')
      .select('id, faab_remaining, waiver_priority')
      .eq('season_id', seasonId);
    if (teamError) throw new Error(`teams: ${teamError.message}`);

    const { data: rosterRows, error: rosterError } = await db
      .from('rosters')
      .select('team_id, player_id')
      .in('team_id', (teamRows ?? []).map((t) => t.id))
      .eq('active', true);
    if (rosterError) throw new Error(`rosters: ${rosterError.message}`);

    const rosterOf = new Map<string, string[]>();
    for (const row of rosterRows ?? []) {
      const list = rosterOf.get(row.team_id as string) ?? [];
      list.push(row.player_id as string);
      rosterOf.set(row.team_id as string, list);
    }

    const teams: TeamWaiverState[] = (teamRows ?? []).map((t) => ({
      teamId: t.id as string,
      faabRemaining: Number(t.faab_remaining ?? 0),
      waiverPriority: Number(t.waiver_priority ?? 0),
      roster: rosterOf.get(t.id as string) ?? [],
    }));

    const claims: WaiverClaim[] = bidRows.map((b) => ({
      teamId: b.team_id as string,
      addPlayerId: b.add_player_id as string,
      dropPlayerId: b.drop_player_id as string,
      bid: Number(b.bid),
    }));

    // --- resolve -------------------------------------------------------------
    const resolution = resolveWaivers(claims, teams);

    // --- persist -------------------------------------------------------------
    // Losing bids are updated, never deleted: a team that bid $40 and lost to $41 is
    // showing its valuation just as clearly as the winner (SPEC §5.4).
    const bidIdOf = new Map(
      bidRows.map((b) => [`${b.team_id}:${b.add_player_id}`, b.id as string]),
    );
    for (const outcome of resolution.outcomes) {
      const id = bidIdOf.get(`${outcome.teamId}:${outcome.addPlayerId}`);
      if (!id) continue;
      const { error } = await db
        .from('waiver_bids')
        .update({ won: outcome.won, losing_reason: outcome.losingReason })
        .eq('id', id);
      if (error) throw new Error(`waiver_bids update: ${error.message}`);
    }

    for (const outcome of resolution.outcomes.filter((o) => o.won)) {
      // Drop first: `rosters_one_active_stint` is a unique index on (team, player)
      // where active, so a re-add of a previously dropped player collides unless the
      // old stint is closed in the same pass.
      const { error: dropError } = await db
        .from('rosters')
        .update({ active: false, dropped_week: targetWeek })
        .eq('team_id', outcome.teamId)
        .eq('player_id', outcome.dropPlayerId)
        .eq('active', true);
      if (dropError) throw new Error(`roster drop: ${dropError.message}`);

      const { error: addError } = await db.from('rosters').insert({
        team_id: outcome.teamId,
        player_id: outcome.addPlayerId,
        acquired_via: 'waiver',
        acquired_week: targetWeek,
        faab_paid: outcome.bid,
        active: true,
      });
      if (addError) throw new Error(`roster add: ${addError.message}`);
    }

    // Budgets debited and the rolling list rotated, both computed by the engine.
    for (const team of resolution.teams) {
      const { error } = await db
        .from('teams')
        .update({ faab_remaining: team.faabRemaining, waiver_priority: team.waiverPriority })
        .eq('id', team.teamId);
      if (error) throw new Error(`teams update: ${error.message}`);
    }

    const won = resolution.outcomes.filter((o) => o.won);
    return Response.json({
      ok: true,
      season,
      bidWeek: playedWeek,
      effectiveWeek: targetWeek,
      claims: resolution.outcomes.length,
      won: won.length,
      spent: won.reduce((sum, o) => sum + o.bid, 0),
      outcomes: resolution.outcomes.map((o) => ({
        teamId: o.teamId,
        add: o.addPlayerId,
        bid: o.bid,
        won: o.won,
        reason: o.losingReason,
      })),
    });
  } catch (err) {
    return cronErrorResponse(err);
  }
}
