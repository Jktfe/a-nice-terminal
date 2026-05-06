// antchat MCP stdio<->HTTP proxy.
//
// Runs as `antchat mcp serve <room-id>` and exposes the host's room as a
// stdio MCP server to whatever client launched the binary (typically Claude
// Desktop's `mcpServers.<name>.command` slot).
//
// Wire format on stdio: newline-delimited JSON-RPC 2.0 frames. The MCP spec
// allows either content-length framing or NDJSON; Claude Desktop and the
// Anthropic mcp CLI both accept NDJSON, so that's what we emit.
//
// Forwarding model:
//   - Inbound stdin frames are POSTed to <server>/mcp/room/<id> with the
//     per-room bearer token. The host's response (or 204) is emitted to
//     stdout if the request had an `id` (calls), or dropped otherwise.
//   - The SSE stream at /mcp/room/<id>/stream is subscribed in parallel.
//     `message_created` events that mention the bound handle are emitted as
//     `notifications/claude/channel` JSON-RPC notifications on stdout, so
//     the connected MCP client (Claude Code / Desktop) wakes up with the
//     mention text in its conversation context.
//   - SSE `event: closed` (token revocation) is treated as a clean exit;
//     anything else is logged to stderr without aborting the proxy so the
//     transient-network case doesn't kill the long-lived MCP session.

import { config } from '../../cli/lib/config.js';
import { subscribeRoomStream } from '../../cli/lib/sse.js';
import { mentionsHandle } from './notifier.js';

export interface ProxyOptions {
  roomId: string;
  handleFlag?: string;
  serverUrlOverride?: string;
  // Logger sink for diagnostics. Defaults to stderr; tests can capture it.
  log?: (line: string) => void;
}

interface JsonRpcReq {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: unknown;
}

const NDJSON_DELIM = '\n';

function logToStderr(line: string) {
  process.stderr.write(`[antchat-mcp] ${line}\n`);
}

/**
 * Forward a single JSON-RPC frame to the host's HTTP MCP endpoint.
 * Returns the response object or `null` for 204 (notification) replies.
 */
async function forwardRpc(frame: unknown, opts: { serverUrl: string; roomId: string; token: string }): Promise<unknown | null> {
  const url = `${opts.serverUrl}/mcp/room/${encodeURIComponent(opts.roomId)}`;
  const fetchOptions: any = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.token}`,
    },
    body: JSON.stringify(frame),
    tls: { rejectUnauthorized: false },
  };
  if (opts.serverUrl.startsWith('https://') && typeof (globalThis as any).Bun === 'undefined') {
    try {
      // @ts-ignore — undici is a runtime dep of node's fetch on darwin/linux.
      const { Agent } = await import('undici');
      fetchOptions.dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
    } catch {}
  }

  const res = await fetch(url, fetchOptions);
  if (res.status === 204) return null;
  const text = await res.text();
  if (!res.ok) {
    // Surface the host's error to the client as a JSON-RPC error response if
    // we can, otherwise as a parse error so the client doesn't hang.
    const reqId = (frame as JsonRpcReq).id ?? null;
    return {
      jsonrpc: '2.0',
      id: reqId,
      error: { code: -32603, message: `Host ${res.status}: ${text.slice(0, 200) || res.statusText}` },
    };
  }
  if (!text.trim()) return null;
  try { return JSON.parse(text); }
  catch { return null; }
}

/**
 * Long-lived proxy loop. Resolves only on stdin EOF / SIGINT / token
 * revocation.
 */
export async function runProxy(opts: ProxyOptions): Promise<void> {
  const log = opts.log ?? logToStderr;

  const tok = config.getRoomToken(opts.roomId, opts.handleFlag);
  if (!tok) {
    log(`no token for room ${opts.roomId}${opts.handleFlag ? ` under handle ${opts.handleFlag}` : ''}`);
    process.exit(1);
  }

  const serverUrl = (opts.serverUrlOverride || tok.server_url || config.get('serverUrl') || '').trim();
  if (!serverUrl) {
    log(`no server URL — pass --server or rejoin to capture server_url in the token`);
    process.exit(1);
  }

  const handle = tok.handle || null;
  log(`serving room=${opts.roomId} handle=${handle ?? '(none)'} server=${serverUrl}`);

  // ── Outbound: SSE wake-on-mention ──────────────────────────────────────
  //
  // Each broadcast frame becomes a JSON-RPC notification on stdout. We only
  // surface frames that target the bound handle to keep noise out of the
  // host's conversation context — without that filter, an idle room with
  // chatty bystanders would page the host on every send.
  const abort = subscribeRoomStream({
    serverUrl,
    roomId: opts.roomId,
    token: tok.token,
    onEvent: ({ data, event }) => {
      if (event === 'closed') {
        log('SSE closed by host (token likely revoked) — exiting');
        process.exit(0);
      }
      const msg = data as {
        type?: string;
        sessionId?: string;
        id?: string;
        sender_id?: string;
        target?: string | null;
        content?: string;
        created_at?: string;
      };
      if (msg?.type !== 'message_created' || msg.sessionId !== opts.roomId) return;

      // Wake on either an explicit target match or an in-content @mention.
      const targetMatch = handle && msg.target === handle;
      const contentMatch = handle && msg.content && mentionsHandle(msg.content, handle);
      const broadcast = !msg.target;
      if (!targetMatch && !contentMatch && !broadcast) return;
      // Suppress our own echoes — agents that post via the same handle would
      // otherwise drown the host with their own outbound text.
      if (msg.sender_id === handle) return;

      const note = {
        jsonrpc: '2.0',
        method: 'notifications/claude/channel',
        params: {
          content: msg.content ?? '',
          meta: {
            sender: msg.sender_id ?? 'unknown',
            session_id: msg.sessionId,
            target: msg.target ?? null,
            message_id: msg.id ?? null,
            created_at: msg.created_at ?? null,
            kind: targetMatch ? 'directed' : (contentMatch ? 'mention' : 'broadcast'),
          },
        },
      };
      process.stdout.write(JSON.stringify(note) + NDJSON_DELIM);
    },
    onError: (err: any) => log(`SSE error: ${err?.message ?? err}`),
  });

  // ── Inbound: stdin NDJSON → host POST ─────────────────────────────────
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', async (chunk: string) => {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const raw = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!raw) continue;
      let frame: unknown;
      try { frame = JSON.parse(raw); }
      catch (err: any) {
        log(`stdin parse error: ${err.message} (frame=${raw.slice(0, 80)})`);
        continue;
      }
      try {
        const reply = await forwardRpc(frame, { serverUrl, roomId: opts.roomId, token: tok.token });
        if (reply) process.stdout.write(JSON.stringify(reply) + NDJSON_DELIM);
      } catch (err: any) {
        const reqId = (frame as JsonRpcReq).id ?? null;
        const errFrame = {
          jsonrpc: '2.0',
          id: reqId,
          error: { code: -32603, message: `Proxy error: ${err.message}` },
        };
        process.stdout.write(JSON.stringify(errFrame) + NDJSON_DELIM);
      }
    }
  });

  process.stdin.on('end', () => {
    log('stdin closed — exiting');
    abort.abort();
    process.exit(0);
  });
  process.on('SIGINT', () => { abort.abort(); process.exit(0); });
  process.on('SIGTERM', () => { abort.abort(); process.exit(0); });
}
