import { latestPicksWeek, loadPicksExport, loadPicksIndex } from '@/lib/site/picks-export';

/**
 * /data/picks/index.json, /data/picks/latest.json and /data/picks/N.json — every
 * model's NFL predictions as read-only JSON. See `src/lib/site/picks-export.ts`.
 */
export const revalidate = 3600;

/**
 * Empty on purpose: there are too many to build, and the site must build without a
 * database. Declaring it is what makes Next cache each one after its first render —
 * without it this route rendered fresh on every request, whatever `revalidate` said.
 */
export async function generateStaticParams() {
  return [];
}

const HEADERS = { 'Cache-Control': 'public, max-age=900, s-maxage=3600', 'Access-Control-Allow-Origin': '*' };

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  if (slug === 'index.json') return Response.json(await loadPicksIndex(), { headers: HEADERS });

  const week = slug === 'latest.json' ? await latestPicksWeek() : Number(/^(\d{1,2})\.json$/.exec(slug)?.[1] ?? NaN);
  if (week === null || !Number.isInteger(week)) {
    return Response.json({ error: 'expected /data/picks/index.json, latest.json or N.json' }, { status: 404 });
  }

  const data = await loadPicksExport(week);
  if (!data) return Response.json({ error: `no picks stored for week ${week}` }, { status: 404 });
  return Response.json(data, { headers: HEADERS });
}
