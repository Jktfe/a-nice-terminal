import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests } from './db';
import {
  addMember,
  removeMember,
  listMembers,
  resolveMember,
  isMember
} from './membershipStore';

let tmpDir: string;
const prev = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-membership-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (prev === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = prev;
});

describe('membershipStore — (room_id, handle, session_id) is the WHOLE table', () => {
  it('addMember inserts and resolveMember returns the session', () => {
    addMember('roomX', '@alice', 'sessZ');
    expect(resolveMember('roomX', '@alice')).toBe('sessZ');
    expect(isMember('roomX', '@alice')).toBe(true);
  });

  it('resolveMember returns null for a non-member', () => {
    expect(resolveMember('roomX', '@nobody')).toBeNull();
    expect(isMember('roomX', '@nobody')).toBe(false);
  });

  it('addMember upserts on UNIQUE(room,handle) — one row, session updated', () => {
    addMember('roomX', '@alice', 'sess1');
    const updated = addMember('roomX', '@alice', 'sess2'); // rebind
    expect(updated.session_id).toBe('sess2');
    expect(resolveMember('roomX', '@alice')).toBe('sess2');
    expect(listMembers('roomX')).toHaveLength(1); // no duplicate
  });

  it('upsert preserves the original created_at_ms', () => {
    const first = addMember('roomX', '@alice', 'sess1');
    const again = addMember('roomX', '@alice', 'sess2');
    expect(again.created_at_ms).toBe(first.created_at_ms);
  });

  it('the same handle can be a member of different rooms independently', () => {
    addMember('roomX', '@alice', 'sessX');
    addMember('roomY', '@alice', 'sessY');
    expect(resolveMember('roomX', '@alice')).toBe('sessX');
    expect(resolveMember('roomY', '@alice')).toBe('sessY');
  });

  it('removeMember hard-deletes the row and reports whether one was removed', () => {
    addMember('roomX', '@alice', 'sessZ');
    expect(removeMember('roomX', '@alice')).toBe(true);
    expect(isMember('roomX', '@alice')).toBe(false);
    expect(resolveMember('roomX', '@alice')).toBeNull();
    expect(removeMember('roomX', '@alice')).toBe(false); // already gone
  });

  it('listMembers returns a room members oldest-first', () => {
    addMember('roomX', '@a', 's1');
    addMember('roomX', '@b', 's2');
    addMember('roomY', '@c', 's3'); // other room, excluded
    expect(listMembers('roomX').map((m) => m.handle)).toEqual(['@a', '@b']);
  });

  it('a member may have a NULL session (backfill case); isMember still true, resolveMember null', () => {
    addMember('roomX', '@alice', null);
    expect(isMember('roomX', '@alice')).toBe(true);
    expect(resolveMember('roomX', '@alice')).toBeNull();
    expect(listMembers('roomX')[0].session_id).toBeNull();
  });
});
