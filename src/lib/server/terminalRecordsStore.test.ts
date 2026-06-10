import { describe, it, expect, beforeEach } from 'vitest';
import {
  createTerminalRecord, getTerminalRecord, updateTerminalRecord, listTerminalRecords, deleteTerminalRecord,
  parseAllowlist, serializeAllowlist, listKnownHandles, listAllPickableHandles, deriveHandle,
  findTerminalRecordByHandle, listLiveTerminalRecords,
  findActiveTerminalRecordByHandle
} from './terminalRecordsStore';
import { getIdentityDb, resetIdentityDbForTests } from './db';
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
    // sec-iter1 Fix #2 (2026-05-30): the partial UNIQUE INDEX
    // `terminal_records_handle_unique` now structurally prevents two
    // active rows from sharing a handle. The pre-fix version of this
    // test inserted two rows with `@bob` to exercise the DISTINCT
    // collapse in `listKnownHandles`; that's now a SQLITE_CONSTRAINT.
    // We keep coverage of the DISTINCT clause by superseding the
    // older `@bob` row before inserting the second one — i.e. the
    // shape that listKnownHandles would have seen in practice anyway
    // (one active + one superseded).
    createTerminalRecord({ sessionId: 't_h_14', name: 'h-14', handle: '@bob' });
    createTerminalRecord({ sessionId: 't_h_15', name: 'h-15', handle: '@alice' });
    // Supersede the older @bob before re-claiming the handle.
    getIdentityDb()
      .prepare(`UPDATE terminal_records SET superseded_at_ms = ? WHERE session_id = ?`)
      .run(Date.now() - 1000, 't_h_14');
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

  // sec-iter1 Fix #2 (2026-05-30 enterprise security pass): the
  // authoritative "who owns this handle right now" gate.
  it('findActiveTerminalRecordByHandle returns the row with that handle (normalised)', () => {
    createTerminalRecord({ sessionId: 't_active_1', name: 'pane-A', handle: '@owner1' });
    expect(findActiveTerminalRecordByHandle('@owner1')?.session_id).toBe('t_active_1');
    expect(findActiveTerminalRecordByHandle('owner1')?.session_id).toBe('t_active_1');
  });

  it('findActiveTerminalRecordByHandle ignores superseded rows (returns the latest active)', () => {
    createTerminalRecord({ sessionId: 't_active_2a', name: 'pane-old', handle: '@owner2' });
    // Mark older row superseded.
    getIdentityDb()
      .prepare(`UPDATE terminal_records SET superseded_at_ms = ? WHERE session_id = ?`)
      .run(Date.now() - 1000, 't_active_2a');
    createTerminalRecord({ sessionId: 't_active_2b', name: 'pane-new', handle: '@owner2' });
    expect(findActiveTerminalRecordByHandle('@owner2')?.session_id).toBe('t_active_2b');
  });

  it('findActiveTerminalRecordByHandle returns null for unknown handle', () => {
    expect(findActiveTerminalRecordByHandle('@nobody-ever')).toBeNull();
  });

  it('findActiveTerminalRecordByHandle returns null for empty input', () => {
    expect(findActiveTerminalRecordByHandle('')).toBeNull();
    expect(findActiveTerminalRecordByHandle('   ')).toBeNull();
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
      // Sec-iter2 Fix #1 (2026-05-30): `@here` was previously used as the
      // "live" handle in this test, but `@here` is on the reserved list
      // (`data/reserved-handles.json`) and is now rejected at the
      // choke-point validator. Swapped to `@still-here` (valid, not
      // reserved) — the test still asserts the same invariant (superseded
      // handle dropped, live handle visible).
      createTerminalRecord({ sessionId: 't_ps_11', name: 'a', tmuxTargetPane: 'pane-%5', handle: '@gone' });
      createTerminalRecord({ sessionId: 't_ps_12', name: 'b', tmuxTargetPane: 'pane-%5', handle: '@still-here' });
      const picker = listAllPickableHandles();
      expect(picker).not.toContain('@gone');
      expect(picker).toContain('@still-here');
      const known = listKnownHandles();
      expect(known).not.toContain('@gone');
      expect(known).toContain('@still-here');
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

  // Phase C3 (JWPK A Team msg_emnmgs1y9t 2026-05-29 — screenshot showing
  // invite picker still listing dead handles after 0.1.13 deploy). Confirms
  // listLiveTerminalRecords, listKnownHandles, and listAllPickableHandles
  // all drop terminal_records whose backing terminal has been flipped to
  // archived/deleted, AND preserve rows that have no matching terminals
  // row at all (pre-A1 + remote-bridge).
  describe('Phase C3 — picker queries filter on terminals.status', () => {
    beforeEach(() => {
      process.env.ANT_FRESH_DB_PATH = ':memory:';
      resetIdentityDbForTests();
    });

    it('C3a: listLiveTerminalRecords includes rows whose terminals row is status=live', async () => {
      const { upsertTerminal } = await import('./terminalsStore');
      const live = upsertTerminal({ pid: 1, pid_start: 'p', name: 'live-record' });
      createTerminalRecord({ sessionId: live.id, name: 'live-record', handle: '@alive' });
      const rows = listLiveTerminalRecords();
      expect(rows.map((r) => r.session_id)).toContain(live.id);
    });

    it('C3b: listLiveTerminalRecords drops rows whose terminals row is archived', async () => {
      const { upsertTerminal, setTerminalStatus } = await import('./terminalsStore');
      const t = upsertTerminal({ pid: 2, pid_start: 'p', name: 'archived-record' });
      createTerminalRecord({ sessionId: t.id, name: 'archived-record', handle: '@archived' });
      setTerminalStatus(t.id, 'archived');
      const rows = listLiveTerminalRecords();
      expect(rows.map((r) => r.session_id)).not.toContain(t.id);
    });

    it('C3c: listLiveTerminalRecords drops rows whose terminals row is deleted', async () => {
      const { upsertTerminal, setTerminalStatus } = await import('./terminalsStore');
      const t = upsertTerminal({ pid: 3, pid_start: 'p', name: 'deleted-record' });
      createTerminalRecord({ sessionId: t.id, name: 'deleted-record', handle: '@gone' });
      setTerminalStatus(t.id, 'deleted');
      const rows = listLiveTerminalRecords();
      expect(rows.map((r) => r.session_id)).not.toContain(t.id);
    });

    it('C3d: listLiveTerminalRecords PRESERVES rows whose terminals row does not exist (pre-A1 / remote bridge)', () => {
      // create a terminal_records row whose session_id has NO matching
      // terminals row — same shape as pre-A1 historical rows + remote
      // bridges that only exist in terminal_records.
      createTerminalRecord({ sessionId: 't_orphan_record', name: 'orphan', handle: '@orphan' });
      const rows = listLiveTerminalRecords();
      expect(rows.map((r) => r.session_id)).toContain('t_orphan_record');
    });

    it('C3e: listKnownHandles drops archived', async () => {
      const { upsertTerminal, setTerminalStatus } = await import('./terminalsStore');
      const live = upsertTerminal({ pid: 4, pid_start: 'p', name: 'h-live' });
      const archived = upsertTerminal({ pid: 5, pid_start: 'p', name: 'h-archived' });
      createTerminalRecord({ sessionId: live.id, name: 'h-live', handle: '@h-live' });
      createTerminalRecord({ sessionId: archived.id, name: 'h-archived', handle: '@h-archived' });
      setTerminalStatus(archived.id, 'archived');
      const handles = listKnownHandles();
      expect(handles).toContain('@h-live');
      expect(handles).not.toContain('@h-archived');
    });

    it('C3f: listAllPickableHandles drops archived (inherits from listLiveTerminalRecords)', async () => {
      const { upsertTerminal, setTerminalStatus } = await import('./terminalsStore');
      const live = upsertTerminal({ pid: 6, pid_start: 'p', name: 'p-live' });
      const archived = upsertTerminal({ pid: 7, pid_start: 'p', name: 'p-archived' });
      createTerminalRecord({ sessionId: live.id, name: 'p-live', handle: '@p-live' });
      createTerminalRecord({ sessionId: archived.id, name: 'p-archived', handle: '@p-archived' });
      setTerminalStatus(archived.id, 'archived');
      const handles = listAllPickableHandles();
      expect(handles).toContain('@p-live');
      expect(handles).not.toContain('@p-archived');
    });

    it('C3g: listAllPickableHandles preserves orphan rows (no terminals row) via derived handle', () => {
      createTerminalRecord({ sessionId: 't_orphan_2', name: 'orphan-pick', handle: null });
      const handles = listAllPickableHandles();
      // deriveHandle falls back to slug of name when handle is null.
      expect(handles).toContain('@orphan-pick');
    });
  });

  /**
   * Sec-iter2 Fix #1 (2026-05-30 enterprise security pass): choke-point
   * handle validation on the store layer. Without these, an attacker
   * could POST /api/terminals { handle: '@admin' } (which had NO API-
   * layer validation) and the row would persist with `@admin`. The
   * approver gate's `resolveAuthoritativeCallerHandle` then returned
   * '@admin', which `requireApproverFor` short-circuited on string
   * equality with `ADMIN_BEARER_HANDLE`. Full admin escalation. The
   * store-layer assertion makes the bypass structurally impossible
   * even if a future writer forgets to validate at the API edge.
   */
  describe('sec-iter2 Fix #1: choke-point handle validation', () => {
    it('createTerminalRecord rejects @admin with [INVALID_HANDLE] tag', () => {
      expect(() =>
        createTerminalRecord({ sessionId: 't_attack_1', name: 'attacker', handle: '@admin' })
      ).toThrow(/\[INVALID_HANDLE\]/);
      // Row must NOT have been persisted. (Verifies the throw fires
      // BEFORE the INSERT — the exact ordering required to close the
      // exploit chain in the iter2 review.)
      expect(getTerminalRecord('t_attack_1')).toBeNull();
    });

    it('createTerminalRecord rejects every reserved handle case-insensitively', () => {
      const reserved = ['@admin', '@ADMIN', '@Admin', '@you', '@everyone', '@system', '@chair'];
      for (const handle of reserved) {
        expect(
          () => createTerminalRecord({ sessionId: `t_r_${handle.slice(1)}`, name: 'r', handle })
        ).toThrow(/\[INVALID_HANDLE\]/);
      }
    });

    it('createTerminalRecord rejects invalid-character handles', () => {
      expect(() =>
        createTerminalRecord({ sessionId: 't_bad_1', name: 'bad', handle: '@bad space' })
      ).toThrow(/\[INVALID_HANDLE\]/);
      expect(() =>
        createTerminalRecord({ sessionId: 't_bad_2', name: 'bad', handle: '@.lead' })
      ).toThrow(/\[INVALID_HANDLE\]/);
    });

    it('createTerminalRecord allows null/undefined/empty handle (column is nullable)', () => {
      expect(() =>
        createTerminalRecord({ sessionId: 't_null_1', name: 'no-handle', handle: null })
      ).not.toThrow();
      expect(() =>
        createTerminalRecord({ sessionId: 't_null_2', name: 'no-handle-2' })
      ).not.toThrow();
      // Empty string trims to nothing → treated as null (column allows it).
      expect(() =>
        createTerminalRecord({ sessionId: 't_null_3', name: 'no-handle-3', handle: '' })
      ).not.toThrow();
    });

    it('createTerminalRecord accepts valid non-reserved handles unchanged', () => {
      const rec = createTerminalRecord({
        sessionId: 't_ok_1',
        name: 'ok',
        handle: '@alice-1'
      });
      expect(rec.handle).toBe('@alice-1');
    });

    it('updateTerminalRecord rejects @admin even when the existing row had a legitimate handle', () => {
      createTerminalRecord({ sessionId: 't_patch_1', name: 'patch', handle: '@worker' });
      expect(() =>
        updateTerminalRecord('t_patch_1', { handle: '@admin' })
      ).toThrow(/\[INVALID_HANDLE\]/);
      // Existing handle must NOT have been overwritten.
      expect(getTerminalRecord('t_patch_1')?.handle).toBe('@worker');
    });

    it('updateTerminalRecord rejects @admin on a row whose handle was previously NULL (the second exploit path)', () => {
      createTerminalRecord({ sessionId: 't_patch_2', name: 'patch-null', handle: null });
      expect(() =>
        updateTerminalRecord('t_patch_2', { handle: '@admin' })
      ).toThrow(/\[INVALID_HANDLE\]/);
      expect(getTerminalRecord('t_patch_2')?.handle).toBeNull();
    });

    it('updateTerminalRecord allows setting handle to null (explicit clear)', () => {
      createTerminalRecord({ sessionId: 't_patch_3', name: 'patch-clear', handle: '@alice-2' });
      const cleared = updateTerminalRecord('t_patch_3', { handle: null });
      expect(cleared?.handle).toBeNull();
    });

    it('updateTerminalRecord does not validate when handle is not present in the patch', () => {
      // Sec-iter2 invariant: patch.handle === undefined is the "leave it
      // alone" signal. The validator must NOT see undefined as an
      // attempted write and must NOT throw on an unrelated name update.
      createTerminalRecord({ sessionId: 't_patch_4', name: 'before', handle: '@alice-3' });
      expect(() =>
        updateTerminalRecord('t_patch_4', { name: 'after' })
      ).not.toThrow();
      expect(getTerminalRecord('t_patch_4')?.handle).toBe('@alice-3');
      expect(getTerminalRecord('t_patch_4')?.name).toBe('after');
    });
  });
});

