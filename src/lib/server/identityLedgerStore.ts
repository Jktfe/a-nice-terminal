/**
 * identityLedgerStore — append-only ledger for the clean identity core
 * (ant-handles-rooms-ownership-contract.md R4, Step 1 of the AC3 sequencing,
 * room "ANT sorted" 2026-06-10).
 *
 * Append-only is enforced by BEFORE UPDATE / BEFORE DELETE triggers in the
 * DDL (db.ts) — this module deliberately exports no mutation beyond append.
 * Enterprise hardening (hash-chaining, WORM export) layers on the same rows.
 */

import { getIdentityDb } from './db';

export type IdentityLedgerKind =
  | 'binding.claimed'
  | 'binding.superseded'
  | 'binding.tombstoned'
  | 'handle.registered'
  | 'handle.claim-refused'
  | 'owner.added'
  | 'owner.removed'
  | 'room.assigned'
  | 'resolver.disagreement';

export type IdentityLedgerRow = {
  id: number;
  at_ms: number;
  kind: IdentityLedgerKind;
  handle: string | null;
  room_id: string | null;
  actor: string | null;
  lineage: string | null;
  detail: Record<string, unknown> | null;
};

export type AppendLedgerInput = {
  kind: IdentityLedgerKind;
  handle?: string | null;
  roomId?: string | null;
  actor?: string | null;
  lineage?: string | null;
  detail?: Record<string, unknown> | null;
  atMs?: number;
};

export function appendLedger(input: AppendLedgerInput): void {
  const db = getIdentityDb();
  db.prepare(
    `INSERT INTO identity_ledger (at_ms, kind, handle, room_id, actor, lineage, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.atMs ?? Date.now(),
    input.kind,
    input.handle ?? null,
    input.roomId ?? null,
    input.actor ?? null,
    input.lineage ?? null,
    input.detail ? JSON.stringify(input.detail) : null
  );
}

type RawLedgerRow = Omit<IdentityLedgerRow, 'detail'> & { detail: string | null };

export function listLedger(filter: { handle?: string; limit?: number } = {}): IdentityLedgerRow[] {
  const db = getIdentityDb();
  const limit = filter.limit ?? 200;
  const rows = (filter.handle
    ? db.prepare(
        `SELECT * FROM identity_ledger WHERE handle = ? ORDER BY id DESC LIMIT ?`
      ).all(filter.handle, limit)
    : db.prepare(`SELECT * FROM identity_ledger ORDER BY id DESC LIMIT ?`).all(limit)
  ) as RawLedgerRow[];
  return rows.map((row) => ({
    ...row,
    detail: row.detail ? (JSON.parse(row.detail) as Record<string, unknown>) : null
  }));
}
