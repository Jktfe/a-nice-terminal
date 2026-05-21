/**
 * OSS proxy to the canonical ant-accounts service (M8 device-link bridge).
 *
 * The Mac antchat app knows exactly one base URL (its OSS server). When
 * Better Auth login completes it POSTs `/api/devices/link` so the device
 * receives a device-token bundle. That endpoint lives on the private
 * accounts service (`accounts.antonline.dev` by default), not on the OSS
 * server. This module is the thin pass-through that bridges them.
 *
 * Design:
 *   - Body is treated as opaque bytes; no JSON reparse anywhere in the
 *     hop. Whatever the client posts is what the upstream sees, byte
 *     for byte, and the upstream's response body is returned unchanged.
 *   - Headers are filtered to drop hop-by-hop noise (Connection,
 *     Transfer-Encoding, Upgrade, Keep-Alive, Proxy-Authenticate,
 *     Proxy-Authorization, TE, Trailer) on both legs. Auth headers
 *     (Authorization, Cookie) pass through to the upstream so the
 *     accounts service is the sole authority on whether to allow the
 *     operation. Set-Cookie on the response leg passes back so the
 *     Better Auth session cookie set by accounts.antonline.dev reaches the
 *     caller intact.
 *   - Upstream URL resolution reuses the same env override
 *     (`ANT_ACCOUNTS_URL`) and default (`https://accounts.antonline.dev`) as
 *     `accountSync.ts`, so a single env knob controls every accounts
 *     call.
 *   - Network failures return 502 (not 500): "we couldn't reach
 *     accounts.antonline.dev" is a different operational class from "we
 *     crashed." Body shape stays JSON for callers that lift-and-shift
 *     existing error handling.
 *
 * This module is deliberately small. Both `/api/devices/link` and
 * `/api/devices/refresh` are pure passthroughs sharing one algorithm —
 * keeping both routes in one file would muddle SvelteKit's
 * route-discovery, so they live as thin wrappers in
 * `src/routes/api/devices/.../+server.ts`.
 */

const DEFAULT_ACCOUNTS_BASE_URL = 'https://accounts.antonline.dev';

// Hop-by-hop headers must be stripped on every proxy hop. RFC 7230 §6.1
// lists Connection + the headers it names; we explicitly drop the
// commonly listed ones rather than dynamically parsing Connection so the
// allowlist stays grep-able from a security review.
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
]);

// Inbound headers we deliberately do NOT forward upstream:
//   - host: Node's fetch sets this from the upstream URL itself; leaving
//     the inbound host header in would point at our OSS hostname.
//   - content-length: Node's fetch recomputes from the body. Passing
//     stale values can mismatch when the body is a Uint8Array.
const HEADERS_NOT_FORWARDED_REQUEST = new Set([
  ...HOP_BY_HOP_HEADERS,
  'host',
  'content-length'
]);

// Response headers we deliberately do NOT pass back:
//   - content-encoding: Node's fetch decodes the body automatically, so
//     re-emitting the upstream encoding header without re-encoding the
//     body produces broken responses.
//   - content-length: same recompute story as the request leg.
const HEADERS_NOT_FORWARDED_RESPONSE = new Set([
  ...HOP_BY_HOP_HEADERS,
  'content-encoding',
  'content-length'
]);

type EnvLike = {
  ANT_ACCOUNTS_URL?: string;
};

export type ProxyOptions = {
  env?: EnvLike;
  fetchImpl?: typeof fetch;
};

/**
 * Resolve the accounts base URL. Mirrors the precedence used by
 * `accountSync.ts` so the env knob is consistent across this server's
 * accounts-related code paths: explicit env override wins, otherwise the
 * default canonical hostname is used. Trailing slashes are normalised so
 * callers can safely concatenate `path` without producing `//`.
 */
export function accountsBaseUrl(env: EnvLike = process.env): string {
  const raw = env.ANT_ACCOUNTS_URL ?? DEFAULT_ACCOUNTS_BASE_URL;
  return raw.replace(/\/+$/, '');
}

function buildForwardHeaders(inbound: Headers): Headers {
  const out = new Headers();
  inbound.forEach((value, key) => {
    if (HEADERS_NOT_FORWARDED_REQUEST.has(key.toLowerCase())) return;
    out.append(key, value);
  });
  return out;
}

function buildResponseHeaders(upstream: Headers): Headers {
  const out = new Headers();
  upstream.forEach((value, key) => {
    if (HEADERS_NOT_FORWARDED_RESPONSE.has(key.toLowerCase())) return;
    out.append(key, value);
  });
  return out;
}

/**
 * Forward `request` to `${accountsBaseUrl()}${path}` and return the
 * upstream's response wrapped for the caller. `path` should start with
 * `/` (e.g. `/api/devices/link`).
 *
 * Body is read once as bytes via `arrayBuffer()` so the upstream sees
 * the exact same payload regardless of content-type. Upstream body is
 * piped back as bytes too — no JSON reparse anywhere.
 */
export async function proxyToAccounts(
  request: Request,
  path: string,
  options: ProxyOptions = {}
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const base = accountsBaseUrl(options.env ?? process.env);
  const target = `${base}${path}`;

  // Read inbound body up-front so we can compute Content-Length-free
  // forwarding bytes. For methods without a body (GET/HEAD) arrayBuffer()
  // returns an empty ArrayBuffer which fetch happily accepts; the route
  // file only wires POST so we keep this branchless.
  const bodyBytes = await request.arrayBuffer();
  const forwardHeaders = buildForwardHeaders(request.headers);

  let upstream: Response;
  try {
    upstream = await fetchImpl(target, {
      method: request.method,
      headers: forwardHeaders,
      // Empty bodies on POST are valid (the link/refresh endpoints
      // require a JSON body but the upstream — not us — is the
      // authority on shape). Pass bytes unchanged either way.
      body: bodyBytes.byteLength > 0 ? bodyBytes : undefined,
      // Don't follow redirects. The upstream's 3xx is part of the
      // protocol surface we're proxying; let the caller decide.
      redirect: 'manual'
    });
  } catch (failure) {
    const detail = failure instanceof Error ? failure.message : String(failure);
    return new Response(
      JSON.stringify({ error: 'upstream unreachable', detail }),
      {
        status: 502,
        headers: { 'content-type': 'application/json' }
      }
    );
  }

  // Pull upstream body as bytes once so we can return them verbatim.
  const upstreamBytes = await upstream.arrayBuffer();
  const responseHeaders = buildResponseHeaders(upstream.headers);
  return new Response(upstreamBytes, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders
  });
}
