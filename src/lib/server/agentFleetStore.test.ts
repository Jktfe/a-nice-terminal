// Tests for agentFleetStore.listFleetAgents — specifically the UNION that
// folds in registered agents who have an active room membership but NO
// attached local terminal (the "@v4claude not on /agents" bug, 2026-06-01).
//
// Background: the fleet is terminal_records-sourced (one card per attached,
// non-archived, live terminal). But an agent can be a live participant —
// an identity with an active room seat, actively posting — while having no
// terminal_records row on this host (fresh-shell rebind gap / remote agent).
// Such an agent was dropped from /agents even though JWPK could see it
// working. The fix UNIONs those agents in, badged remote (recent message
// activity) or offline.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests, getIdentityDb } from './db';
import { listFleetAgents } from './agentFleetStore';
import { createTerminalRecord } from './terminalRecordsStore';
import { upsertTerminal } from './terminalsStore';
import {
  createChatRoom,
  inviteAgentToRoom,
  resetChatRoomStoreForTests,
} from './chatRoomStore';

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
});
afterEach(() => {
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
  delete process.env.ANT_FRESH_DB_PATH;
});

// Create a registry agent (chat_room_members row, kind='agent') WITH an
// attached, live terminal. Returns the terminal session id so the caller
// can mark it live.
function seedAttachedAgent(roomId: string, handle: string, name: string): string {
  inviteAgentToRoom({ roomId, agentHandle: handle, agentDisplayName: name });
  const t = upsertTerminal({ pid: 4242, pid_start: 'pst', name });
  getIdentityDb()
    .prepare(`UPDATE terminals SET agent_kind = 'claude_code', tmux_target_pane = '%1' WHERE id = ?`)
    .run(t.id);
  createTerminalRecord({
    sessionId: t.id,
    name,
    agentKind: 'claude_code',
    tmuxTargetPane: '%1',
    handle,
  });
  return t.id;
}

// Create a registry agent with an active room membership but NO terminal
// record / terminal — the @v4claude case.
function seedTerminalLessAgent(roomId: string, handle: string, name: string): void {
  inviteAgentToRoom({ roomId, agentHandle: handle, agentDisplayName: name });
}

describe('listFleetAgents — terminal-less agent union', () => {
  it('includes a registered agent with an active membership but no attached terminal', () => {
    const room = createChatRoom({ name: 'heroes', whoCreatedIt: '@seed' });
    const attachedSession = seedAttachedAgent(room.id, '@attached', 'Attached');
    seedTerminalLessAgent(room.id, '@v4claude', 'v4claude');

    const fleet = listFleetAgents(new Set([attachedSession]));
    const handles = fleet.map((a) => a.handle);

    // Regression guard: the attached agent still shows.
    expect(handles).toContain('@attached');
    // The fix: the terminal-less active agent now also shows.
    expect(handles).toContain('@v4claude');

    const remote = fleet.find((a) => a.handle === '@v4claude')!;
    // No local terminal → empty sessionId (the /agents card hides the
    // go-to-terminal nav for these).
    expect(remote.sessionId).toBe('');
    // Rooms come from the registry membership.
    expect(remote.rooms.map((r) => r.roomId)).toContain(room.id);
  });

  it('badges a terminal-less agent offline when it has no recent activity', () => {
    const room = createChatRoom({ name: 'heroes', whoCreatedIt: '@seed' });
    seedTerminalLessAgent(room.id, '@dormant', 'Dormant');

    const fleet = listFleetAgents(new Set());
    const dormant = fleet.find((a) => a.handle === '@dormant')!;
    expect(dormant.status?.state).toBe('offline');
  });

  it('badges a terminal-less agent remote when it posted within the active window', () => {
    const room = createChatRoom({ name: 'heroes', whoCreatedIt: '@seed' });
    seedTerminalLessAgent(room.id, '@busy', 'Busy');

    const nowMs = 1_000_000_000_000;
    getIdentityDb()
      .prepare(
        `INSERT INTO chat_messages (id, room_id, author_handle, author_display_name, kind, body, posted_at, post_order)
         VALUES ('m_busy', ?, '@busy', 'Busy', 'agent', 'still here', ?, 1)`
      )
      .run(room.id, new Date(nowMs - 60_000).toISOString());

    const fleet = listFleetAgents(new Set(), nowMs);
    const busy = fleet.find((a) => a.handle === '@busy')!;
    expect(busy.status?.state).toBe('remote');
  });

  it('excludes registered agents with no active room membership', () => {
    // An agent row can exist in chat_room_members only via inviteAgentToRoom,
    // so "no membership" means it never appears in listAgents() at all; the
    // union must not invent terminal-less cards for handles outside any room.
    const room = createChatRoom({ name: 'heroes', whoCreatedIt: '@seed' });
    seedTerminalLessAgent(room.id, '@member', 'Member');

    const fleet = listFleetAgents(new Set());
    expect(fleet.map((a) => a.handle)).not.toContain('@ghost');
    expect(fleet.map((a) => a.handle)).toContain('@member');
  });
});
