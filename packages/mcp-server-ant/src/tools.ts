/**
 * MCP tool definitions for `@jktfe/mcp-server-ant`.
 *
 * Ten tools, all backed by HTTP requests against the local ANT OSS
 * daemon (default `http://127.0.0.1:6174`):
 *
 *   - ant_get_pending_mentions  (long-poll for new bound-handle mentions)
 *   - ant_post_message          (post into a chat room)
 *   - ant_list_rooms            (list visible chat rooms)
 *   - ant_get_room              (read one chat room's metadata)
 *   - ant_get_room_messages     (paginated message history for a room)
 *   - ant_get_message           (resolve one message id → message row)
 *   - ant_search_room_messages  (full-text search within one room)
 *   - ant_list_agents           (agent registry, optionally per-room)
 *   - ant_list_plans            (plans-entity list by lifecycle state)
 *   - ant_get_plan              (read one plan)
 *
 * The pending-mentions tool is intentionally the only "blocking" call.
 * The wait happens server-side on `/api/me/mentions?wait=N`, so the MCP
 * server consumes ~zero CPU while parked on the long-poll. No timers,
 * no in-process retry loops — idle MCP server == idle resource use.
 *
 * Tool-surface cap (rV1 M3-S1): keep this at ~10 tools. Anything beyond
 * read/post/discover belongs in the `ant` CLI, not the MCP bridge.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AntClient, AntClientError } from './ant-client.js';

// Hard cap for `waitSeconds` matches the server's `/api/me/mentions`
// contract (0..60). Server clamps anyway; we clamp client-side too so
// tool callers get a clear error before a doomed round-trip.
const MAX_WAIT_SECONDS = 60;
const DEFAULT_WAIT_SECONDS = 25;

// Mirrors /api/chat-rooms/:roomId/messages page-size contract
// (DEFAULT_MESSAGE_PAGE_SIZE=100, MAX_MESSAGE_PAGE_SIZE=200) and the
// per-room search contract (default 50, max 200). Client-side zod caps
// match so callers get a clear error before a doomed round-trip.
const MAX_PAGE_LIMIT = 200;
const DEFAULT_MESSAGES_LIMIT = 100;
const DEFAULT_SEARCH_LIMIT = 50;

// Client-side page size for list endpoints the server returns unpaged
// (/api/agents, /api/plans). We slice locally and report nextOffset.
const DEFAULT_LIST_LIMIT = 50;

type AntMention = {
  messageId: string;
  roomId: string;
  roomName: string;
  authorHandle: string;
  body: string;
  postedAt: string;
  matchedHandle: string;
};

type MentionsResponse = {
  mentions: AntMention[];
  nextCursor: number;
};

type PostMessageResponse = {
  message?: { id?: string };
};

type RoomsResponse = {
  chatRooms?: Array<{ id: string; name: string }>;
};

type RoomDetailResponse = {
  chatRoom?: Record<string, unknown>;
};

type RoomMessagesResponse = {
  messages?: Array<Record<string, unknown>>;
  paging?: {
    limit?: number;
    before?: number | null;
    hasMore?: boolean;
    nextBefore?: number | null;
    sinceBreak?: boolean;
  };
};

type MessageDetailResponse = {
  message?: Record<string, unknown>;
};

type RoomSearchResponse = {
  matches?: Array<{
    id: string;
    postedAt: string;
    authorHandle: string;
    body: string;
    postOrder: number;
  }>;
  allContent?: boolean;
};

type AgentsResponse = {
  agents?: Array<Record<string, unknown>>;
};

type PlansResponse = {
  plans?: Array<Record<string, unknown>>;
};

type PlanDetailResponse = {
  plan?: Record<string, unknown>;
};

function textResult(payload: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(payload)
      }
    ]
  };
}

/**
 * Map an HTTP failure status to a next-step hint the calling agent can
 * actually act on. Appended to the verbatim server error so nothing is
 * hidden — the raw status + body always come first.
 */
