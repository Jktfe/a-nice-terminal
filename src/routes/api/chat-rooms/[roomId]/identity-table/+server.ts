/**
 * GET /api/chat-rooms/:roomId/identity-table
 *   → 200 { entries: IdentityTableEntry[] }
 *   → 404 unknown room
 *
 * PID-as-identity model JWPK msg_n2cyrel4u5 (2026-05-21). Each entry maps a
 * canonical global handle to:
 *   - its immutable identity (PID for terminal members; null for humans)
 *   - the default display name (most-recent alias, or the global handle when
 *     no alias is set)
 *   - every alias stacked on the handle in this room (newest first)
 *   - tmux pane and agent_kind when present, so an agent receiving a body
 *     like "Yo Codex, ask the Claude to do this" can look up which PID is
 *     "the Claude" without having to guess from the chat text.
 *
 * Slice 4 of the PID-as-identity work. Read-only — no auth gate beyond the
 * room-existence check; lookup table is the same information the room
 * member list already exposes, just denormalised for agent consumption.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { listMembershipsForRoom } from '$lib/server/roomMembershipsStore';
import { getTerminalById } from '$lib/server/terminalsStore';
import {
  listAliasesForHandleInRoom,
  findAliasForHandleInRoom
} from '$lib/server/chatRoomAliasStore';

export type IdentityTableEntry = {
  handle: string;
  defaultDisplayName: string;
  aliases: string[];
  kind: 'human' | 'agent';
  pid: number | null;
  agentKind: string | null;
  tmuxPane: string | null;
};

export const GET: RequestHandler = ({ params }) => {
  const room = findChatRoomById(params.roomId);
  if (!room) throw error(404, 'Room not found.');

  // Combine the in-mem chat-room members (carries kind / displayName for
  // humans) with the SQLite room_memberships rows (carries terminal_id /
  // PID / tmux pane for terminal-backed members). Handle is the join key.
  const membershipRows = listMembershipsForRoom(params.roomId);
  const terminalByHandle = new Map<string, ReturnType<typeof getTerminalById>>();
  for (const row of membershipRows) {
    terminalByHandle.set(row.handle, getTerminalById(row.terminal_id));
  }

  const entries: IdentityTableEntry[] = room.members.map((member) => {
    const terminal = terminalByHandle.get(member.handle) ?? null;
    const aliases = listAliasesForHandleInRoom(params.roomId, member.handle)
      .map((entry) => entry.alias);
    const mostRecentAlias = findAliasForHandleInRoom(params.roomId, member.handle);
    return {
      handle: member.handle,
      defaultDisplayName: mostRecentAlias ?? member.displayName ?? member.handle,
      aliases,
      kind: member.kind,
      pid: terminal?.pid ?? null,
      agentKind: terminal?.agent_kind ?? null,
      tmuxPane: terminal?.tmux_target_pane ?? null
    };
  });

  return json({ entries });
};
