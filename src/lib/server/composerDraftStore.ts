/**
 * Composer draft persistence — never lose typed text.
 *
 * Per-room, per-author in-memory draft store so the composer can save what
 * the user is typing and restore it on next visit. SQLite-backed
 * persistence lands when the data layer ships; the public function names
 * stay the same so the composer does not need to change.
 *
 * Backs the "Draft persistence" capability ledger row. UI wiring is a
 * later slice; this slice ships the store + endpoint surface only.
 */

import { findChatRoomById } from './chatRoomStore';

export type ComposerDraft = {
  roomId: string;
  authorHandle: string;
  draftText: string;
  savedAt: string;
};

const draftsByRoomThenAuthor = new Map<string, Map<string, ComposerDraft>>();

function draftMapForRoom(roomId: string): Map<string, ComposerDraft> {
  const existing = draftsByRoomThenAuthor.get(roomId);
  if (existing) return existing;
  const freshMapForRoom = new Map<string, ComposerDraft>();
  draftsByRoomThenAuthor.set(roomId, freshMapForRoom);
  return freshMapForRoom;
}

function normaliseToAtHandle(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('@')) return trimmed;
  return `@${trimmed}`;
}

function assertHandleNonBlank(rawHandle: string): void {
  if (rawHandle.trim().length === 0) {
    throw new Error('authorHandle cannot be blank.');
  }
}

export function saveDraft(input: {
  roomId: string;
  authorHandle: string;
  draftText: string;
}): ComposerDraft {
  if (!findChatRoomById(input.roomId)) {
    throw new Error(`No room found with id ${input.roomId}.`);
  }

  assertHandleNonBlank(input.authorHandle);

  const trimmedDraft = input.draftText.trim();
  if (trimmedDraft.length === 0) {
    throw new Error('A composer draft cannot be blank — clear it with DELETE instead.');
  }

  const handle = normaliseToAtHandle(input.authorHandle);
  const entry: ComposerDraft = {
    roomId: input.roomId,
    authorHandle: handle,
    draftText: trimmedDraft,
    savedAt: new Date().toISOString()
  };

  draftMapForRoom(input.roomId).set(handle, entry);
  return entry;
}

export function findDraft(roomId: string, authorHandle: string): ComposerDraft | undefined {
  if (authorHandle.trim().length === 0) return undefined;
  const handle = normaliseToAtHandle(authorHandle);
  return draftMapForRoom(roomId).get(handle);
}

export function clearDraft(input: { roomId: string; authorHandle: string }): boolean {
  assertHandleNonBlank(input.authorHandle);
  const handle = normaliseToAtHandle(input.authorHandle);
  return draftMapForRoom(input.roomId).delete(handle);
}

export function resetComposerDraftStoreForTests(): void {
  draftsByRoomThenAuthor.clear();
}
