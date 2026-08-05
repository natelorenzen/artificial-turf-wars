import { assertCronAuth, cronErrorResponse } from '@/lib/cron/guard';
import { supabaseServer } from '@/lib/supabase-server';
import { COHORT, LEAGUE } from '@/lib/config/league';
import { claimJobRun, completeJobRun, failJobRun } from '@/lib/cron/job-run';
import { buildWeekContexts, selectionDiscriminates } from '@/lib/preview/games';
import { seasonIdFor } from '@/lib/scoring/week';
import {
  GAMES_PER_GUIDE,
  takesForGame,
  toWriterInput,
  writeGuide,
  guideToMarkdown,
  type CohortEntry,
  type TakeResult,
} from '@/lib/preview/guide';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const FORBIDDEN_NAMES = [...COHORT.map((m) => m.displayName), ...COHORT.map((m) => m.lab)];

/**
 * Stop starting new work past this point, leaving room to store what is done and to
 * write the article. Vercel kills the function at `maxDuration` with no chance to
 * flush, so the budget has to be enforced on our side of that line.
 */
const TIME_BUDGET_MS = 200_000;

const outOfTime = (startedAt: number) => Date.now() - startedAt > TIME_BUDGET_MS;

/** Every stored take for these games, shaped for the writer. */
async function loadTakes(
  db: ReturnType<typeof supabaseServer>,
  seasonId: string,
  week: number,
  gameKeys: string[],
): Promise<TakeResult[]> {
  const { data, error } = await db
    .from('game_takes')
    .select('game_key, model_id, novice_point, expert_point, player_to_watch, swing_factor, confidence, valid, models(display_name)')
    .eq('season_id', seasonId)
    .eq('week', week)
    .in('game_key', gameKeys);
  if (error) throw new Error(`game_takes read: ${error.message}`);

  return (data ?? [])
    .filter((row) => row.valid)
    .map((row) => {
      const model = row.models as unknown as { display_name: string } | null;
      return {
        modelKey: '',
        modelId: row.model_id as string | null,
        displayName: model?.display_name ?? 'unknown',
        openrouterId: '',
        gameKey: row.game_key as string,
        take: {
          novice_point: (row.novice_point as string) ?? '',
          expert_point: (row.expert_point as string) ?? '',
          player_to_watch: (row.player_to_watch as string) ?? '',
          swing_factor: (row.swing_factor as string) ?? '',
          confidence: row.confidence === null ? 0 : Number(row.confidence),
        },
        raw: null,
        valid: true,
        contextHash: '',
        citedFields: [],
        unsupportedClaims: [],
        costUsd: 0,
      };
    });
}

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
    const startedAt = Date.now();
    const seasonId = await seasonIdFor(db, season);

    // The guide previews the week that has NOT been played yet.
    const week = await nextUnplayedWeek(db, season);
    if (week === null) {
      return Response.json({ ok: true, skipped: 'no upcoming week', season });
    }

    // Resumable: every take is keyed (season, week, game_key, model_id), so a second
    // pass skips what already landed. See the note on ClaimInput.resumable.
    const claim = await claimJobRun(db, { job: 'weekend-guide', seasonId, week, resumable: true });
    if (!claim.claimed) {
      return Response.json({ ok: true, skipped: claim.reason, season, week });
    }

    try {
      // NOTE: weekly projections are ingested by the DAILY ingest job, not here. Six
      // sequential Sleeper fetches inside this route would eat a large share of the
      // 300s ceiling that the model calls need.
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

      // Which games already have a full set of takes from an earlier invocation?
      const { data: existing } = await db
        .from('game_takes')
        .select('game_key, model_id')
        .eq('season_id', seasonId)
        .eq('week', week);
      const storedPerGame = new Map<string, number>();
      for (const row of existing ?? []) {
        const key = row.game_key as string;
        storedPerGame.set(key, (storedPerGame.get(key) ?? 0) + 1);
      }

      let cost = 0;
      let gamesDone = 0;
      // Counted separately from `gamesDone`, which also counts games skipped because
      // an earlier invocation already stored them. Conflating the two reported 33
      // calls for a resumed run that made exactly one.
      let takeCalls = 0;

      for (const context of chosen) {
        if ((storedPerGame.get(context.fixture.gameKey) ?? 0) >= cohort.length) {
          gamesDone++;
          continue;
        }

        // Stop before the ceiling rather than being killed mid-write. A killed
        // invocation loses whatever it had not yet stored; a clean exit keeps it and
        // lets the next run continue.
        if (outOfTime(startedAt)) {
          await completeJobRun(db, {
            runId: claim.runId!,
            costUsd: cost,
            detail: `partial: ${gamesDone}/${chosen.length} games stored, stopped before the function ceiling`,
          });
          return Response.json({
            ok: true,
            partial: true,
            season,
            week,
            gamesDone,
            of: chosen.length,
            note: 'ran out of time; re-invoke to continue',
            costUsd: Number(cost.toFixed(4)),
          });
        }

        const takes = await takesForGame(context, week, cohort, FORBIDDEN_NAMES);
        for (const t of takes) cost += t.costUsd;

        // Persist per GAME, not once at the end — the unit of loss on a timeout
        // should be one game, not the whole run.
        const { error: takeError } = await db.from('game_takes').upsert(
          takes.map((t) => ({
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
        if (takeError) throw new Error(`game_takes: ${takeError.message}`);
        takeCalls += takes.length;
        gamesDone++;
      }

      // Read every take back, so an assembly that follows a resumed run sees the
      // takes stored by earlier invocations too.
      const all = await loadTakes(db, seasonId, week, chosen.map((c) => c.fixture.gameKey));
      const written = await writeGuide(toWriterInput(week, chosen, all));
      cost += written.costUsd;
      // Calls MADE this invocation, not takes stored — a fully resumed run makes one.
      const callsMade = takeCalls + 1;

      if (!written.guide) {
        await failJobRun(db, {
          runId: claim.runId!,
          modelCalls: callsMade,
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
          column_md: guideToMarkdown(written.guide),
          sections: written.guide.games,
          game_keys: chosen.map((c) => c.fixture.gameKey),
          facts_packet: written.factsPacket as unknown as Record<string, unknown>,
          facts_packet_hash: written.factsPacketHash,
          model_calls: callsMade,
          cost_usd: cost,
          published: false,
        },
        { onConflict: 'season_id,week' },
      );
      if (error) throw new Error(`weekend_guides: ${error.message}`);

      await completeJobRun(db, {
        runId: claim.runId!,
        modelCalls: callsMade,
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