function actionableHint(status: number): string | null {
  if (status === 401 || status === 403) {
    return (
      'your token may lack room access — ask the operator to run ' +
      '`ant mcp grant --room <roomId> --handle <your-handle>` and set ' +
      'ANT_DEVICE_TOKEN to the minted tokenSecret'
    );
  }
  if (status === 404) {
    return (
      'not found — the id may be wrong or the resource was deleted; ' +
      'use ant_list_rooms / ant_list_plans / ant_list_agents to discover valid ids'
    );
  }
  if (status >= 500) {
    return (
      'the ANT daemon errored — check it is running and healthy at ' +
      'ANT_SERVER_URL (default http://127.0.0.1:6174, probe GET /api/health)'
    );
  }
  return null;
}

function errorResult(err: unknown) {
  let message: string;
  if (err instanceof AntClientError) {
    message = `${err.message}${err.bodyText ? `: ${err.bodyText.slice(0, 500)}` : ''}`;
    const hint = actionableHint(err.status);
    if (hint) message += ` (${hint})`;
  } else if (err instanceof Error) {
    message = err.message;
    // Undici/fetch network-level failure — the daemon is unreachable.
    if (/fetch failed|ECONNREFUSED|ENOTFOUND/i.test(message)) {
      message +=
        ' (could not reach the ANT daemon — check ANT_SERVER_URL ' +
        '(default http://127.0.0.1:6174) and that the server is running)';
    }
  } else {
    message = String(err);
  }
  return {
    isError: true as const,
    content: [
      {
        type: 'text' as const,
        text: message
      }
    ]
  };
}

/** Slice an unpaged server list into a {items, total, nextOffset} page. */
function pageSlice<T>(items: T[], offset: number, limit: number) {
  const page = items.slice(offset, offset + limit);
  const nextOffset = offset + page.length < items.length ? offset + page.length : null;
  return { page, total: items.length, nextOffset };
}

/**
 * Register the ANT tools on the given MCP server using the supplied
 * `AntClient`. Split out so tests can drive the registration against a
 * mocked client without spinning a real stdio transport.
 */
