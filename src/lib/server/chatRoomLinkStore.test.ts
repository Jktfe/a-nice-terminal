import { beforeEach, describe, expect, it } from 'vitest';
import {
  DuplicateRoomLinkError,
  createRoomLink,
  deleteRoomLink,
  listIncomingRoomLinks,
  listOutgoingRoomLinks,
  resetChatRoomLinkStoreForTests
} from './chatRoomLinkStore';
import { createChatRoom, resetChatRoomStoreForTests } from './chatRoomStore';

describe('chatRoomLinkStore', () => {
  beforeEach(() => {
    resetChatRoomLinkStoreForTests();
    resetChatRoomStoreForTests();
  });

  it('creates and lists an outgoing link with peer name resolution', () => {
    const source = createChatRoom({ name: 'main', whoCreatedIt: '@you' });
    const target = createChatRoom({ name: 'native apps', whoCreatedIt: '@you' });
    const link = createRoomLink({
      sourceRoomId: source.id,
      targetRoomId: target.id,
      relationship: 'discussion_of',
      title: null,
      createdBy: '@you'
    });
    expect(link.relationship).toBe('discussion_of');

    const outgoing = listOutgoingRoomLinks(source.id);
    expect(outgoing).toHaveLength(1);
    expect(outgoing[0]).toMatchObject({
      peerRoomId: target.id,
      peerRoomName: 'native apps',
      relationship: 'discussion_of'
    });

    const incomingForTarget = listIncomingRoomLinks(target.id);
    expect(incomingForTarget).toHaveLength(1);
    expect(incomingForTarget[0]).toMatchObject({
      peerRoomId: source.id,
      peerRoomName: 'main'
    });
  });

  it('rejects a duplicate (source, target, relationship) edge', () => {
    const source = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    const target = createChatRoom({ name: 'b', whoCreatedIt: '@you' });
    createRoomLink({
      sourceRoomId: source.id,
      targetRoomId: target.id,
      relationship: 'follows_up',
      title: null,
      createdBy: null
    });
    expect(() =>
      createRoomLink({
        sourceRoomId: source.id,
        targetRoomId: target.id,
        relationship: 'follows_up',
        title: null,
        createdBy: null
      })
    ).toThrow(DuplicateRoomLinkError);
  });

  it('allows two distinct relationships between the same pair of rooms', () => {
    const source = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    const target = createChatRoom({ name: 'b', whoCreatedIt: '@you' });
    createRoomLink({
      sourceRoomId: source.id,
      targetRoomId: target.id,
      relationship: 'discussion_of',
      title: null,
      createdBy: null
    });
    createRoomLink({
      sourceRoomId: source.id,
      targetRoomId: target.id,
      relationship: 'follows_up',
      title: null,
      createdBy: null
    });
    expect(listOutgoingRoomLinks(source.id)).toHaveLength(2);
  });

  it('deletes a link by id and returns true; subsequent delete returns false', () => {
    const source = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    const target = createChatRoom({ name: 'b', whoCreatedIt: '@you' });
    const link = createRoomLink({
      sourceRoomId: source.id,
      targetRoomId: target.id,
      relationship: 'discussion_of',
      title: null,
      createdBy: null
    });
    expect(deleteRoomLink(link.id)).toBe(true);
    expect(deleteRoomLink(link.id)).toBe(false);
    expect(listOutgoingRoomLinks(source.id)).toHaveLength(0);
  });
});
