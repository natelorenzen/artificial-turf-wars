import { loadVideoBrief } from '@/lib/site/video-brief';

/**
 * /data/week/N/video.json — the weekly video brief. See `src/lib/site/video-brief.ts`.
 *
 * 425 Too Early before 11:00 AM Pacific on the week's Thursday, or while the picks or
 * the weekend guide are missing, with `availableAt` where it is known.
 */
export const revalidate = 900;

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^\d{1,2}$/.test(slug)) return Response.json({ error: 'expected /data/week/N/video.json' }, { status: 404 });

  const result = await loadVideoBrief(Number(slug));
  if (!result.ok) {
    return Response.json(
      { error: result.reason, availableAt: result.availableAt },
      // Short cache on a not-yet, so the brief appears soon after the cutoff.
      { status: result.status, headers: { 'Cache-Control': 'public, max-age=60, s-maxage=60' } },
    );
  }
  return Response.json(result.brief, {
    headers: {
      'Cache-Control': 'public, max-age=900, s-maxage=900',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
