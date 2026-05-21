/**
 * linkedChatPermissionStore — terminal-scoped linked-chat allow/deny rows per
 * M3.3a. Route-level identity gates decide who can read/write; this store only
 * persists one permission row per (terminal_id, subject_handle).
 */
import { randomUUID } from 'node:crypto';
import { getIdentityDb } from './db';

export type LinkedChatPermissionState = 'allow' | 'deny';

export type LinkedChatPermissionRow = {
  id: string;
  terminal_id: string;
  subject_handle: string;
  state: LinkedChatPermissionState;
  set_by: string;
  set_at_ms: number;
  reason: string | null;
};

export type SetLinkedChatPermissionInput = {
  terminalId: string;
  subjectHandle: string;
  state: LinkedChatPermissionState;
  setBy: string;
  reason?: string | null;
};

export function isLinkedChatPermissionState(value: unknown): value is LinkedChatPermissionState {
  return value === 'allow' || value === 'deny';
}

function currentUnixMs(): number {
  return Date.now();
}

function normalizeHandle(rawHandle: string): string {
  const trimmed = rawHandle.trim();
  if (trimmed.length === 0) return trimmed;
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

function terminalExists(terminalId: string): boolean {
  const db = getIdentityDb();
  const row = db.prepare(`SELECT id FROM terminals WHERE id = ?`).get(terminalId) as { id: string } | undefined;
  return row !== undefined;
}

export function setLinkedChatPermission(input: SetLinkedChatPermissionInput): LinkedChatPermissionRow | null {
  if (!isLinkedChatPermissionState(input.state)) return null;
  const subjectHandle = normalizeHandle(input.subjectHandle);
  const setBy = normalizeHandle(input.setBy);
  if (subjectHandle.length === 0 || setBy.length === 0) return null;
  if (!terminalExists(input.terminalId)) return null;

  const db = getIdentityDb();
  const id = randomUUID();
  const now = currentUnixMs();
  const reason = input.reason?.trim() || null;

  db.prepare(`INSERT INTO linked_chat_permissions
      (id, terminal_id, subject_handle, state, set_by, set_at_ms, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(terminal_id, subject_handle) DO UPDATE SET
        state = excluded.state,
        set_by = excluded.set_by,
        set_at_ms = excluded.set_at_ms,
        reason = excluded.reason`).run(
    id, input.terminalId, subjectHandle, input.state, setBy, now, reason
  );

  return getLinkedChatPermission(input.terminalId, subjectHandle);
}

export function getLinkedChatPermission(terminalId: string, subjectHandle: string): LinkedChatPermissionRow | null {
  const db = getIdentityDb();
  const row = db
    .prepare(`SELECT * FROM linked_chat_permissions WHERE terminal_id = ? AND subject_handle = ?`)
    .get(terminalId, normalizeHandle(subjectHandle)) as LinkedChatPermissionRow | undefined;
  return row ?? null;
}

export function listLinkedChatPermissions(terminalId: string): LinkedChatPermissionRow[] {
  const db = getIdentityDb();
  return db
    .prepare(`SELECT * FROM linked_chat_permissions WHERE terminal_id = ? ORDER BY subject_handle ASC`)
    .all(terminalId) as LinkedChatPermissionRow[];
}

export function isLinkedChatSubjectAllowed(terminalId: string, subjectHandle: string): boolean {
  return getLinkedChatPermission(terminalId, subjectHandle)?.state === 'allow';
}
