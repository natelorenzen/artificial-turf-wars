/**
 * Chalk or Walk — the pilot runner.
 *
 *   npx tsx --env-file=.env.local scripts/chalk-or-walk.ts              # dry run, $0
 *   npx tsx --env-file=.env.local scripts/chalk-or-walk.ts --live       # real calls
 *   npx tsx --env-file=.env.local scripts/chalk-or-walk.ts --live --models=claude-opus-5,grok-4-5
 *
 * Defaults to a DRY RUN with synthetic responses. It costs nothing, exercises the
 * identical code path, and proves the machine works. `--live` is opt-in because it
 * spends real money against a third-party API, and that should never be a side effect
 * of running a script to see what it does.
 *
 * What this is FOR: a go/no-go on herding. If every analyst that moves moves toward
 * the crowd, the debate manufactures consensus rather than testing it, and there is no
 * product here. Better to learn that for the price of one slate than after a build.
 *
 * NOTE: writes nothing to the database. This is a separate product track from the
 * league and it stays that way until the mechanic is proven.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { COHORT } from '@/lib/config/league';
import { callModel } from '@/lib/openrouter/client';
import { buildSlate, type ProjectionRow } from '@/lib/debate/slate';
import { runDebate, type DebateCallFn } from '@/lib/debate/run';
import { readTally, tallyDebate } from '@/lib/debate/tally';
import type { Position } from '@/lib/config/league';
import type { Slate, Stance } from '@/lib/debate/types';

const args = process.argv.slice(2);
const LIVE = args.includes('--live');
const modelArg = args.find((a) => a.startsWith('--models='));
const MODEL_KEYS = modelArg ? modelArg.split('=')[1].split(',').filter(Boolean) : undefined;
const perPositionArg = args.find((a) => a.startsWith('--per-position='));
const PER_POSITION = perPositionArg ? Number(perPositionArg.split('=')[1]) : 2;
// `--skip=N` steps down the divergence ranking to produce a different board. Slate 1 is
// skip=0, slate 2 is skip=1, and so on.
const skipArg = args.find((a) => a.startsWith('--skip='));
const SKIP = skipArg ? Number(skipArg.split('=')[1]) : 0;

const SEASON = Number(process.env.SEASON_YEAR ?? '2026');

async function fetchProjectionRows(): Promise<ProjectionRow[]> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Season-long rows carry both our projection and the merged week-1 ADP.
  const { data, error } = await supabase
    .from('player_projections')
    .select('player_id, proj_pts, adp, players!inner(name, position, nfl_team, active)')
    .eq('season', SEASON)
    .is('week', null)
    .not('adp', 'is', null)
    .not('proj_pts', 'is', null);

  if (error) throw new Error(`fetching projections: ${error.message}`);

  return (data ?? [])
    .map((row) => {
      const player = row.players as unknown as {
        name: string;
        position: string;
        nfl_team: string | null;
        active: boolean;
      };
      return {
        playerId: String(row.player_id),
        name: player.name,
        position: player.position as Position,
        nflTeam: player.nfl_team,
        projPts: Number(row.proj_pts),
        adp: Number(row.adp),
        active: player.active,
      };
    })
    .filter((r) => r.active && Number.isFinite(r.projPts) && Number.isFinite(r.adp))
    .map(({ ...r }) => r as ProjectionRow);
}

/**
 * Synthetic responses for the dry run.
 *
 * Deliberately NOT random. The dry run has to prove the pipeline and the tally, so it
 * produces a known, deliberately awkward pattern: a split board, a few flips in each
 * direction, one analyst that challenges nobody, and one tied player. If the tally
 * reports something other than that pattern, the tally is wrong.
 */
function syntheticCall(): DebateCallFn {
  let seen = 0;
  return async <T,>({ round, modelKey, schema }: { round: string; modelKey: string; schema: unknown }) => {
    void schema;
    const index = COHORT.findIndex((m) => m.key === modelKey);
    seen++;

    const stanceFor = (playerIndex: number, final: boolean): Stance => {
      // Base split: alternate by analyst and player so the board is genuinely divided.
      const base: Stance = (index + playerIndex) % 3 === 0 ? 'WALK' : 'CHALK';
      if (!final) return base;
      // Two analysts fold toward the majority; one defects away from it.
      if (index === 5 && playerIndex === 0) return 'CHALK';
      if (index === 6 && playerIndex === 0) return 'CHALK';
      if (index === 1 && playerIndex === 1) return 'WALK';
      return base;
    };

    if (round === 'R0' || round === 'R3') {
      return {
        ok: true,
        parsed: {
          calls: CURRENT_SLATE!.players.map((p, i) => ({
            playerId: p.playerId,
            stance: stanceFor(i, round === 'R3'),
            confidence: round === 'R3' ? 0.72 : 0.61,
            rationale: `synthetic ${round.toLowerCase()} rationale`,
          })),
        } as T,
        rawResponse: '{}',
        validationError: null,
        costUsd: 0,
      };
    }

    if (round === 'R1') {
      // Analyst at index 3 challenges nobody, so `silentAnalysts` has something to find.
      const challenges =
        index === 3
          ? []
          : [
              {
                playerId: CURRENT_SLATE!.players[0].playerId,
                target: `Analyst ${'ABCDEFGH'[(index + 1) % COHORT.length]}`,
                claim: 'synthetic challenge',
                evidence: 'synthetic evidence',
                confidence: 0.55,
              },
            ];
      return { ok: true, parsed: { challenges } as T, rawResponse: '{}', validationError: null, costUsd: 0 };
    }

    return {
      ok: true,
      parsed: {
        rebuttals: [
          {
            playerId: CURRENT_SLATE!.players[0].playerId,
            challenger: 'Analyst A',
            response: 'synthetic rebuttal',
            concedes: seen % 4 === 0,
          },
        ],
      } as T,
      rawResponse: '{}',
      validationError: null,
      costUsd: 0,
    };
  };
}

