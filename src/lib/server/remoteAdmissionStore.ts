/**
 * remoteAdmissionStore — operator-issued remote-invite codes per the M4
 * Remote ANT design contract (2026-05-13).
 *
 * Schema (see ./db.ts): chat_remote_admissions
 *
 * Behaviour:
 *   - createAdmission mints a human-readable invite code (ANT-XXX-YYYY),
 *     stores its hash + the chosen lifetime preset + a 20-min acceptance
 *     window. Returns the plaintext code ONCE — caller hands it off
 *     out-of-band (Signal/email).
 *   - redeemCode is single-use: succeeds once before acceptance window
 *     expires, marks accepted_at_ms, sets mapping_id_after_accept.
 *     Subsequent redeems return null (the route layer maps that to 410).
 *   - revokeAdmission marks revoked_at_ms; future redeems fail.
 *   - listForRoom returns active admissions, newest first.
 *
 * No fanout / no HTTP / no token-mint here — the route layer mints the
 * mapping + bridge_token via remoteMappingStore.createMapping after a
 * successful redeemCode.
 */
import { hashToken } from './chatInviteStore';
import { getIdentityDb } from './db';

export type LifetimePreset = 'today' | '48h' | '7d' | 'indefinite';

const ACCEPTANCE_WINDOW_MS = 20 * 60 * 1000;
const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export type StoredAdmission = {
  id: string;
  room_id: string;
  lifetime_preset: LifetimePreset;
  expires_at_ms: number | null;
  created_by_handle: string | null;
  created_at_ms: number;
  accepted_at_ms: number | null;
  expires_acceptance_at_ms: number;
  mapping_id_after_accept: string | null;
  revoked_at_ms: number | null;
};

export type CreateAdmissionInput = {
  roomId: string;
  lifetimePreset: LifetimePreset;
  createdByHandle?: string | null;
};

export type CreateAdmissionResult = {
  admission: StoredAdmission;
  code: string;
};

export type RedeemResult = {
  admission: StoredAdmission;
};

function nextLocalMidnightMs(now: number): number {
  const d = new Date(now);
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

function expiresAtForPreset(preset: LifetimePreset, now: number): number | null {
  if (preset === 'indefinite') return null;
  if (preset === 'today') return nextLocalMidnightMs(now);
  if (preset === '48h') return now + FORTY_EIGHT_HOURS_MS;
  return now + SEVEN_DAYS_MS;
}

function randomCodeSegment(length: number): string {
  let out = '';
  const buf = new Uint8Array(length);
  crypto.getRandomValues(buf);
  for (const byte of buf) out += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return out;
}

export function mintInviteCode(): string {
  return `ANT-${randomCodeSegment(3)}-${randomCodeSegment(4)}`;
}

function newAdmissionId(): string {
  return `adm_${randomCodeSegment(10).toLowerCase()}`;
}

function rowToAdmission(row: Record<string, unknown>): StoredAdmission {
  return {
    id: row.id as string,
    room_id: row.room_id as string,
    lifetime_preset: row.lifetime_preset as LifetimePreset,
    expires_at_ms: (row.expires_at_ms as number | null) ?? null,
    created_by_handle: (row.created_by_handle as string | null) ?? null,
    created_at_ms: row.created_at_ms as number,
    accepted_at_ms: (row.accepted_at_ms as number | null) ?? null,
    expires_acceptance_at_ms: row.expires_acceptance_at_ms as number,
    mapping_id_after_accept: (row.mapping_id_after_accept as string | null) ?? null,
    revoked_at_ms: (row.revoked_at_ms as number | null) ?? null
  };
}

export function createAdmission(input: CreateAdmissionInput): CreateAdmissionResult {
  const db = getIdentityDb();
  const now = Date.now();
  const code = mintInviteCode();
  const admission: StoredAdmission = {
    id: newAdmissionId(),
    room_id: input.roomId,
    lifetime_preset: input.lifetimePreset,
    expires_at_ms: expiresAtForPreset(input.lifetimePreset, now),
    created_by_handle: input.createdByHandle ?? null,
    created_at_ms: now,
    accepted_at_ms: null,
    expires_acceptance_at_ms: now + ACCEPTANCE_WINDOW_MS,
    mapping_id_after_accept: null,
    revoked_at_ms: null
  };
  db.prepare(`INSERT INTO chat_remote_admissions
    (id, room_id, code_hash, lifetime_preset, expires_at_ms, created_by_handle,
     created_at_ms, accepted_at_ms, expires_acceptance_at_ms, mapping_id_after_accept, revoked_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    admission.id,
    admission.room_id,
    hashToken(code),
    admission.lifetime_preset,
    admission.expires_at_ms,
    admission.created_by_handle,
    admission.created_at_ms,
    admission.accepted_at_ms,
    admission.expires_acceptance_at_ms,
    admission.mapping_id_after_accept,
    admission.revoked_at_ms
  );
  return { admission, code };
}

export type RedeemInput = {
  admissionId: string;
  code: string;
  mappingId: string;
};

export function redeemCode(input: RedeemInput): RedeemResult | null {
  const db = getIdentityDb();
  const now = Date.now();
  const row = db.prepare(`SELECT * FROM chat_remote_admissions WHERE id = ?`).get(input.admissionId) as
    Record<string, unknown> | undefined;
  if (!row) return null;
  const admission = rowToAdmission(row);
  if (admission.revoked_at_ms !== null) return null;
  if (admission.accepted_at_ms !== null) return null;
  if (now > admission.expires_acceptance_at_ms) return null;
  const codeHash = row.code_hash as string;
  if (hashToken(input.code) !== codeHash) return null;
  db.prepare(`UPDATE chat_remote_admissions
    SET accepted_at_ms = ?, mapping_id_after_accept = ?
    WHERE id = ? AND accepted_at_ms IS NULL AND revoked_at_ms IS NULL`).run(
    now, input.mappingId, input.admissionId
  );
  admission.accepted_at_ms = now;
  admission.mapping_id_after_accept = input.mappingId;
  return { admission };
}

export function revokeAdmission(admissionId: string): boolean {
  const db = getIdentityDb();
  const now = Date.now();
  const result = db.prepare(`UPDATE chat_remote_admissions
    SET revoked_at_ms = ? WHERE id = ? AND revoked_at_ms IS NULL`).run(now, admissionId);
  return result.changes === 1;
}

export function listActiveForRoom(roomId: string): StoredAdmission[] {
  const db = getIdentityDb();
  const rows = db.prepare(`SELECT * FROM chat_remote_admissions
    WHERE room_id = ? AND revoked_at_ms IS NULL
    ORDER BY created_at_ms DESC`).all(roomId) as Record<string, unknown>[];
  return rows.map(rowToAdmission);
}

export function findById(admissionId: string): StoredAdmission | null {
  const db = getIdentityDb();
  const row = db.prepare(`SELECT * FROM chat_remote_admissions WHERE id = ?`).get(admissionId) as
    Record<string, unknown> | undefined;
  return row ? rowToAdmission(row) : null;
}
