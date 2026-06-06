import { beforeEach, describe, expect, it } from 'vitest';
import {
  createChatRoom,
  inviteAgentToRoom,
  resetChatRoomStoreForTests
} from './chatRoomStore';
import { createTerminalRecord } from './terminalRecordsStore';
import { backfillHumanInboxes } from './humanInboxBackfill';
import { inboxRoomIdFor } from './humanInboxRoomStore';
import { getIdentityDb } from './db';

function inboxMembers(humanHandle: string): string[] {
  const db = getIdentityDb();
  const inboxId = inboxRoomIdFor(humanHandle);
  return (
    db.prepare(`SELECT handle FROM chat_room_members WHERE room_id = ? ORDER BY handle`)
      .all(inboxId) as Array<{ handle: string }>
  ).map((row) => row.handle);
}

describe('humanInboxBackfill', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    getIdentityDb().prepare(`DELETE FROM terminal_records`).run();
  });

  it('counts legacy humans and edges without recreating retired hidden inbox rows', () => {
    // Set up state WITHOUT calling the live hooks (simulate pre-backfill
    // legacy data). Direct SQL inserts of members + a terminal record.
    const db = getIdentityDb();
    db.prepare(`INSERT INTO chat_rooms (id, name, summary, attention_state, last_update,
      when_it_was_created, who_created_it, creation_order) VALUES
      ('r-legacy', 'legacy', '', 'ready', 'now', 'now', '@legacy-human', 1)`).run();
    db.prepare(`INSERT INTO chat_room_members
      (id, room_id, handle, display_name, display_color, display_icon,
       display_background_style, joined_at, kind)
      VALUES
      ('m1', 'r-legacy', '@legacy-human', '@legacy-human', '#000', 'L', 'card', 'now', 'human'),
      ('m2', 'r-legacy', '@legacy-agent', '@legacy-agent', '#111', 'A', 'transparent', 'now', 'agent')`)
      .run();
    db.prepare(`INSERT INTO terminal_records
      (session_id, name, auto_forward_room_id, auto_forward_chat, agent_kind,
       tmux_target_pane, linked_chat_room_id, created_by, allowlist, handle,
       created_at_ms, updated_at_ms)
      VALUES
      ('t-legacy', 'owned-by-legacy-human', NULL, 1, NULL, NULL, NULL,
       '@legacy-human', NULL, '@owned-by-legacy-human', 100, 100)`).run();

    // Pre-backfill: no inbox rooms exist.
    expect(inboxMembers('@legacy-human')).toEqual([]);

    const result = backfillHumanInboxes();
    expect(result.humansSeeded).toBeGreaterThanOrEqual(1);
    expect(result.edgesEvaluated).toBeGreaterThanOrEqual(2);

    // Hidden inbox rooms are retired; backfill still reports the legacy
    // humans/edges it examined, but does not recreate the old carrier rows.
    const members = inboxMembers('@legacy-human');
    expect(members).toEqual([]);
  });

  it('is idempotent — running twice produces the same membership snapshot', () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@codex' });
    const first = backfillHumanInboxes();
    const second = backfillHumanInboxes();
    expect(inboxMembers('@you')).toEqual([]);
    // Idempotent — both calls return the same humansSeeded count.
    expect(first.humansSeeded).toBe(second.humansSeeded);
  });

  it('no-op safely on an empty DB', () => {
    const result = backfillHumanInboxes();
    expect(result.humansSeeded).toBe(0);
    expect(result.edgesEvaluated).toBe(0);
  });
});
