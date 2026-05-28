/**
 * Persisted store for chat rooms and their member roster.
 *
 * Phase 5.1 of ROOMS-PERSISTENCE-A (canonical RQO32LuIK8xmcV7fq04Oq design
 * PASS 2026-05-14). Previously a process-memory Map; now backed by
 * better-sqlite3 tables `chat_rooms` + `chat_room_members` at
 * ~/.ant/fresh-ant.db (or ANT_FRESH_DB_PATH override). Public exports +
 * signatures + return shapes are byte-identical to the prior in-memory
 * version per Q1 no-caller-churn lock.
 *
 * Per Q7 lock the M3.6a-v1 auth-gate write surfaces (/messages,
 * /discussions, /members POST/DELETE) are NOT touched — they call into
 * createChatRoom / inviteAgentToRoom / removeMemberFromRoom and only see
 * the swap by surviving fresh-ANT process restart.
 */

import { randomUUID } from 'node:crypto';
import type { RoomAttentionState } from '$lib/domain/types';
import { getIdentityDb } from './db';
import { findTerminalRecordByHandle } from './terminalRecordsStore';
import { recomputeInboxEdgesForRoomMembershipChange } from './humanInboxMembership';
import { ensureHumanInboxRoom } from './humanInboxRoomStore';

export type ParticipantBackgroundStyle = 'card' | 'tint' | 'transparent';

export type RoomMember = {
  handle: string;
  displayName: string;
  displayColor: string;
  displayIcon: string;
  displayBackgroundStyle: ParticipantBackgroundStyle;
  joinedAt: string;
  kind: 'human' | 'agent';
};

export type ChatRoom = {
  id: string;
  name: string;
  /** Auto-derived from the latest message — read-only on this type. */
  summary: string;
  /** User/agent-authored optional description (JWPK 2026-05-24 yz4clwzvbm
   *  msg_jj50zw48fr). NULL when unset; UI falls back to summary in that case. */
  description: string | null;
  attentionState: RoomAttentionState;
  lastUpdate: string;
  whenItWasCreated: string;
  whoCreatedIt: string;
  creationOrder: number;
  contractId: string | null;
  members: RoomMember[];
};

export type RecoverableChatRoom = {
  id: string;
  name: string;
  summary: string;
  attentionState: RoomAttentionState;
  lastUpdate: string;
  whenItWasCreated: string;
  whoCreatedIt: string;
  creationOrder: number;
  archivedAtMs: number | null;
  deletedAtMs: number | null;
  restorable: boolean;
  deleteBoundary?: string;
};

type ChatRoomRow = {
  id: string;
  name: string;
  summary: string;
  description: string | null;
  attention_state: string;
  last_update: string;
  when_it_was_created: string;
  who_created_it: string;
  creation_order: number;
  contract_id: string | null;
};

type RecoverableChatRoomRow = ChatRoomRow & {
  archived_at_ms: number | null;
  deleted_at_ms: number | null;
};

type ChatRoomMemberRow = {
  id: string;
  room_id: string;
  handle: string;
  display_name: string;
  display_color: string | null;
  display_icon: string | null;
  display_background_style: string | null;
  joined_at: string;
  kind: 'human' | 'agent';
};

type LatestMessageSummaryRow = {
  author_handle: string;
  body: string;
};

const DEFAULT_SUMMARY = 'Fresh room. Invite an agent or post a first message to get started.';
const DEFAULT_ATTENTION_STATE: RoomAttentionState = 'ready';
const DEFAULT_LAST_UPDATE_LABEL = 'just now';
const ROOM_SUMMARY_MAX_CHARS = 80;
const PARTICIPANT_COLORS = [
  '#2563EB',
  '#059669',
  '#DC2626',
  '#7C3AED',
  '#D97706',
  '#0891B2',
  '#C026D3',
  '#4D7C0F'
];

function makeRoomId(): string {
  const fourLetters = Math.random().toString(36).slice(2, 6);
  const sixMore = Math.random().toString(36).slice(2, 8);
  return `${fourLetters}${sixMore}`;
}

