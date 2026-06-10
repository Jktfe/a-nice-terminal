/**
 * handleBindingsStore — daemon-witnessed pane↔handle bindings plus the
 * durable `handles` rows they bind to (ant-handles-rooms-ownership-contract.md
 * concepts 1 and 3; Step 1 of the AC3 sequencing, room "ANT sorted"
 * 2026-06-10).
 *
 * Writer discipline: ONLY the witness layer (pane verification / boot
 * reconcile / registration wiring) calls bindHandle and the tombstone
 * functions. An agent's own claim about its handle is never an input here —
 * that is rule R1. Exactly one live binding per handle is structural (partial
 * unique index handle_bindings_one_live); a re-bind supersedes the prior row
 * inside one transaction rather than racing it.
 *
 * Every mutation appends to identity_ledger (R4). Nothing reads these tables
 * for authority yet — that is the Step 2 read-flip.
 */

import { getIdentityDb } from './db';
import { appendLedger } from './identityLedgerStore';

export type HandleBindingRow = {
  id: number;
  handle: string;
  pane: string | null;
  pid: number | null;
  pid_start: string | null;
  spawned_by: string | null;
  terminal_id: string | null;
  bound_at_ms: number;
  tombstoned_at_ms: number | null;
  tombstone_reason: string | null;
};

export type HandleRow = {
  handle: string;
  owners: string[] | null;
  approval: number;
  vacated_at_ms: number | null;
  created_at_ms: number;
  created_by: string | null;
};

export type BindHandleInput = {
  handle: string;
  pane: string | null;
  pid: number | null;
  pidStart: string | null;
  spawnedBy?: string | null;
  terminalId?: string | null;
  atMs?: number;
};

function canonicalHandle(raw: string): string {
  return '@' + raw.trim().replace(/^@+/, '');
}

type RawHandleRow = Omit<HandleRow, 'owners'> & { owners: string | null };

export function getHandleRow(rawHandle: string): HandleRow | null {
  const db = getIdentityDb();
  const row = db.prepare(`SELECT * FROM handles WHERE handle = ?`)
    .get(canonicalHandle(rawHandle)) as RawHandleRow | undefined;
  if (!row) return null;
  return { ...row, owners: row.owners ? (JSON.parse(row.owners) as string[]) : null };
}

export function getLiveBinding(rawHandle: string): HandleBindingRow | null {
  const db = getIdentityDb();
  const row = db.prepare(
    `SELECT * FROM handle_bindings WHERE handle = ? AND tombstoned_at_ms IS NULL`
  ).get(canonicalHandle(rawHandle)) as HandleBindingRow | undefined;
  return row ?? null;
}

/**
 * Witness read: the live binding sitting on a pane, if any. This is the
 * clean-core answer to "who is this pane?" — the read the Step 2 resolver
 * uses. Returns null when nothing is witnessed on the pane.
 */
export function getLiveBindingByPane(pane: string): HandleBindingRow | null {
  const db = getIdentityDb();
  const row = db.prepare(
    `SELECT * FROM handle_bindings WHERE pane = ? AND tombstoned_at_ms IS NULL
     ORDER BY bound_at_ms DESC LIMIT 1`
  ).get(pane) as HandleBindingRow | undefined;
  return row ?? null;
}

export function listLiveBindings(): HandleBindingRow[] {
  const db = getIdentityDb();
  return db.prepare(
    `SELECT * FROM handle_bindings WHERE tombstoned_at_ms IS NULL ORDER BY handle`
  ).all() as HandleBindingRow[];
}

/**
 * Witness write: bind a handle to a pane/process. Supersedes any prior live
 * binding for the same handle (powercut reclaim / occupant swap), upserts the
 * durable handles row, and clears its vacancy. Transactional so the partial
 * unique index never sees two live rows mid-flight.
 */
