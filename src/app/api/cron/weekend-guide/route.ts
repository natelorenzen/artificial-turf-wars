import { assertCronAuth, cronErrorResponse } from '@/lib/cron/guard';
import { supabaseServer } from '@/lib/supabase-server';
import { COHORT, LEAGUE } from '@/lib/config/league';
import { claimJobRun, completeJobRun, failJobRun } from '@/lib/cron/job-run';
import { ingestWeekProjections } from '@/lib/sleeper/ingest';
import { buildWeekContexts, selectionDiscriminates } from '@/lib/preview/games';
import { seasonIdFor } from '@/lib/scoring/week';
import {
  GAMES_PER_GUIDE,
  takesForGame,
  toWriterInput,
  writeGuide,
  type CohortEntry,
  type TakeResult,
} from '@/lib/preview/guide';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const FORBIDDEN_NAMES = [...COHORT.map((m) => m.displayName), ...COHORT.map((m) => m.lab)];

/**
 * Thursday — "how to survive this weekend".
 *
 * Eight competitors each give one grounded take on the week's four most interesting
 * games; the non-competing beat writer assembles them. Roughly 33 model calls, so it
 * claims a `job_runs` row BEFORE the first call — a duplicate cron delivery must not
 * spend a second time.
 *
 * The guide is stored with `published = false`. A cron job writes the draft; a human
 * releases it. This is a byline piece, and nothing auto-publishes under it.
 */
export async function GET(request: Request) {
  try {
    assertCronAuth(request);

    const db = supabaseServer();
    const season = Number(process.env.SEASON_YEAR ?? LEAGUE.season);
    const seasonId = await seasonIdFor(db, season);

    // The guide previews the week that has NOT been played yet.
    const week = await nextUnplayedWeek(db, season);
    if (week === null) {
      return Response.json({ ok: true, skipped: 'no upcoming week', season });
    }

    const claim = await claimJobRun(db, { job: 'weekend-guide', seasonId, week });
    if (!claim.claimed) {
      return Response.json({ ok: true, skipped: claim.reason, season, week });
    }

    try {
      // Refresh this week's projections first — the guide is only as current as they are.
      await ingestWeekProjections(season, week, { db });

      const contexts = await buildWeekContexts(db, season, week, seasonId);
      if (contexts.length === 0) {
        await completeJobRun(db, { runId: claim.runId!, detail: 'no fixtures with projections' });
        return Response.json({ ok: true, skipped: 'no fixtures with projections', season, week });
      }

      const chosen = contexts.slice(0, GAMES_PER_GUIDE);
      const gate = selectionDiscriminates(contexts, GAMES_PER_GUIDE);

      const { data: modelRows } = await db.from('models').select('id, key');
      const idOf = new Map((modelRows ?? []).map((m) => [m.key as string, m.id as string]));
      const cohort: CohortEntry[] = COHORT.map((m) => ({
        key: m.key,
        displayName: m.displayName,
        openrouterId: m.openrouterId,
        modelId: idOf.get(m.key) ?? null,
      }));

      const all: TakeResult[] = [];
      let cost = 0;
      for (const context of chosen) {
        const takes = await takesForGame(context, week, cohort, FORBIDDEN_NAMES);
        for (const t of takes) cost += t.costUsd;
        all.push(...takes);
      }

      await db.from('game_takes').upsert(
        all.map((t) => ({
          season_id: seasonId,
          week,
          game_key: t.gameKey,
          model_id: t.modelId,
          novice_point: t.take?.novice_point ?? null,
          expert_point: t.take?.expert_point ?? null,
          player_to_watch: t.take?.player_to_watch ?? null,
          swing_factor: t.take?.swing_factor ?? null,
          confidence: t.take?.confidence ?? null,
          cited_fields: t.citedFields,
          unsupported_claims: t.unsupportedClaims,
          raw_response: t.raw,
          valid: t.valid,
          context_hash: t.contextHash,
          cost_usd: t.costUsd,
        })),
        { onConflict: 'season_id,week,game_key,model_id' },
      );

      const written = await writeGuide(toWriterInput(week, chosen, all));
      cost += written.costUsd;

      if (!written.guide) {
        await failJobRun(db, {
          runId: claim.runId!,
          modelCalls: all.length + 1,
          costUsd: cost,
          detail: 'beat writer returned no usable article',
        });
        return Response.json({ ok: false, error: 'writer failed', season, week }, { status: 502 });
      }

      const { error } = await db.from('weekend_guides').upsert(
        {
          season_id: seasonId,
          week,
          headline: written.guide.headline,
          standfirst: written.guide.standfirst,
          column_md: written.guide.column_md,
          game_keys: chosen.map((c) => c.fixture.gameKey),
          facts_packet: written.factsPacket as unknown as Record<string, unknown>,
          facts_packet_hash: written.factsPacketHash,
          model_calls: all.length + 1,
          cost_usd: cost,
          published: false,
        },
        { onConflict: 'season_id,week' },
      );
      if (error) throw new Error(`weekend_guides: ${error.message}`);

      await completeJobRun(db, {
        runId: claim.runId!,
        modelCalls: all.length + 1,
        costUsd: cost,
        detail: gate.ok ? gate.reason : `SELECTION ARBITRARY — ${gate.reason}`,
      });

      return Response.json({
        ok: true,
        season,
        week,
        games: chosen.map((c) => c.fixture.gameKey),
        takes: all.filter((t) => t.take).length,
        of: all.length,
        headline: written.guide.headline,
        selectionOk: gate.ok,
        costUsd: Number(cost.toFixed(4)),
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
 * The next week with a kickoff still ahead of us — the one to preview.
 *
 * Reads the ingested schedule rather than counting from a season-start date, for the
 * same reason the scoring jobs do: international games, Thanksgiving and the
 * 1 November DST shift all break the arithmetic version.
 */
async function nextUnplayedWeek(
  db: ReturnType<typeof supabaseServer>,
  season: number,
  now = new Date(),
): Promise<number | null> {
  const { data, error } = await db
    .from('nfl_games')
    .select('week')
    .eq('season', season)
    .eq('season_type', 'regular')
    .lte('week', LEAGUE.regularSeasonWeeks)
    .gt('kickoff_at', now.toISOString())
    .order('week', { ascending: true })
    .limit(1);
  if (error) throw new Error(`nfl_games: ${error.message}`);
  return (data?.[0]?.week as number | undefined) ?? null;
}
