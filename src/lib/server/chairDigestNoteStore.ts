/**
 * Chair digest notes — durable per-room digest text.
 *
 * Related: src/lib/server/chairStore.ts (M29 slice 1, heuristic digests).
 *   chairStore returns derived counts/freshness with no writes; this
 *   store owns the writable digest sentence that an operator can persist
 *   today and that the cheap-model LLM will write in M29 slice 3.
 *
 * Verdict relative to chairStore: KEEP both. Slice 1 is the always-on
 * cheap signal; slice 2 is the upgrade path for LLM-authored summaries.
 *
 * Single source of truth per room — one note replaces the prior note when
 * the same roomId is set again. Notes are sorted by setAt-newest-first in
 * listDigestNotes so the chair view can show fresh activity at the top.
 */

import { findChatRoomById } from './chatRoomStore';

export type ChairDigestNote = {
  roomId: string;
  noteText: string;
  setAt: string;
};

const notesByRoomId = new Map<string, ChairDigestNote>();

export function setDigestNote(input: { roomId: string; noteText: string }): ChairDigestNote {
  if (!findChatRoomById(input.roomId)) {
    throw new Error(`No room found with id ${input.roomId}.`);
  }

  const trimmedNote = input.noteText.trim();
  if (trimmedNote.length === 0) {
    throw new Error('A digest note cannot be blank.');
  }

  const entry: ChairDigestNote = {
    roomId: input.roomId,
    noteText: trimmedNote,
    setAt: new Date().toISOString()
  };

  notesByRoomId.set(input.roomId, entry);
  return entry;
}

export function clearDigestNote(roomId: string): boolean {
  return notesByRoomId.delete(roomId);
}

export function findDigestNote(roomId: string): ChairDigestNote | undefined {
  return notesByRoomId.get(roomId);
}

export function listDigestNotes(): ChairDigestNote[] {
  return Array.from(notesByRoomId.values()).sort((leftNote, rightNote) => {
    if (leftNote.setAt < rightNote.setAt) return 1;
    if (leftNote.setAt > rightNote.setAt) return -1;
    return 0;
  });
}

export function resetChairDigestNoteStoreForTests(): void {
  notesByRoomId.clear();
}
