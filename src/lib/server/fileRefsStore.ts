/**
 * Persisted store for file_refs — tagging files as relevant to a terminal,
 * chatroom, or globally. v3 shipped this as /api/sessions/<id>/file-refs
 * (terminal scope only); fresh-ANT generalises to three scopes. JWPK
 * file-refs subsystem (also known as "flag") 2026-05-16.
 *
 * Reuses the chatRoomStore persistence pattern: row → object mapper,
 * randomUUID id, getIdentityDb() singleton, reset helper for tests.
 *
 * 9-year-old-readable. No business rules beyond the schema CHECK constraint
 * on scope — validation of scope_target (does the terminal actually exist?)
 * lives at the route layer.
 */

import { randomUUID } from 'node:crypto';
import { getIdentityDb } from './db';

export type FileRefScope = 'terminal' | 'chatroom' | 'global';

export type FileRef = {
  id: string;
  filePath: string;
  scope: FileRefScope;
  scopeTarget: string | null;
  label: string | null;
  description: string | null;
  flaggedBy: string | null;
  flaggedAtMs: number;
};

type FileRefRow = {
  id: string;
  file_path: string;
  scope: FileRefScope;
  scope_target: string | null;
  label: string | null;
  description: string | null;
  flagged_by: string | null;
  flagged_at_ms: number;
};

function rowToFileRef(row: FileRefRow): FileRef {
  return {
    id: row.id,
    filePath: row.file_path,
    scope: row.scope,
    scopeTarget: row.scope_target,
    label: row.label,
    description: row.description,
    flaggedBy: row.flagged_by,
    flaggedAtMs: row.flagged_at_ms
  };
}

export type AddFileRefInput = {
  filePath: string;
  scope: FileRefScope;
  scopeTarget?: string | null;
  label?: string | null;
  description?: string | null;
  flaggedBy?: string | null;
  nowMs?: number;
};

export function addFileRef(input: AddFileRefInput): FileRef {
  const trimmedPath = input.filePath.trim();
  if (trimmedPath.length === 0) {
    throw new Error('A file_ref needs a non-empty file_path.');
  }
  if (input.scope !== 'terminal' && input.scope !== 'chatroom' && input.scope !== 'global') {
    throw new Error(`Unknown scope "${input.scope}". Must be terminal | chatroom | global.`);
  }
  if (input.scope !== 'global') {
    const target = (input.scopeTarget ?? '').trim();
    if (target.length === 0) {
      throw new Error(`scope_target is required when scope is "${input.scope}".`);
    }
  }

  const db = getIdentityDb();
  const id = randomUUID();
  const nowMs = input.nowMs ?? Date.now();
  const scopeTarget = input.scope === 'global' ? null : (input.scopeTarget ?? '').trim();

  db.prepare(`INSERT INTO file_refs
    (id, file_path, scope, scope_target, label, description, flagged_by, flagged_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id,
    trimmedPath,
    input.scope,
    scopeTarget,
    input.label ?? null,
    input.description ?? null,
    input.flaggedBy ?? null,
    nowMs
  );

  return getFileRef(id)!;
}

export function getFileRef(id: string): FileRef | undefined {
  const db = getIdentityDb();
  const row = db
    .prepare(`SELECT id, file_path, scope, scope_target, label, description, flagged_by, flagged_at_ms
              FROM file_refs WHERE id = ?`)
    .get(id) as FileRefRow | undefined;
  return row ? rowToFileRef(row) : undefined;
}

export function listFileRefsForScope(scope: FileRefScope, scopeTarget?: string | null): FileRef[] {
  const db = getIdentityDb();
  if (scope === 'global') {
    const rows = db
      .prepare(`SELECT id, file_path, scope, scope_target, label, description, flagged_by, flagged_at_ms
                FROM file_refs WHERE scope = 'global'
                ORDER BY flagged_at_ms DESC`)
      .all() as FileRefRow[];
    return rows.map(rowToFileRef);
  }
  const target = (scopeTarget ?? '').trim();
  if (target.length === 0) {
    throw new Error(`scope_target is required when scope is "${scope}".`);
  }
  const rows = db
    .prepare(`SELECT id, file_path, scope, scope_target, label, description, flagged_by, flagged_at_ms
              FROM file_refs WHERE scope = ? AND scope_target = ?
              ORDER BY flagged_at_ms DESC`)
    .all(scope, target) as FileRefRow[];
  return rows.map(rowToFileRef);
}

export function listFileRefsByPath(filePath: string): FileRef[] {
  const trimmed = filePath.trim();
  if (trimmed.length === 0) return [];
  const db = getIdentityDb();
  const rows = db
    .prepare(`SELECT id, file_path, scope, scope_target, label, description, flagged_by, flagged_at_ms
              FROM file_refs WHERE file_path = ?
              ORDER BY flagged_at_ms DESC`)
    .all(trimmed) as FileRefRow[];
  return rows.map(rowToFileRef);
}

export function removeFileRef(id: string): boolean {
  const db = getIdentityDb();
  const info = db.prepare(`DELETE FROM file_refs WHERE id = ?`).run(id);
  return info.changes > 0;
}

export function resetFileRefsStoreForTests(): void {
  getIdentityDb().prepare(`DELETE FROM file_refs`).run();
}
