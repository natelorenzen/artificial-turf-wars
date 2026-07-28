import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Service-role client — bypasses RLS. Server-side only: never import this from a
 * client component, and never expose SUPABASE_SERVICE_ROLE_KEY with a NEXT_PUBLIC_
 * prefix.
 *
 * Lazily constructed so that importing this module in a build step without env vars
 * does not throw.
 */
let client: SupabaseClient | null = null;

export function supabaseServer(): SupabaseClient {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Supabase server client requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
    );
  }

  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}
