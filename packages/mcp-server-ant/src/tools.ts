/**
 * MCP tool definitions for `@jktfe/mcp-server-ant`.
 *
 * Three tools, all backed by HTTP requests against the local ANT OSS
 * daemon (default `http://127.0.0.1:6174`):
 *
 *   - ant_get_pending_mentions  (long-poll for new bound-handle mentions)
 *   - ant_post_message          (post into a chat room)
 *   - ant_list_rooms            (list visible chat rooms)
 *
 * The pending-mentions tool is intentionally the only "blocking" call.
 * The wait happens server-side on `/api/me/mentions?wait=N`, so the MCP
 * server consumes ~zero CPU while parked on the long-poll. No timers,
 * no in-process retry loops — idle MCP server == idle resource use.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AntClient, AntClientError } from './ant-client.js';

// Hard cap for `waitSeconds` matches the server's `/api/me/mentions`
// contract (0..60). Server clamps anyway; we clamp client-side too so
// tool callers get a clear error before a doomed round-trip.
const MAX_WAIT_SECONDS = 60;
const DEFAULT_WAIT_SECONDS = 25;

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

function errorResult(err: unknown) {
  const message =
    err instanceof AntClientError
      ? `${err.message}${err.bodyText ? `: ${err.bodyText.slice(0, 500)}` : ''}`
      : err instanceof Error
        ? err.message
        : String(err);
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

/**
 * Register the three ANT tools on the given MCP server using the supplied
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
        roomId: z.string().min(1),
        body: z.string().min(1),
        parentMessageId: z.string().min(1).optional()
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
      inputSchema: {}
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
}
