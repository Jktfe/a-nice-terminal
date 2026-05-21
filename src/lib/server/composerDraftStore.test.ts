import { beforeEach, describe, expect, it } from 'vitest';
import {
  createChatRoom,
  resetChatRoomStoreForTests
} from './chatRoomStore';
import {
  saveDraft,
  findDraft,
  clearDraft,
  resetComposerDraftStoreForTests
} from './composerDraftStore';

describe('composerDraftStore', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetComposerDraftStoreForTests();
  });

  it('saves a draft and surfaces it via findDraft', () => {
    const room = createChatRoom({ name: 'draft-target', whoCreatedIt: '@you' });
    const entry = saveDraft({
      roomId: room.id,
      authorHandle: '@you',
      draftText: 'Half-typed thought'
    });
    expect(entry.draftText).toBe('Half-typed thought');
    expect(findDraft(room.id, '@you')?.draftText).toBe('Half-typed thought');
  });

  it('trims surrounding whitespace from the draft text', () => {
    const room = createChatRoom({ name: 'trim', whoCreatedIt: '@you' });
    const entry = saveDraft({
      roomId: room.id,
      authorHandle: '@you',
      draftText: '   spaces around   '
    });
    expect(entry.draftText).toBe('spaces around');
  });

  it('rejects a blank draft (clients must DELETE to clear)', () => {
    const room = createChatRoom({ name: 'blank', whoCreatedIt: '@you' });
    expect(() =>
      saveDraft({ roomId: room.id, authorHandle: '@you', draftText: '   ' })
    ).toThrow();
  });

  it('rejects an unknown room BEFORE the blank-draft check', () => {
    expect(() =>
      saveDraft({ roomId: 'doesnotexist', authorHandle: '@you', draftText: '   ' })
    ).toThrow(/No room found/);
  });

  it('replaces an existing draft idempotently for the same (roomId, authorHandle)', () => {
    const room = createChatRoom({ name: 'replace', whoCreatedIt: '@you' });
    saveDraft({ roomId: room.id, authorHandle: '@you', draftText: 'first' });
    saveDraft({ roomId: room.id, authorHandle: '@you', draftText: 'second' });
    expect(findDraft(room.id, '@you')?.draftText).toBe('second');
  });

  it('isolates drafts per-author in the same room', () => {
    const room = createChatRoom({ name: 'per-author', whoCreatedIt: '@you' });
    saveDraft({ roomId: room.id, authorHandle: '@you', draftText: 'mine' });
    saveDraft({ roomId: room.id, authorHandle: '@codex', draftText: 'theirs' });
    expect(findDraft(room.id, '@you')?.draftText).toBe('mine');
    expect(findDraft(room.id, '@codex')?.draftText).toBe('theirs');
  });

  it('isolates drafts per-room for the same author', () => {
    const roomA = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    const roomB = createChatRoom({ name: 'b', whoCreatedIt: '@you' });
    saveDraft({ roomId: roomA.id, authorHandle: '@you', draftText: 'draft for A' });
    saveDraft({ roomId: roomB.id, authorHandle: '@you', draftText: 'draft for B' });
    expect(findDraft(roomA.id, '@you')?.draftText).toBe('draft for A');
    expect(findDraft(roomB.id, '@you')?.draftText).toBe('draft for B');
  });

  it('findDraft returns undefined when nothing has been saved', () => {
    const room = createChatRoom({ name: 'absent', whoCreatedIt: '@you' });
    expect(findDraft(room.id, '@you')).toBeUndefined();
  });

  it('normalises a bare handle without @ prefix on save and lookup', () => {
    const room = createChatRoom({ name: 'prefix', whoCreatedIt: '@you' });
    saveDraft({ roomId: room.id, authorHandle: 'codex', draftText: 'no at' });
    expect(findDraft(room.id, '@codex')?.draftText).toBe('no at');
    expect(findDraft(room.id, 'codex')?.draftText).toBe('no at');
  });

  it('clearDraft drops the draft and reports whether it existed', () => {
    const room = createChatRoom({ name: 'clear', whoCreatedIt: '@you' });
    saveDraft({ roomId: room.id, authorHandle: '@you', draftText: 'goodbye' });
    expect(clearDraft({ roomId: room.id, authorHandle: '@you' })).toBe(true);
    expect(findDraft(room.id, '@you')).toBeUndefined();
    expect(clearDraft({ roomId: room.id, authorHandle: '@you' })).toBe(false);
  });

  it('saveDraft rejects a blank authorHandle and persists nothing', () => {
    const room = createChatRoom({ name: 'blank-handle-save', whoCreatedIt: '@you' });
    expect(() =>
      saveDraft({ roomId: room.id, authorHandle: '   ', draftText: 'anything' })
    ).toThrow(/authorHandle/);
    expect(findDraft(room.id, '@you')).toBeUndefined();
  });

  it('clearDraft rejects a blank authorHandle', () => {
    const room = createChatRoom({ name: 'blank-handle-clear', whoCreatedIt: '@you' });
    expect(() =>
      clearDraft({ roomId: room.id, authorHandle: '   ' })
    ).toThrow(/authorHandle/);
  });

  it('findDraft returns undefined for a blank authorHandle without normalising', () => {
    const room = createChatRoom({ name: 'blank-handle-find', whoCreatedIt: '@you' });
    expect(findDraft(room.id, '   ')).toBeUndefined();
  });

  it('reset clears every draft across rooms and authors', () => {
    const room = createChatRoom({ name: 'reset', whoCreatedIt: '@you' });
    saveDraft({ roomId: room.id, authorHandle: '@you', draftText: 'wiped' });
    resetComposerDraftStoreForTests();
    expect(findDraft(room.id, '@you')).toBeUndefined();
  });
});