export function bindHandle(input: BindHandleInput): HandleBindingRow {
  const db = getIdentityDb();
  const handle = canonicalHandle(input.handle);
  const nowMs = input.atMs ?? Date.now();
  const run = db.transaction((): HandleBindingRow => {
    const prior = db.prepare(
      `SELECT id FROM handle_bindings WHERE handle = ? AND tombstoned_at_ms IS NULL`
    ).get(handle) as { id: number } | undefined;
    if (prior) {
      db.prepare(
        `UPDATE handle_bindings
         SET tombstoned_at_ms = ?, tombstone_reason = 'superseded-by-rebind'
         WHERE id = ?`
      ).run(nowMs, prior.id);
      appendLedger({
        kind: 'binding.superseded', handle, actor: 'daemon', atMs: nowMs,
        detail: { superseded_binding_id: prior.id, new_pane: input.pane }
      });
    }
    // Contract step 5 (blessed msg_6dtpw2o4pn): claims are LOUD. Reclaiming a
    // VACANT desk that has owners ledgers an owner notification — the inbox
    // surface reads these rows; the record itself is the canonical notify.
    const priorHandleRow = db.prepare(
      `SELECT vacated_at_ms, owners FROM handles WHERE handle = ?`
    ).get(handle) as { vacated_at_ms: number | null; owners: string | null } | undefined;
    db.prepare(
      `INSERT INTO handles (handle, created_at_ms, created_by)
       VALUES (?, ?, ?)
       ON CONFLICT(handle) DO UPDATE SET vacated_at_ms = NULL`
    ).run(handle, nowMs, input.spawnedBy ?? null);
    if (priorHandleRow?.vacated_at_ms != null && priorHandleRow.owners) {
      const owners = JSON.parse(priorHandleRow.owners) as string[];
      if (owners.length > 0) {
        appendLedger({
          kind: 'owner.notified', handle, actor: 'daemon', atMs: nowMs,
          detail: { reason: 'vacant-claim', owners, pane: input.pane, pid: input.pid }
        });
      }
    }
    const info = db.prepare(
      `INSERT INTO handle_bindings
         (handle, pane, pid, pid_start, spawned_by, terminal_id, bound_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      handle, input.pane, input.pid, input.pidStart,
      input.spawnedBy ?? null, input.terminalId ?? null, nowMs
    );
    appendLedger({
      kind: 'binding.claimed', handle, actor: 'daemon', atMs: nowMs,
      lineage: input.spawnedBy ?? null,
      detail: { pane: input.pane, pid: input.pid, terminal_id: input.terminalId ?? null }
    });
    return db.prepare(`SELECT * FROM handle_bindings WHERE id = ?`)
      .get(info.lastInsertRowid) as HandleBindingRow;
  });
  return run();
}

/**
 * Witness write: tombstone the live binding for a handle and mark the durable
 * handles row vacant. `reason` is death evidence ('pane-not-found',
 * 'boot-reconcile') — callers must NOT tombstone on tmux-unreachable.
 */
export function tombstoneBinding(rawHandle: string, reason: string, atMs?: number): boolean {
  const db = getIdentityDb();
  const handle = canonicalHandle(rawHandle);
  const nowMs = atMs ?? Date.now();
  const run = db.transaction((): boolean => {
    const info = db.prepare(
      `UPDATE handle_bindings
       SET tombstoned_at_ms = ?, tombstone_reason = ?
       WHERE handle = ? AND tombstoned_at_ms IS NULL`
    ).run(nowMs, reason, handle);
    if (info.changes === 0) return false;
    db.prepare(`UPDATE handles SET vacated_at_ms = ? WHERE handle = ?`).run(nowMs, handle);
    appendLedger({
      kind: 'binding.tombstoned', handle, actor: 'daemon', atMs: nowMs,
      detail: { reason }
    });
    return true;
  });
  return run();
}

/** Witness write: pane died — tombstone every live binding sitting on it. */
export function tombstoneBindingsForPane(pane: string, reason: string, atMs?: number): number {
  const db = getIdentityDb();
  const rows = db.prepare(
    `SELECT handle FROM handle_bindings WHERE pane = ? AND tombstoned_at_ms IS NULL`
  ).all(pane) as { handle: string }[];
  let count = 0;
  for (const row of rows) {
    if (tombstoneBinding(row.handle, reason, atMs)) count++;
  }
  return count;
}
