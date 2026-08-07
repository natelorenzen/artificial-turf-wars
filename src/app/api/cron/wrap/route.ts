import { assertCronAuth, cronErrorResponse } from '@/lib/cron/guard';
import { claimJobRun, completeJobRun, failJobRun } from '@/lib/cron/job-run';
import { supabaseServer } from '@/lib/supabase-server';
import { BEAT_WRITER_MODEL, LEAGUE, PROMPT_VERSION, RULEBOOK_VERSION } from '@/lib/config/league';
import { resolveScoringWeek, seasonIdFor } from '@/lib/scoring/week';
import { buildWrapFacts, writeRecap, type RecapResult } from '@/lib/weekly/wrap';
import { stableHash } from '@/lib/util/hash';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Tuesday 11:00 ET — the weekly column, written by the non-competing beat writer
 * (SPEC §7.5).
 *
 * Runs an hour after `score-provisional`, so the facts packet is built from scores that
 * exist. It reads them rather than computing them: a column that derived its own totals
 * could print a number the standings page disagrees with, and there would be no way to
 * tell which was right.
 *
 * One model call, but it still claims a `job_runs` row — not for the money, for the
 * article. A duplicate delivery would overwrite a released column with a differently
 * worded one, and `recaps` is keyed `(season_id, week)`, so the first version would be
 * gone. It is not resumable: there is nothing partial to resume.
 *
 * The draft is stored with `published = false`. Nothing auto-publishes under a byline.
 */
export async function GET(request: Request) {
  try {
    assertCronAuth(request);

    const db = supabaseServer();
    const season = Number(process.env.SEASON_YEAR ?? LEAGUE.season);
    const seasonId = await seasonIdFor(db, season);

    const week = await resolveScoringWeek(db, season);
    if (week === null) {
      return Response.json({ ok: true, skipped: 'season has not started', season });
    }

    const claim = await claimJobRun(db, { job: 'wrap', seasonId, week });
    if (!claim.claimed) {
      return Response.json({ ok: true, skipped: claim.reason, season, week });
    }

    try {
      const facts = await buildWrapFacts(db, { seasonId, season, week });
      if (facts.teams.length === 0) {
        await completeJobRun(db, { runId: claim.runId!, detail: `week ${week} has no scored lineups` });
        return Response.json({ ok: true, skipped: 'no scored lineups', season, week });
      }

      const result = await writeRecap(facts);
      const decisionId = await recordDecision(db, seasonId, week, result);

      if (!result.recap) {
        await failJobRun(db, {
          runId: claim.runId!,
          modelCalls: 1,
          costUsd: result.costUsd,
          detail: `beat writer returned no usable column: ${result.validationError ?? 'unknown'}`,
        });
        return Response.json(
          { ok: false, error: 'writer failed', season, week, decisionId },
          { status: 502 },
        );
      }

      const { error } = await db.from('recaps').upsert(
        {
          season_id: seasonId,
          week,
          headline: result.recap.headline,
          short_post: result.recap.short_post,
          column_md: result.recap.column_md,
          facts_packet: result.factsPacket as unknown as Record<string, unknown>,
          facts_packet_hash: result.factsPacketHash,
          // Stored, never acted on. A failed check is a finding about the writer and is
          // published next to the draft rather than triggering a rewrite that would
          // hide it.
          number_check_passed: result.numbers.passed,
          number_check_notes: result.numbers.notes,
          decision_id: decisionId,
          model_calls: 1,
          cost_usd: result.costUsd,
          published: false,
        },
        { onConflict: 'season_id,week' },
      );
      if (error) throw new Error(`recaps: ${error.message}`);

      await completeJobRun(db, {
        runId: claim.runId!,
        modelCalls: 1,
        costUsd: result.costUsd,
        detail: result.numbers.passed
          ? `week ${week} column stored, every figure checked out`
          : `week ${week} column stored, ${result.numbers.notes.length} unverified figure(s)`,
      });

      return Response.json({
        ok: true,
        season,
        week,
        scoringStatus: facts.scoring_status,
        headline: result.recap.headline,
        numberCheckPassed: result.numbers.passed,
        numberCheckNotes: result.numbers.notes,
        luck: facts.luck,
        costUsd: Number(result.costUsd.toFixed(4)),
        published: false,
      });
    } catch (err) {
      await failJobRun(db, {
        runId: claim.runId!,
        detail: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  } catch (err) {
    return cronErrorResponse(err);
  }
}

/**
 * The beat writer's call goes in `decisions` like every other model call.
 *
 * Written by hand rather than through `runDecision` because that path assembles the
 * League Rulebook and a memory block, neither of which the writer gets — it is not
 * playing. What must not differ is the audit: the project's claim is that every prompt
 * and every raw response is published, and "except the column" is not a footnote worth
 * having.
 *
 * `team_id` and `model_id` are null: the writer has no team, and it is deliberately
 * absent from the `models` table so it can never be mistaken for a competitor.
 */
async function recordDecision(
  db: ReturnType<typeof supabaseServer>,
  seasonId: string,
  week: number,
  result: RecapResult,
): Promise<string | null> {
  const { data, error } = await db
    .from('decisions')
    .insert({
      season_id: seasonId,
      team_id: null,
      model_id: null,
      type: 'recap',
      week,
      prompt_version: PROMPT_VERSION,
      rulebook_version: RULEBOOK_VERSION,
      system_prompt: result.systemPrompt,
      user_prompt: result.userPrompt,
      context_hash: stableHash(result.factsPacket),
      raw_response: result.raw,
      parsed_json: (result.recap ?? null) as unknown as Record<string, unknown> | null,
      valid: result.valid,
      validation_error: result.validationError,
      fallback_applied: false,
      provider_failure: result.providerFailure,
      retry_count: result.retryCount,
      temperature_requested: LEAGUE.temperature,
      latency_ms: result.latencyMs,
      tokens_in: result.tokensIn,
      tokens_out: result.tokensOut,
      cost_usd: result.costUsd,
      headline: result.recap?.headline ?? null,
      // The number check is the writer's equivalent of the citation post-pass every
      // competitor's decision carries, and it belongs in the same column.
      unsupported_claims: result.numbers.notes,
    })
    .select('id')
    .single();

  if (error) {
    // The column itself is the deliverable. Losing the audit row is worth a loud log,
    // not a 500 that discards a written article and invites a re-run.
    console.error(`recap decision insert (${BEAT_WRITER_MODEL}): ${error.message}`);
    return null;
  }
  return data.id as string;
}
