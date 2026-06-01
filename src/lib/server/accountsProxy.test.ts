/**
 * Tests for the OSS-to-accounts proxy helper.
 *
 * Covers the passthrough algorithm in isolation: bytes-only body
 * integrity, hop-by-hop header stripping, header passthrough for auth
 * + Set-Cookie, status-code passthrough on 2xx/4xx, URL resolution via
 * env override, and 502-on-network-failure error shape.
 *
 * Route-level tests (`devices/link/server.test.ts`,
 * `devices/refresh/server.test.ts`) lift these fixtures so the algorithm
 * is exercised once at the helper level + smoke-checked at each route.
 */

import { describe, expect, it } from 'vitest';
import { accountsBaseUrl, proxyToAccounts } from './accountsProxy';

type CapturedCall = {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
  bodyBytes: Uint8Array;
};

function mockFetch(
  response: Response,
  captured: CapturedCall[] = []
): typeof fetch {
  return (async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    const headers: Record<string, string> = {};
    const initHeaders = init?.headers;
    if (initHeaders instanceof Headers) {
      initHeaders.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });
    } else if (Array.isArray(initHeaders)) {
      for (const [k, v] of initHeaders) headers[k.toLowerCase()] = v;
    } else if (initHeaders && typeof initHeaders === 'object') {
      for (const [k, v] of Object.entries(initHeaders)) {
        headers[k.toLowerCase()] = String(v);
      }
    }
    let bodyBytes = new Uint8Array(0);
    const body = init?.body;
    if (body instanceof ArrayBuffer) bodyBytes = new Uint8Array(body);
    else if (body instanceof Uint8Array) bodyBytes = new Uint8Array(body);
    else if (typeof body === 'string') bodyBytes = new TextEncoder().encode(body);
    captured.push({ url, method: init?.method, headers, bodyBytes });
    return response;
  }) as typeof fetch;
}

describe('accountsBaseUrl', () => {
  it('returns the canonical default when env override is absent', () => {
    expect(accountsBaseUrl({})).toBe('https://accounts.antonline.dev');
  });

  it('honours ANT_ACCOUNTS_URL when set', () => {
    expect(accountsBaseUrl({ ANT_ACCOUNTS_URL: 'https://test-accounts.local' })).toBe(
      'https://test-accounts.local'
    );
  });

  it('strips trailing slashes so callers can concat path safely', () => {
    expect(accountsBaseUrl({ ANT_ACCOUNTS_URL: 'https://x.local///' })).toBe(
      'https://x.local'
    );
  });
});

