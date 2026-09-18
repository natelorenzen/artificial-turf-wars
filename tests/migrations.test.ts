import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Production migrations are applied by hand in the SQL editor, which never looks at the
 * filename. The Supabase Preview check does: it records the numeric prefix as the
 * version in `schema_migrations`, so two files sharing a prefix fail the whole preview
 * branch. That happened once — two `0011_` files, a fortnight apart — and nothing caught
 * it until the first PR to touch this directory after the integration was connected.
 */
describe('supabase/migrations', () => {
  const files = readdirSync(join(__dirname, '..', 'supabase', 'migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  it('names every file <4-digit version>_<name>.sql', () => {
    for (const f of files) expect(f).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
  });

  it('gives every file a distinct version, numbered 0001 upward with no gaps', () => {
    const versions = files.map((f) => Number(f.slice(0, 4)));
    expect(versions).toEqual(versions.map((_, i) => i + 1));
  });
});