export function registerAntTools(server: McpServer, client: AntClient): void {
  server.registerTool(
    'ant_get_pending_mentions',
    {
      title: 'Get pending ANT mentions',
      description:
        'Long-poll the ANT server for new mentions of bound handles. ' +
        'Returns immediately if mentions exist after `since` (unix ms), ' +
        'otherwise blocks up to `waitSeconds` (max 60, default 25) on ' +
        'server-side SSE before returning. ' +
        '`workspaceId` reserved for future multi-workspace fan-out.',
      inputSchema: {
        workspaceId: z.string().optional(),
        since: z.number().int().nonnegative().optional(),
        waitSeconds: z.number().int().min(0).max(MAX_WAIT_SECONDS).optional()
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false
      }
    },
    async (args) => {
      try {
        const sinceMs = args.since ?? 0;
        const waitSec = args.waitSeconds ?? DEFAULT_WAIT_SECONDS;
        const params = new URLSearchParams({
          since: String(sinceMs),
          wait: String(waitSec)
        });
        if (args.workspaceId) params.set('workspaceId', args.workspaceId);
        const data = await client.getJson<MentionsResponse>(
          `/api/me/mentions?${params.toString()}`
        );
        return textResult({
          mentions: data.mentions ?? [],
          nextCursor: data.nextCursor ?? sinceMs
        });
      } catch (cause) {
        return errorResult(cause);
      }
    }
  );

  server.registerTool(
    'ant_post_message',
    {
      title: 'Post a message to an ANT chat room',
      description:
        'Append a message to the given ANT chat room. Returns the created ' +
        'message id. `parentMessageId` is optional — pass it to reply in a ' +
        'thread, omit it for a top-level message.',
      inputSchema: {
        roomId: z.string().min(1).describe('Target room id, e.g. "room_heroes"'),
        body: z.string().min(1).describe('Message body (markdown allowed)'),
        parentMessageId: z
          .string()
          .min(1)
          .optional()
          .describe('Reply target, e.g. "msg_abc123" — omit for a top-level message')
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async (args) => {
      try {
        const payload: Record<string, unknown> = { body: args.body };
        if (args.parentMessageId) payload.parentMessageId = args.parentMessageId;
        const data = await client.postJson<PostMessageResponse>(
          `/api/chat-rooms/${encodeURIComponent(args.roomId)}/messages`,
          payload
        );
        return textResult({ messageId: data.message?.id ?? null });
      } catch (cause) {
        return errorResult(cause);
      }
    }
  );

  server.registerTool(
    'ant_list_rooms',
    {
      title: 'List visible ANT chat rooms',
      description:
        'Return the rooms the authenticated caller can see. `kind` ' +
        'is reserved for future room-typing (currently always "chat").',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        openWorldHint: false
      }
    },
    async () => {
      try {
        const data = await client.getJson<RoomsResponse>('/api/chat-rooms');
        const rooms = (data.chatRooms ?? []).map((room) => ({
          id: room.id,
          name: room.name,
          kind: 'chat' as const
        }));
        return textResult({ rooms });
      } catch (cause) {
        return errorResult(cause);
      }
    }
  );

  server.registerTool(
    'ant_get_room',
    {
      title: 'Get one ANT chat room',
      description:
        'Read one chat room by id (GET /api/chat-rooms/:roomId). Returns the ' +
        'room metadata or a 404 error if the id is unknown. Use ant_list_rooms ' +
        'first to discover valid room ids.',
      inputSchema: {
        roomId: z.string().min(1).describe('Room id, e.g. "room_heroes"')
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false
      }
    },
    async (args) => {
      try {
        const data = await client.getJson<RoomDetailResponse>(
          `/api/chat-rooms/${encodeURIComponent(args.roomId)}`
        );
        return textResult({ room: data.chatRoom ?? null });
      } catch (cause) {
        return errorResult(cause);
      }
    }
  );

  server.registerTool(
    'ant_get_room_messages',
    {
      title: 'Get messages from an ANT chat room',
      description:
        'Read the newest message page for a room (oldest first within the ' +
        'page). Paginate older history by passing `before` = the `nextBefore` ' +
        'cursor from the previous response (`paging.hasMore` tells you when to ' +
        'stop). By default only messages since the most recent context break ' +
        'are returned; set `includePreBreak` to true for full history (the ' +
        'server may refuse this on rooms with hard break enforcement).',
      inputSchema: {
        roomId: z.string().min(1).describe('Room id, e.g. "room_heroes"'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_PAGE_LIMIT)
          .optional()
          .describe(`Page size 1..${MAX_PAGE_LIMIT} (default ${DEFAULT_MESSAGES_LIMIT})`),
        before: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('Pagination cursor: postOrder from paging.nextBefore, e.g. 1024'),
        includePreBreak: z
          .boolean()
          .optional()
          .describe('Include messages from before the latest context break (default false)')
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false
      }
    },
    async (args) => {
      try {
        const params = new URLSearchParams();
        if (args.limit !== undefined) params.set('limit', String(args.limit));
        if (args.before !== undefined) params.set('before', String(args.before));
        if (args.includePreBreak) params.set('include_pre_break', 'true');
        const query = params.toString();
        const data = await client.getJson<RoomMessagesResponse>(
          `/api/chat-rooms/${encodeURIComponent(args.roomId)}/messages${query ? `?${query}` : ''}`
        );
        return textResult({
          messages: data.messages ?? [],
          paging: data.paging ?? null
        });
      } catch (cause) {
        return errorResult(cause);
      }
    }
  );

  server.registerTool(
    'ant_get_message',
    {
      title: 'Get one ANT message by id',
      description:
        'Resolve a message id to its persisted message row ' +
        '(GET /api/chat-rooms/messages/:messageId). The server applies the ' +
        'room read gate to the message\'s room, so private rooms do not leak.',
      inputSchema: {
        messageId: z.string().min(1).describe('Message id, e.g. "msg_abc123"')
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false
      }
    },
    async (args) => {
      try {
        const data = await client.getJson<MessageDetailResponse>(
          `/api/chat-rooms/messages/${encodeURIComponent(args.messageId)}`
        );
        return textResult({ message: data.message ?? null });
      } catch (cause) {
        return errorResult(cause);
      }
    }
  );

  server.registerTool(
    'ant_search_room_messages',
    {
      title: 'Search messages within one ANT chat room',
      description:
        'Full-text search within a single room ' +
        '(GET /api/chat-rooms/:roomId/search). Returns matches newest-first, ' +
        'capped to `limit`. By default only content since the latest context ' +
        'break is searched; set `allContent` to true to search full history.',
      inputSchema: {
        roomId: z.string().min(1).describe('Room id, e.g. "room_heroes"'),
        query: z.string().min(1).describe('Search text, e.g. "release blocker"'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_PAGE_LIMIT)
          .optional()
          .describe(`Max matches 1..${MAX_PAGE_LIMIT} (default ${DEFAULT_SEARCH_LIMIT})`),
        allContent: z
          .boolean()
          .optional()
          .describe('Search content from before the latest context break too (default false)')
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false
      }
    },
    async (args) => {
      try {
        const params = new URLSearchParams({ q: args.query });
        if (args.limit !== undefined) params.set('limit', String(args.limit));
        if (args.allContent) params.set('allContent', '1');
        const data = await client.getJson<RoomSearchResponse>(
          `/api/chat-rooms/${encodeURIComponent(args.roomId)}/search?${params.toString()}`
        );
        return textResult({
          matches: data.matches ?? [],
          allContent: data.allContent ?? false
        });
      } catch (cause) {
        return errorResult(cause);
      }
    }
  );

  server.registerTool(
    'ant_list_agents',
    {
      title: 'List ANT agents',
      description:
        'List registered agents (GET /api/agents), deduplicated by handle. ' +
        'Pass `roomId` to narrow to one room\'s agents. The server returns ' +
        'the full list; `limit`/`offset` page it client-side — follow ' +
        '`nextOffset` until it is null.',
      inputSchema: {
        roomId: z
          .string()
          .min(1)
          .optional()
          .describe('Narrow to one room, e.g. "room_heroes" — omit for all agents'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_PAGE_LIMIT)
          .optional()
          .describe(`Page size 1..${MAX_PAGE_LIMIT} (default ${DEFAULT_LIST_LIMIT})`),
        offset: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe('Pagination offset: pass nextOffset from the previous page (default 0)')
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false
      }
    },
    async (args) => {
      try {
        const params = new URLSearchParams();
        if (args.roomId) params.set('roomId', args.roomId);
        const query = params.toString();
        const data = await client.getJson<AgentsResponse>(`/api/agents${query ? `?${query}` : ''}`);
        const { page, total, nextOffset } = pageSlice(
          data.agents ?? [],
          args.offset ?? 0,
          args.limit ?? DEFAULT_LIST_LIMIT
        );
        return textResult({ agents: page, total, nextOffset });
      } catch (cause) {
        return errorResult(cause);
      }
    }
  );

  server.registerTool(
    'ant_list_plans',
    {
      title: 'List ANT plans',
      description:
        'List persisted plans (GET /api/plans) filtered by lifecycle `state` ' +
        '(default "active"). The server returns the full list; ' +
        '`limit`/`offset` page it client-side — follow `nextOffset` until it ' +
        'is null. Use ant_get_plan for one plan\'s detail.',
      inputSchema: {
        state: z
          .enum(['active', 'archived', 'deleted', 'all'])
          .optional()
          .describe('Lifecycle filter (default "active")'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_PAGE_LIMIT)
          .optional()
          .describe(`Page size 1..${MAX_PAGE_LIMIT} (default ${DEFAULT_LIST_LIMIT})`),
        offset: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe('Pagination offset: pass nextOffset from the previous page (default 0)')
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false
      }
    },
    async (args) => {
      try {
        const params = new URLSearchParams();
        if (args.state) params.set('state', args.state);
        const query = params.toString();
        const data = await client.getJson<PlansResponse>(`/api/plans${query ? `?${query}` : ''}`);
        const { page, total, nextOffset } = pageSlice(
          data.plans ?? [],
          args.offset ?? 0,
          args.limit ?? DEFAULT_LIST_LIMIT
        );
        return textResult({ plans: page, total, nextOffset });
      } catch (cause) {
        return errorResult(cause);
      }
    }
  );

  server.registerTool(
    'ant_get_plan',
    {
      title: 'Get one ANT plan',
      description:
        'Read one plan by id (GET /api/plans/:planId). Returns the plan ' +
        'record or a 404 error if the id is unknown. Use ant_list_plans to ' +
        'discover valid plan ids.',
      inputSchema: {
        planId: z.string().min(1).describe('Plan id, e.g. "antchat-rv1-2026-06-10"')
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false
      }
    },
    async (args) => {
      try {
        const data = await client.getJson<PlanDetailResponse>(
          `/api/plans/${encodeURIComponent(args.planId)}`
        );
        return textResult({ plan: data.plan ?? null });
      } catch (cause) {
        return errorResult(cause);
      }
    }
  );
}
