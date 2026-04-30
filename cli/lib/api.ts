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
