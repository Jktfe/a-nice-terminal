/**
 * terminalRecordsStore — JWPK-visible terminal entity record per
 * terminals-redesign T2d (2026-05-14). Separate from the existing M3.x
 * pid-bound `terminals` table — that one is identity/agent-status; this
 * one is the user-facing terminal entity (name + routing) per JWPK Q1
 * lock (single-target auto_forward_room_id) + v3 linked-chat-adapter
 * lift (auto_forward_chat 1=raw-keystroke / 0=ANSI block).
 */

import { getIdentityDb } from './db';
import { projectAntRegistryFileBestEffort } from './antRegistryFile';

export type TerminalRecord = {
  session_id: string;
  name: string;
  auto_forward_room_id: string | null;
  auto_forward_chat: number;
  agent_kind: string | null;
  tmux_target_pane: string | null;
  linked_chat_room_id: string | null;
  created_by: string | null;
  allowlist: string | null;
  handle: string | null;
  created_at_ms: number;
  updated_at_ms: number;
};

export type TerminalRecordPatch = {
  name?: string;
  autoForwardRoomId?: string | null;
  autoForwardChat?: 0 | 1;
  agentKind?: string | null;
  tmuxTargetPane?: string | null;
  linkedChatRoomId?: string | null;
  createdBy?: string | null;
  allowlist?: string[] | null;
  handle?: string | null;
};

export function parseAllowlist(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((h): h is string => typeof h === 'string');
  } catch {
    return null;
  }
}

export function serializeAllowlist(handles: string[] | null | undefined): string | null {
  if (!handles || handles.length === 0) return null;
  return JSON.stringify(handles);
}

function nextDefaultName(): string {
  const db = getIdentityDb();
  const rows = db.prepare(
    `SELECT name FROM terminal_records WHERE name LIKE 'Terminal %'`
  ).all() as { name: string }[];
  const used = new Set<number>();
  for (const row of rows) {
    const m = /^Terminal (\d+)$/.exec(row.name);
    if (m) used.add(Number(m[1]));
  }
  let n = 1;
  while (used.has(n)) n++;
  return `Terminal ${n}`;
}

export type CreateInput = {
  sessionId: string;
  name?: string;
  autoForwardRoomId?: string | null;
  autoForwardChat?: 0 | 1;
  agentKind?: string | null;
  tmuxTargetPane?: string | null;
  linkedChatRoomId?: string | null;
  createdBy?: string | null;
  allowlist?: string[] | null;
  handle?: string | null;
};

