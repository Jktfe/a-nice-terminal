import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bindTokenToRoomMembership,
  resolveMembershipForToken
} from './chatMembershipBinding';
import {
  createInvite,
  exchangePasswordForToken,
  resetChatInviteStoreForTests,
  revokeInvite,
  revokeToken
} from './chatInviteStore';
import {
  createChatRoom,
  resetChatRoomStoreForTests
} from './chatRoomStore';

beforeEach(() => {
  resetChatInviteStoreForTests();
  resetChatRoomStoreForTests();
});

afterEach(() => {
  resetChatInviteStoreForTests();
  resetChatRoomStoreForTests();
});

function makeRoomAndToken(handle: string | null = '@guest') {
  const room = createChatRoom({ name: 'Test room', whoCreatedIt: '@claude2' });
  const invite = createInvite({
    roomId: room.id,
    label: 'Team',
    password: 'correct-horse-battery-staple',
    kinds: ['cli'],
    createdBy: '@claude2'
  });
  const exchange = exchangePasswordForToken({
    inviteId: invite.id,
    password: 'correct-horse-battery-staple',
    kind: 'cli',
    handle
  });
  return { room, invite, exchange };
}

describe('chatMembershipBinding', () => {
  it('M1: bind succeeds and returns room + member + identity with normalised handle', () => {
    const { room, exchange } = makeRoomAndToken('@guest');
    const result = bindTokenToRoomMembership({ tokenSecret: exchange.tokenSecret, roomId: room.id });
    expect(result).not.toBeNull();
    expect(result?.member.handle).toBe('@guest');
    expect(result?.identity.tokenId).toBe(exchange.tokenId);
    expect(result?.room.members.some((m) => m.handle === '@guest')).toBe(true);
  });

  it('M2: bind returns null on bogus tokenSecret', () => {
    const { room } = makeRoomAndToken('@guest');
    expect(bindTokenToRoomMembership({ tokenSecret: 'not-a-real-token', roomId: room.id })).toBeNull();
  });

  it('M3: bind returns null when tokenSecret is right but roomId is wrong', () => {
    const { exchange } = makeRoomAndToken('@guest');
    const otherRoom = createChatRoom({ name: 'Other', whoCreatedIt: '@claude2' });
    expect(bindTokenToRoomMembership({ tokenSecret: exchange.tokenSecret, roomId: otherRoom.id })).toBeNull();
  });

  it('M4: bind returns null after revokeInvite (cascade)', () => {
    const { room, invite, exchange } = makeRoomAndToken('@guest');
    revokeInvite(invite.id);
    expect(bindTokenToRoomMembership({ tokenSecret: exchange.tokenSecret, roomId: room.id })).toBeNull();
  });

  it('M5: bind returns null after revokeToken', () => {
    const { room, exchange } = makeRoomAndToken('@guest');
    revokeToken(exchange.tokenId);
    expect(bindTokenToRoomMembership({ tokenSecret: exchange.tokenSecret, roomId: room.id })).toBeNull();
  });

  it('M6: bind throws when identity has no handle (admin-must-mint-with-handle invariant)', () => {
    const { room, exchange } = makeRoomAndToken(null);
    expect(() => bindTokenToRoomMembership({ tokenSecret: exchange.tokenSecret, roomId: room.id })).toThrow();
  });

  it('M7: idempotent — binding the same token twice returns the same member, no duplicate', () => {
    const { room, exchange } = makeRoomAndToken('@guest');
    const first = bindTokenToRoomMembership({ tokenSecret: exchange.tokenSecret, roomId: room.id });
    const second = bindTokenToRoomMembership({ tokenSecret: exchange.tokenSecret, roomId: room.id });
    expect(first?.member.handle).toBe('@guest');
    expect(second?.member.handle).toBe('@guest');
    const guestMembers = second?.room.members.filter((m) => m.handle === '@guest') ?? [];
    expect(guestMembers.length).toBe(1);
  });

  it('M8: resolveMembershipForToken returns the member without mutating membership', () => {
    const { room, exchange } = makeRoomAndToken('@guest');
    expect(resolveMembershipForToken(exchange.tokenSecret, room.id)).toBeNull();
    bindTokenToRoomMembership({ tokenSecret: exchange.tokenSecret, roomId: room.id });
    const resolved = resolveMembershipForToken(exchange.tokenSecret, room.id);
    expect(resolved?.handle).toBe('@guest');
  });

  it('extra: bind returns null when room with that id does not exist', () => {
    const { exchange } = makeRoomAndToken('@guest');
    // Token is for the real room. If we ask to bind on a fake roomId, verifyToken returns null first.
    expect(bindTokenToRoomMembership({ tokenSecret: exchange.tokenSecret, roomId: 'room-does-not-exist' })).toBeNull();
  });

  it('extra: handle without leading @ is normalised before lookup', () => {
    const { room, exchange } = makeRoomAndToken('guest-no-prefix');
    const result = bindTokenToRoomMembership({ tokenSecret: exchange.tokenSecret, roomId: room.id });
    expect(result?.member.handle).toBe('@guest-no-prefix');
  });
});
