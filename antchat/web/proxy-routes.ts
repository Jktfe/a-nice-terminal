// Pass-through proxy from the local server to the upstream ANT server.
//
// • GET  /api/rooms/:id/messages?limit&before&since → upstream GET /api/sessions/:id/messages
// • POST /api/rooms/:id/messages                    → upstream POST /api/sessions/:id/messages
// • GET  /api/rooms/:id/participants                → upstream GET /api/sessions/:id/participants
// • GET  /api/rooms/:id/tasks                       → upstream GET /api/sessions/:id/tasks
// • GET  /api/rooms/:id/file-refs                   → upstream GET /api/sessions/:id/file-refs
//
// Auth: per-room bearer from `config.getRoomToken(roomId, handle?)`. We
// preserve the upstream status code rather than translating; HTTP 401/403
// from upstream surfaces back to the SPA so it can prompt the user to
// re-join (token revoked) or pick a different handle.
//
// `handle` selection: query param `?as=@name` picks a non-default identity
// when the room has multiple stored tokens. Omit to use the default handle.

import { config } from '../../cli/lib/config.js';

export type ProxyRoute = 'messages' | 'participants' | 'tasks' | 'file-refs';

interface ResolvedRoom {
  serverUrl: string;
  token: string;
  handle: string | null;
  kind: 'cli' | 'mcp' | 'web';
}

function resolveRoom(roomId: string, handle: string | null): ResolvedRoom | null {
  const tok = config.getRoomToken(roomId, handle ?? undefined);
  if (!tok || !tok.token || !tok.server_url) return null;
  return {
    serverUrl: tok.server_url,
    token: tok.token,
    handle: tok.handle ?? null,
    kind: (tok.kind as ResolvedRoom['kind']) ?? 'cli',
  };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function forward(method: 'GET' | 'POST', resolved: ResolvedRoom, path: string, body?: any): Promise<Response> {
  // We bypass the api.* helpers here because they throw on non-2xx and
  // unwrap JSON; the SPA wants the raw status + body. Same TLS allowances
  // as cli/lib/api.ts:doFetch.
  const headers: Record<string, string> = {
    'authorization': `Bearer ${resolved.token}`,
  };
  const options: any = {
    method,
    headers,
    tls: { rejectUnauthorized: false },
  };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  if (resolved.serverUrl.startsWith('https://') && typeof (globalThis as any).Bun === 'undefined') {
    try {
      // @ts-ignore — undici dispatcher under Node 18+
      const { Agent } = await import('undici');
      options.dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
    } catch { /* fall back to NODE_TLS_REJECT_UNAUTHORIZED=0 if user set it */ }
  }
  const upstreamUrl = `${resolved.serverUrl}${path}`;
  let res: Response;
  try {
    res = await fetch(upstreamUrl, options);
  } catch (err: any) {
    // Connection refused, DNS failure, TLS failure — all become 502 with
    // a useful detail so the SPA can render "upstream unreachable" rather
    // than a generic 500.
    return new Response(JSON.stringify({
      error: 'upstream_unreachable',
      detail: err?.message || String(err),
      server_url: resolved.serverUrl,
    }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }
  const text = await res.text();
  // Pass through status + body. content-type defaults to JSON because the
  // upstream is a JSON API for these routes.
  return new Response(text, {
    status: res.status,
    headers: { 'content-type': res.headers.get('content-type') || 'application/json' },
  });
}

export async function handleProxy(req: Request, roomId: string, route: ProxyRoute): Promise<Response> {
  const url = new URL(req.url);
  const handleParam = url.searchParams.get('as');
  const resolved = resolveRoom(roomId, handleParam);
  if (!resolved) return jsonResponse({ error: 'unknown_room', detail: roomId }, 404);

  if (route === 'messages') {
    if (req.method === 'GET') {
      const limit = url.searchParams.get('limit');
      const before = url.searchParams.get('before');
      const since = url.searchParams.get('since');
      const qs = new URLSearchParams();
      if (limit) qs.set('limit', limit);
      if (before) qs.set('before', before);
      if (since) qs.set('since', since);
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      return forward('GET', resolved, `/api/sessions/${encodeURIComponent(roomId)}/messages${suffix}`);
    }
    if (req.method === 'POST') {
      let body: any;
      try { body = await req.json(); }
      catch { return jsonResponse({ error: 'invalid_json' }, 400); }
      const content = typeof body?.content === 'string' ? body.content : '';
      const target = typeof body?.target === 'string' && body.target.length ? body.target : null;
      const replyTo = typeof body?.reply_to === 'string' && body.reply_to.length ? body.reply_to : null;
      if (!content) return jsonResponse({ error: 'missing_content' }, 400);
      if (resolved.kind === 'web') return jsonResponse({ error: 'read_only_kind', detail: 'this token cannot post; rejoin with kind=cli' }, 403);
      const payload = {
        role: 'user',
        content,
        format: 'text',
        sender_id: resolved.handle ?? undefined,
        target,
        reply_to: replyTo,
        msg_type: 'message',
      };
      return forward('POST', resolved, `/api/sessions/${encodeURIComponent(roomId)}/messages`, payload);
    }
  }

  if (route === 'participants') {
    return forward('GET', resolved, `/api/sessions/${encodeURIComponent(roomId)}/participants`);
  }

  if (route === 'tasks') {
    if (req.method !== 'GET') return jsonResponse({ error: 'method_not_allowed' }, 405);
    return forward('GET', resolved, `/api/sessions/${encodeURIComponent(roomId)}/tasks`);
  }

  if (route === 'file-refs') {
    if (req.method !== 'GET') return jsonResponse({ error: 'method_not_allowed' }, 405);
    return forward('GET', resolved, `/api/sessions/${encodeURIComponent(roomId)}/file-refs`);
  }

  return jsonResponse({ error: 'not_implemented' }, 501);
}

/** Exposed for sse-fanout.ts so the bridge can resolve once when starting up. */
export { resolveRoom };
