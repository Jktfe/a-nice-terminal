import { describe, it, expect, beforeEach } from 'vitest';
import {
  createTerminalRecord, getTerminalRecord, updateTerminalRecord, listTerminalRecords, deleteTerminalRecord,
  parseAllowlist, serializeAllowlist, listKnownHandles, listAllPickableHandles, deriveHandle,
  findTerminalRecordByHandle, listLiveTerminalRecords
} from './terminalRecordsStore';
import { getIdentityDb } from './db';
import { createChatRoom, archiveChatRoom, softDeleteChatRoom } from './chatRoomStore';

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

  // JWPK msg_oqks7iixre 2026-05-27 antV4: the "Invite an agent" picker was
  // offering agents whose linked chat was archived. Filtered set must
  // drop those without dropping bare-pane records (no linked room).
  describe('listLiveTerminalRecords + picker-handles archive filter', () => {
    beforeEach(() => {
      try { getIdentityDb().prepare(`DELETE FROM chat_rooms`).run(); } catch { /* schema not applied */ }
    });

    it('AR1: drops a terminal whose linked chat is archived', () => {
      const room = createChatRoom({ name: 'archive-me', whoCreatedIt: '@you' });
      createTerminalRecord({ sessionId: 't_ar_1', name: 'live-agent', handle: '@live', linkedChatRoomId: room.id });
      createTerminalRecord({ sessionId: 't_ar_2', name: 'dead-agent', handle: '@dead', linkedChatRoomId: room.id });
      archiveChatRoom(room.id);
      // Both terminals point at the now-archived room → both excluded.
      const live = listLiveTerminalRecords();
      expect(live.find((r) => r.session_id === 't_ar_1')).toBeUndefined();
      expect(live.find((r) => r.session_id === 't_ar_2')).toBeUndefined();
      const handles = listAllPickableHandles();
      expect(handles).not.toContain('@live');
      expect(handles).not.toContain('@dead');
    });

    it('AR2: drops a terminal whose linked chat is soft-deleted', () => {
      const room = createChatRoom({ name: 'delete-me', whoCreatedIt: '@you' });
      createTerminalRecord({ sessionId: 't_ar_3', name: 'orphan-agent', handle: '@orphan', linkedChatRoomId: room.id });
      softDeleteChatRoom(room.id);
      expect(listLiveTerminalRecords().find((r) => r.session_id === 't_ar_3')).toBeUndefined();
      expect(listAllPickableHandles()).not.toContain('@orphan');
    });

    it('AR3: keeps a terminal whose linked chat is live (not archived/deleted)', () => {
      const room = createChatRoom({ name: 'live-room', whoCreatedIt: '@you' });
      createTerminalRecord({ sessionId: 't_ar_4', name: 'alive-agent', handle: '@alive', linkedChatRoomId: room.id });
      expect(listLiveTerminalRecords().find((r) => r.session_id === 't_ar_4')).toBeDefined();
      expect(listAllPickableHandles()).toContain('@alive');
    });

    it('AR4: keeps bare-pane terminals (linked_chat_room_id IS NULL)', () => {
      // Operator may have a tmux pane registered with no linked chat —
      // these should still be invitable.
      createTerminalRecord({ sessionId: 't_ar_5', name: 'bare-pane', handle: '@bare', linkedChatRoomId: null });
      expect(listLiveTerminalRecords().find((r) => r.session_id === 't_ar_5')).toBeDefined();
      expect(listAllPickableHandles()).toContain('@bare');
    });

    it('AR5: listKnownHandles also filters archived/deleted linked rooms', () => {
      const liveRoom = createChatRoom({ name: 'live', whoCreatedIt: '@you' });
      const archivedRoom = createChatRoom({ name: 'archived', whoCreatedIt: '@you' });
      createTerminalRecord({ sessionId: 't_ar_6', name: 'a', handle: '@live-h', linkedChatRoomId: liveRoom.id });
      createTerminalRecord({ sessionId: 't_ar_7', name: 'b', handle: '@dead-h', linkedChatRoomId: archivedRoom.id });
      archiveChatRoom(archivedRoom.id);
      const handles = listKnownHandles();
      expect(handles).toContain('@live-h');
      expect(handles).not.toContain('@dead-h');
    });
  });
});
