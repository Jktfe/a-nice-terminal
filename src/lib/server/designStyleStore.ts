/**
 * designStyleStore — banked styles for decks, UI surfaces, and org branding.
 *
 * Styles are scoped (org/user/public), shareable, and referenced by id.
 * Kinds: palette, font, asset, spacing, shadow, border.
 */
import { randomUUID } from 'node:crypto';
import { getIdentityDb } from './db';

export type DesignStyleKind = 'palette' | 'font' | 'asset' | 'spacing' | 'shadow' | 'border';
export type DesignStyleScope = 'org' | 'user' | 'public';

export type DesignStyle = {
  id: string;
  name: string;
  kind: DesignStyleKind;
  scope: DesignStyleScope;
  scopeId: string;
  data: Record<string, unknown>;
  tags: string[];
  isDefault: boolean;
  createdBy: string | null;
  createdAtMs: number;
  updatedAtMs: number;
};

type DesignStyleRow = {
  id: string;
  name: string;
  kind: string;
  scope: string;
  scope_id: string;
  data_json: string;
  tags_json: string;
  is_default: number;
  created_by: string | null;
  created_at_ms: number;
  updated_at_ms: number;
};

function rowToStyle(row: DesignStyleRow): DesignStyle {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as DesignStyleKind,
    scope: row.scope as DesignStyleScope,
    scopeId: row.scope_id,
    data: JSON.parse(row.data_json),
    tags: JSON.parse(row.tags_json),
    isDefault: Boolean(row.is_default),
    createdBy: row.created_by,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms
  };
}

const ALLOWED_KINDS: readonly DesignStyleKind[] = ['palette', 'font', 'asset', 'spacing', 'shadow', 'border'];
const ALLOWED_SCOPES: readonly DesignStyleScope[] = ['org', 'user', 'public'];

export function isAllowedDesignStyleKind(value: unknown): value is DesignStyleKind {
  return typeof value === 'string' && (ALLOWED_KINDS as readonly string[]).includes(value);
}

export function isAllowedDesignStyleScope(value: unknown): value is DesignStyleScope {
  return typeof value === 'string' && (ALLOWED_SCOPES as readonly string[]).includes(value);
}

export function listDesignStyles(args?: {
  scope?: DesignStyleScope;
  scopeId?: string;
  kind?: DesignStyleKind;
  tag?: string;
  limit?: number;
}): DesignStyle[] {
  const db = getIdentityDb();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (args?.scope) {
    conditions.push('scope = ?');
    params.push(args.scope);
  }
  if (args?.scopeId) {
    conditions.push('scope_id = ?');
    params.push(args.scopeId);
  }
  if (args?.kind) {
    conditions.push('kind = ?');
    params.push(args.kind);
  }
  if (args?.tag) {
    conditions.push("EXISTS (SELECT 1 FROM json_each(tags_json) WHERE value = ?)");
    params.push(args.tag);
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
  const limit = args?.limit && args.limit > 0 ? 'LIMIT ?' : '';
  if (limit && args?.limit) params.push(args.limit);

  const rows = db
    .prepare(`SELECT * FROM design_styles ${where} ORDER BY kind, name ${limit}`)
    .all(...params) as DesignStyleRow[];

  return rows.map(rowToStyle);
}

export function getDesignStyle(id: string): DesignStyle | undefined {
  const db = getIdentityDb();
  const row = db.prepare('SELECT * FROM design_styles WHERE id = ?').get(id) as DesignStyleRow | undefined;
  return row ? rowToStyle(row) : undefined;
}

export function createDesignStyle(input: {
  name: string;
  kind: DesignStyleKind;
  scope: DesignStyleScope;
  scopeId: string;
  data?: Record<string, unknown>;
  tags?: string[];
  isDefault?: boolean;
  createdBy?: string | null;
  nowMs?: number;
}): DesignStyle {
  const now = input.nowMs ?? Date.now();
  const id = randomUUID();
  const db = getIdentityDb();
  db.prepare(`INSERT INTO design_styles
    (id, name, kind, scope, scope_id, data_json, tags_json, is_default, created_by, created_at_ms, updated_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.name.trim(),
    input.kind,
    input.scope,
    input.scopeId.trim(),
    JSON.stringify(input.data ?? {}),
    JSON.stringify(input.tags ?? []),
    input.isDefault ? 1 : 0,
    input.createdBy ?? null,
    now,
    now
  );
  return getDesignStyle(id)!;
}

export function updateDesignStyle(id: string, patch: {
  name?: string;
  data?: Record<string, unknown>;
  tags?: string[];
  isDefault?: boolean;
  nowMs?: number;
}): DesignStyle | undefined {
  const existing = getDesignStyle(id);
  if (!existing) return undefined;
  const now = patch.nowMs ?? Date.now();
  const db = getIdentityDb();
  db.prepare(`UPDATE design_styles SET
    name = COALESCE(?, name),
    data_json = COALESCE(?, data_json),
    tags_json = COALESCE(?, tags_json),
    is_default = COALESCE(?, is_default),
    updated_at_ms = ?
    WHERE id = ?
  `).run(
    patch.name?.trim() ?? null,
    patch.data ? JSON.stringify(patch.data) : null,
    patch.tags ? JSON.stringify(patch.tags) : null,
    patch.isDefault !== undefined ? (patch.isDefault ? 1 : 0) : null,
    now,
    id
  );
  return getDesignStyle(id);
}

export function deleteDesignStyle(id: string): boolean {
  const db = getIdentityDb();
  const result = db.prepare('DELETE FROM design_styles WHERE id = ?').run(id);
  return result.changes > 0;
}
