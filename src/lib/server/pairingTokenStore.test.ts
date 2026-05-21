import { describe, expect, it, beforeEach } from 'vitest';
import { getIdentityDb, resetIdentityDbForTests } from './db';
import {
  createPairingToken,
  getPairingToken,
  consumePairingToken,
  revokePairingToken,
  listPairingTokensForRoom,
} from './pairingTokenStore';

describe('pairingTokenStore', () => {
  beforeEach(() => {
    resetIdentityDbForTests();
    getIdentityDb();
  });

  it('creates and retrieves a pairing token', () => {
    const t = createPairingToken({
      room_id: 'room-a',
      server_url: 'http://localhost:6174',
      api_key: 'test-key',
      device_name: 'iPad',
      created_by: '@evolveantkimi',
      expires_at_ms: Date.now() + 60_000,
    });
    expect(t.token).toHaveLength(32);
    expect(t.room_id).toBe('room-a');
    expect(t.consumed_at_ms).toBeNull();

    const found = getPairingToken(t.token);
    expect(found?.device_name).toBe('iPad');
  });

  it('consumes a token once', () => {
    const t = createPairingToken({
      room_id: 'room-a',
      server_url: 'http://localhost:6174',
      api_key: 'test-key',
      expires_at_ms: Date.now() + 60_000,
    });
    const consumed = consumePairingToken(t.token, 'MyDevice');
    expect(consumed?.consumed_at_ms).not.toBeNull();
    expect(consumed?.consumed_by_device).toBe('MyDevice');

    const second = consumePairingToken(t.token, 'Other');
    expect(second).toBeNull();
  });

  it('rejects expired tokens', () => {
    const t = createPairingToken({
      room_id: 'room-a',
      server_url: 'http://localhost:6174',
      api_key: 'test-key',
      expires_at_ms: Date.now() - 1,
    });
    expect(consumePairingToken(t.token)).toBeNull();
  });

  it('revokes a token', () => {
    const t = createPairingToken({
      room_id: 'room-a',
      server_url: 'http://localhost:6174',
      api_key: 'test-key',
    });
    expect(revokePairingToken(t.token)).toBe(true);
    expect(getPairingToken(t.token)).toBeNull();
    expect(revokePairingToken(t.token)).toBe(false);
  });

  it('lists tokens for a room', () => {
    createPairingToken({ room_id: 'room-a', server_url: 'http://localhost:6174', api_key: 'k1' });
    createPairingToken({ room_id: 'room-b', server_url: 'http://localhost:6174', api_key: 'k2' });
    expect(listPairingTokensForRoom('room-a').length).toBeGreaterThanOrEqual(1);
    expect(listPairingTokensForRoom('room-b').length).toBeGreaterThanOrEqual(1);
  });
});
