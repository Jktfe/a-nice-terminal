import { randomUUID } from 'node:crypto';
import { hasBareAtMarker, listBareMentionHandles } from '$lib/chat/mentionRouting';
import type { ChatMessage } from './chatMessageStore';
import { listMessagesInRoom } from './chatMessageStore';
import { listChatRooms } from './chatRoomStore';
import { getIdentityDb } from './db';
import { openAskInRoom, type Ask } from './askStore';

const HANDS_UP_EMOJIS = ['🙌', '🙋‍♂️'] as const;
const RETROSCAN_WINDOW_MS = 24 * 60 * 60 * 1000;

export type AskCandidateStatus = 'candidate' | 'promoted' | 'dismissed';
export type AskCandidateSourceType = 'mention' | 'emoji-message' | 'reaction';

export type AskCandidate = {
  id: string;
  roomId: string;
  sourceMessageId: string;
  sourceType: AskCandidateSourceType;
  sourceActorHandle: string;
  sourceEmoji?: string;
  title: string;
  body: string;
  status: AskCandidateStatus;
  createdAt: string;
  promotedAskId?: string;
  promotedByHandle?: string;
  promotedAt?: string;
  dismissedByHandle?: string;
  dismissedAt?: string;
};

type AskCandidateRow = {
  id: string;
  room_id: string;
  source_message_id: string;
  source_type: AskCandidateSourceType;
  source_actor_handle: string;
  source_emoji: string;
  title: string;
  body: string;
  status: AskCandidateStatus;
  created_at_ms: number;
  promoted_ask_id: string | null;
  promoted_by_handle: string | null;
  promoted_at_ms: number | null;
  dismissed_by_handle: string | null;
  dismissed_at_ms: number | null;
};

function msToIso(ms: number): string {
  return new Date(ms).toISOString();
}

function rowToCandidate(row: AskCandidateRow): AskCandidate {
  const candidate: AskCandidate = {
    id: row.id,
    roomId: row.room_id,
    sourceMessageId: row.source_message_id,
    sourceType: row.source_type,
    sourceActorHandle: row.source_actor_handle,
    title: row.title,
    body: row.body,
    status: row.status,
    createdAt: msToIso(row.created_at_ms)
  };
  if (row.source_emoji.length > 0) candidate.sourceEmoji = row.source_emoji;
  if (row.promoted_ask_id !== null) candidate.promotedAskId = row.promoted_ask_id;
  if (row.promoted_by_handle !== null) candidate.promotedByHandle = row.promoted_by_handle;
  if (row.promoted_at_ms !== null) candidate.promotedAt = msToIso(row.promoted_at_ms);
  if (row.dismissed_by_handle !== null) candidate.dismissedByHandle = row.dismissed_by_handle;
  if (row.dismissed_at_ms !== null) candidate.dismissedAt = msToIso(row.dismissed_at_ms);
  return candidate;
}

function titleFor(type: AskCandidateSourceType, message: ChatMessage, emoji?: string): string {
  if (type === 'reaction') return `Candidate ask from ${emoji ?? 'reaction'}`;
  if (type === 'emoji-message') return `Candidate ask from ${emoji ?? 'hands-up'} signal`;
  return `Candidate ask from @you mention`;
}

function bodyFor(type: AskCandidateSourceType, message: ChatMessage, actorHandle: string, emoji?: string): string {
  const sourceLine = `Source message ${message.id} in room ${message.roomId} by ${message.authorHandle}.`;
  if (type === 'reaction') {
    return `${actorHandle} reacted ${emoji ?? ''} to a message.\n\n${sourceLine}\n\n${message.body}`;
  }
  return `${sourceLine}\n\n${message.body}`;
}

function insertCandidate(input: {
  roomId: string;
  sourceMessageId: string;
  sourceType: AskCandidateSourceType;
  sourceActorHandle: string;
  sourceEmoji?: string;
  title: string;
  body: string;
  createdAtMs?: number;
}): AskCandidate | null {
  const nowMs = input.createdAtMs ?? Date.now();
  const id = `cand_${randomUUID()}`;
  const info = getIdentityDb()
    .prepare(
      `INSERT OR IGNORE INTO ask_candidates
       (id, room_id, source_message_id, source_type, source_actor_handle, source_emoji,
        title, body, status, created_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'candidate', ?)`
    )
    .run(
      id,
      input.roomId,
      input.sourceMessageId,
      input.sourceType,
      input.sourceActorHandle,
      input.sourceEmoji ?? '',
      input.title,
      input.body,
      nowMs
    );
  if (info.changes === 0) return null;
  return findCandidateById(id);
}

