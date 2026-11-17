import { assertCronAuth, cronErrorResponse } from '@/lib/cron/guard';
import { refreshSite } from '@/lib/cron/refresh';

export const dynamic = 'force-dynamic';

/**
 * Refresh every page now. For writes that happen outside a cron job — `publish.ts`
 * releasing or retracting a column — so a retraction is gone on the next visit rather
 * than when the page's backstop timer next expires. Same secret as the cron routes.
 */
export async function POST(request: Request) {
  try {
    assertCronAuth(request);
    refreshSite();
    return Response.json({ ok: true, revalidated: '/' });
  } catch (err) {
    return cronErrorResponse(err);
  }
}
