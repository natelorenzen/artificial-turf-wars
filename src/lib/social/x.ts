/**
 * Posting to X.
 *
 * `POST /2/tweets` needs a USER context, which means OAuth 1.0a signed with four
 * values — the app's consumer key and secret, and an access token and secret belonging
 * to the account that will appear as the author. The bearer token in the developer
 * portal is app-only auth and cannot create a post; it is not one of the four, and
 * reaching for it is the most common way this fails.
 *
 * Two things about the credentials that are not obvious from the portal:
 *
 *   - An access token minted BEFORE the app's permissions were set to "Read and write"
 *     keeps its old read-only scope. It has to be regenerated after the change, and the
 *     403 it returns until then does not mention permissions.
 *   - The token belongs to whichever account was signed in when it was generated. That
 *     account is the byline on every post for the season.
 *
 * Signing is done here rather than with a client library because the whole of it is
 * forty lines of HMAC and this project has one dependency budget it keeps spending on
 * things that matter more.
 */

import { createHmac, randomBytes } from 'node:crypto';

const ENDPOINT = 'https://api.x.com/2/tweets';

export interface XCredentials {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

/**
 * The credentials, or null when they are not configured.
 *
 * Null is a first-class answer, not an error. The social job runs weekly from
 * September; it must skip cleanly and say why while the account is still being set up,
 * for the same reason every other job reports "nothing to do" as a skip: a weekly 500
 * trains whoever watches the cron log to ignore it, which is how the `CCRON_SECRET`
 * typo survived for weeks.
 */
export function xCredentials(): XCredentials | null {
  const apiKey = process.env.X_API_KEY;
  const apiSecret = process.env.X_API_SECRET;
  const accessToken = process.env.X_ACCESS_TOKEN;
  const accessTokenSecret = process.env.X_ACCESS_TOKEN_SECRET;

  if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) return null;
  return { apiKey, apiSecret, accessToken, accessTokenSecret };
}

/**
 * RFC 3986, which is NOT what `encodeURIComponent` implements.
 *
 * It leaves `!*'()` alone, and X's signature check does not. A post containing an
 * apostrophe — "It's over" — would sign correctly here and be rejected by the server
 * with a generic 401, which is an unpleasant thing to debug at 11pm on a Tuesday.
 */
export function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!*'()]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export interface OAuthParams {
  oauth_consumer_key: string;
  oauth_nonce: string;
  oauth_signature_method: 'HMAC-SHA1';
  oauth_timestamp: string;
  oauth_token: string;
  oauth_version: '1.0';
}

/**
 * The signature base string.
 *
 * The JSON body is deliberately absent. OAuth 1.0a only folds request parameters into
 * the signature when they are form-encoded; a JSON body is signed by nothing, which is
 * correct here and is what X expects.
 */
export function signatureBaseString(
  method: string,
  url: string,
  params: Record<string, string>,
): string {
  const encoded = Object.entries(params)
    .map(([k, v]) => [percentEncode(k), percentEncode(v)])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  return `${method.toUpperCase()}&${percentEncode(url)}&${percentEncode(encoded)}`;
}

export function sign(base: string, consumerSecret: string, tokenSecret: string): string {
  const key = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
  return createHmac('sha1', key).update(base).digest('base64');
}

/** The `Authorization` header for one request. */
export function authorizationHeader(
  credentials: XCredentials,
  method: string,
  url: string,
  oauth: OAuthParams,
): string {
  const signature = sign(
    signatureBaseString(method, url, oauth as unknown as Record<string, string>),
    credentials.apiSecret,
    credentials.accessTokenSecret,
  );

  const fields = { ...oauth, oauth_signature: signature };
  const rendered = Object.entries(fields)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${percentEncode(k)}="${percentEncode(v)}"`)
    .join(', ');

  return `OAuth ${rendered}`;
}

export function oauthParams(credentials: XCredentials, now = new Date()): OAuthParams {
  return {
    oauth_consumer_key: credentials.apiKey,
    oauth_nonce: randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(now.getTime() / 1000)),
    oauth_token: credentials.accessToken,
    oauth_version: '1.0',
  };
}

export type PostResult =
  | { ok: true; remoteId: string }
  | { ok: false; error: string; status: number | null };

/**
 * Send one post.
 *
 * Never throws. A failed post is stored on its row as `failed` with the reason, and the
 * job carries on to the next one — one rejected post must not strand a week's queue,
 * and the reason is worth keeping because the interesting failures here (wrong scope,
 * duplicate content, a caps-exceeded response) are all diagnosable from the message.
 */
export async function postToX(
  credentials: XCredentials,
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PostResult> {
  try {
    const oauth = oauthParams(credentials);
    const response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: authorizationHeader(credentials, 'POST', ENDPOINT, oauth),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });

    const body = (await response.json().catch(() => null)) as
      | { data?: { id?: string }; detail?: string; title?: string; errors?: { message?: string }[] }
      | null;

    if (!response.ok) {
      const detail =
        body?.detail ??
        body?.errors?.map((e) => e.message).filter(Boolean).join('; ') ??
        body?.title ??
        'no detail returned';
      return { ok: false, error: `${response.status}: ${detail}`, status: response.status };
    }

    const id = body?.data?.id;
    if (!id) return { ok: false, error: 'accepted with no post id in the response', status: response.status };

    return { ok: true, remoteId: id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), status: null };
  }
}
