/**
 * v02ChatRoomBridge tests — auto-create v02_agents + v02_rooms + mirror
 * legacy addMembership / removeMembership writes into v02_memberships.
 *
 * Each test wipes state (resetIdentityDbForTests) so they are order-
 * independent; the bridge holds NO module-level state.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getIdentityDb, resetIdentityDbForTests } from './db';
import { seedSiblingFkTargets } from './v02TestFixtures';
import * as v02Agents from './v02AgentsStore';
import * as v02Memberships from './v02MembershipsStore';
import {
  ensureV02AgentForHandle,
  ensureV02RoomExists,
  mirrorAddMembership,
  mirrorRemoveMembership,
  resolveV02AgentIdForHandle
} from './v02ChatRoomBridge';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;
const previousMemoryVaultPath = process.env.ANT_MEMORY_VAULT_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-v02-bridge-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_MEMORY_VAULT_PATH = '/tmp/ant-memory-pack-test-bridge';
  resetIdentityDbForTests();
  // Option D collapse — seed PR #99/#105/#106 FK target tables.
  seedSiblingFkTargets(getIdentityDb());
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
  if (previousMemoryVaultPath === undefined) delete process.env.ANT_MEMORY_VAULT_PATH;
  else process.env.ANT_MEMORY_VAULT_PATH = previousMemoryVaultPath;
});

function seedLegacyChatRoom(roomId: string, name: string = roomId) {
  const db = getIdentityDb();
  db.prepare(
    `INSERT INTO chat_rooms (id, name, summary, attention_state, last_update,
       when_it_was_created, who_created_it, creation_order)
     VALUES (?, ?, '', 'idle', 'now', '2026-05-30T00:00:00Z', '@you', 1)`
  ).run(roomId, name);
}

describe('ensureV02RoomExists', () => {
  it('creates a v02_rooms row when missing, copying the legacy display name', () => {
    seedLegacyChatRoom('room-1', 'My Cool Room');
    const room_id = ensureV02RoomExists('room-1');
    expect(room_id).toBe('room-1');
    const row = getIdentityDb()
      .prepare(`SELECT * FROM rooms WHERE room_id = ?`)
      .get('room-1') as { room_id: string; display_name: string } | undefined;
    expect(row).toBeDefined();
    expect(row?.display_name).toBe('My Cool Room');
  });

  it('is idempotent — second call probes + returns the same row', () => {
    seedLegacyChatRoom('room-2');
    ensureV02RoomExists('room-2');
    ensureV02RoomExists('room-2');
    const count = (getIdentityDb()
      .prepare(`SELECT COUNT(*) AS c FROM rooms WHERE room_id = ?`)
      .get('room-2') as { c: number }).c;
    expect(count).toBe(1);
  });

  it('falls back to using roomId as the display name when no legacy row exists', () => {
    const room_id = ensureV02RoomExists('orphan-room');
    expect(room_id).toBe('orphan-room');
    const row = getIdentityDb()
      .prepare(`SELECT display_name FROM rooms WHERE room_id = ?`)
      .get('orphan-room') as { display_name: string } | undefined;
    expect(row?.display_name).toBe('orphan-room');
  });
});

describe('ensureV02AgentForHandle', () => {
  it('creates a v02_agents row when handle is unseen', () => {
    const agent_id = ensureV02AgentForHandle('@new-agent', 'Display Name');
    const agent = v02Agents.getAgentById(agent_id);
    expect(agent?.primary_handle).toBe('@new-agent');
    expect(agent?.display_name).toBe('Display Name');
    expect(agent?.status).toBe('live');
  });

  it('returns the existing live agent when handle already exists', () => {
    const first = ensureV02AgentForHandle('@agent', 'First Name');
    const second = ensureV02AgentForHandle('@agent', 'Second Name');
    expect(first).toBe(second);
    const agent = v02Agents.getAgentById(first);
    // displayName from the FIRST call is preserved (no drift).
    expect(agent?.display_name).toBe('First Name');
  });

  it('normalises a handle without leading @', () => {
    const agent_id = ensureV02AgentForHandle('plain-handle');
    const agent = v02Agents.getAgentById(agent_id);
    expect(agent?.primary_handle).toBe('@plain-handle');
  });

  it('uses the handle as display_name when displayName is missing', () => {
    const agent_id = ensureV02AgentForHandle('@hno-name');
    const agent = v02Agents.getAgentById(agent_id);
    expect(agent?.display_name).toBe('@hno-name');
  });

  it('throws on empty handle', () => {
    expect(() => ensureV02AgentForHandle('   ')).toThrow();
  });

  // sec-iter1 Fix #5 (2026-05-30 enterprise security pass) — stub
  // auto-create guard. When a handle has NO identity_keys row, the
  // auto-created agents row is marked as a stub (audit_event kind +
  // is_stub field) so Stage B can later require explicit attestation
  // before promoting `primary_trust_key_id` from NULL to real.
  describe('sec-iter1 Fix #5: stub-auto-create guard', () => {
    function listAuditEvents() {
      return getIdentityDb()
        .prepare(`SELECT kind, after_json FROM audit_events ORDER BY at_ms ASC`)
        .all() as Array<{ kind: string; after_json: string | null }>;
    }

    it('auto-creates with primary_trust_key_id=NULL and stub audit-event kind when no identity_keys row exists', () => {
      const agent_id = ensureV02AgentForHandle('@stub-handle');
      const agent = v02Agents.getAgentById(agent_id);
      expect(agent?.primary_trust_key_id).toBeNull();
      const audits = listAuditEvents();
      const stubAudit = audits.find((a) => a.kind === 'agent.created.via_bridge_stub');
      expect(stubAudit).toBeDefined();
      const after = JSON.parse(stubAudit!.after_json!);
      expect(after.is_stub).toBe(true);
      expect(after.via).toBe('v02-chatroom-bridge-stub');
      expect(after.identity_id).toBeNull();
    });

    it('auto-creates as a regular (non-stub) agent when identity_keys row exists for handle', () => {
      // Seed an `identities` row for this handle so the bridge resolves
      // it as a known canonical identity. Uses the substrate helper to
      // mint a real identity (no shortcut DB writes).
      const db = getIdentityDb();
      db.prepare(
        `INSERT INTO identities (identity_id, kind, display_name, canonical_handle, created_at_ms)
         VALUES (?, 'human', 'Real Person', ?, ?)`
      ).run('id_real_1', '@known-handle', Date.now());
      const agent_id = ensureV02AgentForHandle('@known-handle');
      const audits = listAuditEvents();
      const regularAudit = audits.find((a) => a.kind === 'agent.created');
      const stubAudit = audits.find((a) => a.kind === 'agent.created.via_bridge_stub');
      expect(regularAudit).toBeDefined();
      expect(stubAudit).toBeUndefined();
      const after = JSON.parse(regularAudit!.after_json!);
      expect(after.is_stub).toBe(false);
      expect(after.via).toBe('v02-chatroom-bridge');
      expect(after.identity_id).toBe('id_real_1');
      expect(v02Agents.getAgentById(agent_id)?.primary_trust_key_id).toBeNull();
    });

    it('stub agents are NOT promoted on subsequent ensure calls — second call returns the same stub row', () => {
      const first = ensureV02AgentForHandle('@stub-twice');
      const second = ensureV02AgentForHandle('@stub-twice');
      expect(first).toBe(second);
      // Promotion of stubs to real agents is Stage B sweep responsibility,
      // not the bridge's. The bridge MUST NOT silently promote on a
      // subsequent call — that would let an attacker who pre-created
      // the stub silently bind their handle to a real identity later.
      const agent = v02Agents.getAgentById(first);
      expect(agent?.primary_trust_key_id).toBeNull();
    });
  });
});

describe('mirrorAddMembership', () => {
  it('writes a v02_memberships row + auto-creates the agent + room', () => {
    seedLegacyChatRoom('mirror-room');
    const membership_id = mirrorAddMembership({
      roomId: 'mirror-room',
      handle: '@mirror-handle',
      displayName: 'Mirror Agent'
    });
    expect(membership_id).not.toBeNull();
    const memberships = v02Memberships.listActiveMembershipsForRoom('mirror-room');
    expect(memberships.length).toBe(1);
    expect(memberships[0].membership_id).toBe(membership_id);
  });

  it('is idempotent — second call for same (room, handle) returns same row', () => {
    seedLegacyChatRoom('mirror-room-2');
    const first = mirrorAddMembership({
      roomId: 'mirror-room-2',
      handle: '@idemp'
    });
    const second = mirrorAddMembership({
      roomId: 'mirror-room-2',
      handle: '@idemp'
    });
    expect(first).toBe(second);
    const memberships = v02Memberships.listActiveMembershipsForRoom('mirror-room-2');
    expect(memberships.length).toBe(1);
  });

  it('writes an audit event on first join', () => {
    seedLegacyChatRoom('audit-room');
    mirrorAddMembership({ roomId: 'audit-room', handle: '@audit-agent' });
    const auditRow = getIdentityDb()
      .prepare(
        `SELECT kind, entity_kind FROM audit_events
          WHERE kind = 'membership.joined'
          ORDER BY at_ms DESC LIMIT 1`
      )
      .get() as { kind: string; entity_kind: string } | undefined;
    expect(auditRow?.kind).toBe('membership.joined');
    expect(auditRow?.entity_kind).toBe('membership');
  });

  it('does not throw when called twice with same handle/room', () => {
    seedLegacyChatRoom('twice-room');
    expect(() => {
      mirrorAddMembership({ roomId: 'twice-room', handle: '@twice' });
      mirrorAddMembership({ roomId: 'twice-room', handle: '@twice' });
    }).not.toThrow();
  });
});

describe('mirrorRemoveMembership', () => {
  it('soft-leaves a v02_memberships row (left_at_ms set)', () => {
    seedLegacyChatRoom('remove-room');
    mirrorAddMembership({ roomId: 'remove-room', handle: '@remove-me' });
    const flipped = mirrorRemoveMembership('remove-room', '@remove-me');
    expect(flipped).toBe(true);
    // The active membership view should no longer include the agent.
    const active = v02Memberships.listActiveMembershipsForRoom('remove-room');
    expect(active.length).toBe(0);
    // But the historical row remains.
    const all = v02Memberships.listAllMembershipsForRoomIncludingHistorical('remove-room');
    expect(all.length).toBe(1);
    expect(all[0].left_at_ms).not.toBeNull();
  });

  it('returns false when no agent exists for the handle', () => {
    const flipped = mirrorRemoveMembership('unknown-room', '@nobody');
    expect(flipped).toBe(false);
  });

  it('writes an audit event on successful soft-leave', () => {
    seedLegacyChatRoom('audit-remove');
    mirrorAddMembership({ roomId: 'audit-remove', handle: '@bye' });
    mirrorRemoveMembership('audit-remove', '@bye');
    const auditRow = getIdentityDb()
      .prepare(
        `SELECT kind FROM audit_events
          WHERE kind = 'membership.left'
          ORDER BY at_ms DESC LIMIT 1`
      )
      .get() as { kind: string } | undefined;
    expect(auditRow?.kind).toBe('membership.left');
  });
});

describe('resolveV02AgentIdForHandle', () => {
  it('returns null when no agent exists', () => {
    expect(resolveV02AgentIdForHandle('@missing')).toBeNull();
  });

  it('returns the agent_id when one exists', () => {
    const agent_id = ensureV02AgentForHandle('@here');
    expect(resolveV02AgentIdForHandle('@here')).toBe(agent_id);
  });

  it('does NOT auto-create agents', () => {
    resolveV02AgentIdForHandle('@should-not-create');
    const agent = v02Agents.getLiveAgentByHandle('@should-not-create');
    expect(agent).toBeNull();
  });
});
