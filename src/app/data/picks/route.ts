import { loadPicksIndex } from '@/lib/site/picks-export';

/**
 * /data/picks — the same document as /data/picks/index.json. The bare folder is the
 * address people actually guess, and it 404ed.
 */
export const revalidate = 900;

export async function GET() {
  return Response.json(await loadPicksIndex(), {
    headers: { 'Cache-Control': 'public, max-age=900, s-maxage=900', 'Access-Control-Allow-Origin': '*' },
  });
}
