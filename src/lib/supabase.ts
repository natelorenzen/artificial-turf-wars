import { createClient } from '@supabase/supabase-js';

/**
 * Anon-key client. Read-only by construction: every table has RLS on with a SELECT
 * policy only, so this key cannot write even if it leaks. Safe in client components.
 */
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } },
);
