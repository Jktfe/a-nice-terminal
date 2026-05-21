import { beforeEach, describe, expect, it } from 'vitest';
import {
  createChatRoom,
  resetChatRoomStoreForTests
} from './chatRoomStore';
import {
  setDigestNote,
  clearDigestNote,
  findDigestNote,
  listDigestNotes,
  resetChairDigestNoteStoreForTests
} from './chairDigestNoteStore';

describe('chairDigestNoteStore', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetChairDigestNoteStoreForTests();
  });

  it('saves a digest note and surfaces it via findDigestNote', () => {
    const room = createChatRoom({ name: 'note-target', whoCreatedIt: '@you' });

    const entry = setDigestNote({
      roomId: room.id,
      noteText: 'Plan agreed — shipping slice 5 next.'
    });

    expect(entry.noteText).toBe('Plan agreed — shipping slice 5 next.');
    expect(findDigestNote(room.id)?.noteText).toBe('Plan agreed — shipping slice 5 next.');
  });

  it('trims surrounding whitespace from the note text', () => {
    const room = createChatRoom({ name: 'trim-test', whoCreatedIt: '@you' });
    const entry = setDigestNote({ roomId: room.id, noteText: '   spaces around   ' });
    expect(entry.noteText).toBe('spaces around');
  });

  it('rejects a blank note', () => {
    const room = createChatRoom({ name: 'blank-test', whoCreatedIt: '@you' });
    expect(() =>
      setDigestNote({ roomId: room.id, noteText: '   ' })
    ).toThrow();
  });

  it('rejects an unknown room', () => {
    expect(() =>
      setDigestNote({ roomId: 'doesnotexist', noteText: 'note' })
    ).toThrow();
  });

  it('replaces a previous note for the same room (idempotent set)', () => {
    const room = createChatRoom({ name: 'replace', whoCreatedIt: '@you' });
    setDigestNote({ roomId: room.id, noteText: 'first note' });
    setDigestNote({ roomId: room.id, noteText: 'second note' });

    expect(findDigestNote(room.id)?.noteText).toBe('second note');
    expect(listDigestNotes()).toHaveLength(1);
  });

  it('clearDigestNote drops the note and reports it existed', () => {
    const room = createChatRoom({ name: 'clear', whoCreatedIt: '@you' });
    setDigestNote({ roomId: room.id, noteText: 'goodbye soon' });

    expect(clearDigestNote(room.id)).toBe(true);
    expect(findDigestNote(room.id)).toBeUndefined();
    expect(clearDigestNote(room.id)).toBe(false);
  });

  it('findDigestNote returns undefined when nothing has been set', () => {
    const room = createChatRoom({ name: 'absent', whoCreatedIt: '@you' });
    expect(findDigestNote(room.id)).toBeUndefined();
  });

  it('listDigestNotes returns every note across rooms, newest first', async () => {
    const roomA = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    const roomB = createChatRoom({ name: 'b', whoCreatedIt: '@you' });

    setDigestNote({ roomId: roomA.id, noteText: 'older' });
    // Small await so the setAt timestamps are deterministically different.
    await new Promise((resolve) => setTimeout(resolve, 2));
    setDigestNote({ roomId: roomB.id, noteText: 'newer' });

    const notes = listDigestNotes();
    expect(notes).toHaveLength(2);
    expect(notes[0].noteText).toBe('newer');
    expect(notes[1].noteText).toBe('older');
  });

  it('reset clears every note', () => {
    const room = createChatRoom({ name: 'reset', whoCreatedIt: '@you' });
    setDigestNote({ roomId: room.id, noteText: 'will be wiped' });
    resetChairDigestNoteStoreForTests();
    expect(findDigestNote(room.id)).toBeUndefined();
    expect(listDigestNotes()).toEqual([]);
  });
});
