import { supabaseServer } from '@/lib/supabase-server';
import { seasonIdFor } from '@/lib/scoring/week';
import { checkHealth } from '@/lib/cron/health';

export const dynamic = 'force-dynamic';

/**
 * Whether the cron jobs that should have run, ran.
 *
 * NOT under `/api/cron`, and deliberately not behind `assertCronAuth`. This is the one
 * route that has to be readable when the cron secret is the broken thing — which is
 * not a hypothetical here, it is the exact failure this project already had, and a
 * watchdog that 401s for the same reason the jobs 500 would be no watchdog at all.
 *
 * Public, like everything else on this site. It exposes no secret and no model output:
 * job names that are already listed in `vercel.json`, timestamps, and a state. A reader
 * who wants to check that the league is being run on time can see exactly what we see,
 * which is the same argument as publishing every prompt.
 *
 * Returns HTTP 200 even when unhealthy. The body's `healthy` flag is the signal; a
 * non-200 would make an uptime monitor report the WATCHDOG as down rather than the job
 * it is reporting on, and those need to stay distinguishable.
 */
export async function GET() {
  try {
    const db = supabaseServer();
    const season = Number(process.env.SEASON_YEAR ?? '2026');
    const seasonId = await seasonIdFor(db, season);

    const report = await checkHealth(db, seasonId, season);

    return Response.json(report, {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (err) {
    return Response.json(
      {
        checkedAt: new Date().toISOString(),
        healthy: false,
        error: err instanceof Error ? err.message : String(err),
        detail: 'the health check itself failed, which says nothing about the jobs',
      },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    );
  }
}
