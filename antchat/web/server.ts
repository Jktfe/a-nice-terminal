// Local web server for `antchat web`.
//
// Bun.serve on 127.0.0.1:<port>. Wires the route table, applies auth guards
// (Origin → launch-token cookie → CSRF), serves embedded static assets, and
// delegates business routes to handlers in proxy-routes.ts and sse-fanout.ts.
//
// Lifecycle: `createWebServer({ port, launchToken })` returns `{ server,
// close, ctx }`. `close()` aborts every in-flight room bridge before
// `server.stop(true)` so we don't leak upstream SSE connections.
//
// The server is intentionally compact — most logic lives in pure helper
// modules so we can unit-test them without spinning up Bun.serve.

import { config } from '../../cli/lib/config.js';
import {
  parseShareString,
  exchangeInvite,
  type InviteKind,
} from '../../cli/commands/joinRoom.js';
import {
  applyApiGuards,
  buildSetCookie,
  COOKIE_CSRF,
  COOKIE_LAUNCH,
  mintCsrfToken,
  type AuthCtx,
} from './auth.js';
import { logAccess, logEvent } from './log.js';
import { renderShell, serveStatic } from './assets.js';
import { handleProxy } from './proxy-routes.js';
import { handleStream, closeAllBridges } from './sse-fanout.js';

const SERVER_VERSION = '0.3.0';
const SECURITY_HEADERS: Record<string, string> = {
  'cross-origin-opener-policy': 'same-origin',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

export interface CreateWebServerOpts {
  port: number;
  launchToken: string;
  /** Test hook: override Date.now() for deterministic uptime. */
  now?: () => number;
}

export interface WebServerHandle {
  server: { stop: (closeActiveConnections?: boolean) => void; port: number };
  ctx: AuthCtx;
  close: () => Promise<void>;
}

interface RouteCtx {
  auth: AuthCtx;
  startedAt: number;
  rid: string;
}

function makeRequestId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  return new Response(JSON.stringify(body), { ...init, headers });
}

function methodNotAllowed(): Response {
  return jsonResponse({ error: 'method_not_allowed' }, { status: 405 });
}

// ─── Public route handlers (no auth) ────────────────────────────────────────

function handleHealthz(rctx: RouteCtx): Response {
  const uptime = Math.floor((Date.now() - rctx.startedAt) / 1000);
  return jsonResponse({
    ok: true,
    version: SERVER_VERSION,
    uptime,
    port: rctx.auth.port,
  });
}

// ─── Auth-gated handlers ────────────────────────────────────────────────────

function handleCsrf(rctx: RouteCtx): Response {
  // Re-mint on every call. The previous token is invalidated by overwriting
  // ctx.csrfToken — short-lived, single-tab semantics.
  const token = mintCsrfToken();
  rctx.auth.csrfToken = token;
  const headers = new Headers({ 'content-type': 'application/json' });
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  // Cookie is readable by JS so the SPA can echo it in X-CSRF on POSTs.
  headers.append('set-cookie', buildSetCookie(COOKIE_CSRF, token, { sameSite: 'Strict' }));
  return new Response(JSON.stringify({ csrfToken: token }), { status: 200, headers });
}

function handleLaunchInfo(rctx: RouteCtx): Response {
  const tokens = config.listRoomTokens();
  const servers = new Set<string>();
  for (const list of Object.values(tokens)) {
    for (const t of list) if (t.server_url) servers.add(t.server_url);
  }
  return jsonResponse({
    version: SERVER_VERSION,
    cwd: process.cwd(),
    port: rctx.auth.port,
    servers: Array.from(servers),
    rooms_known: Object.keys(tokens).length,
  });
}

function handleListRooms(_rctx: RouteCtx): Response {
  const tokens = config.listRoomTokens();
  const rooms = Object.entries(tokens).map(([roomId, list]) => ({
    room_id: roomId,
    handles: list.map(t => ({
      handle: t.handle,
      kind: t.kind,
      label: t.label,
      joined_at: t.joined_at,
      server_url: t.server_url,
    })),
  }));
  return jsonResponse({ rooms });
}

async function handleParseShare(req: Request): Promise<Response> {
  let body: any;
  try { body = await req.json(); }
  catch { return jsonResponse({ error: 'invalid_json' }, { status: 400 }); }
  const share = typeof body?.share === 'string' ? body.share : '';
  if (!share) return jsonResponse({ error: 'missing_share' }, { status: 400 });
  try {
    const parsed = parseShareString(share);
    return jsonResponse({ ok: true, parsed });
  } catch (err: any) {
    return jsonResponse({ ok: false, error: err?.message || 'parse_failed' }, { status: 400 });
  }
}

