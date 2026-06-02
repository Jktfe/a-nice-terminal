import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests } from './db';
import {
  ensureOrg,
  addUser,
  getUserRole,
  isSuperAdmin,
  listUsers,
  seedDefaultOrg,
  DEFAULT_ORG_ID,
  DEFAULT_SUPERADMIN_HANDLE
} from './orgStore';

let tmpDir: string;
const prev = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-org-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (prev === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = prev;
});

describe('orgStore — ORG -> USERS -> PRIVILEGES', () => {
  it('ensureOrg creates an org and is idempotent', () => {
    const a = ensureOrg('o1', 'Org One');
    expect(a.org_id).toBe('o1');
    expect(a.name).toBe('Org One');
    const b = ensureOrg('o1', 'Renamed'); // idempotent — keeps original name
    expect(b.name).toBe('Org One');
    expect(b.created_at_ms).toBe(a.created_at_ms);
  });

  it('addUser inserts a user with a role', () => {
    ensureOrg('o1', 'Org One');
    const u = addUser('o1', '@alice', 'member');
    expect(u).toMatchObject({ org_id: 'o1', handle: '@alice', role: 'member' });
    expect(getUserRole('@alice', 'o1')).toBe('member');
  });

  it('addUser upserts the role for an existing (org,handle), preserving created_at', () => {
    ensureOrg('o1', 'Org One');
    const first = addUser('o1', '@alice', 'member');
    const upgraded = addUser('o1', '@alice', 'admin');
    expect(upgraded.role).toBe('admin');
    expect(upgraded.created_at_ms).toBe(first.created_at_ms);
    expect(listUsers('o1')).toHaveLength(1); // no duplicate row
  });

  it('addUser rejects an unknown role', () => {
    ensureOrg('o1', 'Org One');
    // @ts-expect-error — invalid role at the type level too
    expect(() => addUser('o1', '@bob', 'wizard')).toThrow();
  });

  it('getUserRole scoped to an org returns null for an unknown handle', () => {
    ensureOrg('o1', 'Org One');
    expect(getUserRole('@nobody', 'o1')).toBeNull();
  });

  it('getUserRole without an org returns the highest role across orgs', () => {
    ensureOrg('o1', 'Org One');
    ensureOrg('o2', 'Org Two');
    addUser('o1', '@alice', 'member');
    addUser('o2', '@alice', 'superadmin');
    expect(getUserRole('@alice')).toBe('superadmin');
    expect(getUserRole('@alice', 'o1')).toBe('member');
  });

  it('isSuperAdmin is true if the handle is superadmin in any org', () => {
    ensureOrg('o1', 'Org One');
    ensureOrg('o2', 'Org Two');
    addUser('o1', '@alice', 'member');
    addUser('o2', '@alice', 'superadmin');
    expect(isSuperAdmin('@alice')).toBe(true);
    expect(isSuperAdmin('@alice', 'o1')).toBe(false); // scoped — member here
    expect(isSuperAdmin('@bob')).toBe(false);
  });

  it('listUsers returns the org members oldest-first', () => {
    ensureOrg('o1', 'Org One');
    addUser('o1', '@a', 'member');
    addUser('o1', '@b', 'admin');
    const users = listUsers('o1');
    expect(users.map((u) => u.handle)).toEqual(['@a', '@b']);
  });

  it('seedDefaultOrg creates NewModel + @JWPK superadmin, idempotently', () => {
    const r1 = seedDefaultOrg();
    expect(r1.org.org_id).toBe(DEFAULT_ORG_ID);
    expect(r1.org.name).toBe('NewModel');
    expect(r1.superAdmin.handle).toBe(DEFAULT_SUPERADMIN_HANDLE);
    expect(r1.superAdmin.role).toBe('superadmin');
    expect(isSuperAdmin(DEFAULT_SUPERADMIN_HANDLE)).toBe(true);

    // second call: no duplicates, role unchanged
    const r2 = seedDefaultOrg();
    expect(r2.superAdmin.role).toBe('superadmin');
    expect(listUsers(DEFAULT_ORG_ID)).toHaveLength(1);
    expect(r2.superAdmin.created_at_ms).toBe(r1.superAdmin.created_at_ms);
  });

  it('seedDefaultOrg never downgrades an existing @JWPK superadmin', () => {
    seedDefaultOrg();
    // someone tries to make JWPK a member; seed must not change that to member,
    // but if it were already superadmin seed leaves it untouched
    seedDefaultOrg();
    expect(getUserRole(DEFAULT_SUPERADMIN_HANDLE, DEFAULT_ORG_ID)).toBe('superadmin');
  });
});
