import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests } from './db';
import {
  setMemberPresentation,
  getMemberPresentation,
  listPresentationForRoom,
  removeMemberPresentation
} from './membershipPresentationStore';

let tmpDir: string;
const prevDbPath = process.env.ANT_FRESH_DB_PATH;
const prevVault = process.env.ANT_MEMORY_VAULT_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-member-presentation-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_MEMORY_VAULT_PATH = '/tmp/ant-memory-pack-test';
  resetIdentityDbForTests();
});
afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (prevDbPath === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = prevDbPath;
  if (prevVault === undefined) delete process.env.ANT_MEMORY_VAULT_PATH;
  else process.env.ANT_MEMORY_VAULT_PATH = prevVault;
});

describe('membershipPresentationStore', () => {
  it('returns null when no presentation is set', () => {
    expect(getMemberPresentation('room1', '@x')).toBeNull();
  });

  it('sets and reads presentation, keyed by (room, handle)', () => {
    setMemberPresentation('room1', '@tony', {
      display_color: '#f00',
      display_icon: 'robot',
      member_kind: 'agent'
    });
    const p = getMemberPresentation('room1', '@tony');
    expect(p?.display_color).toBe('#f00');
    expect(p?.display_icon).toBe('robot');
    expect(p?.member_kind).toBe('agent');
    expect(p?.display_background_style).toBeNull();
    // same handle, different room = independent
    expect(getMemberPresentation('room2', '@tony')).toBeNull();
  });

  it('partial update preserves omitted fields (colour change does not clobber icon)', () => {
    setMemberPresentation('room1', '@tony', { display_color: '#f00', display_icon: 'robot' });
    setMemberPresentation('room1', '@tony', { display_color: '#0f0' }); // only colour
    const p = getMemberPresentation('room1', '@tony');
    expect(p?.display_color).toBe('#0f0'); // changed
    expect(p?.display_icon).toBe('robot'); // preserved
  });

  it('explicit null clears a field', () => {
    setMemberPresentation('room1', '@tony', { display_icon: 'robot' });
    setMemberPresentation('room1', '@tony', { display_icon: null });
    expect(getMemberPresentation('room1', '@tony')?.display_icon).toBeNull();
  });

  it('per-room display name override is stored', () => {
    setMemberPresentation('room1', '@tony', { room_display_name: 'Tony (chair)' });
    expect(getMemberPresentation('room1', '@tony')?.room_display_name).toBe('Tony (chair)');
  });

  it('lists all presentation rows in a room, handle-ordered', () => {
    setMemberPresentation('room1', '@bravo', { display_color: '#00f' });
    setMemberPresentation('room1', '@alpha', { display_color: '#f00' });
    setMemberPresentation('room2', '@gamma', { display_color: '#0f0' });
    const list = listPresentationForRoom('room1');
    expect(list.map((p) => p.handle)).toEqual(['@alpha', '@bravo']);
  });

  it('removes presentation', () => {
    setMemberPresentation('room1', '@tony', { display_color: '#f00' });
    expect(removeMemberPresentation('room1', '@tony')).toBe(true);
    expect(getMemberPresentation('room1', '@tony')).toBeNull();
    expect(removeMemberPresentation('room1', '@tony')).toBe(false); // idempotent
  });
});
