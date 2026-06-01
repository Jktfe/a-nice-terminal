import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getIdentityDb, resetIdentityDbForTests } from './db';
import { createChatRoom, resetChatRoomStoreForTests } from './chatRoomStore';
import { createAdmission } from './remoteAdmissionStore';
import { redeemAdmissionAndMintMapping } from './remoteRedeem';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
});

afterEach(() => {
  resetChatRoomStoreForTests();
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
});

describe('remoteRedeem', () => {
  it('returns null for unknown admission', () => {
    const result = redeemAdmissionAndMintMapping({
      admissionId: 'missing',
      code: 'any-code',
      remoteInstanceLabel: 'remote-1'
    });
    expect(result).toBeNull();
  });

  it('redeems a valid admission and creates mapping', () => {
    const room = createChatRoom({ name: 'Room 1', whoCreatedIt: '@you' });
    const { admission, code } = createAdmission({ roomId: room.id, lifetimePreset: 'indefinite', createdByHandle: '@you' });

    const result = redeemAdmissionAndMintMapping({
      admissionId: admission.id,
      code,
      remoteInstanceLabel: 'remote-1'
    });

    expect(result).not.toBeNull();
    expect(result!.mapping.room_id).toBe(room.id);
    expect(result!.mapping.remote_instance_label).toBe('remote-1');

    const db = getIdentityDb();
    const row = db.prepare(`SELECT accepted_at_ms, mapping_id_after_accept FROM chat_remote_admissions WHERE id = ?`).get(admission.id) as { accepted_at_ms: number; mapping_id_after_accept: string };
    expect(row.accepted_at_ms).toBeGreaterThan(0);
    expect(row.mapping_id_after_accept).toBe(result!.mapping.id);
  });

  it('returns null on wrong code', () => {
    const room = createChatRoom({ name: 'Room 1', whoCreatedIt: '@you' });
    const { admission } = createAdmission({ roomId: room.id, lifetimePreset: 'indefinite', createdByHandle: '@you' });

    const result = redeemAdmissionAndMintMapping({
      admissionId: admission.id,
      code: 'wrong-code',
      remoteInstanceLabel: 'remote-1'
    });
    expect(result).toBeNull();
  });

  it('returns null on already-accepted admission', () => {
    const room = createChatRoom({ name: 'Room 1', whoCreatedIt: '@you' });
    const { admission, code } = createAdmission({ roomId: room.id, lifetimePreset: 'indefinite', createdByHandle: '@you' });

    redeemAdmissionAndMintMapping({ admissionId: admission.id, code, remoteInstanceLabel: 'remote-1' });
    const second = redeemAdmissionAndMintMapping({ admissionId: admission.id, code, remoteInstanceLabel: 'remote-2' });

    expect(second).toBeNull();
  });

  it('returns null on expired admission', () => {
    const room = createChatRoom({ name: 'Room 1', whoCreatedIt: '@you' });
    const { admission, code } = createAdmission({ roomId: room.id, lifetimePreset: 'indefinite', createdByHandle: '@you' });
    getIdentityDb().prepare(`UPDATE chat_remote_admissions SET expires_acceptance_at_ms = 1 WHERE id = ?`).run(admission.id);

    const result = redeemAdmissionAndMintMapping({
      admissionId: admission.id,
      code,
      remoteInstanceLabel: 'remote-1'
    });
    expect(result).toBeNull();
  });

  it('returns null on revoked admission', () => {
    const room = createChatRoom({ name: 'Room 1', whoCreatedIt: '@you' });
    const { admission, code } = createAdmission({ roomId: room.id, lifetimePreset: 'indefinite', createdByHandle: '@you' });
    getIdentityDb().prepare(`UPDATE chat_remote_admissions SET revoked_at_ms = ? WHERE id = ?`).run(Date.now(), admission.id);

    const result = redeemAdmissionAndMintMapping({
      admissionId: admission.id,
      code,
      remoteInstanceLabel: 'remote-1'
    });
    expect(result).toBeNull();
  });

  it('respects direction input', () => {
    const room = createChatRoom({ name: 'Room 1', whoCreatedIt: '@you' });
    const { admission, code } = createAdmission({ roomId: room.id, lifetimePreset: 'indefinite', createdByHandle: '@you' });

    const result = redeemAdmissionAndMintMapping({
      admissionId: admission.id,
      code,
      remoteInstanceLabel: 'remote-1',
      direction: 'both'
    });

    expect(result).not.toBeNull();
    expect(result!.mapping.direction).toBe('both');
  });
});
