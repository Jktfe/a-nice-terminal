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
import { validateHandleForRegistration } from './handleValidation';

/**
 * Tag prefix used for `Error.message` thrown by `createTerminalRecord` /
 * `updateTerminalRecord` when the handle parameter fails the reserved-
 * list / character / length checks in {@link validateHandleForRegistration}.
 *
 * Sec-iter2 Fix #1 (2026-05-30): the choke-point validation lives at the
 * store layer so EVERY writer to `terminal_records.handle` runs through
 * the same reserved-list check — closing the HIGH-severity
 * `POST /api/terminals { handle: "@admin" }` bypass found in sec-iter2
 * review. The API layer (`/api/terminals` POST + `/api/terminals/[id]`
 * PATCH) ALSO validates earlier so well-behaved callers see a 400 with
 * a structured reason (`Fix #2`); the store throw is the structural
 * backstop for any future writer that forgets to validate at the edge.
 *
 * Callers that want to translate the throw into a 400 should match on
 * `INVALID_HANDLE_ERROR_PREFIX` (or `INVALID_HANDLE_ERROR_TAG`) at the
 * start of the message; everything past the prefix is the
 * human-readable validator reason from `handleValidation.ts`.
 */
export const INVALID_HANDLE_ERROR_TAG = '[INVALID_HANDLE]';
export const INVALID_HANDLE_ERROR_PREFIX = `${INVALID_HANDLE_ERROR_TAG} `;

/**
 * Sec-iter2 Fix #1 (2026-05-30): single choke-point for handle validation.
 * Called by `createTerminalRecord` + `updateTerminalRecord` so EVERY
 * writer of `terminal_records.handle` runs the same reserved-list /
 * character / length checks — defence in depth for the API-layer
 * validation in `/api/terminals` POST + `/api/terminals/[id]` PATCH.
 *
 * Throws an `Error` tagged with `INVALID_HANDLE_ERROR_TAG` when the
 * handle fails validation. The error message is `[INVALID_HANDLE] <reason>`
 * so the API layer can translate to a 400 with a precise message.
 *
 * No-op on `null`, `undefined`, or empty-string-after-trim — the
 * `handle` column is nullable and explicit NULL writes are valid (e.g.
 * the dedup migration sets handle=NULL on duplicates).
 */
function assertHandleValidOrThrow(handle: string | null | undefined): void {
  if (handle === null || handle === undefined) return;
  if (typeof handle !== 'string') return; // type system should prevent this; defensive
  if (handle.trim().length === 0) return;
  const result = validateHandleForRegistration(handle);
  if (!result.ok) {
    throw new Error(`${INVALID_HANDLE_ERROR_PREFIX}${result.message}`);
  }
}

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
  /**
   * Session recovery: the exact CLI line that launched the agent in this pane
   * (e.g. `claude --dangerously-skip-permissions --remote-control`). NULL until
   * set on spawn/PATCH or mined from scrollback at recover time. Used by
   * `POST /api/terminals/recover` to re-run the agent after a reboot.
   */
  boot_command: string | null;
  created_at_ms: number;
  updated_at_ms: number;
  /**
   * Pane-binding supersession (JWPK msg_wlvguvfvqu/msg_8390722mjh 2026-05-27).
   * NULL = active. Non-null = a later terminal_record claimed this row's
   * `tmux_target_pane`, so this binding is no longer authoritative for
   * fanout / picker / inbox / fleet. Cleanup readers ignore the filter.
   */
  superseded_at_ms: number | null;
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
  bootCommand?: string | null;
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

/**
 * Normalise a free-form boot command: trim, and fold empty/whitespace-only
 * (and explicit null/undefined) to NULL so the column reads cleanly. Mirrors
 * the model/last_path normalisation in terminalsStore.
 */
function normaliseBootCommand(raw: string | null | undefined): string | null {
  const trimmed = typeof raw === 'string' ? raw.trim() : null;
  return trimmed && trimmed.length > 0 ? trimmed : null;
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
  bootCommand?: string | null;
};

/**
 * Mark any OTHER terminal_records that currently claim the same
 * `tmux_target_pane` as superseded. Called from create + update paths
 * whenever a row claims/updates its pane.
 *
 * Pane-binding supersession (JWPK msg_wlvguvfvqu/msg_8390722mjh
 * 2026-05-27): the leak fix. A recycled tmux pane (e.g. Vera's codex
 * spawn inheriting @xenocc's old pane) no longer delivers the prior
 * agent's room subscriptions to whoever runs there next, because the
 * prior terminal_record is marked superseded the moment the new row
 * claims the pane.
 *
 * Self-supersession is filtered by `session_id != ?` so a row writing
 * to its own pane (no-op update) doesn't supersede itself.
 */
