/**
 * Bring-in-App context payload + launch recorder.
 *
 * Premium feature spec at docs/research/bring-in-app-spec-2026-05-25.md
 * (ratified by JWPK msg_a0s51ioct6 2026-05-25 — "Q2: Yes").
 *
 * The server mints a `RoomContextPayload` summarising the room's recent
 * state (last N messages + name/description + open asks + attached plan
 * progress) so that any client (web/Mac/Windows/iOS) can hand it off to
 * an external app (Claude Desktop / Claude Mobile / ChatGPT / Codex
 * Desktop / Gemini) via the platform-appropriate launch protocol.
 *
 * Per-target launch is NOT in this layer — adapters live on the client
 * side (web `BringInAppButton.svelte`, Mac `BringInAppMenu.swift`, etc.)
 * and choose between URL scheme / clipboard / Share Sheet / new window
 * based on platform capability detection.
 *
 * What this module owns:
 *   - Payload minting (recent-messages markdown, room metadata, open asks)
 *   - Launch event recording into `bring_in_app_launches` (audit trail
 *     for the operator's /cli-hooks consumption pattern + future revoke)
 *   - Pure server data shaping — no I/O beyond DB reads/writes
 */

import { getIdentityDb } from './db';
import { findChatRoomById, type ChatRoom } from './chatRoomStore';
import { listMessagesInRoom } from './chatMessageStore';

const DEFAULT_MESSAGE_COUNT = 30;

export type BringInTarget =
  | 'claude-desktop'
  | 'claude-mobile'
  | 'chatgpt'
  | 'codex-desktop'
  | 'gemini';

const ALLOWED_TARGETS: readonly BringInTarget[] = [
  'claude-desktop',
  'claude-mobile',
  'chatgpt',
  'codex-desktop',
  'gemini'
];

export function isAllowedBringInTarget(value: unknown): value is BringInTarget {
  return typeof value === 'string' && (ALLOWED_TARGETS as readonly string[]).includes(value);
}

export type RoomContextPayload = {
  roomId: string;
  roomName: string;
  roomDescription: string | null;
  recentMessagesMarkdown: string;
  openAsksMarkdown: string | null;
  generatedAtMs: number;
};

export type BringInLaunchRecord = {
  id: string;
  roomId: string;
  target: BringInTarget;
  operatorHandle: string;
  launchedAtMs: number;
  payloadByteSize: number;
};

type BringInLaunchRow = {
  id: string;
  room_id: string;
  target: string;
  operator_handle: string;
  launched_at_ms: number;
  payload_byte_size: number;
};

/**
 * Mint a payload describing the current room state. Pure read-only —
 * caller is responsible for any subsequent recording via
 * `recordBringInLaunch`.
 */
export function mintRoomContextPayload(input: {
  roomId: string;
  messageCount?: number;
  nowMs?: number;
}): RoomContextPayload | null {
  const room: ChatRoom | undefined = findChatRoomById(input.roomId);
  if (!room) return null;
  const messageCount = input.messageCount ?? DEFAULT_MESSAGE_COUNT;
  const nowMs = input.nowMs ?? Date.now();

  const allMessages = listMessagesInRoom(input.roomId);
  // Take the last N (newest at end of list); reverse so the markdown
  // reads chronologically oldest → newest like a transcript.
  const recent = allMessages.slice(-messageCount);
  const recentMessagesMarkdown = recent
    .map((m) => {
      const author = m.authorDisplayName ?? m.authorHandle;
      const body = (m.body ?? '').replace(/\n+/g, ' ').trim();
      return `**${author}**: ${body}`;
    })
    .join('\n\n');

  // Open asks markdown via direct DB read — askStore would create a
  // circular import. Cheap enough for the payload-mint path; if hot it
  // can move into askStore later.
  const askRows = getIdentityDb()
    .prepare(
      `SELECT title, opened_by_display_name, opened_by_handle, opened_at_ms
       FROM asks
       WHERE room_id = ? AND status = 'open'
       ORDER BY opened_at_ms DESC
       LIMIT 20`
    )
    .all(input.roomId) as Array<{
      title: string;
      opened_by_display_name: string | null;
      opened_by_handle: string;
      opened_at_ms: number;
    }>;
  const openAsksMarkdown = askRows.length === 0
    ? null
    : askRows
        .map((a) => `- **${a.title}** (opened by ${a.opened_by_display_name ?? a.opened_by_handle})`)
        .join('\n');

  return {
    roomId: room.id,
    roomName: room.name,
    roomDescription: room.description,
    recentMessagesMarkdown,
    openAsksMarkdown,
    generatedAtMs: nowMs
  };
}

/**
 * Record a bring-in launch. Append-only audit trail so operators can
 * see in /cli-hooks (or a future Bring-in-App-history surface) which
 * external apps received a context payload from which room when, and
 * grants can be revoked later.
 */
export function recordBringInLaunch(input: {
  roomId: string;
  target: BringInTarget;
  operatorHandle: string;
  payloadByteSize: number;
  launchedAtMs?: number;
  launchId?: string;
}): BringInLaunchRecord {
  const id = input.launchId ?? `bia_${Math.random().toString(36).slice(2, 14)}`;
  const launchedAtMs = input.launchedAtMs ?? Date.now();
  const db = getIdentityDb();
  db.prepare(
    `INSERT INTO bring_in_app_launches
       (id, room_id, target, operator_handle, launched_at_ms, payload_byte_size)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, input.roomId, input.target, input.operatorHandle, launchedAtMs, input.payloadByteSize);
  return {
    id,
    roomId: input.roomId,
    target: input.target,
    operatorHandle: input.operatorHandle,
    launchedAtMs,
    payloadByteSize: input.payloadByteSize
  };
}

/**
 * List recent launches across all rooms for an operator. Drives the
 * /bring-in-app-history surface (not built yet — endpoint reserved).
 */
export function listBringInLaunchesForOperator(
  operatorHandle: string,
  limit: number = 50
): BringInLaunchRecord[] {
  const rows = getIdentityDb()
    .prepare(
      `SELECT id, room_id, target, operator_handle, launched_at_ms, payload_byte_size
       FROM bring_in_app_launches
       WHERE operator_handle = ?
       ORDER BY launched_at_ms DESC
       LIMIT ?`
    )
    .all(operatorHandle, limit) as BringInLaunchRow[];
  return rows.map((row) => ({
    id: row.id,
    roomId: row.room_id,
    target: row.target as BringInTarget,
    operatorHandle: row.operator_handle,
    launchedAtMs: row.launched_at_ms,
    payloadByteSize: row.payload_byte_size
  }));
}

/**
 * Estimate payload byte size for storage/recording. Sum of the markdown
 * fields + handle overhead — close enough for audit-trail bookkeeping.
 */
export function payloadByteSize(payload: RoomContextPayload): number {
  return (
    (payload.roomName?.length ?? 0)
    + (payload.roomDescription?.length ?? 0)
    + payload.recentMessagesMarkdown.length
    + (payload.openAsksMarkdown?.length ?? 0)
  );
}