function describeMomentNow(): string {
  return DEFAULT_LAST_UPDATE_LABEL;
}

function normaliseHandle(rawHandle: string): string {
  const trimmed = rawHandle.trim();
  if (trimmed.length === 0) return trimmed;
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

function truncateSummary(summary: string): string {
  if (summary.length <= ROOM_SUMMARY_MAX_CHARS) return summary;
  return `${summary.slice(0, ROOM_SUMMARY_MAX_CHARS - 1).trimEnd()}…`;
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function deriveRoomSummary(roomId: string, persistedSummary: string, memberCount: number): string {
  const latest = getIdentityDb()
    .prepare(
      `SELECT author_handle, body
         FROM chat_messages
        WHERE room_id = ?
        ORDER BY post_order DESC
        LIMIT 1`
    )
    .get(roomId) as LatestMessageSummaryRow | undefined;
  if (latest) {
    return truncateSummary(`${latest.author_handle}: ${compactWhitespace(latest.body)}`);
  }
  if (memberCount > 1) {
    return `${memberCount} members, no messages yet.`;
  }
  return persistedSummary || DEFAULT_SUMMARY;
}

function hashString(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function defaultParticipantColor(handle: string): string {
  return PARTICIPANT_COLORS[hashString(handle) % PARTICIPANT_COLORS.length];
}

export function defaultParticipantIcon(displayNameOrHandle: string): string {
  const trimmed = displayNameOrHandle.trim();
  const withoutAt = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
  return (withoutAt.charAt(0) || trimmed.charAt(0) || '?').toUpperCase();
}

export function defaultParticipantBackgroundStyle(kind: RoomMember['kind']): ParticipantBackgroundStyle {
  return kind === 'agent' ? 'transparent' : 'card';
}

export function normaliseParticipantBackgroundStyle(
  rawStyle: string | null | undefined,
  kind: RoomMember['kind']
): ParticipantBackgroundStyle {
  if (rawStyle === 'card' || rawStyle === 'tint' || rawStyle === 'transparent') return rawStyle;
  return defaultParticipantBackgroundStyle(kind);
}

function rowToRoom(row: ChatRoomRow, members: RoomMember[]): ChatRoom {
  return {
    id: row.id,
    name: row.name,
    summary: deriveRoomSummary(row.id, row.summary, members.length),
    description: typeof row.description === 'string' && row.description.length > 0
      ? row.description
      : null,
    attentionState: row.attention_state as RoomAttentionState,
    lastUpdate: row.last_update,
    whenItWasCreated: row.when_it_was_created,
    whoCreatedIt: row.who_created_it,
    creationOrder: row.creation_order,
    contractId: row.contract_id ?? null,
    members
  };
}

function memberRowToMember(row: ChatRoomMemberRow): RoomMember {
  const kind: RoomMember['kind'] =
    row.kind === 'human' && row.handle !== '@you' && findTerminalRecordByHandle(row.handle)
      ? 'agent'
      : row.kind;
  return {
    handle: row.handle,
    displayName: row.display_name,
    displayColor: row.display_color ?? defaultParticipantColor(row.handle),
    displayIcon: row.display_icon ?? defaultParticipantIcon(row.display_name || row.handle),
    displayBackgroundStyle: normaliseParticipantBackgroundStyle(
      row.display_background_style,
      kind
    ),
    joinedAt: row.joined_at,
    kind
  };
}

function recoverableRowToRoom(
  row: RecoverableChatRoomRow,
  restorable: boolean,
  deleteBoundary?: string
): RecoverableChatRoom {
  return {
    id: row.id,
    name: row.name,
    summary: row.summary,
    attentionState: row.attention_state as RoomAttentionState,
    lastUpdate: row.last_update,
    whenItWasCreated: row.when_it_was_created,
    whoCreatedIt: row.who_created_it,
    creationOrder: row.creation_order,
    archivedAtMs: row.archived_at_ms,
    deletedAtMs: row.deleted_at_ms,
    restorable,
    deleteBoundary
  };
}

function loadMembersForRoom(roomId: string): RoomMember[] {
  const db = getIdentityDb();
  const rows = db
    .prepare(`SELECT id, room_id, handle, display_name, display_color, display_icon, display_background_style, joined_at, kind
              FROM chat_room_members WHERE room_id = ? ORDER BY joined_at ASC`)
    .all(roomId) as ChatRoomMemberRow[];
  return rows.map(memberRowToMember);
}

function loadRoomById(roomId: string): ChatRoom | undefined {
  const db = getIdentityDb();
  const row = db
    .prepare(`SELECT id, name, summary, description, attention_state, last_update, contract_id,
                     when_it_was_created, who_created_it, creation_order
              FROM chat_rooms
              WHERE id = ? AND deleted_at_ms IS NULL AND archived_at_ms IS NULL`)
    .get(roomId) as ChatRoomRow | undefined;
  if (!row) return undefined;
  return rowToRoom(row, loadMembersForRoom(row.id));
}

export function createChatRoom(input: {
  name: string;
  whoCreatedIt: string;
  /** Optional user/agent-authored description (a19a496). Capped at
   *  ROOM_DESCRIPTION_MAX_CHARS and trimmed; null/empty stores NULL. */
  description?: string | null;
}): ChatRoom {
  const trimmedName = input.name.trim();
  if (trimmedName.length === 0) {
    throw new Error('A chat room needs a name with at least one character.');
  }
  // Validate optional description against the same cap as the PATCH path.
  const trimmedDescription = (input.description ?? '').trim();
  if (trimmedDescription.length > ROOM_DESCRIPTION_MAX_CHARS) {
    throw new Error(`Room description cannot exceed ${ROOM_DESCRIPTION_MAX_CHARS} characters.`);
  }
  const descriptionToStore: string | null = trimmedDescription.length === 0 ? null : trimmedDescription;
  // creatorKind detection: @you = human (always). Otherwise prefer a
  // terminal_record match. If that misses (race between agent registration
  // and side-room creation, or terminal_records not yet populated), check
  // for an existing live room-membership binding under the same handle —
  // that binding only exists for handles backed by a real terminal_id.
  // Without this fallback, agents creating side-rooms get stored as
  // kind='human' and the agent pill goes missing.
  const hasExistingAgentBinding = (handle: string): boolean => {
    if (handle === '@you' || handle.startsWith('@browser-bs_')) return false;
    const row = getIdentityDb()
      .prepare(
        `SELECT 1 FROM room_memberships
         WHERE handle = ? AND terminal_id != '' AND revoked_at_ms IS NULL
         LIMIT 1`
      )
      .get(handle);
    return !!row;
  };
  const creatorKind: RoomMember['kind'] =
    input.whoCreatedIt === '@you'
      ? 'human'
      : findTerminalRecordByHandle(input.whoCreatedIt) || hasExistingAgentBinding(input.whoCreatedIt)
        ? 'agent'
        : 'human';

  const db = getIdentityDb();
  const newRoomId = makeRoomId();
  const nowIso = new Date().toISOString();
  const lastUpdate = describeMomentNow();

  const txn = db.transaction(() => {
    const nextOrderRow = db
      .prepare(`SELECT COALESCE(MAX(creation_order), 0) + 1 AS next FROM chat_rooms`)
      .get() as { next: number };
    const creationOrder = nextOrderRow.next;

    db.prepare(`INSERT INTO chat_rooms
      (id, name, summary, description, attention_state, last_update,
       when_it_was_created, who_created_it, creation_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      newRoomId, trimmedName, DEFAULT_SUMMARY, descriptionToStore, DEFAULT_ATTENTION_STATE,
      lastUpdate, nowIso, input.whoCreatedIt, creationOrder
    );

    db.prepare(`INSERT INTO chat_room_members
      (id, room_id, handle, display_name, display_color, display_icon, display_background_style, joined_at, kind)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      randomUUID(),
      newRoomId,
      input.whoCreatedIt,
      input.whoCreatedIt,
      defaultParticipantColor(input.whoCreatedIt),
      defaultParticipantIcon(input.whoCreatedIt),
      defaultParticipantBackgroundStyle(creatorKind),
      nowIso,
      creatorKind
    );

    // Task #138: server operator @you is always a member
    if (input.whoCreatedIt !== '@you') {
      db.prepare(`INSERT INTO chat_room_members
        (id, room_id, handle, display_name, display_color, display_icon, display_background_style, joined_at, kind)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'human')`).run(
        randomUUID(),
        newRoomId,
        '@you',
        '@you',
        defaultParticipantColor('@you'),
        defaultParticipantIcon('@you'),
        defaultParticipantBackgroundStyle('human'),
        nowIso
      );
    }

    return creationOrder;
  });

  txn();
  // Per-human inbox: provision the creator's inbox (if human) + recompute
  // edges so any pre-existing agents in the room come into the inbox.
  // The @you membership added above also triggers a recompute through the
  // same hook, so @you's inbox is provisioned the first time @you appears
  // anywhere in the system.
  if (creatorKind === 'human') ensureHumanInboxRoom(input.whoCreatedIt);
  if (input.whoCreatedIt !== '@you') ensureHumanInboxRoom('@you');
  recomputeInboxEdgesForRoomMembershipChange(newRoomId, input.whoCreatedIt);
  if (input.whoCreatedIt !== '@you') {
    recomputeInboxEdgesForRoomMembershipChange(newRoomId, '@you');
  }
  return loadRoomById(newRoomId)!;
}

export function listChatRooms(): ChatRoom[] {
  // LINKED-CHAT-LISTING-FILTER (2026-05-15, JWPK): linked chats are a
  // property of a terminal (live on the terminal page as one of three
  // views), not stand-alone rooms in the Dashboard / /rooms index.
  // Filter by the inverse pointer terminal_records.linked_chat_room_id.
  // Direct lookup-by-id paths (findChatRoomById, loadRoomById) are NOT
  // filtered — linked rooms remain reachable by their id.
  const db = getIdentityDb();
  // ORDER BY (JWPK 2026-05-22): most-recently-messaged rooms first.
  // last_post_order is the cached MAX(post_order) for the room — set
  // inside chatMessageStore.insertMessageRow's transaction. The COALESCE
  // falls back to a derived MAX(post_order) subquery for rooms whose
  // column hasn't been backfilled yet, and finally to -1 so unmessaged
  // rooms drop below ANY messaged room. creation_order DESC is the
  // stable tiebreaker among rooms with the same activity score.
  const rows = db
    .prepare(`SELECT id, name, summary, description, attention_state, last_update, contract_id,
                     when_it_was_created, who_created_it, creation_order
              FROM chat_rooms
              WHERE deleted_at_ms IS NULL AND archived_at_ms IS NULL
                AND id NOT IN (
                  SELECT linked_chat_room_id FROM terminal_records
                  WHERE linked_chat_room_id IS NOT NULL
                )
                AND id NOT LIKE '__inbox_%'
              ORDER BY
                COALESCE(
                  last_post_order,
                  (SELECT MAX(post_order) FROM chat_messages WHERE room_id = chat_rooms.id),
                  -1
                ) DESC,
                creation_order DESC`)
    .all() as ChatRoomRow[];
  return rows.map((row) => rowToRoom(row, loadMembersForRoom(row.id)));
}

export function resetChatRoomStoreForTests(): void {
  const db = getIdentityDb();
  db.prepare('DELETE FROM chat_room_members').run();
  db.prepare('DELETE FROM chat_rooms').run();
}

export function findChatRoomById(id: string): ChatRoom | undefined {
  return loadRoomById(id);
}

export function doesChatRoomExist(roomId: string): boolean {
  const db = getIdentityDb();
  const row = db
    .prepare(`SELECT 1 AS present FROM chat_rooms
              WHERE id = ? AND deleted_at_ms IS NULL AND archived_at_ms IS NULL`)
    .get(roomId) as { present: number } | undefined;
  return row !== undefined;
}

/**
 * Membership predicate (JWPK msg_athx11bshr 2026-05-28 antV4): /rooms
 * delete/archive failed silently when the user's browser session was
 * room-scoped to a DIFFERENT room than the one being acted on.
 * `requireChatRoomMutationAuth` needs a fallback path that resolves
 * the cookie to an identity (ignoring room scope) and then verifies
 * the resolved handle is actually a member of the target room. This
 * predicate is the membership check. Handles get normalised with the
 * `@` prefix so callers can pass either form.
 */
export function isHandleMemberOfRoom(roomId: string, handle: string): boolean {
  if (!roomId || !handle) return false;
  const normalised = handle.startsWith('@') ? handle : `@${handle}`;
  const db = getIdentityDb();
  const row = db
    .prepare(`SELECT 1 AS present FROM chat_room_members
              WHERE room_id = ? AND handle = ?`)
    .get(roomId, normalised) as { present: number } | undefined;
  return row !== undefined;
}

/**
 * Soft-delete a chat room: sets chat_rooms.deleted_at_ms so listChatRooms,
 * loadRoomById, doesChatRoomExist all treat it as gone, but screenshots FK
 * CASCADE never fires and files + index rows survive (JWPK Q-E delta-2).
 * Returns true on state change, false if already soft-deleted or missing.
 */
export function softDeleteChatRoom(roomId: string, nowMs?: number): boolean {
  const db = getIdentityDb();
  const info = db
    .prepare(`UPDATE chat_rooms SET deleted_at_ms = ?
              WHERE id = ? AND deleted_at_ms IS NULL`)
    .run(nowMs ?? Date.now(), roomId);
  return info.changes > 0;
}

/**
 * Archive a chat room: sets chat_rooms.archived_at_ms so listChatRooms +
 * loadRoomById + doesChatRoomExist hide it. Non-destructive; recoverable
 * via unarchiveChatRoom. Returns true on state change, false if already
 * archived, soft-deleted, or missing.
 */
export function archiveChatRoom(roomId: string, nowMs?: number): boolean {
  const db = getIdentityDb();
  const info = db
    .prepare(`UPDATE chat_rooms SET archived_at_ms = ?
              WHERE id = ? AND archived_at_ms IS NULL AND deleted_at_ms IS NULL`)
    .run(nowMs ?? Date.now(), roomId);
  return info.changes > 0;
}

/**
 * Unarchive a previously archived room. Soft-deleted rooms are NOT eligible
 * for unarchive (they need an undelete path first, which doesn't exist yet).
 * Returns true on state change, false if not archived or missing.
 */
export function unarchiveChatRoom(roomId: string): boolean {
  const db = getIdentityDb();
  const info = db
    .prepare(`UPDATE chat_rooms SET archived_at_ms = NULL
              WHERE id = ? AND archived_at_ms IS NOT NULL AND deleted_at_ms IS NULL`)
    .run(roomId);
  return info.changes > 0;
}

export function listArchivedChatRooms(): RecoverableChatRoom[] {
  const rows = getIdentityDb()
    .prepare(`SELECT id, name, summary, description, attention_state, last_update, contract_id,
                     when_it_was_created, who_created_it, creation_order,
                     archived_at_ms, deleted_at_ms
              FROM chat_rooms
              WHERE archived_at_ms IS NOT NULL AND deleted_at_ms IS NULL
                AND id NOT LIKE '__inbox_%'
              ORDER BY archived_at_ms DESC, creation_order DESC`)
    .all() as RecoverableChatRoomRow[];
  return rows.map((row) => recoverableRowToRoom(row, true));
}

export function listDeletedChatRooms(): RecoverableChatRoom[] {
  const rows = getIdentityDb()
    .prepare(`SELECT id, name, summary, description, attention_state, last_update, contract_id,
                     when_it_was_created, who_created_it, creation_order,
                     archived_at_ms, deleted_at_ms
              FROM chat_rooms
              WHERE deleted_at_ms IS NOT NULL
                AND id NOT LIKE '__inbox_%'
              ORDER BY deleted_at_ms DESC, creation_order DESC`)
    .all() as RecoverableChatRoomRow[];
  return rows.map((row) =>
    recoverableRowToRoom(row, false, 'soft-deleted room restore is not implemented')
  );
}

export function inviteAgentToRoom(input: {
  roomId: string;
  agentHandle: string;
  agentDisplayName?: string;
}): ChatRoom {
  if (!doesChatRoomExist(input.roomId)) {
    throw new Error(`No room found with id ${input.roomId}.`);
  }

  const handleTrimmed = input.agentHandle.trim();
  if (handleTrimmed.length === 0) {
    throw new Error('An agent handle cannot be blank.');
  }

  const handleWithAtSign = handleTrimmed.startsWith('@') ? handleTrimmed : `@${handleTrimmed}`;

  const db = getIdentityDb();
  const alreadyMember = db
    .prepare(`SELECT 1 AS present FROM chat_room_members WHERE room_id = ? AND handle = ?`)
    .get(input.roomId, handleWithAtSign) as { present: number } | undefined;
  if (alreadyMember) {
    throw new Error(`${handleWithAtSign} is already a member of this room.`);
  }

  const nowIso = new Date().toISOString();
  const lastUpdate = describeMomentNow();
  const displayName = input.agentDisplayName?.trim() || handleWithAtSign;

  const txn = db.transaction(() => {
    db.prepare(`INSERT INTO chat_room_members
      (id, room_id, handle, display_name, display_color, display_icon, display_background_style, joined_at, kind)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'agent')`).run(
      randomUUID(),
      input.roomId,
      handleWithAtSign,
      displayName,
      defaultParticipantColor(handleWithAtSign),
      defaultParticipantIcon(displayName),
      defaultParticipantBackgroundStyle('agent'),
      nowIso
    );
    db.prepare(`UPDATE chat_rooms SET last_update = ? WHERE id = ?`).run(
      lastUpdate, input.roomId
    );
  });

  txn();
  recomputeInboxEdgesForRoomMembershipChange(input.roomId, handleWithAtSign);
  return loadRoomById(input.roomId)!;
}

export function inviteHumanToRoom(input: {
  roomId: string;
  humanHandle: string;
  humanDisplayName?: string;
}): ChatRoom {
  if (!doesChatRoomExist(input.roomId)) {
    throw new Error(`No room found with id ${input.roomId}.`);
  }

  const handleTrimmed = input.humanHandle.trim();
  if (handleTrimmed.length === 0) {
    throw new Error('A human handle cannot be blank.');
  }

  const handleWithAtSign = handleTrimmed.startsWith('@') ? handleTrimmed : `@${handleTrimmed}`;

  const db = getIdentityDb();
  const alreadyMember = db
    .prepare(`SELECT 1 AS present FROM chat_room_members WHERE room_id = ? AND handle = ?`)
    .get(input.roomId, handleWithAtSign) as { present: number } | undefined;
  if (alreadyMember) {
    throw new Error(`${handleWithAtSign} is already a member of this room.`);
  }

  const nowIso = new Date().toISOString();
  const lastUpdate = describeMomentNow();
  const displayName = input.humanDisplayName?.trim() || handleWithAtSign;

  const txn = db.transaction(() => {
    db.prepare(`INSERT INTO chat_room_members
      (id, room_id, handle, display_name, display_color, display_icon, display_background_style, joined_at, kind)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'human')`).run(
      randomUUID(),
      input.roomId,
      handleWithAtSign,
      displayName,
      defaultParticipantColor(handleWithAtSign),
      defaultParticipantIcon(displayName),
      defaultParticipantBackgroundStyle('human'),
      nowIso
    );
    db.prepare(`UPDATE chat_rooms SET last_update = ? WHERE id = ?`).run(
      lastUpdate, input.roomId
    );
  });

  txn();
  ensureHumanInboxRoom(handleWithAtSign);
  recomputeInboxEdgesForRoomMembershipChange(input.roomId, handleWithAtSign);
  return loadRoomById(input.roomId)!;
}

export function ensureAgentMemberInRoom(input: {
  roomId: string;
  agentHandle: string;
  agentDisplayName?: string;
}): ChatRoom {
  if (!doesChatRoomExist(input.roomId)) {
    throw new Error(`No room found with id ${input.roomId}.`);
  }

  const handleTrimmed = input.agentHandle.trim();
  if (handleTrimmed.length === 0) {
    throw new Error('An agent handle cannot be blank.');
  }

  const handleWithAtSign = handleTrimmed.startsWith('@') ? handleTrimmed : `@${handleTrimmed}`;
  const existing = getIdentityDb()
    .prepare(`SELECT 1 AS present FROM chat_room_members WHERE room_id = ? AND handle = ?`)
    .get(input.roomId, handleWithAtSign) as { present: number } | undefined;
  if (existing) return loadRoomById(input.roomId)!;

  return inviteAgentToRoom(input);
}

export class CannotRemoveRoomMemberError extends Error {
  reason: 'creator' | 'last-human';

  constructor(message: string, reason: CannotRemoveRoomMemberError['reason']) {
    super(message);
    this.name = 'CannotRemoveRoomMemberError';
    this.reason = reason;
  }
}

export function removeMemberFromRoom(input: {
  roomId: string;
  globalHandle: string;
}): ChatRoom {
  const room = loadRoomById(input.roomId);
  if (!room) {
    throw new Error(`No room found with id ${input.roomId}.`);
  }

  const target = room.members.find((member) => member.handle === input.globalHandle);
  if (!target) {
    throw new Error(`${input.globalHandle} is not a member of this room.`);
  }

  if (input.globalHandle === room.whoCreatedIt) {
    throw new CannotRemoveRoomMemberError(
      `${input.globalHandle} created this room and cannot be removed until ownership transfer ships.`,
      'creator'
    );
  }

  const humansInRoom = room.members.filter((member) => member.kind === 'human');
  if (target.kind === 'human' && humansInRoom.length === 1) {
    throw new CannotRemoveRoomMemberError(
      `${input.globalHandle} is the last human in this room and cannot be removed.`,
      'last-human'
    );
  }

  const db = getIdentityDb();
  const lastUpdate = describeMomentNow();
  const txn = db.transaction(() => {
    db.prepare(`DELETE FROM chat_room_members WHERE room_id = ? AND handle = ?`).run(
      input.roomId, input.globalHandle
    );
    db.prepare(`UPDATE chat_rooms SET last_update = ? WHERE id = ?`).run(
      lastUpdate, input.roomId
    );
  });
  txn();
  // After the delete, recompute every inbox edge involving the removed
  // handle. The helper walks the REMAINING members to find pairings — so
  // if the removed agent had no other shared rooms with each human in
  // this room, the inbox membership is dropped (JWPK 2026-05-22 auto-
  // remove correction).
  recomputeInboxEdgesForRoomMembershipChange(input.roomId, input.globalHandle);

  return loadRoomById(input.roomId)!;
}

export function renameChatRoom(input: {
  roomId: string;
  newName: string;
}): { previousName: string; chatRoom: ChatRoom } {
  const room = loadRoomById(input.roomId);
  if (!room) {
    throw new Error(`No room found with id ${input.roomId}.`);
  }

  const trimmedNewName = input.newName.trim();
  if (trimmedNewName.length === 0) {
    throw new Error('A chat room name cannot be blank.');
  }

  const db = getIdentityDb();
  const lastUpdate = describeMomentNow();
  db.prepare(`UPDATE chat_rooms SET name = ?, last_update = ? WHERE id = ?`).run(
    trimmedNewName, lastUpdate, input.roomId
  );

  return { previousName: room.name, chatRoom: loadRoomById(input.roomId)! };
}


export function updateRoomContract(roomId: string, contractId: string | null): void {
  const db = getIdentityDb();
  db.prepare('UPDATE chat_rooms SET contract_id = ? WHERE id = ?').run(contractId ?? null, roomId);
}

/**
 * Set a room's user/agent-authored description. Pass null (or empty string)
 * to clear. Trims whitespace; capped at ROOM_DESCRIPTION_MAX_CHARS to keep
 * the value renderable in a single line under the room name. Updates
 * last_update so the rooms list reflects the edit.
 */
export const ROOM_DESCRIPTION_MAX_CHARS = 240;

export function updateChatRoomDescription(input: {
  roomId: string;
  description: string | null;
}): ChatRoom {
  const room = loadRoomById(input.roomId);
  if (!room) {
    throw new Error(`No room found with id ${input.roomId}.`);
  }
  const trimmed = (input.description ?? '').trim();
  if (trimmed.length > ROOM_DESCRIPTION_MAX_CHARS) {
    throw new Error(`Room description cannot exceed ${ROOM_DESCRIPTION_MAX_CHARS} characters.`);
  }
  const valueToStore: string | null = trimmed.length === 0 ? null : trimmed;
  const db = getIdentityDb();
  const lastUpdate = describeMomentNow();
  db.prepare(`UPDATE chat_rooms SET description = ?, last_update = ? WHERE id = ?`)
    .run(valueToStore, lastUpdate, input.roomId);
  return loadRoomById(input.roomId)!;
}

export function updateRoomMemberPresentation(input: {
  roomId: string;
  globalHandle: string;
  displayName?: string;
  displayColor?: string;
  displayIcon?: string;
  displayBackgroundStyle?: ParticipantBackgroundStyle;
}): RoomMember {
  const room = loadRoomById(input.roomId);
  if (!room) {
    throw new Error(`No room found with id ${input.roomId}.`);
  }
  const current = room.members.find((member) => member.handle === input.globalHandle);
  if (!current) {
    throw new Error(`${input.globalHandle} is not a member of this room.`);
  }

  const displayName =
    input.displayName !== undefined && input.displayName.trim().length > 0
      ? input.displayName.trim()
      : current.displayName;
  const displayColor =
    input.displayColor !== undefined && input.displayColor.trim().length > 0
      ? input.displayColor.trim()
      : current.displayColor;
  const displayBackgroundStyle =
    input.displayBackgroundStyle !== undefined
      ? normaliseParticipantBackgroundStyle(input.displayBackgroundStyle, current.kind)
      : current.displayBackgroundStyle;
  const displayIcon =
    input.displayIcon !== undefined && input.displayIcon.trim().length > 0
      ? input.displayIcon.trim()
      : current.displayIcon;

  getIdentityDb()
    .prepare(`UPDATE chat_room_members
              SET display_name = ?, display_color = ?, display_icon = ?, display_background_style = ?
              WHERE room_id = ? AND handle = ?`)
    .run(
      displayName,
      displayColor,
      displayIcon,
      displayBackgroundStyle,
      input.roomId,
      input.globalHandle
    );

  const updated = loadRoomById(input.roomId)!;
  return updated.members.find((member) => member.handle === input.globalHandle)!;
}

// Unused — normaliseHandle helper retained for future invite normalisation work.
void normaliseHandle;

/**
 * Test-only escape hatch — overrides who_created_it for a room without going
 * through a (not-yet-built) ownership-transfer flow. Pre-Phase 5.1 the tests
 * for the last-human defense-in-depth guard mutated the in-memory ChatRoom
 * object directly; post-5.1 the returned object is a fresh row copy so a
 * direct UPDATE is needed instead. Double-underscore prefix + name suffix
 * signal "tests only" — production code must use the future transferOwnership
 * function once it ships.
 */
export function __overrideRoomCreatorForTests(roomId: string, newCreatorHandle: string): void {
  const db = getIdentityDb();
  db.prepare(`UPDATE chat_rooms SET who_created_it = ? WHERE id = ?`).run(
    newCreatorHandle, roomId
  );
}
