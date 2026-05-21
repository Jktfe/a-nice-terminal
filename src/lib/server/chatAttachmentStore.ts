/**
 * Files shared inside a chat room.
 *
 * Vertical slice for M11 upload-a-file. Stores file bytes in SQLite so
 * markdown attachment URLs survive a server restart/kickstart.
 * No chat-message integration in this slice — files are surfaced via a
 * dedicated /attachments endpoint, leaving ChatMessageKind small. Slice 2
 * decides whether uploads also post a message kind or live in a sidebar.
 *
 * Public functions:
 *   - shareFileInRoom            stores one new file under a room
 *   - listFilesSharedInRoom      returns files in upload order, newest first
 *   - findSharedFileById         returns one file by its id
 *   - resetChatAttachmentStoreForTests
 *
 * Replaces in a later milestone with object storage. Public function names
 * stay the same so screens won't change when the swap happens.
 *
 * Security: the store accepts a uploadedByHandle but does NOT verify the
 * caller is a member of the room. The endpoint does that, same pattern
 * as M16 agent-events + M19 typing — membership-before-validation lives
 * at the API boundary.
 */

import { getIdentityDb } from './db';

const HARD_CAP_BASE64_LENGTH = 8 * 1024 * 1024; // ~6 MB binary, generous for slice 1

export type SharedFile = {
  id: string;
  roomId: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  contentsBase64: string;
  uploadedByHandle: string;
  uploadedAt: string;
};

type SharedFileRow = {
  id: string;
  room_id: string;
  filename: string;
  mime_type: string;
  byte_size: number;
  contents_base64: string;
  uploaded_by_handle: string;
  uploaded_at: string;
};

function rowToSharedFile(row: SharedFileRow): SharedFile {
  return {
    id: row.id,
    roomId: row.room_id,
    filename: row.filename,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    contentsBase64: row.contents_base64,
    uploadedByHandle: row.uploaded_by_handle,
    uploadedAt: row.uploaded_at
  };
}

export function shareFileInRoom(input: {
  roomId: string;
  filename: string;
  mimeType: string;
  contentsBase64: string;
  uploadedByHandle: string;
}): SharedFile {
  const trimmedRoomId = input.roomId.trim();
  if (trimmedRoomId.length === 0) {
    throw new Error('A roomId is required to share a file.');
  }
  const safeFilename = sanitiseFilename(input.filename);
  const trimmedMimeType = input.mimeType.trim();
  if (trimmedMimeType.length === 0) {
    throw new Error('A mimeType is required to share a file.');
  }
  const trimmedHandle = input.uploadedByHandle.trim();
  if (trimmedHandle.length === 0) {
    throw new Error('An uploadedByHandle is required to share a file.');
  }
  if (input.contentsBase64.length === 0) {
    throw new Error('A file with no contents cannot be shared.');
  }
  if (input.contentsBase64.length > HARD_CAP_BASE64_LENGTH) {
    throw new Error('That file is too big to share right now (max about 6 MB).');
  }
  if (!isStrictBase64(input.contentsBase64)) {
    throw new Error('contentsBase64 is not valid base64 (bad characters or padding).');
  }

  const nowMs = Date.now();
  const uploadedAt = new Date(nowMs).toISOString();
  const db = getIdentityDb();
  const insertAndRead = db.transaction(() => {
    const uploadOrderRow = db
      .prepare('SELECT COALESCE(MAX(upload_order), 0) + 1 AS next_order FROM chat_room_attachments')
      .get() as { next_order: number };
    const id = makeAttachmentId();
    db.prepare(
      `INSERT INTO chat_room_attachments
         (id, room_id, filename, mime_type, byte_size, contents_base64,
          uploaded_by_handle, uploaded_at, uploaded_at_ms, upload_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      trimmedRoomId,
      safeFilename,
      trimmedMimeType,
      estimateByteSizeFromBase64(input.contentsBase64),
      input.contentsBase64,
      trimmedHandle,
      uploadedAt,
      nowMs,
      uploadOrderRow.next_order
    );
    return db.prepare(
      `SELECT id, room_id, filename, mime_type, byte_size, contents_base64,
              uploaded_by_handle, uploaded_at
         FROM chat_room_attachments
        WHERE id = ?`
    ).get(id) as SharedFileRow;
  });

  return rowToSharedFile(insertAndRead());
}

export function listFilesSharedInRoom(roomId: string): SharedFile[] {
  return (getIdentityDb()
    .prepare(
      `SELECT id, room_id, filename, mime_type, byte_size, contents_base64,
              uploaded_by_handle, uploaded_at
         FROM chat_room_attachments
        WHERE room_id = ?
        ORDER BY upload_order DESC`
    )
    .all(roomId) as SharedFileRow[]).map(rowToSharedFile);
}

export function findSharedFileById(attachmentId: string): SharedFile | undefined {
  const row = getIdentityDb()
    .prepare(
      `SELECT id, room_id, filename, mime_type, byte_size, contents_base64,
              uploaded_by_handle, uploaded_at
         FROM chat_room_attachments
        WHERE id = ?`
    )
    .get(attachmentId) as SharedFileRow | undefined;
  return row ? rowToSharedFile(row) : undefined;
}

export function resetChatAttachmentStoreForTests(): void {
  getIdentityDb().prepare('DELETE FROM chat_room_attachments').run();
}

function makeAttachmentId(): string {
  const four = Math.random().toString(36).slice(2, 6);
  const six = Math.random().toString(36).slice(2, 8);
  return `file_${four}${six}`;
}

function sanitiseFilename(rawFilename: string): string {
  // Strip directory parts and leading dots so an uploaded "../etc/passwd"
  // becomes "passwd". The download endpoint never builds a filesystem path
  // from this name anyway — bytes are stored in memory — but keeping the
  // display string clean avoids surprising room readers.
  const stripped = rawFilename
    .split(/[\\/]/)
    .pop() ?? rawFilename;
  const noLeadingDots = stripped.replace(/^\.+/, '');
  const trimmed = noLeadingDots.trim();
  if (trimmed.length === 0) {
    throw new Error('A filename is required to share a file.');
  }
  return trimmed;
}

function estimateByteSizeFromBase64(contentsBase64: string): number {
  // Base64 encodes 3 bytes per 4 characters, minus padding.
  const padding = contentsBase64.endsWith('==') ? 2 : contentsBase64.endsWith('=') ? 1 : 0;
  return Math.floor((contentsBase64.length * 3) / 4) - padding;
}

function isStrictBase64(value: string): boolean {
  // Strict canonical base64: length multiple of 4, only A-Za-z0-9+/, optional
  // 1 or 2 trailing '=' for padding, and at least one non-padding character.
  // Buffer.from(..., 'base64') is permissive and would silently decode junk
  // like "!!!!" to a 3-byte arbitrary string; this validator stops that
  // before any bytes hit the store.
  if (value.length === 0) return false;
  if (value.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}
