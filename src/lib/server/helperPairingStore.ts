/**
 * helperPairingStore — antAppHelper pairing handshake (SPEC §3).
 *
 * Flow: operator (signed in — the mint is operator-gated at the route layer)
 * mints a short-lived, SINGLE-USE pairing code bound to a handle. ANT shows the
 * code on that handle. The desktop app redeems code (+ host) → a lease is
 * minted (helperLeaseStore) and its secret returned once. A leaked code or a
 * stolen app is worthless: the code is short-TTL + single-use, and only the
 * signed-in operator could have minted it.
 *
 * Schema: helper_pairing_codes (see ./db.ts).
 */
import { randomBytes } from 'node:crypto';
import { hashToken } from './chatInviteStore';
import { getIdentityDb } from './db';
import { mintLease, type StoredLease } from './helperLeaseStore';

/** Operator has a 15-min window to hand the code to the app and redeem it. */
export const PAIRING_CODE_TTL_MS = 15 * 60 * 1000;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 ambiguity

export function mintPairingCode(bytes = randomBytes(6)): string {
  // 6 unambiguous chars, e.g. 7F3A29 → shown grouped in the UI.
  let out = '';
  for (let i = 0; i < 6; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

export type CreatePairingInput = {
  handle: string;
  owners: string[];
  createdBy?: string | null;
  ttlMs?: number;
  nowMs?: number;
  /** test seam */
  pairingId?: string;
  code?: string;
};

export type CreatePairingResult = {
  pairingId: string;
  /** plaintext code — shown in ANT on the handle; only its hash is stored. */
  code: string;
  expiresAtMs: number;
};

export function createPairingCode(input: CreatePairingInput): CreatePairingResult {
  const handle = input.handle.trim();
  if (handle.length === 0) throw new Error('createPairingCode: handle is required');
  const owners = input.owners.map((o) => o.trim()).filter((o) => o.length > 0);
  if (owners.length === 0) throw new Error('createPairingCode: at least one owner is required');

  const db = getIdentityDb();
  const nowMs = input.nowMs ?? Date.now();
  const ttlMs = input.ttlMs ?? PAIRING_CODE_TTL_MS;
  const expiresAtMs = nowMs + ttlMs;
  const pairingId = input.pairingId ?? `pair_${randomBytes(9).toString('hex')}`;
  const code = input.code ?? mintPairingCode();

  db.prepare(
    `INSERT INTO helper_pairing_codes
       (id, code_hash, handle, owners, created_by, created_at_ms, expires_at_ms, consumed_at_ms, lease_id_after_consume, paired_host)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`
  ).run(pairingId, hashToken(code), handle, JSON.stringify(owners), input.createdBy ?? null, nowMs, expiresAtMs);

  return { pairingId, code, expiresAtMs };
}

export type RedeemPairingInput = {
  code: string;
  pairedHost?: string | null;
  /** lease TTL override; defaults to helperLeaseStore's 30-day default. */
  leaseTtlMs?: number | null;
  nowMs?: number;
};

export type RedeemPairingResult = {
  pairingId: string;
  handle: string;
  leaseId: string;
  /** plaintext lease secret — returned ONCE. */
  leaseSecret: string;
  lease: StoredLease;
};

/**
 * Single-use redeem: succeeds once for a live (un-consumed, un-expired) code,
 * mints the lease, and stamps the code consumed. Returns null on
 * unknown / expired / already-consumed (the route maps that to 410/404).
 */
export function redeemPairingCode(input: RedeemPairingInput): RedeemPairingResult | null {
  const code = input.code.trim();
  if (code.length === 0) return null;
  const db = getIdentityDb();
  const nowMs = input.nowMs ?? Date.now();

  const row = db.prepare(`SELECT * FROM helper_pairing_codes WHERE code_hash = ?`).get(hashToken(code)) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  if (row.consumed_at_ms !== null && row.consumed_at_ms !== undefined) return null; // single-use
  if ((row.expires_at_ms as number) <= nowMs) return null; // expired

  let owners: string[] = [];
  try {
    const parsed = JSON.parse((row.owners as string) ?? '[]');
    if (Array.isArray(parsed)) owners = parsed.filter((o): o is string => typeof o === 'string');
  } catch { /* fall through with empty owners → mintLease will refuse, surfaced as null below */ }

  const handle = row.handle as string;
  let minted;
  try {
    minted = mintLease({
      handle,
      owners,
      pairedHost: input.pairedHost ?? null,
      createdBy: (row.created_by as string | null) ?? null,
      ttlMs: input.leaseTtlMs,
      nowMs
    });
  } catch {
    // owners invariant failed (corrupt row) — do NOT consume the code; let the
    // operator re-mint cleanly rather than burning the code on a bad state.
    return null;
  }

  // Stamp consumed only AFTER the lease is safely minted (single transaction
  // would be tighter, but mintLease already committed; consume-after keeps the
  // code single-use without risking a consumed-but-no-lease gap).
  db.prepare(
    `UPDATE helper_pairing_codes SET consumed_at_ms = ?, lease_id_after_consume = ?, paired_host = ? WHERE id = ?`
  ).run(nowMs, minted.leaseId, input.pairedHost ?? null, row.id as string);

  return {
    pairingId: row.id as string,
    handle,
    leaseId: minted.leaseId,
    leaseSecret: minted.secret,
    lease: minted.lease
  };
}

export function findPairingById(pairingId: string): {
  id: string; handle: string; consumed_at_ms: number | null; expires_at_ms: number;
} | null {
  const db = getIdentityDb();
  const row = db.prepare(`SELECT id, handle, consumed_at_ms, expires_at_ms FROM helper_pairing_codes WHERE id = ?`).get(pairingId) as
    | { id: string; handle: string; consumed_at_ms: number | null; expires_at_ms: number }
    | undefined;
  return row ?? null;
}
