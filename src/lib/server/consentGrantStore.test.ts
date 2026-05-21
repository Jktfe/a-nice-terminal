import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from './db';
import { createChatRoom, resetChatRoomStoreForTests } from './chatRoomStore';
import {
  consumeConsentGrant,
  createConsentGrant,
  listConsentGrants,
  resetConsentGrantStoreForTests,
  revokeConsentGrant
} from './consentGrantStore';

const PREV_DB = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
  resetConsentGrantStoreForTests();
  resetChatRoomStoreForTests();
});

afterEach(() => {
  resetChatRoomStoreForTests();
  resetConsentGrantStoreForTests();
  resetIdentityDbForTests();
  if (PREV_DB === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB;
});

describe('consentGrantStore', () => {
  it('creates a room-scoped grant with topic, grantee, source set, and audit metadata', () => {
    const room = createChatRoom({ name: 'grant-room', whoCreatedIt: '@owner' });
    const grant = createConsentGrant({
      roomId: room.id,
      grantedTo: 'codex',
      topic: 'file-read',
      sourceSet: ['/tmp/a.txt', '/tmp/b.txt'],
      duration: '1h',
      maxAnswers: 2,
      createdBy: '@owner'
    });

    expect(grant.id).toMatch(/^cg_/);
    expect(grant.roomId).toBe(room.id);
    expect(grant.grantedTo).toBe('@codex');
    expect(grant.topic).toBe('file-read');
    expect(grant.sourceSet).toEqual(['/tmp/a.txt', '/tmp/b.txt']);
    expect(grant.status).toBe('active');
    expect(grant.maxAnswers).toBe(2);
    expect(grant.auditTrail[0]).toMatchObject({ action: 'created', actorHandle: '@owner' });
  });

  it('lists grants by room, grantee, topic, and active-only status', () => {
    const room = createChatRoom({ name: 'grant-room', whoCreatedIt: '@owner' });
    const keep = createConsentGrant({
      roomId: room.id,
      grantedTo: '@codex',
      topic: 'file-read',
      sourceSet: []
    });
    createConsentGrant({
      roomId: room.id,
      grantedTo: '@kimi',
      topic: 'web-fetch',
      sourceSet: []
    });
    revokeConsentGrant(keep.id, '@owner');

    expect(listConsentGrants({ roomId: room.id })).toHaveLength(1);
    expect(listConsentGrants({ roomId: room.id, includeInactive: true })).toHaveLength(2);
    expect(listConsentGrants({ roomId: room.id, grantedTo: 'kimi', topic: 'web-fetch' })[0].grantedTo).toBe('@kimi');
  });

  it('consumes a matching grant and exhausts it at maxAnswers', () => {
    const room = createChatRoom({ name: 'grant-room', whoCreatedIt: '@owner' });
    const grant = createConsentGrant({
      roomId: room.id,
      grantedTo: '@codex',
      topic: 'file-read',
      sourceSet: ['/tmp/a.txt'],
      maxAnswers: 1
    });

    const first = consumeConsentGrant({
      roomId: room.id,
      grantedTo: '@codex',
      topic: 'file-read',
      source: '/tmp/a.txt',
      actorHandle: '@codex'
    });
    expect(first.allowed).toBe(true);
    if (!first.allowed) throw new Error('expected grant consume to be allowed');
    expect(first.grant.answerCount).toBe(1);
    expect(first.grant.status).toBe('exhausted');

    const second = consumeConsentGrant({
      roomId: room.id,
      grantedTo: '@codex',
      topic: 'file-read',
      source: '/tmp/a.txt',
      actorHandle: '@codex'
    });
    expect(second).toMatchObject({ allowed: false, reason: 'exhausted', grantId: grant.id });
  });

  it('rejects source, topic, grantee, room, revoked, and expired mismatches', () => {
    const room = createChatRoom({ name: 'grant-room', whoCreatedIt: '@owner' });
    const grant = createConsentGrant({
      roomId: room.id,
      grantedTo: '@codex',
      topic: 'file-read',
      sourceSet: ['/tmp/a.txt'],
      duration: '1ms'
    });
    expect(consumeConsentGrant({ roomId: room.id, grantedTo: '@codex', topic: 'file-read', source: '/tmp/other.txt' })).toMatchObject({ allowed: false, reason: 'source' });
    expect(consumeConsentGrant({ roomId: room.id, grantedTo: '@codex', topic: 'web-fetch', source: '/tmp/a.txt' })).toMatchObject({ allowed: false, reason: 'topic' });
    expect(consumeConsentGrant({ roomId: room.id, grantedTo: '@kimi', topic: 'file-read', source: '/tmp/a.txt' })).toMatchObject({ allowed: false, reason: 'grantee' });
    expect(consumeConsentGrant({ roomId: 'other-room', grantedTo: '@codex', topic: 'file-read', source: '/tmp/a.txt' })).toMatchObject({ allowed: false, reason: 'room' });
    revokeConsentGrant(grant.id, '@owner');
    expect(consumeConsentGrant({ roomId: room.id, grantedTo: '@codex', topic: 'file-read', source: '/tmp/a.txt' })).toMatchObject({ allowed: false, reason: 'revoked' });
  });
}
);