describe('terminalRecordsStore — session-capture provenance (boot_command_source + cli_session_id)', () => {
  beforeEach(() => {
    try { getIdentityDb().prepare(`DELETE FROM terminal_records`).run(); } catch { /* schema not applied */ }
  });

  it('defaults boot_command_source to operator when bootCommand is set at create', () => {
    createTerminalRecord({ sessionId: 't_src_1', name: 'src-1', bootCommand: 'claude --remote-control' });
    const got = getTerminalRecord('t_src_1');
    expect(got?.boot_command).toBe('claude --remote-control');
    expect(got?.boot_command_source).toBe('operator');
  });

  it('leaves boot_command_source null when no bootCommand is set', () => {
    createTerminalRecord({ sessionId: 't_src_2', name: 'src-2' });
    const got = getTerminalRecord('t_src_2');
    expect(got?.boot_command).toBeNull();
    expect(got?.boot_command_source).toBeNull();
  });

  it('updateTerminalRecord defaults a patched bootCommand to operator provenance', () => {
    createTerminalRecord({ sessionId: 't_src_3', name: 'src-3' });
    updateTerminalRecord('t_src_3', { bootCommand: 'codex --yolo' });
    const got = getTerminalRecord('t_src_3');
    expect(got?.boot_command).toBe('codex --yolo');
    expect(got?.boot_command_source).toBe('operator');
  });

  it('updateTerminalRecord persists explicit auto provenance and clears it with the command', () => {
    createTerminalRecord({ sessionId: 't_src_4', name: 'src-4' });
    updateTerminalRecord('t_src_4', { bootCommand: 'claude --mined', bootCommandSource: 'auto' });
    expect(getTerminalRecord('t_src_4')?.boot_command_source).toBe('auto');
    // Clearing the command clears the provenance — a NULL command with a
    // lingering 'auto' tag would let a later auto-capture think it owns it.
    updateTerminalRecord('t_src_4', { bootCommand: null });
    const cleared = getTerminalRecord('t_src_4');
    expect(cleared?.boot_command).toBeNull();
    expect(cleared?.boot_command_source).toBeNull();
  });

  it('an unrelated patch leaves boot_command + provenance untouched', () => {
    createTerminalRecord({ sessionId: 't_src_5', name: 'src-5', bootCommand: 'claude --keep' });
    updateTerminalRecord('t_src_5', { name: 'renamed' });
    const got = getTerminalRecord('t_src_5');
    expect(got?.boot_command).toBe('claude --keep');
    expect(got?.boot_command_source).toBe('operator');
  });

  it('cli_session_id + cli_session_source round-trip via update and clear together', () => {
    createTerminalRecord({ sessionId: 't_src_6', name: 'src-6' });
    expect(getTerminalRecord('t_src_6')?.cli_session_id).toBeNull();
    updateTerminalRecord('t_src_6', { cliSessionId: 'claude-uuid-1', cliSessionSource: 'claude-code' });
    const got = getTerminalRecord('t_src_6');
    expect(got?.cli_session_id).toBe('claude-uuid-1');
    expect(got?.cli_session_source).toBe('claude-code');
    updateTerminalRecord('t_src_6', { cliSessionId: null });
    const cleared = getTerminalRecord('t_src_6');
    expect(cleared?.cli_session_id).toBeNull();
    expect(cleared?.cli_session_source).toBeNull();
  });
});