async function handleExchange(req: Request): Promise<Response> {
  let body: any;
  try { body = await req.json(); }
  catch { return jsonResponse({ error: 'invalid_json' }, { status: 400 }); }

  const share = typeof body?.share === 'string' ? body.share : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const kindRaw = typeof body?.kind === 'string' ? body.kind : 'cli';
  const handleInput = typeof body?.handle === 'string' ? body.handle.trim() : '';
  const labelInput = typeof body?.label === 'string' ? body.label : undefined;

  if (!share) return jsonResponse({ error: 'missing_share' }, { status: 400 });
  if (!['cli', 'mcp', 'web'].includes(kindRaw)) {
    return jsonResponse({ error: 'invalid_kind' }, { status: 400 });
  }

  let parsed;
  try { parsed = parseShareString(share); }
  catch (err: any) { return jsonResponse({ error: 'invalid_share', detail: err?.message }, { status: 400 }); }

  const handle = handleInput
    ? (handleInput.startsWith('@') ? handleInput : `@${handleInput}`)
    : null;

  try {
    const result = await exchangeInvite({
      parsed,
      password,
      kind: kindRaw as InviteKind,
      handle,
      label: labelInput,
      metaClient: 'antchat-web',
      ctx: {},
    });
    logEvent('exchange', { room_id: result.room_id, kind: result.kind, handle: result.handle });
    return jsonResponse({ ok: true, room_id: result.room_id, handle: result.handle, kind: result.kind, server_url: result.server_url });
  } catch (err: any) {
    return jsonResponse({ ok: false, error: err?.message || 'exchange_failed' }, { status: 401 });
  }
}

function handleRevokeHandle(roomId: string, handle: string): Response {
  const decodedHandle = decodeURIComponent(handle);
  config.removeRoomToken(roomId, decodedHandle);
  return jsonResponse({ ok: true });
}

// ─── Static + boot ─────────────────────────────────────────────────────────

function handleRoot(): Response {
  const headers = new Headers({
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy':
      "default-src 'self'; connect-src 'self'; img-src 'self' data:; " +
      "style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'",
  });
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  return new Response(renderShell(), { status: 200, headers });
}

// ─── Router ─────────────────────────────────────────────────────────────────

async function route(req: Request, ctx: AuthCtx, startedAt: number): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method.toUpperCase();
  const rctx: RouteCtx = { auth: ctx, startedAt, rid: makeRequestId() };

  // Public, no auth
  if (path === '/' && method === 'GET') return handleRoot();
  if (path === '/healthz' && method === 'GET') return handleHealthz(rctx);
  if (path.startsWith('/static/') && method === 'GET') return serveStatic(path.slice('/static/'.length));

  // Everything below is /api/*
  if (!path.startsWith('/api/')) return jsonResponse({ error: 'not_found' }, { status: 404 });

  const denied = applyApiGuards(req, ctx);
  if (denied) return denied;

  if (path === '/api/csrf' && method === 'GET') return handleCsrf(rctx);
  if (path === '/api/launch' && method === 'GET') return handleLaunchInfo(rctx);
  if (path === '/api/rooms' && method === 'GET') return handleListRooms(rctx);
  if (path === '/api/rooms/parse-share' && method === 'POST') return handleParseShare(req);
  if (path === '/api/rooms/exchange' && method === 'POST') return handleExchange(req);

  // Per-room sub-routes: /api/rooms/:id/...
  const roomMatch = path.match(/^\/api\/rooms\/([^/]+)\/(.+)$/);
  if (roomMatch) {
    const roomId = decodeURIComponent(roomMatch[1]);
    const rest = roomMatch[2];

    if (rest === 'messages') {
      if (method !== 'GET' && method !== 'POST') return methodNotAllowed();
      return handleProxy(req, roomId, 'messages');
    }
    if (rest === 'participants' && method === 'GET') return handleProxy(req, roomId, 'participants');
    if (rest === 'stream' && method === 'GET') return handleStream(req, roomId);

    const handleRevokeMatch = rest.match(/^handles\/(.+)$/);
    if (handleRevokeMatch && method === 'DELETE') {
      return handleRevokeHandle(roomId, handleRevokeMatch[1]);
    }
  }

  // /api/desktop-config/install + /api/notify — stubs until step 9
  if (path === '/api/desktop-config/install' && method === 'POST') {
    return jsonResponse({ error: 'not_implemented' }, { status: 501 });
  }
  if (path === '/api/notify' && method === 'POST') {
    return jsonResponse({ error: 'not_implemented' }, { status: 501 });
  }

  return jsonResponse({ error: 'not_found' }, { status: 404 });
}

// ─── Bun.serve entry ────────────────────────────────────────────────────────

declare const Bun: any;

export function createWebServer(opts: CreateWebServerOpts): WebServerHandle {
  const startedAt = (opts.now ?? Date.now)();
  const ctx: AuthCtx = {
    launchToken: opts.launchToken,
    csrfToken: mintCsrfToken(),
    port: opts.port,
  };

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: opts.port,
    async fetch(req: Request): Promise<Response> {
      const t0 = performance.now();
      let res: Response;
      try {
        res = await route(req, ctx, startedAt);
      } catch (err: any) {
        logEvent('error', { msg: err?.message || String(err), stack: err?.stack });
        res = jsonResponse({ error: 'internal_error' }, { status: 500 });
      }
      const ms = performance.now() - t0;
      logAccess(req.method, req.url, res.status, ms, makeRequestId());
      return res;
    },
  });

  logEvent('server_start', { port: opts.port, version: SERVER_VERSION });

  return {
    server,
    ctx,
    async close() {
      await closeAllBridges();
      server.stop(true);
      logEvent('server_stop', {});
    },
  };
}
