// Minimal MCP (Model Context Protocol) JSON-RPC handler for the per-room
// remote endpoint at /mcp/room/:id. Exposes a small toolset that any MCP
// client (Claude Desktop, the official mcp CLI, Continue.dev, etc.) can
// connect to once a per-room bearer token has been issued via ant join-room.
//
// We implement the protocol directly rather than pulling in
// @modelcontextprotocol/sdk because:
//   1. Only 3 methods are needed (initialize, tools/list, tools/call) — the
//      SDK is heavyweight relative to that surface.
//   2. SvelteKit route handlers are already a fine HTTP transport — no need
//      for the SDK's transport abstractions.
//   3. Avoiding a new dep keeps the OSS install footprint smaller.
//
// JSON-RPC 2.0: https://www.jsonrpc.org/specification
// MCP spec:    https://modelcontextprotocol.io/specification

import { queries } from './db';
import { resolveToken } from './room-invites';
import { nanoid } from 'nanoid';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'ant-room';
const SERVER_VERSION = '0.1.0';

interface RoomContext {
  roomId: string;
  handle: string | null;
  tokenId: string;
  inviteId: string;
  kind: string | null;
}

const WRITE_KINDS = new Set(['cli', 'mcp']);
function canWrite(ctx: RoomContext): boolean {
  if (ctx.kind === null) return true; // legacy/unknown — be permissive
  return WRITE_KINDS.has(ctx.kind);
}