function supersedePriorRecordsForPane(
  db: ReturnType<typeof getIdentityDb>,
  newSessionId: string,
  tmuxTargetPane: string | null,
  nowMs: number
): void {
  if (!tmuxTargetPane) return;
  db.prepare(
    `UPDATE terminal_records
        SET superseded_at_ms = ?
      WHERE tmux_target_pane = ?
        AND session_id != ?
        AND superseded_at_ms IS NULL`
  ).run(nowMs, tmuxTargetPane, newSessionId);
}

export function createTerminalRecord(input: CreateInput): TerminalRecord {
  // Sec-iter2 Fix #1 (2026-05-30): choke-point validation. Run BEFORE
  // any DB write so an attempted `@admin` create raises a tagged Error
  // instead of persisting a privileged-handle row that the approver
  // gate would then trust via `permissionCallerIdentity`.
  assertHandleValidOrThrow(input.handle ?? null);
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
  const bootCommand = normaliseBootCommand(input.bootCommand);
  // Supersede prior rows claiming this pane BEFORE the insert — so if
  // they shared a unique-name constraint or future invariant fired,
  // the earlier rows are already marked stale.
  supersedePriorRecordsForPane(db, input.sessionId, tmuxTargetPane, now);
  db.prepare(
    `INSERT INTO terminal_records (session_id, name, auto_forward_room_id, auto_forward_chat, agent_kind, tmux_target_pane, linked_chat_room_id, created_by, allowlist, handle, boot_command, created_at_ms, updated_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(input.sessionId, name, roomId, forwardChat, agentKind, tmuxTargetPane, linkedChatRoomId, createdBy, allowlistJson, handle, bootCommand, now, now);
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
  return { session_id: input.sessionId, name, auto_forward_room_id: roomId, auto_forward_chat: forwardChat, agent_kind: agentKind, tmux_target_pane: tmuxTargetPane, linked_chat_room_id: linkedChatRoomId, created_by: createdBy, allowlist: allowlistJson, handle, boot_command: bootCommand, created_at_ms: now, updated_at_ms: now, superseded_at_ms: null };
}

export function getTerminalRecord(sessionId: string): TerminalRecord | null {
  const db = getIdentityDb();
  const row = db.prepare(`SELECT * FROM terminal_records WHERE session_id = ?`).get(sessionId);
  return (row as TerminalRecord) ?? null;
}

export function updateTerminalRecord(sessionId: string, patch: TerminalRecordPatch): TerminalRecord | null {
  // Sec-iter2 Fix #1 (2026-05-30): choke-point validation on the patch
  // path. PATCH /api/terminals/[id] is the second attack surface — an
  // attacker could PATCH any existing terminal whose handle is NULL to
  // `@admin` and gain admin via the approver gate. Validate BEFORE the
  // existing-row lookup so the throw shape matches the create path
  // regardless of whether the sessionId exists.
  if (patch.handle !== undefined) {
    assertHandleValidOrThrow(patch.handle);
  }
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
  const bootCommand = patch.bootCommand !== undefined ? normaliseBootCommand(patch.bootCommand) : existing.boot_command;
  const now = Date.now();
  // Pane-binding supersession: if the update is moving this row's
  // tmux_target_pane (or claiming a new one), supersede any OTHER rows
  // already on that pane. Self-supersession is filtered by sessionId.
  if (tmuxTargetPane && tmuxTargetPane !== existing.tmux_target_pane) {
    supersedePriorRecordsForPane(db, sessionId, tmuxTargetPane, now);
  }
  db.prepare(
    `UPDATE terminal_records SET name = ?, auto_forward_room_id = ?, auto_forward_chat = ?, agent_kind = ?, tmux_target_pane = ?, linked_chat_room_id = ?, created_by = ?, allowlist = ?, handle = ?, boot_command = ?, updated_at_ms = ?
     WHERE session_id = ?`
  ).run(name, roomId, forwardChat, agentKind, tmuxTargetPane, linkedChatRoomId, createdBy, allowlistJson, handle, bootCommand, now, sessionId);
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
  // Re-read the row to pick up superseded_at_ms (could have been set
  // by the supersedePriorRecordsForPane call above if the operator
  // moved a pane that another row was already on — though our update
  // never marks the row we just updated, this preserves the invariant
  // that the returned shape mirrors what's in the DB).
  const post = getTerminalRecord(sessionId) ?? existing;
  return { session_id: sessionId, name, auto_forward_room_id: roomId, auto_forward_chat: forwardChat, agent_kind: agentKind, tmux_target_pane: tmuxTargetPane, linked_chat_room_id: linkedChatRoomId, created_by: createdBy, allowlist: allowlistJson, handle, boot_command: bootCommand, created_at_ms: existing.created_at_ms, updated_at_ms: now, superseded_at_ms: post.superseded_at_ms ?? null };
}

export function listTerminalRecords(): TerminalRecord[] {
  const db = getIdentityDb();
  return db.prepare(`SELECT * FROM terminal_records ORDER BY created_at_ms DESC`).all() as TerminalRecord[];
}

/**
 * Live terminal_records — drops any record that is:
 *   (a) superseded by a later pane-claim (pane-binding supersession,
 *       JWPK msg_wlvguvfvqu/msg_8390722mjh 2026-05-27, fixes the
 *       Vera-saw-xenoChat leak).
 *   (b) bound to a `chat_rooms` row that is archived (archived_at_ms
 *       IS NOT NULL) or soft-deleted (deleted_at_ms IS NOT NULL)
 *       — JWPK msg_oqks7iixre antV4 2026-05-27, fixes the
 *       Invite-an-agent-picker-shows-archived bug.
 *
 * Bare-pane records with `linked_chat_room_id IS NULL` are KEPT on the
 * (b) axis (they never had a linked room to archive). Supersession on
 * the (a) axis applies regardless of linked_chat_room_id state.
 *
 * History surfaces should call `listTerminalRecords()` directly to see
 * superseded + archived-linked rows.
 */
// Phase C3 (JWPK A Team msg_emnmgs1y9t 2026-05-29 — screenshot showing
// invite picker still listing dead handles after 0.1.13 deploy).
// LEFT JOIN to terminals so rows whose backing terminal has been flipped
// to 'archived' or 'deleted' by the lifecycle poller (Phase A3) drop out
// of every picker that derives from this set. The NULL-tolerant predicate
// `(t.status IS NULL OR t.status = 'live')` preserves rows that lack a
// matching terminals row entirely — pre-A1 historical rows + remote
// bridges that only exist in terminal_records. Without that fallback the
// migration to lifecycle-gated picker would silently delete those.
export function listLiveTerminalRecords(): TerminalRecord[] {
  const db = getIdentityDb();
  return db.prepare(`
    SELECT tr.*
      FROM terminal_records tr
      LEFT JOIN chat_rooms cr ON tr.linked_chat_room_id = cr.id
      LEFT JOIN terminals  t  ON tr.session_id = t.id
     WHERE tr.superseded_at_ms IS NULL
       AND (tr.linked_chat_room_id IS NULL
            OR (cr.archived_at_ms IS NULL AND cr.deleted_at_ms IS NULL))
       AND (t.status IS NULL OR t.status = 'live')
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
// 2026-05-27 (JWPK msg_oqks7iixre + msg_wlvguvfvqu): joined against
// chat_rooms so handles whose linked room is archived/deleted are
// excluded, plus filtered on `superseded_at_ms IS NULL` so handles from
// terminal_records that lost their pane to a later claim are excluded.
// Bare-pane terminals (no linked room) stay in if not superseded.
// Phase C3 (JWPK A Team msg_emnmgs1y9t 2026-05-29): same lifecycle filter
// as listLiveTerminalRecords — drop handles whose backing terminal is
// archived/deleted, preserve rows with no matching terminals row via the
// NULL-tolerant predicate. See listLiveTerminalRecords for the full
// rationale.
export function listKnownHandles(): string[] {
  const db = getIdentityDb();
  const rows = db.prepare(
    `SELECT DISTINCT tr.handle
       FROM terminal_records tr
       LEFT JOIN chat_rooms cr ON tr.linked_chat_room_id = cr.id
       LEFT JOIN terminals  t  ON tr.session_id = t.id
      WHERE tr.handle IS NOT NULL AND tr.handle != ''
        AND tr.superseded_at_ms IS NULL
        AND (tr.linked_chat_room_id IS NULL
             OR (cr.archived_at_ms IS NULL AND cr.deleted_at_ms IS NULL))
        AND (t.status IS NULL OR t.status = 'live')
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
// LIVE terminal_records (not superseded, not bound to an archived /
// deleted linked room). Sorted, deduped — feeds the picker so it sees
// every live ANT terminal but NOT terminals whose pane has been
// recycled (superseded) or whose linked room has been archived/deleted.
export function listAllPickableHandles(): string[] {
  const all = listLiveTerminalRecords();
  const set = new Set<string>();
  for (const r of all) set.add(deriveHandle(r));
  return [...set].sort();
}

/**
 * Lifecycle Phase A1 (JWPK A Team msg_w7sfmc4hpp + msg_7uvr35x0xr
 * 2026-05-29). Append a handle to the handle_aliases JSON array on the
 * terminal_records row for `sessionId`. Used by Phase B when
 * `ant register` changes the handle on an existing terminal: the prior
 * handle is appended here so it can be surfaced as a "previously known
 * as @x" hint in pickers / audit / mention resolution.
 *
 * JSON shape on disk: `["@old1", "@old2"]`. NULL becomes `["@new"]` on
 * first append. Idempotent — appending a handle already in the array
 * is a no-op and still returns true. The alias is normalised to start
 * with `@` (mirroring roomMembershipsStore.normalizeHandle).
 *
 * Returns true when the row exists (even when the alias was already
 * present — the caller doesn't care). Returns false when sessionId
 * doesn't match any terminal_records row.
 */
export function appendHandleAlias(sessionId: string, alias: string): boolean {
  const trimmed = alias.trim();
  if (trimmed.length === 0) return false;
  const normalised = trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
  const db = getIdentityDb();
  const row = db
    .prepare(`SELECT handle_aliases FROM terminal_records WHERE session_id = ?`)
    .get(sessionId) as { handle_aliases: string | null } | undefined;
  if (!row) return false;
  const existing = parseHandleAliasesRaw(row.handle_aliases);
  if (existing.includes(normalised)) return true;
  const next = [...existing, normalised];
  db.prepare(
    `UPDATE terminal_records SET handle_aliases = ?, updated_at_ms = ?
      WHERE session_id = ?`
  ).run(JSON.stringify(next), Date.now(), sessionId);
  return true;
}

/**
 * Lifecycle Phase A1 (JWPK A Team msg_w7sfmc4hpp + msg_7uvr35x0xr
 * 2026-05-29). Read the handle_aliases array for a session. Returns
 * an empty array when no aliases (NULL column) or the row doesn't
 * exist or the stored JSON is malformed — callers never need to
 * handle a null/undefined return.
 */
export function getHandleAliases(sessionId: string): string[] {
  const db = getIdentityDb();
  const row = db
    .prepare(`SELECT handle_aliases FROM terminal_records WHERE session_id = ?`)
    .get(sessionId) as { handle_aliases: string | null } | undefined;
  if (!row) return [];
  return parseHandleAliasesRaw(row.handle_aliases);
}

function parseHandleAliasesRaw(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((h): h is string => typeof h === 'string');
  } catch {
    return [];
  }
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

/**
 * Fix #2 of sec-iter1 (2026-05-30 enterprise security pass). Returns the
 * first ACTIVE terminal_record whose `handle` column matches the
 * supplied (normalised) handle. Used by the register endpoint to reject
 * cross-terminal handle collisions BEFORE the DB UNIQUE constraint
 * fires.
 *
 * "Active" = not superseded (pane-binding supersession) AND the row's
 * stored handle exactly matches (no derived-from-name fallback — that
 * would block names that slug to the same handle).
 *
 * Distinct from {@link findTerminalRecordByHandle} which uses
 * `deriveHandle` (alias-friendly invite check). This one is the
 * authoritative "who currently owns this handle" gate.
 */
export function findActiveTerminalRecordByHandle(handle: string): TerminalRecord | null {
  const trimmed = handle.trim();
  if (trimmed.length === 0) return null;
  const normalised = trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
  const db = getIdentityDb();
  const row = db
    .prepare(
      `SELECT * FROM terminal_records
        WHERE handle = ?
          AND superseded_at_ms IS NULL
        ORDER BY created_at_ms DESC
        LIMIT 1`
    )
    .get(normalised) as TerminalRecord | undefined;
  return row ?? null;
}

/**
 * Lowest-free handle in the terminal_records namespace, using the same @x / @x-N
 * (dash) convention as the room lease layer (roomHandleLeaseClean.display). The
 * base is returned when free; otherwise @x-1, @x-2 … skipping any active
 * (non-superseded) terminal_records handle. `exemptSessionId` lets a
 * re-register keep its own row's handle (so an idempotent re-register never
 * self-suffixes).
 *
 * Used by register's Option A: instead of 409-rejecting a live-handle collision
 * (which left the caller tokenless = mute), the caller is granted a distinct,
 * visible @x-N while the live incumbent keeps clean @x untouched.
 */
export function lowestFreeTerminalHandle(
  rawBase: string,
  exemptSessionId?: string | null
): string {
  const t = rawBase.trim();
  const base = t.startsWith('@') ? t : `@${t}`;
  const isTaken = (candidate: string): boolean => {
    const rec = findActiveTerminalRecordByHandle(candidate);
    return rec !== null && rec.session_id !== (exemptSessionId ?? null);
  };
  if (!isTaken(base)) return base;
  for (let n = 1; n <= 999; n += 1) {
    const candidate = `${base}-${n}`;
    if (!isTaken(candidate)) return candidate;
  }
  throw new Error(`No free terminal handle found for ${base}.`);
}
