import { beforeEach, describe, expect, it } from 'vitest';
import {
  createArtefactInRoom,
  getArtefact,
  isKnownArtefactKind,
  listArtefactsInRoom,
  resetChatRoomArtefactStoreForTests,
  softDeleteArtefact
} from './chatRoomArtefactStore';
import { createChatRoom, resetChatRoomStoreForTests } from './chatRoomStore';

describe('chatRoomArtefactStore', () => {
  beforeEach(() => {
    resetChatRoomArtefactStoreForTests();
    resetChatRoomStoreForTests();
  });

  it('rejects unknown artefact kinds at the type guard', () => {
    expect(isKnownArtefactKind('html')).toBe(true);
    expect(isKnownArtefactKind('deck')).toBe(true);
    expect(isKnownArtefactKind('not-a-kind')).toBe(false);
    expect(isKnownArtefactKind(42)).toBe(false);
  });

  it('persists an artefact and lists it ordered by kind then created_at_ms desc', () => {
    const room = createChatRoom({ name: 'busy', whoCreatedIt: '@you' });
    const deckOlder = createArtefactInRoom({
      roomId: room.id,
      kind: 'deck',
      title: 'Pitch v1',
      nowMs: 1
    });
    const deckNewer = createArtefactInRoom({
      roomId: room.id,
      kind: 'deck',
      title: 'Pitch v2',
      nowMs: 2
    });
    const html = createArtefactInRoom({
      roomId: room.id,
      kind: 'html',
      title: 'Landing draft',
      refUrl: 'https://example.com/landing.html',
      nowMs: 3
    });

    const listed = listArtefactsInRoom(room.id);
    expect(listed.map((entry) => entry.id)).toEqual([deckNewer.id, deckOlder.id, html.id]);
    expect(listed[2].refUrl).toBe('https://example.com/landing.html');
  });

  it('blank titles are rejected', () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    expect(() =>
      createArtefactInRoom({ roomId: room.id, kind: 'doc', title: '   ' })
    ).toThrow();
  });

  it('soft delete hides the artefact and returns true once', () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const artefact = createArtefactInRoom({
      roomId: room.id,
      kind: 'mockup',
      title: 'wireframe'
    });
    expect(softDeleteArtefact(artefact.id)).toBe(true);
    expect(softDeleteArtefact(artefact.id)).toBe(false);
    expect(listArtefactsInRoom(room.id)).toHaveLength(0);
    expect(getArtefact(artefact.id)).toBeNull();
  });

  it('getArtefact returns one non-deleted artefact by id', () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const artefact = createArtefactInRoom({
      roomId: room.id,
      kind: 'spreadsheet',
      title: 'Costs',
      refUrl: '/sheets/costs'
    });
    expect(getArtefact(artefact.id)).toMatchObject({
      id: artefact.id,
      kind: 'spreadsheet',
      title: 'Costs',
      refUrl: '/sheets/costs'
    });
  });
});