describe('proxyToAccounts', () => {
  it('forwards Authorization Bearer headers verbatim', async () => {
    const captured: CapturedCall[] = [];
    const fetchImpl = mockFetch(
      new Response('{"deviceId":"dev_1"}', {
        status: 200,
        headers: { 'content-type': 'application/json' }
      }),
      captured
    );
    const req = new Request('http://oss.local/api/devices/link', {
      method: 'POST',
      headers: { authorization: 'Bearer xyz', 'content-type': 'application/json' },
      body: '{"name":"smoke"}'
    });
    const res = await proxyToAccounts(req, '/api/devices/link', { fetchImpl });
    expect(res.status).toBe(200);
    expect(captured).toHaveLength(1);
    expect(captured[0].headers.authorization).toBe('Bearer xyz');
    expect(captured[0].headers['content-type']).toBe('application/json');
  });

  it('forwards Cookie headers verbatim', async () => {
    const captured: CapturedCall[] = [];
    const fetchImpl = mockFetch(new Response('{}', { status: 200 }), captured);
    const req = new Request('http://oss.local/api/devices/link', {
      method: 'POST',
      headers: { cookie: 'better-auth.session_token=abc' },
      body: '{}'
    });
    await proxyToAccounts(req, '/api/devices/link', { fetchImpl });
    expect(captured[0].headers.cookie).toBe('better-auth.session_token=abc');
  });

  it('passes 200 + JSON body through unchanged', async () => {
    const upstreamBody = '{"deviceId":"dev_1","accountId":"acct_1","tier":"bundle"}';
    const fetchImpl = mockFetch(
      new Response(upstreamBody, {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );
    const req = new Request('http://oss.local/api/devices/link', {
      method: 'POST',
      body: '{}'
    });
    const res = await proxyToAccounts(req, '/api/devices/link', { fetchImpl });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(await res.text()).toBe(upstreamBody);
  });

  it('passes 401 + body through unchanged', async () => {
    const fetchImpl = mockFetch(
      new Response('{"error":"unauthorized"}', {
        status: 401,
        headers: { 'content-type': 'application/json' }
      })
    );
    const req = new Request('http://oss.local/api/devices/link', {
      method: 'POST',
      body: '{}'
    });
    const res = await proxyToAccounts(req, '/api/devices/link', { fetchImpl });
    expect(res.status).toBe(401);
    expect(await res.text()).toBe('{"error":"unauthorized"}');
  });

  it('passes upstream 5xx through unchanged (not remapped to 502)', async () => {
    const fetchImpl = mockFetch(
      new Response('{"error":"upstream broke"}', {
        status: 503,
        headers: { 'content-type': 'application/json' }
      })
    );
    const req = new Request('http://oss.local/api/devices/link', {
      method: 'POST',
      body: '{}'
    });
    const res = await proxyToAccounts(req, '/api/devices/link', { fetchImpl });
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('{"error":"upstream broke"}');
  });

  it('honours ANT_ACCOUNTS_URL override for the upstream target', async () => {
    const captured: CapturedCall[] = [];
    const fetchImpl = mockFetch(new Response('{}', { status: 200 }), captured);
    const req = new Request('http://oss.local/api/devices/link', {
      method: 'POST',
      body: '{}'
    });
    await proxyToAccounts(req, '/api/devices/link', {
      env: { ANT_ACCOUNTS_URL: 'https://test-accounts.local' },
      fetchImpl
    });
    expect(captured[0].url).toBe('https://test-accounts.local/api/devices/link');
  });

  it('routes refresh requests to the refresh upstream path', async () => {
    const captured: CapturedCall[] = [];
    const fetchImpl = mockFetch(new Response('{}', { status: 200 }), captured);
    const req = new Request('http://oss.local/api/devices/refresh', {
      method: 'POST',
      body: '{"refreshToken":"r.jwt"}'
    });
    await proxyToAccounts(req, '/api/devices/refresh', {
      env: { ANT_ACCOUNTS_URL: 'https://test-accounts.local' },
      fetchImpl
    });
    expect(captured[0].url).toBe('https://test-accounts.local/api/devices/refresh');
  });

  it('preserves body bytes verbatim including emoji + newlines', async () => {
    const captured: CapturedCall[] = [];
    const fetchImpl = mockFetch(new Response('{}', { status: 200 }), captured);
    const bodyText = '{"name":"smoke 🐜","notes":"line1\nline2","platform":"macos"}';
    const expectedBytes = new TextEncoder().encode(bodyText);
    const req = new Request('http://oss.local/api/devices/link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: bodyText
    });
    await proxyToAccounts(req, '/api/devices/link', { fetchImpl });
    expect(captured[0].bodyBytes.length).toBe(expectedBytes.length);
    // Byte-for-byte equality — no JSON reparse should mutate ordering or
    // escape sequences anywhere in the proxy hop.
    for (let i = 0; i < expectedBytes.length; i++) {
      expect(captured[0].bodyBytes[i]).toBe(expectedBytes[i]);
    }
  });

  it('preserves response body bytes verbatim', async () => {
    const upstreamBody = '{"emoji":"🐜","nested":{"a":1,"b":[true,false]}}';
    const fetchImpl = mockFetch(
      new Response(upstreamBody, {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );
    const req = new Request('http://oss.local/api/devices/link', {
      method: 'POST',
      body: '{}'
    });
    const res = await proxyToAccounts(req, '/api/devices/link', { fetchImpl });
    expect(await res.text()).toBe(upstreamBody);
  });

  it('passes Set-Cookie response header through to the caller', async () => {
    const fetchImpl = mockFetch(
      new Response('{}', {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'set-cookie': 'better-auth.session_token=xyz; Path=/; HttpOnly'
        }
      })
    );
    const req = new Request('http://oss.local/api/devices/link', {
      method: 'POST',
      body: '{}'
    });
    const res = await proxyToAccounts(req, '/api/devices/link', { fetchImpl });
    expect(res.headers.get('set-cookie')).toBe(
      'better-auth.session_token=xyz; Path=/; HttpOnly'
    );
  });

  it('drops hop-by-hop headers on the request leg', async () => {
    const captured: CapturedCall[] = [];
    const fetchImpl = mockFetch(new Response('{}', { status: 200 }), captured);
    const req = new Request('http://oss.local/api/devices/link', {
      method: 'POST',
      headers: {
        connection: 'keep-alive',
        'keep-alive': 'timeout=5',
        authorization: 'Bearer xyz'
      },
      body: '{}'
    });
    await proxyToAccounts(req, '/api/devices/link', { fetchImpl });
    expect(captured[0].headers.connection).toBeUndefined();
    expect(captured[0].headers['keep-alive']).toBeUndefined();
    expect(captured[0].headers.authorization).toBe('Bearer xyz');
  });

  it('returns 502 with a structured body when fetch throws', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new TypeError('fetch failed: ENOTFOUND accounts.ant.run');
    };
    const req = new Request('http://oss.local/api/devices/link', {
      method: 'POST',
      body: '{}'
    });
    const res = await proxyToAccounts(req, '/api/devices/link', { fetchImpl });
    expect(res.status).toBe(502);
    expect(res.headers.get('content-type')).toBe('application/json');
    const body = await res.json();
    expect(body.error).toBe('upstream unreachable');
    expect(typeof body.detail).toBe('string');
    expect(body.detail).toContain('ENOTFOUND');
  });
});
