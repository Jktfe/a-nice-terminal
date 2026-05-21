/**
 * remoteMappingStore — long-lived bridge identities per the M4 Remote
 * ANT design contract (2026-05-13).
 *
 * Schema (see ./db.ts): chat_remote_mappings + synthetic rows in
 * terminals + room_memberships keyed by `remote-{mapping_id}` for
 * downstream join reuse.
 *
 * Behaviour:
 *   - createMapping mints an opaque bridge_token (rbt_...), stores its
 *     hash on the mapping row, AND writes the synthetic terminal +
 *     room_membership rows in the same transaction. Returns the
 *     plaintext bridge_token ONCE — caller hands it to the redeeming
 *     remote operator.
 *   - resolveByBearer takes a presented bridge_token and returns the
 *     mapping_id + room_id if the mapping is active (not revoked, not
 *     expired). null otherwise.
 *   - revokeMapping marks revoked_at_ms on the mapping and inactivates
 *     the synthetic terminal/membership rows (no delete — preserves
 *     audit and prevents handle-reclaim race).
 *   - touchLastSeen bumps last_seen_at_ms; called AFTER auth resolves
 *     on every successful inbound bridge POST.
 *   - listForRoom returns active mappings, newest first.
 *
 * No HTTP / no event-store calls / no payload handling here.
 */
import { hashToken, mintTokenSecret } from './chatInviteStore';
import { getIdentityDb } from './db';
import type { LifetimePreset, StoredAdmission } from './remoteAdmissionStore';

export type MappingDirection = 'in' | 'out' | 'both';

export type StoredMapping = {
  id: string;
  room_id: string;
  remote_instance_label: string;
  lifetime_preset: LifetimePreset;
  expires_at_ms: number | null;
  revoked_at_ms: number | null;
  created_at_ms: number;
  last_seen_at_ms: number | null;
  admission_id: string;
  direction: MappingDirection;
};

export type CreateMappingInput = {
  roomId: string;
  remoteInstanceLabel: string;
  admissionId: string;
  lifetimePreset: LifetimePreset;
  expiresAtMs: number | null;
  direction?: MappingDirection;
};

export type CreateMappingResult = {
  mapping: StoredMapping;
  bridgeToken: string;
};

export type ResolvedMapping = {
  mapping_id: string;
  room_id: string;
  remote_instance_label: string;
};

function newMappingId(): string {
  return `map_${mintTokenSecret().slice(0, 16)}`;
}

function rowToMapping(row: Record<string, unknown>): StoredMapping {
  return {
    id: row.id as string,
    room_id: row.room_id as string,
    remote_instance_label: row.remote_instance_label as string,
    lifetime_preset: row.lifetime_preset as LifetimePreset,
    expires_at_ms: (row.expires_at_ms as number | null) ?? null,
    revoked_at_ms: (row.revoked_at_ms as number | null) ?? null,
    created_at_ms: row.created_at_ms as number,
    last_seen_at_ms: (row.last_seen_at_ms as number | null) ?? null,
    admission_id: row.admission_id as string,
    direction: row.direction as MappingDirection
  };
}

function syntheticTerminalId(mappingId: string): string {
  return `remote-${mappingId}`;
}

