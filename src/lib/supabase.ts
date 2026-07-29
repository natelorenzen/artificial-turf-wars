import { createClient } from '@supabase/supabase-js';

/**
 * Anon-key client. Read-only by construction: every table has RLS on with a SELECT
 * policy only, so this key cannot write even if it leaks. Safe in client components.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Whether the site has a database to read from.
 *
 * Pages prerender real data at build time, so an unconfigured environment used to
 * take the whole build down: `createClient` throws on an empty URL at module load,
 * before any page had a chance to handle it. The first Vercel deploy failed exactly
 * this way.
 *
 * Every loader checks this flag and returns empty rather than querying, so the site
 * builds and renders its "no data yet" states anywhere — a fresh clone, a preview
 * branch without secrets, CI. A missing database should degrade the page, never break
 * the build.
 */
export const SUPABASE_CONFIGURED = Boolean(url && anonKey);

export const supabase = createClient(
  // A syntactically valid placeholder keeps createClient from throwing when
  // unconfigured. Nothing queries it, because SUPABASE_CONFIGURED gates every read.
  url ?? 'http://localhost:54321',
  anonKey ?? 'placeholder-anon-key',
  { auth: { persistSession: false } },
);
