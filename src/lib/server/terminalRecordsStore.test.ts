import { describe, it, expect, beforeEach } from 'vitest';
import {
  createTerminalRecord, getTerminalRecord, updateTerminalRecord, listTerminalRecords, deleteTerminalRecord,
  parseAllowlist, serializeAllowlist, listKnownHandles, listAllPickableHandles, deriveHandle,
  findTerminalRecordByHandle, listLiveTerminalRecords
} from './terminalRecordsStore';
import { getIdentityDb } from './db';
import { createChatRoom, archiveChatRoom, softDeleteChatRoom } from './chatRoomStore';
import { listLinkedTerminalRowsForRoom, getLinkedTerminalRowBySessionId, isLinkedChatRoom } from './linkedRoomTerminalLookup';

describe('terminalRecordsStore — agent_kind round-trip (T2b autodetect-wiring)', () => {
  beforeEach(() => {
    // VITEST-isolated DB per worker via db.ts; just clear the table.
    try { getIdentityDb().prepare(`DELETE FROM terminal_records`).run(); } catch { /* schema not applied */ }
  });

  it('createTerminalRecord persists agentKind + getTerminalRecord reads it back', () => {
    createTerminalRecord({ sessionId: 't_smoke_1', name: 'smoke-1', agentKind: 'claude-code' });
    const got = getTerminalRecord('t_smoke_1');
    expect(got).not.toBeNull();
    expect(got?.agent_kind).toBe('claude-code');
  });

  it('listTerminalRecords includes agent_kind on each row', () => {
    createTerminalRecord({ sessionId: 't_smoke_2', name: 'smoke-2', agentKind: 'codex' });
    const list = listTerminalRecords();
    const found = list.find((r) => r.session_id === 't_smoke_2');
    expect(found?.agent_kind).toBe('codex');
  });

  it('updateTerminalRecord patches agentKind without touching other fields', () => {
    createTerminalRecord({ sessionId: 't_smoke_3', name: 'smoke-3', agentKind: null });
    const updated = updateTerminalRecord('t_smoke_3', { agentKind: 'claude-code' });
    expect(updated?.agent_kind).toBe('claude-code');
    expect(updated?.name).toBe('smoke-3');
    deleteTerminalRecord('t_smoke_3');
  });

  it('createTerminalRecord with no agentKind defaults to null', () => {
    createTerminalRecord({ sessionId: 't_smoke_4', name: 'smoke-4' });
    expect(getTerminalRecord('t_smoke_4')?.agent_kind).toBeNull();
  });

  it('createTerminalRecord auto-populates tmux_target_pane as <sessionId>:0.0 (T1a)', () => {
    createTerminalRecord({ sessionId: 't_pane_5', name: 'pane-5' });
    expect(getTerminalRecord('t_pane_5')?.tmux_target_pane).toBe('t_pane_5:0.0');
  });

  it('createTerminalRecord honours explicit tmuxTargetPane override', () => {
    createTerminalRecord({ sessionId: 't_pane_6', name: 'pane-6', tmuxTargetPane: '%14' });
    expect(getTerminalRecord('t_pane_6')?.tmux_target_pane).toBe('%14');
  });

  it('createTerminalRecord defaults linked_chat_room_id to null (T1b)', () => {
    createTerminalRecord({ sessionId: 't_link_7', name: 'link-7' });
    expect(getTerminalRecord('t_link_7')?.linked_chat_room_id).toBeNull();
  });

  it('updateTerminalRecord patches linked_chat_room_id', () => {
    createTerminalRecord({ sessionId: 't_link_8', name: 'link-8' });
    const updated = updateTerminalRecord('t_link_8', { linkedChatRoomId: 'room_xyz' });
    expect(updated?.linked_chat_room_id).toBe('room_xyz');
    deleteTerminalRecord('t_link_8');
  });

  it('createTerminalRecord persists created_by + allowlist (S1)', () => {
    createTerminalRecord({
      sessionId: 't_id_9', name: 'id-9',
      createdBy: '@you', allowlist: ['@coordinator', '@claude2']
    });
    const got = getTerminalRecord('t_id_9');
    expect(got?.created_by).toBe('@you');
    expect(parseAllowlist(got?.allowlist ?? null)).toEqual(['@coordinator', '@claude2']);
  });

  it('createTerminalRecord with no allowlist persists null', () => {
    createTerminalRecord({ sessionId: 't_id_10', name: 'id-10', createdBy: '@you' });
    expect(getTerminalRecord('t_id_10')?.allowlist).toBeNull();
  });

  it('updateTerminalRecord patches allowlist (round-trip)', () => {
    createTerminalRecord({ sessionId: 't_id_11', name: 'id-11', createdBy: '@you' });
    const updated = updateTerminalRecord('t_id_11', { allowlist: ['@new'] });
    expect(parseAllowlist(updated?.allowlist ?? null)).toEqual(['@new']);
    deleteTerminalRecord('t_id_11');
  });

  it('serializeAllowlist returns null for empty array', () => {
    expect(serializeAllowlist([])).toBeNull();
    expect(serializeAllowlist(null)).toBeNull();
    expect(serializeAllowlist(['@a'])).toBe('["@a"]');
  });

  it('createTerminalRecord persists handle (S7)', () => {
    createTerminalRecord({ sessionId: 't_h_12', name: 'h-12', handle: '@worker' });
    expect(getTerminalRecord('t_h_12')?.handle).toBe('@worker');
  });

  it('updateTerminalRecord patches handle round-trip', () => {
    createTerminalRecord({ sessionId: 't_h_13', name: 'h-13' });
    expect(getTerminalRecord('t_h_13')?.handle).toBeNull();
    const updated = updateTerminalRecord('t_h_13', { handle: '@later' });
    expect(updated?.handle).toBe('@later');
    deleteTerminalRecord('t_h_13');
  });

  it('listKnownHandles returns distinct sorted non-null handles', () => {
    createTerminalRecord({ sessionId: 't_h_14', name: 'h-14', handle: '@bob' });
    createTerminalRecord({ sessionId: 't_h_15', name: 'h-15', handle: '@alice' });
    createTerminalRecord({ sessionId: 't_h_16', name: 'h-16', handle: '@bob' });
    createTerminalRecord({ sessionId: 't_h_17', name: 'h-17' }); // null handle
    const handles = listKnownHandles();
    expect(handles).toContain('@alice');
    expect(handles).toContain('@bob');
    expect(handles.filter((h) => h === '@bob')).toHaveLength(1); // distinct
    expect(handles).not.toContain(null);
    // sorted
    expect([...handles].sort()).toEqual(handles);
  });

  // PICKER-SAME-SET (2026-05-14, JWPK gap):
  it('deriveHandle returns explicit handle when set', () => {
    expect(deriveHandle({ handle: '@worker', name: 'Whatever' })).toBe('@worker');
  });

  it('deriveHandle slugs the name when handle is null', () => {
    expect(deriveHandle({ handle: null, name: 'Terminal 1' })).toBe('@terminal-1');
    expect(deriveHandle({ handle: null, name: 'Build Lane' })).toBe('@build-lane');
    expect(deriveHandle({ handle: null, name: 'Foo!Bar Baz' })).toBe('@foo-bar-baz');
  });

  it('deriveHandle falls back to @terminal when name is symbol-only', () => {
    expect(deriveHandle({ handle: null, name: '!!!' })).toBe('@terminal');
  });

  it('listAllPickableHandles unions explicit + derived across ALL records', () => {
    createTerminalRecord({ sessionId: 't_p_18', name: 'Build Lane', handle: '@worker' });
    createTerminalRecord({ sessionId: 't_p_19', name: 'Test Lane' }); // derived → @test-lane
    createTerminalRecord({ sessionId: 't_p_20', name: 'Doc Lane', handle: null });
    const all = listAllPickableHandles();
    expect(all).toContain('@worker');       // explicit
    expect(all).toContain('@test-lane');    // derived
    expect(all).toContain('@doc-lane');     // derived
    // sorted
    expect([...all].sort()).toEqual(all);
  });

  // INVITE-VALIDATE (2026-05-15, JWPK):
  it('findTerminalRecordByHandle matches explicit handle (with @ and without)', () => {
    createTerminalRecord({ sessionId: 't_v_1', name: 'unused-name', handle: '@worker' });
    expect(findTerminalRecordByHandle('@worker')?.session_id).toBe('t_v_1');
    expect(findTerminalRecordByHandle('worker')?.session_id).toBe('t_v_1');
  });

  it('findTerminalRecordByHandle matches name-derived handle (@slug)', () => {
    createTerminalRecord({ sessionId: 't_v_2', name: 'Build Lane', handle: null });
    expect(findTerminalRecordByHandle('@build-lane')?.session_id).toBe('t_v_2');
    expect(findTerminalRecordByHandle('build-lane')?.session_id).toBe('t_v_2');
  });

  it('findTerminalRecordByHandle returns null for unknown handle', () => {
    createTerminalRecord({ sessionId: 't_v_3', name: 'Real Term', handle: '@real' });
    expect(findTerminalRecordByHandle('@ghost')).toBeNull();
    expect(findTerminalRecordByHandle('@manual-test-bot')).toBeNull();
  });

  it('findTerminalRecordByHandle rejects empty / whitespace-only input', () => {
    createTerminalRecord({ sessionId: 't_v_4', name: 'Anything', handle: '@x' });
    expect(findTerminalRecordByHandle('')).toBeNull();
    expect(findTerminalRecordByHandle('   ')).toBeNull();
  });

  // JWPK msg_wlvguvfvqu / msg_8390722mjh antV4 2026-05-27: pane-binding
  // supersession. A recycled tmux pane must NOT deliver the prior
  // agent's room subscriptions. Vera (codex --yolo) spawned in the
  // same pane as @xenocc and saw a xenoChat message before having any
  // membership. Insert/update supersession + reader filters fix it.
  describe('pane-binding supersession', () => {
    beforeEach(() => {
      try { getIdentityDb().prepare(`DELETE FROM chat_rooms`).run(); } catch { /* schema not applied */ }
    });

    it('PS1: inserting a new record on a pane supersedes the prior record on that pane', () => {
      const room = createChatRoom({ name: 'xenoChat', whoCreatedIt: '@you' });
      createTerminalRecord({
        sessionId: 't_ps_1', name: 'prior-agent',
        tmuxTargetPane: 'pane-%5', linkedChatRoomId: room.id, handle: '@xenocc'
      });
      // Vera spawns in the same pane:
      createTerminalRecord({
        sessionId: 't_ps_2', name: 'new-agent',
        tmuxTargetPane: 'pane-%5', handle: '@vera'
      });
      const prior = getTerminalRecord('t_ps_1');
      const newer = getTerminalRecord('t_ps_2');
      expect(prior?.superseded_at_ms).not.toBeNull();
      expect(newer?.superseded_at_ms).toBeNull();
    });

    it('PS2: superseded records do NOT appear in listLinkedTerminalRowsForRoom (the primary leak surface)', () => {
      const room = createChatRoom({ name: 'xenoChat', whoCreatedIt: '@you' });
      createTerminalRecord({
        sessionId: 't_ps_3', name: 'prior', tmuxTargetPane: 'pane-%5',
        linkedChatRoomId: room.id, handle: '@xenocc'
      });
      // Pre-supersession: prior shows up.
      expect(listLinkedTerminalRowsForRoom(room.id).map((r) => r.id)).toContain('t_ps_3');
      // Vera claims the pane:
      createTerminalRecord({
        sessionId: 't_ps_4', name: 'vera', tmuxTargetPane: 'pane-%5', handle: '@vera'
      });
      // Post-supersession: prior is GONE from the linked-room walker.
      const linked = listLinkedTerminalRowsForRoom(room.id).map((r) => r.id);
      expect(linked).not.toContain('t_ps_3');
    });

    it('PS3: superseded records also drop from getLinkedTerminalRowBySessionId', () => {
      createTerminalRecord({
        sessionId: 't_ps_5', name: 'prior', tmuxTargetPane: 'pane-%5', handle: '@xenocc'
      });
      expect(getLinkedTerminalRowBySessionId('t_ps_5')).not.toBeNull();
      createTerminalRecord({
        sessionId: 't_ps_6', name: 'next', tmuxTargetPane: 'pane-%5', handle: '@vera'
      });
      expect(getLinkedTerminalRowBySessionId('t_ps_5')).toBeNull();
      expect(getLinkedTerminalRowBySessionId('t_ps_6')).not.toBeNull();
    });

    it('PS4: isLinkedChatRoom returns false when only superseded records point at the room', () => {
      const room = createChatRoom({ name: 'orphaned', whoCreatedIt: '@you' });
      createTerminalRecord({
        sessionId: 't_ps_7', name: 'a', tmuxTargetPane: 'pane-%5',
        linkedChatRoomId: room.id, handle: '@a'
      });
      expect(isLinkedChatRoom(room.id)).toBe(true);
      // Same pane claimed by another agent with a DIFFERENT linked room:
      const room2 = createChatRoom({ name: 'fresh', whoCreatedIt: '@you' });
      createTerminalRecord({
        sessionId: 't_ps_8', name: 'b', tmuxTargetPane: 'pane-%5',
        linkedChatRoomId: room2.id, handle: '@b'
      });
      // Original room now has only a superseded record → no longer "linked".
      expect(isLinkedChatRoom(room.id)).toBe(false);
      // New room IS linked via the live record.
      expect(isLinkedChatRoom(room2.id)).toBe(true);
    });

    it('PS5: listLiveTerminalRecords excludes superseded rows (picker fix)', () => {
      createTerminalRecord({ sessionId: 't_ps_9', name: 'a', tmuxTargetPane: 'pane-%5', handle: '@a' });
      createTerminalRecord({ sessionId: 't_ps_10', name: 'b', tmuxTargetPane: 'pane-%5', handle: '@b' });
      const live = listLiveTerminalRecords();
      expect(live.find((r) => r.session_id === 't_ps_9')).toBeUndefined();
      expect(live.find((r) => r.session_id === 't_ps_10')).toBeDefined();
    });

    it('PS6: listAllPickableHandles + listKnownHandles exclude superseded handles', () => {
      createTerminalRecord({ sessionId: 't_ps_11', name: 'a', tmuxTargetPane: 'pane-%5', handle: '@gone' });
      createTerminalRecord({ sessionId: 't_ps_12', name: 'b', tmuxTargetPane: 'pane-%5', handle: '@here' });
      const picker = listAllPickableHandles();
      expect(picker).not.toContain('@gone');
      expect(picker).toContain('@here');
      const known = listKnownHandles();
      expect(known).not.toContain('@gone');
      expect(known).toContain('@here');
    });

    it('PS7: listTerminalRecords (audit-shape) still returns superseded rows for history', () => {
      createTerminalRecord({ sessionId: 't_ps_13', name: 'a', tmuxTargetPane: 'pane-%5', handle: '@a' });
      createTerminalRecord({ sessionId: 't_ps_14', name: 'b', tmuxTargetPane: 'pane-%5', handle: '@b' });
      const all = listTerminalRecords();
      const ids = all.map((r) => r.session_id);
      expect(ids).toContain('t_ps_13'); // superseded but visible to audit
      expect(ids).toContain('t_ps_14');
    });

    it('PS8: re-registering the SAME session on its own pane does not self-supersede', () => {
      createTerminalRecord({ sessionId: 't_ps_15', name: 'a', tmuxTargetPane: 'pane-%5', handle: '@a' });
      // Update the same record (e.g. handle rename) — pane unchanged.
      updateTerminalRecord('t_ps_15', { handle: '@a-renamed' });
      const record = getTerminalRecord('t_ps_15');
      expect(record?.superseded_at_ms).toBeNull();
      expect(record?.handle).toBe('@a-renamed');
    });

    it('PS9: updateTerminalRecord moving to a NEW pane supersedes whoever was there', () => {
      createTerminalRecord({ sessionId: 't_ps_16', name: 'occupant', tmuxTargetPane: 'pane-target', handle: '@occupant' });
      createTerminalRecord({ sessionId: 't_ps_17', name: 'mover', tmuxTargetPane: 'pane-original', handle: '@mover' });
      // Mover moves to pane-target → occupant gets superseded.
      updateTerminalRecord('t_ps_17', { tmuxTargetPane: 'pane-target' });
      const occupant = getTerminalRecord('t_ps_16');
      const mover = getTerminalRecord('t_ps_17');
      expect(occupant?.superseded_at_ms).not.toBeNull();
      expect(mover?.superseded_at_ms).toBeNull();
    });

    it('PS10: NULL tmux_target_pane records do NOT supersede each other (no pane to share)', () => {
      createTerminalRecord({ sessionId: 't_ps_18', name: 'a', tmuxTargetPane: null, handle: '@a' });
      createTerminalRecord({ sessionId: 't_ps_19', name: 'b', tmuxTargetPane: null, handle: '@b' });
      // Note: T1a default kicks in if tmuxTargetPane is undefined, but
      // we passed explicit null. Both rows should remain unsuperseded.
      expect(getTerminalRecord('t_ps_18')?.superseded_at_ms).toBeNull();
      expect(getTerminalRecord('t_ps_19')?.superseded_at_ms).toBeNull();
    });
  });
});