export function createMapping(input: CreateMappingInput): CreateMappingResult {
  const db = getIdentityDb();
  const now = Date.now();
  const mappingId = newMappingId();
  const bridgeToken = `rbt_${mintTokenSecret()}`;
  const tokenHash = hashToken(bridgeToken);
  const direction: MappingDirection = input.direction ?? 'both';
  const terminalId = syntheticTerminalId(mappingId);
  const handle = `@${input.remoteInstanceLabel}`;

  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO chat_remote_mappings
      (id, room_id, remote_instance_label, bridge_token_hash, lifetime_preset,
       expires_at_ms, revoked_at_ms, created_at_ms, last_seen_at_ms, admission_id, direction)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?)`).run(
      mappingId, input.roomId, input.remoteInstanceLabel, tokenHash,
      input.lifetimePreset, input.expiresAtMs, now, input.admissionId, direction
    );
    db.prepare(`INSERT INTO terminals
      (id, pid, pid_start, name, tmux_target_pane, agent_kind, pane_status,
       pane_stale_since, source, expires_at, meta, created_at, updated_at)
      VALUES (?, 0, NULL, ?, NULL, 'remote', 'verified', NULL, 'remote-mapping', NULL, '{}', ?, ?)`).run(
      terminalId, handle, now, now
    );
    db.prepare(`INSERT INTO room_memberships
      (id, room_id, handle, terminal_id, created_at)
      VALUES (?, ?, ?, ?, ?)`).run(
      `mem_${mappingId}`, input.roomId, handle, terminalId, now
    );
  });
  tx();

  const mapping: StoredMapping = {
    id: mappingId, room_id: input.roomId,
    remote_instance_label: input.remoteInstanceLabel,
    lifetime_preset: input.lifetimePreset, expires_at_ms: input.expiresAtMs,
    revoked_at_ms: null, created_at_ms: now, last_seen_at_ms: null,
    admission_id: input.admissionId, direction
  };
  return { mapping, bridgeToken };
}

export function resolveByBearer(bridgeToken: string): ResolvedMapping | null {
  const db = getIdentityDb();
  const now = Date.now();
  const tokenHash = hashToken(bridgeToken);
  const row = db.prepare(`SELECT id, room_id, remote_instance_label, expires_at_ms, revoked_at_ms
    FROM chat_remote_mappings WHERE bridge_token_hash = ?`).get(tokenHash) as
    Record<string, unknown> | undefined;
  if (!row) return null;
  if (row.revoked_at_ms !== null) return null;
  const expires = row.expires_at_ms as number | null;
  if (expires !== null && now > expires) return null;
  return {
    mapping_id: row.id as string,
    room_id: row.room_id as string,
    remote_instance_label: row.remote_instance_label as string
  };
}

export function revokeMapping(mappingId: string): boolean {
  const db = getIdentityDb();
  const now = Date.now();
  const result = db.prepare(`UPDATE chat_remote_mappings
    SET revoked_at_ms = ? WHERE id = ? AND revoked_at_ms IS NULL`).run(now, mappingId);
  if (result.changes !== 1) return false;
  // Mark synthetic membership inactive (no-delete preserves audit per
  // contract Q4); terminal row stays as well. Future bearer presentations
  // fail at resolveByBearer's revoked_at_ms check on the mapping itself.
  db.prepare(`UPDATE room_memberships SET revoked_at_ms = ? WHERE id = ?`)
    .run(now, `mem_${mappingId}`);
  return true;
}

export function touchLastSeen(mappingId: string): void {
  const db = getIdentityDb();
  db.prepare(`UPDATE chat_remote_mappings
    SET last_seen_at_ms = ? WHERE id = ? AND revoked_at_ms IS NULL`).run(Date.now(), mappingId);
}

export function listActiveForRoom(roomId: string): StoredMapping[] {
  const db = getIdentityDb();
  const rows = db.prepare(`SELECT * FROM chat_remote_mappings
    WHERE room_id = ? AND revoked_at_ms IS NULL
    ORDER BY created_at_ms DESC`).all(roomId) as Record<string, unknown>[];
  return rows.map(rowToMapping);
}

export function findById(mappingId: string): StoredMapping | null {
  const db = getIdentityDb();
  const row = db.prepare(`SELECT * FROM chat_remote_mappings WHERE id = ?`).get(mappingId) as
    Record<string, unknown> | undefined;
  return row ? rowToMapping(row) : null;
}

// The atomic redeem-and-mint flow lives in `./remoteRedeem.ts` (extracted
// per T2.5 cap fix to keep this store under 200L).
