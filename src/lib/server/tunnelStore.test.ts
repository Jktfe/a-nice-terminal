import { describe, expect, it, beforeEach } from 'vitest';
import { getIdentityDb, resetIdentityDbForTests } from './db';
import {
  createTunnel,
  getTunnelBySlug,
  listTunnelsForRoom,
  updateTunnel,
  deleteTunnel,
} from './tunnelStore';

describe('tunnelStore', () => {
  beforeEach(() => {
    resetIdentityDbForTests();
    getIdentityDb();
  });

  it('creates and retrieves a tunnel', () => {
    const t = createTunnel({
      slug: 'test-site',
      title: 'Test Site',
      public_url: 'https://test.trycloudflare.com',
      local_url: 'http://localhost:3000',
      owner_room_id: 'room-a',
      allowed_room_ids: ['room-b'],
      access_required: true,
      status: 'linked',
    });
    expect(t.slug).toBe('test-site');
    expect(t.allowed_room_ids).toContain('room-a');
    expect(t.allowed_room_ids).toContain('room-b');

    const found = getTunnelBySlug('test-site');
    expect(found).not.toBeNull();
    expect(found?.title).toBe('Test Site');
  });

  it('lists tunnels scoped to a room', () => {
    createTunnel({
      slug: 'site-1',
      public_url: 'https://1.com',
      owner_room_id: 'room-a',
      allowed_room_ids: ['room-b'],
      access_required: false,
      status: 'linked',
    });
    createTunnel({
      slug: 'site-2',
      public_url: 'https://2.com',
      owner_room_id: 'room-c',
      allowed_room_ids: [],
      access_required: false,
      status: 'linked',
    });

    expect(listTunnelsForRoom('room-a').map((t) => t.slug)).toContain('site-1');
    expect(listTunnelsForRoom('room-b').map((t) => t.slug)).toContain('site-1');
    expect(listTunnelsForRoom('room-c').map((t) => t.slug)).toContain('site-2');
  });

  it('updates tunnel fields', () => {
    createTunnel({
      slug: 'upd',
      public_url: 'https://old.com',
      owner_room_id: 'room-a',
      allowed_room_ids: [],
      access_required: false,
      status: 'linked',
    });
    const updated = updateTunnel('upd', { public_url: 'https://new.com', status: 'offline' });
    expect(updated?.public_url).toBe('https://new.com');
    expect(updated?.status).toBe('offline');
  });

  it('deletes a tunnel', () => {
    createTunnel({
      slug: 'del',
      public_url: 'https://del.com',
      owner_room_id: 'room-a',
      allowed_room_ids: [],
      access_required: false,
      status: 'linked',
    });
    expect(deleteTunnel('del')).toBe(true);
    expect(getTunnelBySlug('del')).toBeNull();
    expect(deleteTunnel('del')).toBe(false);
  });
});
