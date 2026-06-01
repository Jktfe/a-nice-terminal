/**
 * Manual canvas v2 store (JWPK msg_i538jl6ztt 2026-05-23).
 *
 * Per-state, per-element annotations + central suggestions feed for the
 * interactive screens canvas at /manual/v2. Slice 1 ships read-only;
 * writes (suggestions capture) land in slice 3, audit in slice 6.
 */

import { randomUUID } from 'node:crypto';
import { getIdentityDb } from './db';

export type ManualScreenState = {
  screen_id: string;
  state_slug: string;
  state_label: string;
  description: string | null;
  screenshot_path: string;
  viewport_w: number;
  viewport_h: number;
  sort_order: number;
  created_at_ms: number;
  updated_at_ms: number;
};

export type ManualElementAnnotation = {
  screen_id: string;
  state_slug: string;
  element_slug: string;
  item_name: string;
  bbox: { x: number; y: number; w: number; h: number };
  cli_verbs: string[];
  data_sources: string[];
  logic_text: string | null;
  intended_actions: string[];
  tab_order: number;
};

export type ManualSuggestion = {
  id: string;
  screen_id: string | null;
  state_slug: string | null;
  element_slug: string | null;
  body: string;
  captured_by_handle: string;
  captured_at_ms: number;
  status: 'open' | 'addressed' | 'dismissed';
  addressed_at_ms: number | null;
  addressed_by_handle: string | null;
  addressed_note: string | null;
};

type StateRow = {
  screen_id: string;
  state_slug: string;
  state_label: string;
  description: string | null;
  screenshot_path: string;
  viewport_w: number;
  viewport_h: number;
  sort_order: number;
  created_at_ms: number;
  updated_at_ms: number;
};

type AnnotationRow = {
  screen_id: string;
  state_slug: string;
  element_slug: string;
  item_name: string;
  bbox_x: number;
  bbox_y: number;
  bbox_w: number;
  bbox_h: number;
  cli_verbs_json: string;
  data_sources_json: string;
  logic_text: string | null;
  intended_actions_json: string;
  tab_order: number;
};

type SuggestionRow = {
  id: string;
  screen_id: string | null;
  state_slug: string | null;
  element_slug: string | null;
  body: string;
  captured_by_handle: string;
  captured_at_ms: number;
  status: 'open' | 'addressed' | 'dismissed';
  addressed_at_ms: number | null;
  addressed_by_handle: string | null;
  addressed_note: string | null;
};

function parseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function rowToAnnotation(row: AnnotationRow): ManualElementAnnotation {
  return {
    screen_id: row.screen_id,
    state_slug: row.state_slug,
    element_slug: row.element_slug,
    item_name: row.item_name,
    bbox: { x: row.bbox_x, y: row.bbox_y, w: row.bbox_w, h: row.bbox_h },
    cli_verbs: parseJsonArray(row.cli_verbs_json),
    data_sources: parseJsonArray(row.data_sources_json),
    logic_text: row.logic_text,
    intended_actions: parseJsonArray(row.intended_actions_json),
    tab_order: row.tab_order
  };
}

// ─── reads ───────────────────────────────────────────────────────────

export function listScreenStates(): ManualScreenState[] {
  const rows = getIdentityDb()
    .prepare(`SELECT * FROM manual_screen_states ORDER BY screen_id, sort_order`)
    .all() as StateRow[];
  return rows;
}

export function getScreenState(screenId: string, stateSlug: string): ManualScreenState | null {
  const row = getIdentityDb()
    .prepare(`SELECT * FROM manual_screen_states WHERE screen_id = ? AND state_slug = ?`)
    .get(screenId, stateSlug) as StateRow | undefined;
  return row ?? null;
}

export function listStatesForScreen(screenId: string): ManualScreenState[] {
  const rows = getIdentityDb()
    .prepare(`SELECT * FROM manual_screen_states WHERE screen_id = ? ORDER BY sort_order`)
    .all(screenId) as StateRow[];
  return rows;
}

