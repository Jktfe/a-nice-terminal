/**
 * messageQueueStore — durable, editable curated work queue for a local-model
 * chair (JWPK 2026-06-09). The spine of the two-tier "curator + worker" design:
 *
 *   inbound @s ──enqueue──► [ room_message_queue ] ◄──curate── Perspective/curator
 *                                  │                            (condense/dedupe/
 *                                  │ pullNext (one-in-flight,    drop-resolved/sort)
 *                                  ▼  gated on worker capacity)
 *                              Gemma (worker)
 *
 * Unlike the in-memory pty-inject-queue, this is PERSISTED + EDITABLE by user
 * AND CLI (so the queue is a first-class, inspectable, steerable object). All
 * model work happens elsewhere; this module is pure SQLite state + invariants.
 *
 * Spec: docs/curated-queue-spec.md.
 */

import { randomUUID } from 'node:crypto';
import { getIdentityDb } from './db';

export type QueueStatus = 'pending' | 'working' | 'done' | 'dropped';
export type QueueKind = 'mention' | 'cron' | 'task' | 'manual';

export type QueueItem = {
  id: string;
  roomId: string;
  targetHandle: string;
  sourceMessageIds: string[];
  curatedText: string;
  kind: QueueKind;
  priority: number;
  status: QueueStatus;
  createdAtMs: number;
  updatedAtMs: number;
};

type QueueRow = {
  id: string;
  room_id: string;
  target_handle: string;
  source_message_ids: string;
  curated_text: string;
  kind: string;
  priority: number;
  status: string;
  created_at_ms: number;
  updated_at_ms: number;
};

const VALID_STATUS: ReadonlySet<string> = new Set<QueueStatus>(['pending', 'working', 'done', 'dropped']);
const VALID_KIND: ReadonlySet<string> = new Set<QueueKind>(['mention', 'cron', 'task', 'manual']);

