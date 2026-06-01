/**
 * Read receipts for chat messages.
 *
 * Backs M24 read-receipts slice 1 (backend). Stores which handle has read
 * which message, idempotently. A second mark from the same handle on the
 * same message keeps the original readAt time — first-read wins.
 *
 * Public functions:
 *   - markMessageRead             record a reader (idempotent)
 *   - listReadersForMessage       readers of one message, oldest first
 *   - hasReaderReadMessage        boolean check
 *   - resetMessageReadReceiptStoreForTests
 *
 * No chat-message integration here — the store accepts opaque message ids
 * and trusts the caller (the endpoint) to verify the message exists. This
 * keeps the store standalone and avoids editing chatMessageStore for what
 * is essentially a cross-cutting marker.
 */

import { getIdentityDb } from './db';

export type MessageReadReceipt = {
  messageId: string;
  readerHandle: string;
  readAt: string;
};

type MessageReadReceiptRow = {
  message_id: string;
  reader_handle: string;
  read_at: string;
};

function rowToReceipt(row: MessageReadReceiptRow): MessageReadReceipt {
  return {
    messageId: row.message_id,
    readerHandle: row.reader_handle,
    readAt: row.read_at
  };
}

export function markMessageRead(input: {
  messageId: string;
  readerHandle: string;
}): MessageReadReceipt {
  const trimmedMessageId = input.messageId.trim();
  if (trimmedMessageId.length === 0) {
    throw new Error('A messageId is required to mark a read.');
  }
  const trimmedHandle = input.readerHandle.trim();
  if (trimmedHandle.length === 0) {
    throw new Error('A readerHandle is required to mark a read.');
  }

  const db = getIdentityDb();
  const nowMs = Date.now();
  const readAt = new Date(nowMs).toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO message_read_receipts
       (message_id, reader_handle, read_at, read_at_ms)
     VALUES (?, ?, ?, ?)`
  ).run(trimmedMessageId, trimmedHandle, readAt, nowMs);

  const row = db.prepare(
    `SELECT message_id, reader_handle, read_at
       FROM message_read_receipts
      WHERE message_id = ? AND reader_handle = ?`
  ).get(trimmedMessageId, trimmedHandle) as MessageReadReceiptRow | undefined;
  if (!row) throw new Error('Could not record read receipt.');
  return rowToReceipt(row);
}

export function listReadersForMessage(messageId: string): MessageReadReceipt[] {
  return (getIdentityDb()
    .prepare(
      `SELECT message_id, reader_handle, read_at
         FROM message_read_receipts
        WHERE message_id = ?
        ORDER BY read_at_ms ASC, reader_handle ASC`
    )
    .all(messageId) as MessageReadReceiptRow[]).map(rowToReceipt);
}

export function listReadersForMessages(messageIds: readonly string[]): Record<string, MessageReadReceipt[]> {
  const ids = [...new Set(messageIds.map((id) => id.trim()).filter((id) => id.length > 0))];
  if (ids.length === 0) return {};

  const placeholders = ids.map(() => '?').join(', ');
  const rows = getIdentityDb()
    .prepare(
      `SELECT message_id, reader_handle, read_at
         FROM message_read_receipts
        WHERE message_id IN (${placeholders})
        ORDER BY message_id ASC, read_at_ms ASC, reader_handle ASC`
    )
    .all(...ids) as MessageReadReceiptRow[];

  const byMessageId: Record<string, MessageReadReceipt[]> = {};
  for (const row of rows) {
    const bucket = byMessageId[row.message_id] ?? [];
    bucket.push(rowToReceipt(row));
    byMessageId[row.message_id] = bucket;
  }
  return byMessageId;
}

export function hasReaderReadMessage(
  messageId: string,
  readerHandle: string
): boolean {
  const row = getIdentityDb()
    .prepare(
      `SELECT 1 AS present
         FROM message_read_receipts
        WHERE message_id = ? AND reader_handle = ?`
    )
    .get(messageId, readerHandle) as { present: number } | undefined;
  return Boolean(row);
}

export function resetMessageReadReceiptStoreForTests(): void {
  getIdentityDb().prepare('DELETE FROM message_read_receipts').run();
}