export function listAnnotationsForState(screenId: string, stateSlug: string): ManualElementAnnotation[] {
  const rows = getIdentityDb()
    .prepare(
      `SELECT * FROM manual_element_annotations
       WHERE screen_id = ? AND state_slug = ?
       ORDER BY tab_order`
    )
    .all(screenId, stateSlug) as AnnotationRow[];
  return rows.map(rowToAnnotation);
}

export function listSuggestions(filter?: {
  screenId?: string;
  stateSlug?: string;
  elementSlug?: string;
  status?: 'open' | 'addressed' | 'dismissed';
}): ManualSuggestion[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter?.screenId) { clauses.push('screen_id = ?'); params.push(filter.screenId); }
  if (filter?.stateSlug) { clauses.push('state_slug = ?'); params.push(filter.stateSlug); }
  if (filter?.elementSlug) { clauses.push('element_slug = ?'); params.push(filter.elementSlug); }
  if (filter?.status) { clauses.push('status = ?'); params.push(filter.status); }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = getIdentityDb()
    .prepare(`SELECT * FROM manual_screen_suggestions ${where} ORDER BY captured_at_ms DESC`)
    .all(...params) as SuggestionRow[];
  return rows;
}

// ─── writes (slice 3 will expose via API; slice 1 only seeds) ────────

export type UpsertScreenStateInput = {
  screenId: string;
  stateSlug: string;
  stateLabel: string;
  description?: string | null;
  screenshotPath: string;
  viewportW: number;
  viewportH: number;
  sortOrder?: number;
};

export function upsertScreenState(input: UpsertScreenStateInput): ManualScreenState {
  const now = Date.now();
  const db = getIdentityDb();
  db.prepare(
    `INSERT INTO manual_screen_states
       (screen_id, state_slug, state_label, description, screenshot_path,
        viewport_w, viewport_h, sort_order, created_at_ms, updated_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (screen_id, state_slug) DO UPDATE SET
       state_label = excluded.state_label,
       description = excluded.description,
       screenshot_path = excluded.screenshot_path,
       viewport_w = excluded.viewport_w,
       viewport_h = excluded.viewport_h,
       sort_order = excluded.sort_order,
       updated_at_ms = excluded.updated_at_ms`
  ).run(
    input.screenId, input.stateSlug, input.stateLabel,
    input.description ?? null, input.screenshotPath,
    input.viewportW, input.viewportH, input.sortOrder ?? 0,
    now, now
  );
  return getScreenState(input.screenId, input.stateSlug) as ManualScreenState;
}

export type UpsertAnnotationInput = {
  screenId: string;
  stateSlug: string;
  elementSlug: string;
  itemName: string;
  bbox: { x: number; y: number; w: number; h: number };
  cliVerbs?: string[];
  dataSources?: string[];
  logicText?: string | null;
  intendedActions?: string[];
  tabOrder?: number;
};

export function upsertAnnotation(input: UpsertAnnotationInput): ManualElementAnnotation {
  const now = Date.now();
  const db = getIdentityDb();
  db.prepare(
    `INSERT INTO manual_element_annotations
       (screen_id, state_slug, element_slug, item_name,
        bbox_x, bbox_y, bbox_w, bbox_h,
        cli_verbs_json, data_sources_json, logic_text, intended_actions_json,
        tab_order, created_at_ms, updated_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (screen_id, state_slug, element_slug) DO UPDATE SET
       item_name = excluded.item_name,
       bbox_x = excluded.bbox_x, bbox_y = excluded.bbox_y,
       bbox_w = excluded.bbox_w, bbox_h = excluded.bbox_h,
       cli_verbs_json = excluded.cli_verbs_json,
       data_sources_json = excluded.data_sources_json,
       logic_text = excluded.logic_text,
       intended_actions_json = excluded.intended_actions_json,
       tab_order = excluded.tab_order,
       updated_at_ms = excluded.updated_at_ms`
  ).run(
    input.screenId, input.stateSlug, input.elementSlug, input.itemName,
    input.bbox.x, input.bbox.y, input.bbox.w, input.bbox.h,
    JSON.stringify(input.cliVerbs ?? []),
    JSON.stringify(input.dataSources ?? []),
    input.logicText ?? null,
    JSON.stringify(input.intendedActions ?? []),
    input.tabOrder ?? 0, now, now
  );
  const row = getIdentityDb()
    .prepare(`SELECT * FROM manual_element_annotations WHERE screen_id = ? AND state_slug = ? AND element_slug = ?`)
    .get(input.screenId, input.stateSlug, input.elementSlug) as AnnotationRow;
  return rowToAnnotation(row);
}

