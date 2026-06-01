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

  it('badges a terminal-less agent remote via pty heartbeat even with no recent chat', () => {
    // The heartbeat-union: an agent working silently at a real pty (no chat)
    // still reads alive. The terminal exists in `terminals` + is mapped by a
    // membership, but has NO terminal_records row (the fresh-shell rebind gap),
    // so the fleet still sources it as terminal-less.
    const room = createChatRoom({ name: 'heroes', whoCreatedIt: '@seed' });
    seedTerminalLessAgent(room.id, '@working', 'Working');

    const nowMs = 1_000_000_000_000;
    const t = upsertTerminal({ pid: 999, pid_start: 'pst', name: 'working-pty' });
    const db = getIdentityDb();
    db.prepare(`UPDATE terminals SET last_pty_byte_at_ms = ? WHERE id = ?`).run(nowMs - 60_000, t.id);
    db.prepare(
      `INSERT INTO room_memberships (id, room_id, handle, terminal_id, created_at, revoked_at_ms)
       VALUES ('rm_working', ?, '@working', ?, ?, NULL)`
    ).run(room.id, t.id, nowMs);

    // terminal NOT in liveSessionIds + no terminal_records row → still terminal-less.
    const fleet = listFleetAgents(new Set(), nowMs);
    const working = fleet.find((a) => a.handle === '@working')!;
    expect(working.status?.state).toBe('remote');
  });

  it('ignores a revoked seat heartbeat (stale terminal cannot keep an agent alive)', () => {
    const room = createChatRoom({ name: 'heroes', whoCreatedIt: '@seed' });
    seedTerminalLessAgent(room.id, '@revoked', 'Revoked');

    const nowMs = 1_000_000_000_000;
    const t = upsertTerminal({ pid: 998, pid_start: 'pst', name: 'revoked-pty' });
    const db = getIdentityDb();
    db.prepare(`UPDATE terminals SET last_pty_byte_at_ms = ? WHERE id = ?`).run(nowMs - 60_000, t.id);
    db.prepare(
      `INSERT INTO room_memberships (id, room_id, handle, terminal_id, created_at, revoked_at_ms)
       VALUES ('rm_revoked', ?, '@revoked', ?, ?, ?)`
    ).run(room.id, t.id, nowMs, nowMs - 1000);

    const fleet = listFleetAgents(new Set(), nowMs);
    const revoked = fleet.find((a) => a.handle === '@revoked')!;
    expect(revoked.status?.state).toBe('offline');
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
