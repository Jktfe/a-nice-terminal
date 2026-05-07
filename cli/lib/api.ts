interface Ctx { serverUrl: string; apiKey: string; json: boolean; }

async function doFetch(url: string, options: any): Promise<Response> {
  try {
    return await fetch(url, options);
  } catch (err: any) {
    // If http:// was used against an https-only server, retry with https://
    if (url.startsWith('http://') && (err.code === 'UND_ERR_SOCKET' || err.message?.includes('socket'))) {
      const httpsUrl = url.replace('http://', 'https://');
      console.warn(`[ant] http:// failed — retrying with https://`);
      return fetch(httpsUrl, options);
    }
    throw err;
  }
}

interface RequestOpts { roomToken?: string }

async function request(ctx: Ctx, method: string, path: string, body?: any, opts?: RequestOpts): Promise<any> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  // Per-call room token wins over the master api key — it's narrower-scoped.
  if (opts?.roomToken) headers['Authorization'] = `Bearer ${opts.roomToken}`;
  else if (ctx.apiKey) headers['Authorization'] = `Bearer ${ctx.apiKey}`;

  const options: any = {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    // Bun: accepts self-signed certs via tls option
    tls: { rejectUnauthorized: false },
    // Node.js (>=18): accepts self-signed certs via dispatcher/agent
    // @ts-ignore — Node.js undici dispatcher for self-signed certs
    dispatcher: undefined as any,
  };

  // Node.js fetch (undici) uses a different mechanism than Bun
  if (ctx.serverUrl.startsWith('https://') && typeof (globalThis as any).Bun === 'undefined') {
    try {
      // @ts-ignore — undici types may not be installed in all environments
      const { Agent } = await import('undici');
      options.dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
    } catch {
      // undici not available — rely on NODE_TLS_REJECT_UNAUTHORIZED=0
    }
  }

  const res = await doFetch(`${ctx.serverUrl}${path}`, options);

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  get: (ctx: Ctx, path: string, opts?: RequestOpts) => request(ctx, 'GET', path, undefined, opts),
  post: (ctx: Ctx, path: string, body: any, opts?: RequestOpts) => request(ctx, 'POST', path, body, opts),
  put: (ctx: Ctx, path: string, body: any, opts?: RequestOpts) => request(ctx, 'PUT', path, body, opts),
  patch: (ctx: Ctx, path: string, body: any, opts?: RequestOpts) => request(ctx, 'PATCH', path, body, opts),
  del: (ctx: Ctx, path: string, opts?: RequestOpts) => request(ctx, 'DELETE', path, undefined, opts),
};

// Raw-byte helpers for the deck/sheet file endpoints. Those return file
// content directly (not JSON) and accept raw byte uploads — JSON serialisation
// would corrupt binary content and lose the per-write base_hash/mtime guard.
//
// The guard headers (`x-ant-base-hash`, `x-ant-if-match-mtime`) are how the
// server detects concurrent writes. A 409 with JSON details means another
// writer landed first; the caller should re-fetch via getRaw and retry.

export interface RawGetResult {
  bytes: Uint8Array;
  status: number;
  headers: Record<string, string>;
  contentType: string | null;
}

export interface RawPutResult {
  ok: true;
  status: number;
  body: any;  // server returns { ok, path, size, sha256, mtime_ms }
}

export interface RawConflictResult {
  ok: false;
  status: 409;
  details: any;  // DeckConflictError.details / SheetConflictError.details
}

async function rawRequest(ctx: Ctx, method: 'GET' | 'PUT' | 'DELETE', path: string, body: Uint8Array | null, extraHeaders: Record<string, string>, opts?: RequestOpts): Promise<{ res: Response; bytes: Uint8Array }> {
  const headers: Record<string, string> = { ...extraHeaders };
  if (opts?.roomToken) headers['Authorization'] = `Bearer ${opts.roomToken}`;
  else if (ctx.apiKey) headers['Authorization'] = `Bearer ${ctx.apiKey}`;

  const options: any = {
    method,
    headers,
    body: body ? body : undefined,
    tls: { rejectUnauthorized: false },
    dispatcher: undefined as any,
  };
  if (ctx.serverUrl.startsWith('https://') && typeof (globalThis as any).Bun === 'undefined') {
    try {
      const { Agent } = await import('undici');
      options.dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
    } catch {}
  }

  const res = await doFetch(`${ctx.serverUrl}${path}`, options);
  const arrayBuf = await res.arrayBuffer();
  return { res, bytes: new Uint8Array(arrayBuf) };
}

export async function getRaw(ctx: Ctx, path: string, opts?: RequestOpts): Promise<RawGetResult> {
  const { res, bytes } = await rawRequest(ctx, 'GET', path, null, {}, opts);
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const txt = new TextDecoder().decode(bytes);
      const parsed = JSON.parse(txt);
      msg = parsed.error || msg;
    } catch {}
    throw new Error(`HTTP ${res.status}: ${msg}`);
  }
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  return {
    bytes,
    status: res.status,
    headers,
    contentType: res.headers.get('content-type'),
  };
}

export async function putRaw(
  ctx: Ctx,
  path: string,
  body: Uint8Array,
  opts: { contentType?: string; baseHash?: string | null; ifMatchMtime?: number | null; roomToken?: string } = {},
): Promise<RawPutResult | RawConflictResult> {
  const headers: Record<string, string> = {
    'Content-Type': opts.contentType || 'application/octet-stream',
    'Content-Length': String(body.byteLength),
  };
  if (opts.baseHash) headers['x-ant-base-hash'] = opts.baseHash;
  if (opts.ifMatchMtime != null) headers['x-ant-if-match-mtime'] = String(opts.ifMatchMtime);

  const { res, bytes } = await rawRequest(ctx, 'PUT', path, body, headers, { roomToken: opts.roomToken });
  const txt = new TextDecoder().decode(bytes);
  let parsed: any = null;
  try { parsed = JSON.parse(txt); } catch {}

  if (res.status === 409) {
    return { ok: false, status: 409, details: parsed?.details ?? parsed };
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${parsed?.error || res.statusText}`);
  }
  return { ok: true, status: res.status, body: parsed };
}
