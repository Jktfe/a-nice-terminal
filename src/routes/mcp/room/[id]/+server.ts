// Remote MCP transport for a single ANT room.
//
// MCP clients (Claude Desktop, mcp CLI, Continue.dev, etc.) speak JSON-RPC
// 2.0 over HTTP POST. This route is the public surface that turns a per-room
// bearer token into an authenticated MCP session — no separate handshake or
// session cookie, the token IS the session.
//
// Auth: Authorization: Bearer ant_t_... OR ?token=ant_t_...
// Method: POST application/json with a JSON-RPC request (or batch)
// Response: application/json with the JSON-RPC response (or 204 for pure
//           notifications which have no id and warrant no reply).

import { json, type RequestEvent } from '@sveltejs/kit';
import { dispatchMcp, resolveMcpContext } from '$lib/server/mcp-handler';

function rpcError(id: number | string | null, code: number, message: string) {
  return json(
    { jsonrpc: '2.0', id, error: { code, message } },
    { status: 200 },
  );
}

export async function POST(event: RequestEvent<{ id: string }>) {
  const { params, request, url } = event;

  const ctx = resolveMcpContext(request, url, params.id);
  if (!ctx) {
    // 401 — generic on purpose. We don't leak whether the room exists or
    // whether the token was malformed vs revoked vs cross-room.
    return new Response(
      JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorised' } }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return rpcError(null, -32700, 'Parse error: invalid JSON');
  }

  // JSON-RPC 2.0 supports batched requests as an array. Handle both shapes.
  if (Array.isArray(body)) {
    const responses: unknown[] = [];
    for (const req of body) {
      if (!req || typeof req !== 'object') continue;
      const res = await dispatchMcp(req as never, ctx);
      if (res) responses.push(res);
    }
    if (responses.length === 0) return new Response(null, { status: 204 });
    return json(responses);
  }

  if (!body || typeof body !== 'object') {
    return rpcError(null, -32600, 'Invalid Request');
  }

  const res = await dispatchMcp(body as never, ctx);
  if (!res) return new Response(null, { status: 204 });
  return json(res);
}

// GET — surface a tiny health hint so a human poking the URL gets a useful
// reply rather than a 405 wall. MCP clients themselves never GET this URL.
export function GET(event: RequestEvent<{ id: string }>) {
  const ctx = resolveMcpContext(event.request, event.url, event.params.id);
  if (!ctx) {
    return new Response('MCP endpoint — POST JSON-RPC with a valid room token.\n', {
      status: 401,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
  return json({
    transport: 'http+json-rpc',
    room_id: ctx.roomId,
    handle: ctx.handle,
    note: 'POST JSON-RPC 2.0 requests here (initialize, tools/list, tools/call).',
  });
}
