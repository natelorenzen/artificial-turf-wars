import { loadWeekExport } from '@/lib/site/week-export';

/**
 * /data/week/N.json — one league week as read-only JSON. See `src/lib/site/week-export.ts`.
 *
 * Under /data/ rather than /api/ on purpose: robots.txt disallows /api/ because those
 * are cron routes, and this is meant to be fetched.
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

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const match = /^(\d{1,2})\.json$/.exec((await params).slug);
  if (!match) return Response.json({ error: 'expected /data/week/N.json' }, { status: 404 });

  const data = await loadWeekExport(Number(match[1]));
  if (!data) return Response.json({ error: `week ${match[1]} has no fixtures yet` }, { status: 404 });

  return Response.json(data, {
    headers: {
      'Cache-Control': 'public, max-age=900, s-maxage=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