// Match upstream's tool shape: name, description, inputSchema (JSON Schema).
const TOOLS = [
  {
    name: 'whoami',
    description: 'Return the room id, handle, and bearer-token id this MCP session is authenticated as. Useful for confirming the wiring works before posting.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'list_messages',
    description: 'List recent messages in the room. Use this to read the chat history before replying. Defaults to the 50 most recent.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Max messages to return (default 50, capped at 200).' },
        since: { type: 'string', description: 'ISO timestamp or message id — only return messages newer than this.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'post_message',
    description: 'Post a message into the room. The token\'s handle is used as sender. To address one participant set target to their @handle; omit for room-wide posts.',
    inputSchema: {
      type: 'object',
      required: ['content'],
      properties: {
        content: { type: 'string', minLength: 1, description: 'Message body. Plain text or markdown.' },
        target: { type: 'string', description: 'Optional @handle to direct the message at (omit or set @everyone for broadcast).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_participants',
    description: 'List the participants currently in the room (members and external posters).',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
] as const;

// Resolve the token from the request: Authorization: Bearer X first,
// then ?token= query (for MCP clients that can't set headers).
export function resolveMcpContext(request: Request, url: URL, expectedRoomId: string): RoomContext | null {
  const auth = request.headers.get('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : (url.searchParams.get('token') || '');
  if (!bearer) return null;
  const resolved = resolveToken(bearer);
  if (!resolved) return null;
  if (resolved.invite.room_id !== expectedRoomId) return null;
  return {
    roomId: resolved.invite.room_id,
    handle: resolved.token.handle,
    tokenId: resolved.token.id,
    inviteId: resolved.invite.id,
    kind: resolved.token.kind ?? null,
  };
}

function ok(id: JsonRpcRequest['id'] | undefined, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function fail(id: JsonRpcRequest['id'] | undefined, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

// Tool result shape per MCP spec: { content: [{type:'text', text:'...'}], isError? }
function textResult(text: string, isError = false): unknown {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) };
}

function jsonResult(value: unknown, isError = false): unknown {
  return textResult(JSON.stringify(value, null, 2), isError);
}

async function handleToolCall(name: string, args: Record<string, unknown>, ctx: RoomContext): Promise<unknown> {
  switch (name) {
    case 'whoami': {
      return jsonResult({
        room_id: ctx.roomId,
        handle: ctx.handle,
        token_id: ctx.tokenId,
        invite_id: ctx.inviteId,
      });
    }

    case 'list_messages': {
      const limit = Math.max(1, Math.min(Number(args.limit ?? 50) || 50, 200));
      const since = typeof args.since === 'string' && args.since ? args.since : null;
      const rows = since
        ? (queries.getMessagesSince(ctx.roomId, since, limit) as unknown[])
        : (queries.listMessages(ctx.roomId) as unknown[]).slice(-limit);
      return jsonResult(rows);
    }

    case 'post_message': {
      if (!canWrite(ctx)) {
        return textResult(`post_message: tokens of kind '${ctx.kind}' are read-only`, true);
      }
      const content = typeof args.content === 'string' ? args.content : '';
      if (!content) return textResult('post_message: content is required', true);
      const target = typeof args.target === 'string' && args.target ? args.target : null;
      const sender = ctx.handle || `@token:${ctx.tokenId.slice(0, 8)}`;
      const id = nanoid();
      const meta = JSON.stringify({ via: 'mcp', token_id: ctx.tokenId });
      const normalisedTarget = target === '@everyone' ? null : target;
      queries.createMessage(
        id,
        ctx.roomId,
        'user',
        content,
        'text',
        'complete',
        sender,
        normalisedTarget,
        null,
        'message',
        meta,
      );
      queries.updateSession(null, null, null, null, ctx.roomId);

      // Route via MessageRouter so @mentions / agent fan-out fire just like
      // a POST /messages would — otherwise MCP-posted messages would be
      // second-class (no broadcast, no router-driven delivery).
      try {
        const { getRouter } = await import('./message-router.js');
        const router = getRouter();
        await router.route({
          id,
          sessionId: ctx.roomId,
          content,
          role: 'user',
          senderId: null,
          senderName: sender,
          senderType: null,
          target: normalisedTarget,
          replyTo: null,
          msgType: 'message',
          meta,
        });
      } catch {
        // Router is best-effort here — fall back to a direct broadcast so the
        // message at least reaches live UIs even if routing is unavailable.
        try {
          const { broadcast } = await import('./ws-broadcast.js');
          broadcast(ctx.roomId, { type: 'message_added', sessionId: ctx.roomId, msgId: id });
        } catch {}
      }
      return jsonResult({ msg_id: id, sender, target: normalisedTarget, content });
    }

    case 'list_participants': {
      const members = queries.listRoomMembers(ctx.roomId) as Array<Record<string, unknown>>;
      return jsonResult(members.map((m) => ({
        session_id: m.session_id,
        handle: m.handle,
        alias: m.alias,
        role: m.role,
        joined_at: m.joined_at,
        attention_state: m.attention_state || 'available',
      })));
    }

    default:
      return textResult(`Unknown tool: ${name}`, true);
  }
}

export async function dispatchMcp(req: JsonRpcRequest, ctx: RoomContext): Promise<JsonRpcResponse | null> {
  // Notifications (no id) — accept and return null (HTTP 202-ish).
  if (req.id === undefined || req.id === null) {
    return null;
  }

  switch (req.method) {
    case 'initialize':
      return ok(req.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: false },
        },
        serverInfo: {
          name: SERVER_NAME,
          version: SERVER_VERSION,
        },
      });

    case 'ping':
      return ok(req.id, {});

    case 'tools/list':
      return ok(req.id, { tools: TOOLS });

    case 'tools/call': {
      const params = (req.params || {}) as { name?: unknown; arguments?: unknown };
      const name = typeof params.name === 'string' ? params.name : '';
      const args = (params.arguments && typeof params.arguments === 'object')
        ? params.arguments as Record<string, unknown>
        : {};
      if (!name) return fail(req.id, -32602, 'tools/call: name is required');
      try {
        const result = await handleToolCall(name, args, ctx);
        return ok(req.id, result);
      } catch (err: unknown) {
        return fail(req.id, -32603, `Tool ${name} failed`, { reason: (err as Error)?.message ?? String(err) });
      }
    }

    default:
      return fail(req.id, -32601, `Method not found: ${req.method}`);
  }
}
