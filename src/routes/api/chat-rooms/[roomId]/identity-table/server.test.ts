/**
 * Endpoint tests for GET /api/chat-rooms/:roomId/identity-table.
 *
 * Covers the agent-side lookup contract: bare names ("the Claude") in body
 * text → which PID / handle / aliases? Slice 4 of PID-as-identity.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { GET } from './+server';
import {
  createChatRoom,
  inviteAgentToRoom,
  resetChatRoomStoreForTests
} from '$lib/server/chatRoomStore';
import {
  setRoomAlias,
  resetChatRoomAliasStoreForTests
} from '$lib/server/chatRoomAliasStore';
import { addMembership } from '$lib/server/roomMembershipsStore';
import { upsertTerminal, updatePaneTarget } from '$lib/server/terminalsStore';

function eventFor(roomId: string) {
  const url = new URL(`http://localhost/api/chat-rooms/${roomId}/identity-table`);
  return {
    request: new Request(url.toString()),
    params: { roomId },
    url
  } as unknown as Parameters<typeof GET>[0];
}

async function runHandler(event: Parameters<typeof GET>[0]): Promise<Response> {
  try {
    return (await GET(event)) as Response;
  } catch (thrownByHandler) {
    if (thrownByHandler instanceof Response) return thrownByHandler;
    const httpFailure = thrownByHandler as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrownByHandler;
  }
}

describe('GET /api/chat-rooms/:roomId/identity-table', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetChatRoomAliasStoreForTests();
  });

  it('returns 404 for an unknown room', async () => {
    const response = await runHandler(eventFor('doesnotexist'));
    expect(response.status).toBe(404);
  });

  it('returns each member with handle, kind, and (empty) aliases when none are set', async () => {
    const room = createChatRoom({ name: 'identity-basic', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@evolveantcodex' });

    const response = await runHandler(eventFor(room.id));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { entries: Array<{ handle: string; aliases: string[]; kind: string; pid: number | null }> };

    const handles = body.entries.map((entry) => entry.handle);
    expect(handles).toContain('@you');
    expect(handles).toContain('@evolveantcodex');

    const youEntry = body.entries.find((entry) => entry.handle === '@you');
    expect(youEntry?.kind).toBe('human');
    expect(youEntry?.aliases).toEqual([]);
    expect(youEntry?.pid).toBeNull(); // humans have no terminal PID

    const codexEntry = body.entries.find((entry) => entry.handle === '@evolveantcodex');
    expect(codexEntry?.kind).toBe('agent');
    expect(codexEntry?.aliases).toEqual([]);
  });

  it('exposes stacked aliases newest-first AND surfaces the PID + tmux pane of the terminal-backed member', async () => {
    const room = createChatRoom({ name: 'identity-rich', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@evolveantcodex' });

    const codexTerminal = upsertTerminal({
      pid: 47238,
      pid_start: 'p47238',
      name: 'identity-rich-codex'
    });
    updatePaneTarget(codexTerminal.id, '%antv4:codex.0', 'codex_cli');
    addMembership({
      room_id: room.id,
      handle: '@evolveantcodex',
      terminal_id: codexTerminal.id
    });

    // Stack three aliases — newest last to set, expected newest first in output.
    setRoomAlias({ roomId: room.id, globalHandle: '@evolveantcodex', newAlias: '@cdx' });
    setRoomAlias({ roomId: room.id, globalHandle: '@evolveantcodex', newAlias: '@codex-mac' });
    setRoomAlias({ roomId: room.id, globalHandle: '@evolveantcodex', newAlias: '@the-friendly-codex' });

    const response = await runHandler(eventFor(room.id));
    const body = (await response.json()) as {
      entries: Array<{
        handle: string;
        defaultDisplayName: string;
        aliases: string[];
        pid: number | null;
        tmuxPane: string | null;
        agentKind: string | null;
      }>;
    };

    const codexEntry = body.entries.find((entry) => entry.handle === '@evolveantcodex');
    expect(codexEntry).toBeDefined();
    expect(codexEntry?.pid).toBe(47238);
    expect(codexEntry?.tmuxPane).toBe('%antv4:codex.0');
    expect(codexEntry?.agentKind).toBe('codex_cli');
    expect(codexEntry?.aliases).toEqual(['@the-friendly-codex', '@codex-mac', '@cdx']);
    expect(codexEntry?.defaultDisplayName).toBe('@the-friendly-codex');
  });

  it('default display name falls back to the global handle when no alias has been set', async () => {
    const room = createChatRoom({ name: 'identity-fallback', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@evolveantclaude' });

    const response = await runHandler(eventFor(room.id));
    const body = (await response.json()) as { entries: Array<{ handle: string; defaultDisplayName: string }> };
    const claudeEntry = body.entries.find((entry) => entry.handle === '@evolveantclaude');
    // Falls back to displayName (chatRoomStore seeds it to the handle for invited agents).
    expect(claudeEntry?.defaultDisplayName === '@evolveantclaude' || claudeEntry?.defaultDisplayName === 'evolveantclaude').toBe(true);
  });
});
