import { revalidatePath } from 'next/cache';

/**
 * Refresh every page after a job that writes what the pages show.
 *
 * The site's data changes only when a cron job (or `publish.ts`) writes it. Before this,
 * each page re-rendered on a 15-minute timer instead, and every render recomputes from
 * every week played so far — so Vercel CPU grew week on week while the numbers on the
 * page did not move. Now the jobs that write invalidate the cache, and the page timers
 * are only a backstop for text that turns on the clock (a kickoff passing).
 *
 * Invalidating is cheap: a page re-renders once, on its next visit, not here. That is
 * why this fires on skipped and failed runs too — a failed run may have written half of
 * what it meant to, and a stale page is worse than one spare render. It does not fire on
 * a 401, so an unauthenticated caller cannot force re-renders.
 */
export function refreshSite(): void {
  try {
    revalidatePath('/', 'layout');
  } catch (err) {
    // Never let a cache hiccup turn a job that did its work into a reported failure.
    console.error('revalidatePath failed', err);
  }
}

export function refreshesSite(
  handler: (request: Request) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const response = await handler(request);
    if (response.status !== 401) refreshSite();
    return response;
  };
}