// Track the DB INSTANCE the schema was created against, not a bare boolean —
// resetIdentityDbForTests() closes + deletes the file and the next
// getIdentityDb() returns a fresh handle, so a boolean flag would wrongly skip
// re-creating the table on the new connection (caused "no such table" in tests).
let schemaReadyForDb: unknown = null;
function ensureSchema(db = getIdentityDb()): void {
  if (schemaReadyForDb === db) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS room_message_queue (
      id                 TEXT PRIMARY KEY,
      room_id            TEXT NOT NULL,
      target_handle      TEXT NOT NULL,
      source_message_ids TEXT NOT NULL DEFAULT '[]',
      curated_text       TEXT NOT NULL DEFAULT '',
      kind               TEXT NOT NULL DEFAULT 'mention' CHECK (kind IN ('mention','cron','task','manual')),
      priority           INTEGER NOT NULL,
      status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','working','done','dropped')),
      created_at_ms      INTEGER NOT NULL,
      updated_at_ms      INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_msgq_lookup
      ON room_message_queue (room_id, target_handle, status, priority, created_at_ms);
  `);
  schemaReadyForDb = db;
}

function normaliseHandle(raw: string): string {
  const t = raw.trim();
  return t.startsWith('@') ? t : `@${t}`;
}

function rowToItem(row: QueueRow): QueueItem {
  let ids: string[] = [];
  try {
    const parsed = JSON.parse(row.source_message_ids);
    if (Array.isArray(parsed)) ids = parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    ids = [];
  }
  return {
    id: row.id,
    roomId: row.room_id,
    targetHandle: row.target_handle,
    sourceMessageIds: ids,
    curatedText: row.curated_text,
    kind: (VALID_KIND.has(row.kind) ? row.kind : 'mention') as QueueKind,
    priority: row.priority,
    status: (VALID_STATUS.has(row.status) ? row.status : 'pending') as QueueStatus,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms
  };
}

export type EnqueueInput = {
  roomId: string;
  targetHandle: string;
  sourceMessageId?: string | null;
  text: string;
  kind?: QueueKind;
  /** Lower = sooner. Omit → defaults to arrival order (the createdAt clock). */
  priority?: number;
};

/** Add a pending item. Default priority = createdAt so the natural order is FIFO. */
export function enqueue(input: EnqueueInput, now = Date.now(), db = getIdentityDb()): QueueItem {
  ensureSchema(db);
  const id = `q_${randomUUID().slice(0, 12)}`;
  const handle = normaliseHandle(input.targetHandle);
  const kind: QueueKind = input.kind && VALID_KIND.has(input.kind) ? input.kind : 'mention';
  const sourceIds = input.sourceMessageId ? [input.sourceMessageId] : [];
  const priority = typeof input.priority === 'number' ? input.priority : now;
  const row: QueueRow = {
    id,
    room_id: input.roomId,
    target_handle: handle,
    source_message_ids: JSON.stringify(sourceIds),
    curated_text: input.text,
    kind,
    priority,
    status: 'pending',
    created_at_ms: now,
    updated_at_ms: now
  };
  db.prepare(
    `INSERT INTO room_message_queue
       (id, room_id, target_handle, source_message_ids, curated_text, kind, priority, status, created_at_ms, updated_at_ms)
     VALUES (@id, @room_id, @target_handle, @source_message_ids, @curated_text, @kind, @priority, @status, @created_at_ms, @updated_at_ms)`
  ).run(row);
  return rowToItem(row);
}

export function getItem(id: string, db = getIdentityDb()): QueueItem | null {
  ensureSchema(db);
  const row = db.prepare(`SELECT * FROM room_message_queue WHERE id = ?`).get(id) as QueueRow | undefined;
  return row ? rowToItem(row) : null;
}

export function listQueue(
  roomId: string,
  targetHandle: string,
  opts: { status?: QueueStatus } = {},
  db = getIdentityDb()
): QueueItem[] {
  ensureSchema(db);
  const handle = normaliseHandle(targetHandle);
  const rows = (
    opts.status
      ? db
          .prepare(
            `SELECT * FROM room_message_queue
               WHERE room_id = ? AND target_handle = ? AND status = ?
               ORDER BY priority ASC, created_at_ms ASC`
          )
          .all(roomId, handle, opts.status)
      : db
          .prepare(
            `SELECT * FROM room_message_queue
               WHERE room_id = ? AND target_handle = ?
               ORDER BY priority ASC, created_at_ms ASC`
          )
          .all(roomId, handle)
  ) as QueueRow[];
  return rows.map(rowToItem);
}

/**
 * Atomically claim the next pending item for the worker — ONE-IN-FLIGHT.
 * If an item is already `working` for this (room,handle), returns null (the
 * worker is busy; the capacity gate must not double-release). Otherwise the
 * next pending item (priority, then FIFO) flips to `working` and is returned.
 * Transactional so concurrent pulls can't both win.
 */
export function pullNext(roomId: string, targetHandle: string, now = Date.now(), db = getIdentityDb()): QueueItem | null {
  ensureSchema(db);
  const handle = normaliseHandle(targetHandle);
  const tx = db.transaction((): QueueItem | null => {
    const working = db
      .prepare(`SELECT 1 FROM room_message_queue WHERE room_id = ? AND target_handle = ? AND status = 'working' LIMIT 1`)
      .get(roomId, handle);
    if (working) return null; // one-in-flight: worker busy
    const next = db
      .prepare(
        `SELECT * FROM room_message_queue
           WHERE room_id = ? AND target_handle = ? AND status = 'pending'
           ORDER BY priority ASC, created_at_ms ASC LIMIT 1`
      )
      .get(roomId, handle) as QueueRow | undefined;
    if (!next) return null;
    db.prepare(`UPDATE room_message_queue SET status = 'working', updated_at_ms = ? WHERE id = ?`).run(now, next.id);
    return rowToItem({ ...next, status: 'working', updated_at_ms: now });
  });
  return tx();
}

function setStatus(id: string, status: QueueStatus, now: number, db: ReturnType<typeof getIdentityDb>): boolean {
  ensureSchema(db);
  const r = db
    .prepare(`UPDATE room_message_queue SET status = ?, updated_at_ms = ? WHERE id = ?`)
    .run(status, now, id);
  return r.changes > 0;
}

export function markDone(id: string, now = Date.now(), db = getIdentityDb()): boolean {
  return setStatus(id, 'done', now, db);
}

export function markDropped(id: string, now = Date.now(), db = getIdentityDb()): boolean {
  return setStatus(id, 'dropped', now, db);
}

export type UpdateInput = { curatedText?: string; priority?: number; status?: QueueStatus };

/** Edit an item (curator condense, user/CLI edit, reprioritise). */
export function updateItem(id: string, patch: UpdateInput, now = Date.now(), db = getIdentityDb()): QueueItem | null {
  ensureSchema(db);
  const existing = getItem(id, db);
  if (!existing) return null;
  const curatedText = patch.curatedText ?? existing.curatedText;
  const priority = typeof patch.priority === 'number' ? patch.priority : existing.priority;
  const status = patch.status && VALID_STATUS.has(patch.status) ? patch.status : existing.status;
  db.prepare(
    `UPDATE room_message_queue SET curated_text = ?, priority = ?, status = ?, updated_at_ms = ? WHERE id = ?`
  ).run(curatedText, priority, status, now, id);
  return getItem(id, db);
}

export function reorder(id: string, newPriority: number, now = Date.now(), db = getIdentityDb()): QueueItem | null {
  return updateItem(id, { priority: newPriority }, now, db);
}

/**
 * Coalesce duplicates (curator dedupe): merge `sourceId`'s source_message_ids
 * into `targetId`, then drop the source. Returns the merged target, or null if
 * either is missing. PRESERVES the source's text: if the source's curated_text
 * differs from the target's (and isn't already contained), it is appended — so
 * even a wrong/near-dup merge never silently loses an instruction (adversarial
 * review M3: order-independent similarity can match opposite messages). Exact
 * dups append nothing.
 */
export function coalesce(targetId: string, sourceId: string, now = Date.now(), db = getIdentityDb()): QueueItem | null {
  ensureSchema(db);
  const tx = db.transaction((): QueueItem | null => {
    const target = getItem(targetId, db);
    const source = getItem(sourceId, db);
    if (!target || !source) return null;
    const merged = Array.from(new Set([...target.sourceMessageIds, ...source.sourceMessageIds]));
    const srcText = source.curatedText.trim();
    const tgtText = target.curatedText;
    const mergedText =
      srcText.length === 0 || tgtText.includes(srcText) ? tgtText : `${tgtText}\n— also: ${srcText}`;
    db.prepare(`UPDATE room_message_queue SET source_message_ids = ?, curated_text = ?, updated_at_ms = ? WHERE id = ?`).run(
      JSON.stringify(merged),
      mergedText,
      now,
      targetId
    );
    db.prepare(`UPDATE room_message_queue SET status = 'dropped', updated_at_ms = ? WHERE id = ?`).run(now, sourceId);
    return getItem(targetId, db);
  });
  return tx();
}

/**
 * Reclaim stuck `working` items — robustness backstop. If the worker dies (or
 * hangs) mid-item, that item stays `working` forever and pullNext stalls the
 * whole queue (one-in-flight). After `ttlMs` with no progress, flip stale
 * `working` items back to `pending` so a recovered/replacement worker can pull
 * them. Returns the count reclaimed. (Mirrors the room-worker lease TTL reclaim.)
 */
export function reclaimStaleWorking(
  roomId: string,
  targetHandle: string,
  ttlMs: number,
  now = Date.now(),
  db = getIdentityDb()
): number {
  ensureSchema(db);
  const handle = normaliseHandle(targetHandle);
  const cutoff = now - ttlMs;
  const r = db
    .prepare(
      `UPDATE room_message_queue
         SET status = 'pending', updated_at_ms = ?
       WHERE room_id = ? AND target_handle = ? AND status = 'working' AND updated_at_ms < ?`
    )
    .run(now, roomId, handle, cutoff);
  return r.changes;
}

export function countPending(roomId: string, targetHandle: string, db = getIdentityDb()): number {
  ensureSchema(db);
  const handle = normaliseHandle(targetHandle);
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM room_message_queue WHERE room_id = ? AND target_handle = ? AND status = 'pending'`
    )
    .get(roomId, handle) as { n: number };
  return row.n;
}

/** Test/maintenance helper. */
export function resetMessageQueueForTests(db = getIdentityDb()): void {
  ensureSchema(db);
  db.prepare(`DELETE FROM room_message_queue`).run();
}