let CURRENT_SLATE: Slate | null = null;

const liveCall: DebateCallFn = async ({ openrouterId, systemPrompt, userPrompt, schema }) => {
  const result = await callModel({ openrouterId, systemPrompt, userPrompt, schema });
  return {
    ok: result.ok,
    parsed: result.parsed,
    rawResponse: result.rawResponse,
    validationError: result.validationError,
    costUsd: result.usage.costUsd,
  };
};

function printSlate(slate: Slate) {
  console.log(`\nSLATE ${slate.slateId} — ${slate.players.length} contested players\n`);
  console.log(
    `  ${'PLAYER'.padEnd(24)} ${'POS'.padEnd(4)} ${'PROJ'.padEnd(7)} ${'RANK'.padEnd(5)} ${'ADP'.padEnd(7)} ${'RANK'.padEnd(5)} DIVERGENCE`,
  );
  for (const p of slate.players) {
    console.log(
      `  ${p.name.slice(0, 23).padEnd(24)} ${p.position.padEnd(4)} ` +
        `${p.projectedPoints.toFixed(1).padEnd(7)} ${String(p.projectionRank).padEnd(5)} ` +
        `${p.adp.toFixed(1).padEnd(7)} ${String(p.adpRank).padEnd(5)} ` +
        `${p.divergence > 0 ? '+' : ''}${p.divergence}`,
    );
  }
}

async function main() {
  console.log(`Chalk or Walk — ${LIVE ? 'LIVE' : 'DRY RUN (no model calls, no cost)'}`);

  const rows = await fetchProjectionRows();
  console.log(`Loaded ${rows.length} players with both a projection and a real ADP.`);

  const slate = buildSlate(rows, { season: SEASON, perPosition: PER_POSITION, skip: SKIP });
  CURRENT_SLATE = slate;
  printSlate(slate);

  const cohortSize = (MODEL_KEYS ?? COHORT.map((m) => m.key)).length;
  const maxCalls = cohortSize * 4;
  if (LIVE) {
    console.log(`\nUp to ${maxCalls} model calls across ${cohortSize} analysts. Spending real budget.\n`);
  }

  const run = await runDebate({
    slate,
    call: LIVE ? liveCall : syntheticCall(),
    live: LIVE,
    modelKeys: MODEL_KEYS,
    onEvent: (m) => console.log(m),
  });

  const tally = tallyDebate(slate, run.transcripts);

  console.log('\n================ BOARD ================\n');
  console.log(`  ${'PLAYER'.padEnd(24)} ${'R0'.padEnd(12)} ${'R3'.padEnd(12)} FLIPS`);
  for (const p of tally.players) {
    const r0 = `${p.chalkR0}C / ${p.walkR0}W`;
    const r3 = `${p.chalkR3}C / ${p.walkR3}W`;
    console.log(
      `  ${p.name.slice(0, 23).padEnd(24)} ${r0.padEnd(12)} ${r3.padEnd(12)} ${p.flips}` +
        (p.convergedToUnanimous ? '   <- converged to unanimous' : ''),
    );
  }

  console.log('\n================ ANALYSTS ================\n');
  console.log(
    `  ${'MODEL'.padEnd(18)} ${'HELD'.padEnd(6)} ${'FLIP'.padEnd(6)} ${'->MAJ'.padEnd(7)} ${'CHAL'.padEnd(6)} ${'CONC'.padEnd(6)} DISSENT HELD`,
  );
  for (const a of tally.analysts) {
    console.log(
      `  ${a.modelKey.padEnd(18)} ${String(a.held).padEnd(6)} ${String(a.flipped).padEnd(6)} ` +
        `${String(a.flippedToMajority).padEnd(7)} ${String(a.challengesIssued).padEnd(6)} ` +
        `${String(a.concessions).padEnd(6)} ${a.minorityPositionsHeld}/${a.minorityPositionsR0}`,
    );
  }

  // Persist the full transcript. The tally is the finding; the transcripts are the
  // evidence, and a run that reports a herd rate without keeping what was actually
  // argued is not auditable — which is the one thing this project sells.
  const outDir = join(process.cwd(), 'debate-runs');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${slate.slateId}-${LIVE ? 'live' : 'dry'}-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify({ run, tally }, null, 2));
  console.log(`\nTranscript written to ${outPath.replace(process.cwd() + '/', '')}`);

  console.log('\n================ VERDICT ================\n');
  console.log(`  herd rate         ${tally.herdRate ?? 'n/a (no movement)'}`);
  console.log(`  dissent survival  ${tally.dissentSurvival ?? 'n/a (no minority positions)'}`);
  console.log(`  flips             ${tally.totalFlips} (${tally.flipsToMajority} toward crowd, ${tally.flipsFromMajority} away)`);
  console.log(`  unanimous players ${tally.unanimousR0} -> ${tally.unanimousR3}`);
  console.log(`  challenges        ${tally.totalChallenges} (${tally.silentAnalysts} analysts challenged nobody)`);
  console.log(`  calls / cost      ${run.calls} / $${run.costUsd.toFixed(4)}`);
  console.log(`\n  ${readTally(tally)}\n`);

  if (!LIVE) {
    console.log('  Dry run: figures above come from synthetic responses and mean nothing');
    console.log('  about real model behaviour. Re-run with --live for the actual test.\n');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