function messageCreatedAtMs(message: ChatMessage): number {
  const parsed = Date.parse(message.postedAt);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function handsUpEmojiIn(body: string): string | undefined {
  return HANDS_UP_EMOJIS.find((emoji) => body.includes(emoji));
}

export function collectAskCandidatesFromMessage(message: ChatMessage): AskCandidate[] {
  if (message.kind !== 'human' && message.kind !== 'agent') return [];
  const createdAtMs = messageCreatedAtMs(message);
  const candidates: AskCandidate[] = [];
  const targetsLoggedInHuman =
    listBareMentionHandles(message.body).some((handle) => handle.toLowerCase() === '@you')
    || hasBareAtMarker(message.body);
  if (targetsLoggedInHuman) {
    const candidate = insertCandidate({
      roomId: message.roomId,
      sourceMessageId: message.id,
      sourceType: 'mention',
      sourceActorHandle: message.authorHandle,
      title: titleFor('mention', message),
      body: bodyFor('mention', message, message.authorHandle),
      createdAtMs
    });
    if (candidate) candidates.push(candidate);
  }
  const emoji = handsUpEmojiIn(message.body);
  if (emoji) {
    const candidate = insertCandidate({
      roomId: message.roomId,
      sourceMessageId: message.id,
      sourceType: 'emoji-message',
      sourceActorHandle: message.authorHandle,
      sourceEmoji: emoji,
      title: titleFor('emoji-message', message, emoji),
      body: bodyFor('emoji-message', message, message.authorHandle, emoji),
      createdAtMs
    });
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

export function collectAskCandidateFromReaction(input: {
  roomId: string;
  message: ChatMessage;
  reactorHandle: string;
  emoji: string;
}): AskCandidate | null {
  if (!HANDS_UP_EMOJIS.includes(input.emoji as (typeof HANDS_UP_EMOJIS)[number])) return null;
  return insertCandidate({
    roomId: input.roomId,
    sourceMessageId: input.message.id,
    sourceType: 'reaction',
    sourceActorHandle: input.reactorHandle,
    sourceEmoji: input.emoji,
    title: titleFor('reaction', input.message, input.emoji),
    body: bodyFor('reaction', input.message, input.reactorHandle, input.emoji)
  });
}

export function listOpenAskCandidates(roomId?: string): AskCandidate[] {
  const sql = `SELECT id, room_id, source_message_id, source_type, source_actor_handle, source_emoji,
                     title, body, status, created_at_ms, promoted_ask_id, promoted_by_handle,
                     promoted_at_ms, dismissed_by_handle, dismissed_at_ms
                FROM ask_candidates
               WHERE status = 'candidate'${roomId ? ' AND room_id = ?' : ''}
               ORDER BY created_at_ms ASC, rowid ASC`;
  const rows = roomId
    ? getIdentityDb().prepare(sql).all(roomId) as AskCandidateRow[]
    : getIdentityDb().prepare(sql).all() as AskCandidateRow[];
  return rows.map(rowToCandidate);
}

export function findCandidateById(candidateId: string): AskCandidate | null {
  const row = getIdentityDb()
    .prepare(
      `SELECT id, room_id, source_message_id, source_type, source_actor_handle, source_emoji,
              title, body, status, created_at_ms, promoted_ask_id, promoted_by_handle,
              promoted_at_ms, dismissed_by_handle, dismissed_at_ms
         FROM ask_candidates
        WHERE id = ?`
    )
    .get(candidateId) as AskCandidateRow | undefined;
  return row ? rowToCandidate(row) : null;
}

export function promoteAskCandidate(input: {
  candidateId: string;
  promotedByHandle: string;
}): { candidate: AskCandidate; ask: Ask } {
  const candidate = findCandidateById(input.candidateId);
  if (!candidate) throw new Error(`Ask candidate ${input.candidateId} not found.`);
  if (candidate.status !== 'candidate') throw new Error(`Ask candidate ${input.candidateId} is already ${candidate.status}.`);
  const ask = openAskInRoom({
    roomId: candidate.roomId,
    openedByHandle: candidate.sourceActorHandle,
    title: candidate.title,
    body: candidate.body
  });
  const nowMs = Date.now();
  getIdentityDb()
    .prepare(
      `UPDATE ask_candidates
          SET status = 'promoted',
              promoted_ask_id = ?,
              promoted_by_handle = ?,
              promoted_at_ms = ?
        WHERE id = ?`
    )
    .run(ask.id, input.promotedByHandle.trim() || '@you', nowMs, input.candidateId);
  return { candidate: findCandidateById(input.candidateId)!, ask };
}

export function dismissAskCandidate(input: {
  candidateId: string;
  dismissedByHandle: string;
}): AskCandidate {
  const candidate = findCandidateById(input.candidateId);
  if (!candidate) throw new Error(`Ask candidate ${input.candidateId} not found.`);
  if (candidate.status !== 'candidate') throw new Error(`Ask candidate ${input.candidateId} is already ${candidate.status}.`);
  const nowMs = Date.now();
  getIdentityDb()
    .prepare(
      `UPDATE ask_candidates
          SET status = 'dismissed',
              dismissed_by_handle = ?,
              dismissed_at_ms = ?
        WHERE id = ?`
    )
    .run(input.dismissedByHandle.trim() || '@you', nowMs, input.candidateId);
  return findCandidateById(input.candidateId)!;
}

export function backfillAskCandidatesFromRecentMessages(input: { sinceMs?: number } = {}): number {
  const sinceMs = input.sinceMs ?? Date.now() - RETROSCAN_WINDOW_MS;
  let count = 0;
  for (const room of listChatRooms()) {
    for (const message of listMessagesInRoom(room.id)) {
      if (messageCreatedAtMs(message) < sinceMs) continue;
      count += collectAskCandidatesFromMessage(message).length;
    }
  }
  return count;
}

export function resetAskCandidateStoreForTests(): void {
  getIdentityDb().prepare(`DELETE FROM ask_candidates`).run();
}
