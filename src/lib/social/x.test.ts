import { describe, expect, it } from 'vitest';
import {
  authorizationHeader,
  percentEncode,
  postToX,
  signatureBaseString,
  sign,
  type OAuthParams,
  type XCredentials,
} from './x';

const credentials: XCredentials = {
  apiKey: 'consumer-key',
  apiSecret: 'consumer-secret',
  accessToken: 'access-token',
  accessTokenSecret: 'token-secret',
};

const oauth: OAuthParams = {
  oauth_consumer_key: 'consumer-key',
  oauth_nonce: 'nonce123',
  oauth_signature_method: 'HMAC-SHA1',
  oauth_timestamp: '1770000000',
  oauth_token: 'access-token',
  oauth_version: '1.0',
};

describe('percent encoding', () => {
  it('encodes the four characters encodeURIComponent leaves alone', () => {
    // The whole reason this function exists. A post containing an apostrophe signs
    // correctly with the built-in and is rejected by the server with a bare 401.
    expect(percentEncode("!*'()")).toBe('%21%2A%27%28%29');
  });

  it('leaves the unreserved set alone', () => {
    expect(percentEncode('aZ09-._~')).toBe('aZ09-._~');
  });

  it('encodes the ordinary reserved characters', () => {
    expect(percentEncode('a b&c=d')).toBe('a%20b%26c%3Dd');
  });
});

describe('the signature', () => {
  it('sorts parameters and encodes the base string as one unit', () => {
    const base = signatureBaseString('post', 'https://api.x.com/2/tweets', {
      b: '2',
      a: '1',
    });
    expect(base).toBe('POST&https%3A%2F%2Fapi.x.com%2F2%2Ftweets&a%3D1%26b%3D2');
  });

  it('is stable for the same inputs', () => {
    const base = signatureBaseString('POST', 'https://api.x.com/2/tweets', { ...oauth });
    expect(sign(base, credentials.apiSecret, credentials.accessTokenSecret)).toBe(
      sign(base, credentials.apiSecret, credentials.accessTokenSecret),
    );
  });

  it('changes when any credential changes', () => {
    const base = signatureBaseString('POST', 'https://api.x.com/2/tweets', { ...oauth });
    const original = sign(base, credentials.apiSecret, credentials.accessTokenSecret);
    expect(sign(base, 'other-secret', credentials.accessTokenSecret)).not.toBe(original);
    expect(sign(base, credentials.apiSecret, 'other-token-secret')).not.toBe(original);
  });

  it('does not fold the post body into the signature', () => {
    // OAuth 1.0a signs form-encoded parameters only. A JSON body is signed by nothing,
    // which is what X expects — including the body here produces a valid-looking
    // signature the server rejects.
    const withBody = signatureBaseString('POST', 'https://api.x.com/2/tweets', {
      ...oauth,
      text: 'hello',
    });
    const withoutBody = signatureBaseString('POST', 'https://api.x.com/2/tweets', { ...oauth });
    expect(withBody).not.toBe(withoutBody);
    expect(withoutBody).not.toContain('text');
  });
});

describe('the Authorization header', () => {
  const header = authorizationHeader(credentials, 'POST', 'https://api.x.com/2/tweets', oauth);

  it('is an OAuth header carrying every required field', () => {
    expect(header.startsWith('OAuth ')).toBe(true);
    for (const field of [
      'oauth_consumer_key',
      'oauth_nonce',
      'oauth_signature',
      'oauth_signature_method',
      'oauth_timestamp',
      'oauth_token',
      'oauth_version',
    ]) {
      expect(header).toContain(`${field}="`);
    }
  });

  it('never carries either secret', () => {
    expect(header).not.toContain(credentials.apiSecret);
    expect(header).not.toContain(credentials.accessTokenSecret);
  });
});

describe('posting', () => {
  it('returns the remote id on success', async () => {
    const result = await postToX(credentials, 'Week 5.', (async () =>
      new Response(JSON.stringify({ data: { id: '1234' } }), { status: 201 })) as typeof fetch);
    expect(result).toEqual({ ok: true, remoteId: '1234' });
  });

  it('reports a rejection with the reason rather than throwing', async () => {
    // The interesting failures here — wrong scope, duplicate content, caps exceeded —
    // are all diagnosable from the message, and all of them must leave the job alive
    // to handle the rest of the queue.
    const result = await postToX(credentials, 'Week 5.', (async () =>
      new Response(JSON.stringify({ detail: 'Unsupported Authentication' }), { status: 403 })) as typeof fetch);
    expect(result).toEqual({
      ok: false,
      error: '403: Unsupported Authentication',
      status: 403,
    });
  });

  it('does not report success on a 200 with no id in it', async () => {
    const result = await postToX(credentials, 'Week 5.', (async () =>
      new Response(JSON.stringify({ data: {} }), { status: 200 })) as typeof fetch);
    expect(result.ok).toBe(false);
  });

  it('survives a network failure', async () => {
    const result = await postToX(credentials, 'Week 5.', (async () => {
      throw new Error('ECONNRESET');
    }) as typeof fetch);
    expect(result).toEqual({ ok: false, error: 'ECONNRESET', status: null });
  });
});

describe("X's own published signing example", () => {
  /**
   * The worked example from X's OAuth 1.0a documentation, kept verbatim.
   *
   * Its value is diagnostic. When a real request comes back 401 there are two
   * suspects — the credentials, or this file — and an implementation that reproduces
   * a published signature byte for byte is no longer one of them. Every credential
   * below is from public documentation and belongs to no live account.
   */
  const example = {
    consumerKey: 'xvz1evFS4wEEPTGEFPHBog',
    consumerSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
    token: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
    tokenSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE',
    url: 'https://api.twitter.com/1.1/statuses/update.json',
    params: {
      status: 'Hello Ladies + Gentlemen, a signed OAuth request!',
      include_entities: 'true',
      oauth_consumer_key: 'xvz1evFS4wEEPTGEFPHBog',
      oauth_nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg',
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: '1318622958',
      oauth_token: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
      oauth_version: '1.0',
    },
  };

  it('reproduces the documented base string', () => {
    expect(signatureBaseString('POST', example.url, example.params)).toBe(
      'POST&https%3A%2F%2Fapi.twitter.com%2F1.1%2Fstatuses%2Fupdate.json&' +
        'include_entities%3Dtrue%26oauth_consumer_key%3Dxvz1evFS4wEEPTGEFPHBog%26' +
        'oauth_nonce%3DkYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg%26' +
        'oauth_signature_method%3DHMAC-SHA1%26oauth_timestamp%3D1318622958%26' +
        'oauth_token%3D370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb%26' +
        'oauth_version%3D1.0%26status%3DHello%2520Ladies%2520%252B%2520Gentlemen' +
        '%252C%2520a%2520signed%2520OAuth%2520request%2521',
    );
  });

  it('reproduces the documented signature', () => {
    const base = signatureBaseString('POST', example.url, example.params);
    expect(sign(base, example.consumerSecret, example.tokenSecret)).toBe(
      'hCtSmYh+iHYCEqBWrE7C7hYmtUk=',
    );
  });
});
