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
  isMember,
  isDurableMemberHandle
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

  it('addMember by the SAME session is idempotent — one row, no duplicate', () => {
    addMember('roomX', '@alice', 'sess1');
    const again = addMember('roomX', '@alice', 'sess1'); // same session re-add
    expect(again.session_id).toBe('sess1');
    expect(resolveMember('roomX', '@alice')).toBe('sess1');
    expect(listMembers('roomX')).toHaveLength(1); // no duplicate
  });

  // HIJACK FIX (PART 1): a held handle must NOT be silently stolen by a
  // different session. addMember from a second session is a no-op on the
  // incumbent's session_id — it does NOT overwrite the existing claim.
  it('addMember from a DIFFERENT session does NOT overwrite the incumbent (hijack fix)', () => {
    addMember('roomX', '@JWPK', 'sessOwner');
    const attempt = addMember('roomX', '@JWPK', 'sessAttacker'); // hijack attempt
    expect(attempt.session_id).toBe('sessOwner'); // incumbent unchanged
    expect(resolveMember('roomX', '@JWPK')).toBe('sessOwner');
    expect(listMembers('roomX')).toHaveLength(1); // still one row
  });

  // A NULL-session incumbent (legacy backfill row) is not an owned claim, so a
  // real session may fill it — that is not a hijack.
  it('addMember fills a NULL-session incumbent (backfill row is unowned)', () => {
    addMember('roomX', '@alice', null); // backfill, unowned
    const filled = addMember('roomX', '@alice', 'sessReal');
    expect(filled.session_id).toBe('sessReal');
    expect(resolveMember('roomX', '@alice')).toBe('sessReal');
    expect(listMembers('roomX')).toHaveLength(1);
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

  it('only the literal @browser-bs_ prefix is synthetic; near-prefix handles stay durable', () => {
    expect(isDurableMemberHandle('@browser-bs_abc123')).toBe(false);
    expect(isDurableMemberHandle('@browser-bsXabc123')).toBe(true);
    expect(isDurableMemberHandle('@browser-bs')).toBe(true);
  });
});
