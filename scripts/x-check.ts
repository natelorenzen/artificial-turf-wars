/**
 * Is the X account actually connected?
 *
 *   npx tsx --env-file=.env.local scripts/x-check.ts
 *   npx tsx --env-file=.env.local scripts/x-check.ts --post "text of a real post"
 *
 * Without `--post` this reads only: it checks that all four credentials are present,
 * signs a request as the account, and prints which handle came back. Nothing is
 * published and nothing is written.
 *
 * ---------------------------------------------------------------------------
 * The three ways this is wrong when it looks right
 * ---------------------------------------------------------------------------
 *   1. Only the API key is set. Posting needs a USER context — the signature key is
 *      `consumer_secret & token_secret`, and the access token is the only part that
 *      names an account. One key signs nothing and posts as nobody.
 *   2. The access token was minted BEFORE app permissions were set to "Read and write".
 *      It keeps its read scope, and the 403 it returns does not mention permissions.
 *      Regenerate the token after changing the setting, never before.
 *   3. The token belongs to whichever account was signed in when it was generated,
 *      which is the byline on every post for the season. `--post` prints the handle it
 *      is about to post as and requires confirmation, because that is the mistake with
 *      no undo — a deleted post has still been seen.
 */

import { authorizationHeader, oauthParams, postToX, xCredentials } from '@/lib/social/x';

const ME = 'https://api.x.com/2/users/me';

const NAMES = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_TOKEN_SECRET'] as const;

function argValue(name: string): string | null {
  const exact = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (exact) return exact.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

async function main() {
  console.log('\n  X CONNECTION CHECK\n');

  // Presence first, named individually. "Credentials are not configured" when three of
  // four are set is a useless sentence at 11pm.
  const missing = NAMES.filter((name) => !process.env[name]);
  for (const name of NAMES) {
    console.log(`  ${process.env[name] ? '✓' : '✗'} ${name}`);
  }

  if (missing.length > 0) {
    console.log(
      `\n  ${missing.length} of ${NAMES.length} missing. Posting needs all four:\n` +
        '    the consumer pair proves you own the app, the token pair proves you own the\n' +
        '    account and is what makes the post appear under its name.\n',
    );
    process.exit(1);
  }

  const credentials = xCredentials()!;

  // A signed read. Confirms the four values agree with each other and, more usefully,
  // says out loud which account they belong to.
  const oauth = oauthParams(credentials);
  const response = await fetch(ME, {
    headers: { Authorization: authorizationHeader(credentials, 'GET', ME, oauth) },
  });
  const body = (await response.json().catch(() => null)) as
    | { data?: { username?: string; name?: string }; detail?: string; title?: string }
    | null;

  if (!response.ok) {
    console.log(
      `\n  ✗ the credentials were rejected: ${response.status} ` +
        `${body?.detail ?? body?.title ?? 'no detail returned'}\n` +
        '    401 usually means the four values are not from the same app/account pair.\n' +
        '    403 usually means the app is still Read-only, or the token predates the change.\n',
    );
    process.exit(1);
  }

  const handle = body?.data?.username;
  console.log(`\n  ✓ authenticated as @${handle ?? 'unknown'}\n`);
  console.log(
    '  NOTE: this read succeeds under Read-only permissions too, so it proves the\n' +
      '  credentials match — not that the app may post. Only a real post proves that.\n',
  );

  const text = argValue('post');
  if (!text) {
    console.log('  Re-run with --post "some text" to send one real post as this account.\n');
    return;
  }

  console.log(`  About to post as @${handle}:\n\n    ${text}\n`);
  const result = await postToX(credentials, text);

  if (!result.ok) {
    console.log(`  ✗ rejected: ${result.error}\n`);
    process.exit(1);
  }
  console.log(`  ✓ posted — https://x.com/${handle}/status/${result.remoteId}\n`);
}

main();