export function createTerminalRecord(input: CreateInput): TerminalRecord {
  const db = getIdentityDb();
  const now = Date.now();
  const name = input.name && input.name.trim().length > 0 ? input.name.trim() : nextDefaultName();
  const roomId = input.autoForwardRoomId ?? null;
  const forwardChat = input.autoForwardChat ?? 1;
  const agentKind = input.agentKind ?? null;
  // T1a default: daemon-spawned sessions live at `<sessionId>:0.0` per
  // tmux convention (new-session -A creates default window 0 + pane 0).
  const tmuxTargetPane = input.tmuxTargetPane ?? `${input.sessionId}:0.0`;
  const linkedChatRoomId = input.linkedChatRoomId ?? null;
  const createdBy = input.createdBy ?? null;
  const allowlistJson = serializeAllowlist(input.allowlist ?? null);
  const handle = input.handle ?? null;
  db.prepare(
    `INSERT INTO terminal_records (session_id, name, auto_forward_room_id, auto_forward_chat, agent_kind, tmux_target_pane, linked_chat_room_id, created_by, allowlist, handle, created_at_ms, updated_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(input.sessionId, name, roomId, forwardChat, agentKind, tmuxTargetPane, linkedChatRoomId, createdBy, allowlistJson, handle, now, now);
  projectAntRegistryFileBestEffort();
  return { session_id: input.sessionId, name, auto_forward_room_id: roomId, auto_forward_chat: forwardChat, agent_kind: agentKind, tmux_target_pane: tmuxTargetPane, linked_chat_room_id: linkedChatRoomId, created_by: createdBy, allowlist: allowlistJson, handle, created_at_ms: now, updated_at_ms: now };
}

export function getTerminalRecord(sessionId: string): TerminalRecord | null {
  const db = getIdentityDb();
  const row = db.prepare(`SELECT * FROM terminal_records WHERE session_id = ?`).get(sessionId);
  return (row as TerminalRecord) ?? null;
}

export function updateTerminalRecord(sessionId: string, patch: TerminalRecordPatch): TerminalRecord | null {
  const db = getIdentityDb();
  const existing = getTerminalRecord(sessionId);
  if (!existing) return null;
  const name = patch.name !== undefined && patch.name.trim().length > 0 ? patch.name.trim() : existing.name;
  const roomId = patch.autoForwardRoomId !== undefined ? patch.autoForwardRoomId : existing.auto_forward_room_id;
  const forwardChat = patch.autoForwardChat !== undefined ? patch.autoForwardChat : existing.auto_forward_chat;
  const agentKind = patch.agentKind !== undefined ? patch.agentKind : existing.agent_kind;
  const tmuxTargetPane = patch.tmuxTargetPane !== undefined ? patch.tmuxTargetPane : existing.tmux_target_pane;
  const linkedChatRoomId = patch.linkedChatRoomId !== undefined ? patch.linkedChatRoomId : existing.linked_chat_room_id;
  const createdBy = patch.createdBy !== undefined ? patch.createdBy : existing.created_by;
  const allowlistJson = patch.allowlist !== undefined ? serializeAllowlist(patch.allowlist) : existing.allowlist;
  const handle = patch.handle !== undefined ? patch.handle : existing.handle;
  const now = Date.now();
  db.prepare(
    `UPDATE terminal_records SET name = ?, auto_forward_room_id = ?, auto_forward_chat = ?, agent_kind = ?, tmux_target_pane = ?, linked_chat_room_id = ?, created_by = ?, allowlist = ?, handle = ?, updated_at_ms = ?
     WHERE session_id = ?`
  ).run(name, roomId, forwardChat, agentKind, tmuxTargetPane, linkedChatRoomId, createdBy, allowlistJson, handle, now, sessionId);
  projectAntRegistryFileBestEffort();
  return { session_id: sessionId, name, auto_forward_room_id: roomId, auto_forward_chat: forwardChat, agent_kind: agentKind, tmux_target_pane: tmuxTargetPane, linked_chat_room_id: linkedChatRoomId, created_by: createdBy, allowlist: allowlistJson, handle, created_at_ms: existing.created_at_ms, updated_at_ms: now };
}

export function listTerminalRecords(): TerminalRecord[] {
  const db = getIdentityDb();
  return db.prepare(`SELECT * FROM terminal_records ORDER BY created_at_ms DESC`).all() as TerminalRecord[];
}

export function deleteTerminalRecord(sessionId: string): void {
  const db = getIdentityDb();
  db.prepare(`DELETE FROM terminal_records WHERE session_id = ?`).run(sessionId);
  projectAntRegistryFileBestEffort();
}

// T2-IDENTITY-REGISTER-S7 (2026-05-14): distinct non-null handles for the
// allowed-posters picker. Sorted for stable UI ordering.
export function listKnownHandles(): string[] {
  const db = getIdentityDb();
  const rows = db.prepare(
    `SELECT DISTINCT handle FROM terminal_records
      WHERE handle IS NOT NULL AND handle != ''
      ORDER BY handle ASC`
  ).all() as { handle: string }[];
  return rows.map((r) => r.handle);
}

// PICKER-SAME-SET (2026-05-14, JWPK gap): when handle is null we still
// want a routable identifier so the picker can offer EVERY terminal as
// an allowed-poster. Lazy default derives `@slug(name)` from the
// human-readable name. Slug rule: lowercase, alphanumerics + dash, all
// other runs collapse to a single dash, leading/trailing dashes trimmed.
function slugForHandle(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'terminal';
}

export function deriveHandle(record: Pick<TerminalRecord, 'handle' | 'name'>): string {
  if (record.handle && record.handle.trim().length > 0) return record.handle;
  return `@${slugForHandle(record.name)}`;
}

// PICKER-SAME-SET: union of explicit + derived handles across ALL
// terminal_records. Sorted, deduped — feeds the picker so it sees every
// ANT terminal not just the few with explicit handles.
export function listAllPickableHandles(): string[] {
  const all = listTerminalRecords();
  const set = new Set<string>();
  for (const r of all) set.add(deriveHandle(r));
  return [...set].sort();
}

// INVITE-VALIDATE (2026-05-15, JWPK): room invites must resolve to a real
// terminal — without this, the chat-rooms members POST accepts free-form
// strings and creates "ghost" participants (e.g. @manual-test-bot) that
// have no backing terminal/agent. Comparison uses deriveHandle so callers
// can pass either an explicit handle (@foo) or a name-derived one
// (@build-lane from "Build Lane"), with or without the leading @.
export function findTerminalRecordByHandle(handle: string): TerminalRecord | null {
  const trimmed = handle.trim();
  if (trimmed.length === 0) return null;
  const target = trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
  for (const record of listTerminalRecords()) {
    if (deriveHandle(record) === target) return record;
  }
  return null;
}