export type CreateSuggestionInput = {
  screenId?: string | null;
  stateSlug?: string | null;
  elementSlug?: string | null;
  body: string;
  capturedByHandle: string;
};

export function createSuggestion(input: CreateSuggestionInput): ManualSuggestion {
  const id = `sug_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const now = Date.now();
  getIdentityDb().prepare(
    `INSERT INTO manual_screen_suggestions
       (id, screen_id, state_slug, element_slug, body, captured_by_handle,
        captured_at_ms, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'open')`
  ).run(
    id, input.screenId ?? null, input.stateSlug ?? null, input.elementSlug ?? null,
    input.body, input.capturedByHandle, now
  );
  const row = getIdentityDb()
    .prepare(`SELECT * FROM manual_screen_suggestions WHERE id = ?`)
    .get(id) as SuggestionRow;
  return row;
}

// ─── slice 6: audit log ─────────────────────────────────────────────

export type ManualAnnotationAudit = {
  id: string;
  screen_id: string;
  state_slug: string;
  element_slug: string;
  edited_by_handle: string;
  edited_at_ms: number;
  action: 'create' | 'update' | 'delete';
  // Parsed JSON snapshots — null when N/A (create has no before;
  // delete has no after).
  before: ManualElementAnnotation | null;
  after: ManualElementAnnotation | null;
};

type AuditRow = {
  id: string;
  screen_id: string;
  state_slug: string;
  element_slug: string;
  edited_by_handle: string;
  edited_at_ms: number;
  action: 'create' | 'update' | 'delete';
  before_json: string | null;
  after_json: string | null;
};

function parseAuditSnapshot(raw: string | null): ManualElementAnnotation | null {
  if (raw === null || raw.length === 0) return null;
  try {
    const parsed = JSON.parse(raw) as ManualElementAnnotation;
    return parsed;
  } catch {
    return null;
  }
}

function rowToAudit(row: AuditRow): ManualAnnotationAudit {
  return {
    id: row.id,
    screen_id: row.screen_id,
    state_slug: row.state_slug,
    element_slug: row.element_slug,
    edited_by_handle: row.edited_by_handle,
    edited_at_ms: row.edited_at_ms,
    action: row.action,
    before: parseAuditSnapshot(row.before_json),
    after: parseAuditSnapshot(row.after_json)
  };
}

export type RecordAuditInput = {
  screenId: string;
  stateSlug: string;
  elementSlug: string;
  editedByHandle: string;
  action: 'create' | 'update' | 'delete';
  before: ManualElementAnnotation | null;
  after: ManualElementAnnotation | null;
};

export function recordAnnotationAudit(input: RecordAuditInput): void {
  const id = `aud_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  getIdentityDb().prepare(
    `INSERT INTO manual_element_annotations_audit
       (id, screen_id, state_slug, element_slug, edited_by_handle,
        edited_at_ms, action, before_json, after_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, input.screenId, input.stateSlug, input.elementSlug,
    input.editedByHandle, Date.now(), input.action,
    input.before === null ? null : JSON.stringify(input.before),
    input.after === null ? null : JSON.stringify(input.after)
  );
}

export function listAuditForElement(
  screenId: string,
  stateSlug: string,
  elementSlug: string,
  limit = 50
): ManualAnnotationAudit[] {
  const rows = getIdentityDb()
    .prepare(
      `SELECT * FROM manual_element_annotations_audit
       WHERE screen_id = ? AND state_slug = ? AND element_slug = ?
       ORDER BY edited_at_ms DESC
       LIMIT ?`
    )
    .all(screenId, stateSlug, elementSlug, limit) as AuditRow[];
  return rows.map(rowToAudit);
}

export function findAnnotationByKeys(
  screenId: string,
  stateSlug: string,
  elementSlug: string
): ManualElementAnnotation | null {
  return listAnnotationsForState(screenId, stateSlug)
    .find((a) => a.element_slug === elementSlug) ?? null;
}
