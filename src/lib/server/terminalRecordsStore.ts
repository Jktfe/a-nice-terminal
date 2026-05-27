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
import { recomputeInboxEdgesForTerminalOwnershipChange } from './humanInboxMembership';

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
  // Per-human inbox (JWPK 2026-05-22): a terminal created by a human grants
  // its agent inhabitant membership in the human's inbox even before a
  // shared chat room exists. Lazy-imported to keep terminalRecordsStore
  // from pulling chat-room-store transitively at module load (cycle risk).
  if (createdBy && handle) {
    try {
      recomputeInboxEdgesForTerminalOwnershipChange({
        agentHandle: handle,
        previousOwnerHandle: null,
        newOwnerHandle: createdBy
      });
    } catch {
      /* recompute is a side-effect; never block the terminal write */
    }
  }
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
  // Recompute inbox edges if created_by changed OR the agent handle moved.
  // Both old + new owners get recomputed so a transfer auto-drops the
  // previous owner's inbox membership when no other shared context remains.
  if ((existing.created_by !== createdBy || existing.handle !== handle) && handle) {
    try {
      recomputeInboxEdgesForTerminalOwnershipChange({
        agentHandle: handle,
        previousOwnerHandle: existing.created_by,
        newOwnerHandle: createdBy
      });
    } catch {
      /* recompute is a side-effect; never block the terminal write */
    }
  }
  return { session_id: sessionId, name, auto_forward_room_id: roomId, auto_forward_chat: forwardChat, agent_kind: agentKind, tmux_target_pane: tmuxTargetPane, linked_chat_room_id: linkedChatRoomId, created_by: createdBy, allowlist: allowlistJson, handle, created_at_ms: existing.created_at_ms, updated_at_ms: now };
}

export function listTerminalRecords(): TerminalRecord[] {
  const db = getIdentityDb();
  return db.prepare(`SELECT * FROM terminal_records ORDER BY created_at_ms DESC`).all() as TerminalRecord[];
}

/**
 * Live terminals only — drops any record whose `linked_chat_room_id`
 * points at a chat_rooms row that is archived (archived_at_ms IS NOT
 * NULL) or soft-deleted (deleted_at_ms IS NOT NULL). Bare-pane records
 * with `linked_chat_room_id IS NULL` are KEPT (they never had a linked
 * room to archive).
 *
 * JWPK msg_oqks7iixre 2026-05-27 antV4: the "Invite an agent" picker on
 * the room right-rail was offering agents whose linked chat had been
 * archived via `ant kill --mode archive`. The agent stays in
 * terminal_records (intentional — history preserved), but the picker
 * should not surface them as live invite candidates.
 */
export function listLiveTerminalRecords(): TerminalRecord[] {
  const db = getIdentityDb();
  return db.prepare(`
    SELECT tr.*
    FROM terminal_records tr
    LEFT JOIN chat_rooms cr ON tr.linked_chat_room_id = cr.id
    WHERE tr.linked_chat_room_id IS NULL
       OR (cr.archived_at_ms IS NULL AND cr.deleted_at_ms IS NULL)
    ORDER BY tr.created_at_ms DESC
  `).all() as TerminalRecord[];
}

export function deleteTerminalRecord(sessionId: string): void {
  const db = getIdentityDb();
  db.prepare(`DELETE FROM terminal_records WHERE session_id = ?`).run(sessionId);
  projectAntRegistryFileBestEffort();
}

// T2-IDENTITY-REGISTER-S7 (2026-05-14): distinct non-null handles for the
// allowed-posters picker. Sorted for stable UI ordering.
// 2026-05-27 (JWPK msg_oqks7iixre): joined against chat_rooms so handles
// whose linked room is archived/deleted are excluded — same shape as
// listLiveTerminalRecords. Bare-pane terminals (no linked room) stay in.
export function listKnownHandles(): string[] {
  const db = getIdentityDb();
  const rows = db.prepare(
    `SELECT DISTINCT tr.handle
       FROM terminal_records tr
       LEFT JOIN chat_rooms cr ON tr.linked_chat_room_id = cr.id
      WHERE tr.handle IS NOT NULL AND tr.handle != ''
        AND (tr.linked_chat_room_id IS NULL
             OR (cr.archived_at_ms IS NULL AND cr.deleted_at_ms IS NULL))
      ORDER BY tr.handle ASC`
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

// PICKER-SAME-SET: union of explicit + derived handles across all
// LIVE terminal_records (linked chat not archived/deleted). Sorted,
// deduped — feeds the picker so it sees every live ANT terminal but
// NOT terminals whose linked room has been archived/deleted. JWPK
// msg_oqks7iixre 2026-05-27: dead-room agents were showing up as
// invitable.
export function listAllPickableHandles(): string[] {
  const all = listLiveTerminalRecords();
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
