import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests, getIdentityDb } from './db';
import { upsertTerminal } from './terminalsStore';
import {
  getLinkedChatPermission,
  isLinkedChatPermissionState,
  isLinkedChatSubjectAllowed,
  listLinkedChatPermissions,
  setLinkedChatPermission,
  type LinkedChatPermissionState
} from './linkedChatPermissionStore';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-linkedchat-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
});

function terminal(name = 'linked-owner') {
  return upsertTerminal({ pid: Math.floor(Math.random() * 10_000) + 1, pid_start: name, name });
}

describe('linkedChatPermissionStore — M3.3a T1', () => {
  it('accepts only allow/deny states', () => {
    expect(isLinkedChatPermissionState('allow')).toBe(true);
    expect(isLinkedChatPermissionState('deny')).toBe(true);
    expect(isLinkedChatPermissionState('blocked')).toBe(false);
    expect(isLinkedChatPermissionState(null)).toBe(false);
  });

  it('creates one permission row with normalised handles', () => {
    const t = terminal();
    const row = setLinkedChatPermission({
      terminalId: t.id,
      subjectHandle: 'viewer',
      state: 'allow',
      setBy: 'owner',
      reason: 'pairing'
    });
    expect(row?.terminal_id).toBe(t.id);
    expect(row?.subject_handle).toBe('@viewer');
    expect(row?.state).toBe('allow');
    expect(row?.set_by).toBe('@owner');
    expect(row?.reason).toBe('pairing');
    expect(typeof row?.set_at_ms).toBe('number');
  });

  it('upserts one row per terminal_id + subject_handle and replaces state', () => {
    const t = terminal();
    const first = setLinkedChatPermission({ terminalId: t.id, subjectHandle: '@viewer', state: 'allow', setBy: '@owner' });
    const second = setLinkedChatPermission({ terminalId: t.id, subjectHandle: '@viewer', state: 'deny', setBy: '@owner', reason: 'pause' });
    const rows = listLinkedChatPermissions(t.id);
    expect(rows).toHaveLength(1);
    expect(second?.id).toBe(first?.id);
    expect(rows[0].state).toBe('deny');
    expect(rows[0].reason).toBe('pause');
  });

  it('deny overrides allow in effective permission resolution', () => {
    const t = terminal();
    setLinkedChatPermission({ terminalId: t.id, subjectHandle: '@viewer', state: 'allow', setBy: '@owner' });
    expect(isLinkedChatSubjectAllowed(t.id, '@viewer')).toBe(true);
    setLinkedChatPermission({ terminalId: t.id, subjectHandle: '@viewer', state: 'deny', setBy: '@owner' });
    expect(isLinkedChatSubjectAllowed(t.id, '@viewer')).toBe(false);
  });

  it('defaults unknown/no-row subjects to not allowed', () => {
    const t = terminal();
    expect(getLinkedChatPermission(t.id, '@absent')).toBeNull();
    expect(isLinkedChatSubjectAllowed(t.id, '@absent')).toBe(false);
  });

  it('isolates permissions by terminal_id', () => {
    const t1 = terminal('linked-one');
    const t2 = terminal('linked-two');
    setLinkedChatPermission({ terminalId: t1.id, subjectHandle: '@viewer', state: 'allow', setBy: '@owner' });
    setLinkedChatPermission({ terminalId: t2.id, subjectHandle: '@viewer', state: 'deny', setBy: '@owner' });
    expect(isLinkedChatSubjectAllowed(t1.id, '@viewer')).toBe(true);
    expect(isLinkedChatSubjectAllowed(t2.id, '@viewer')).toBe(false);
    expect(listLinkedChatPermissions(t1.id)).toHaveLength(1);
    expect(listLinkedChatPermissions(t2.id)).toHaveLength(1);
  });

  it('returns null and writes nothing for an unknown terminal_id', () => {
    const row = setLinkedChatPermission({ terminalId: 'term_missing', subjectHandle: '@viewer', state: 'allow', setBy: '@owner' });
    const count = getIdentityDb()
      .prepare(`SELECT COUNT(*) as n FROM linked_chat_permissions`)
      .get() as { n: number };
    expect(row).toBeNull();
    expect(count.n).toBe(0);
  });

  it('returns null and writes nothing for invalid state or blank handles', () => {
    const t = terminal();
    const badState = setLinkedChatPermission({
      terminalId: t.id,
      subjectHandle: '@viewer',
      state: 'blocked' as LinkedChatPermissionState,
      setBy: '@owner'
    });
    const blankSubject = setLinkedChatPermission({ terminalId: t.id, subjectHandle: ' ', state: 'allow', setBy: '@owner' });
    const blankSetter = setLinkedChatPermission({ terminalId: t.id, subjectHandle: '@viewer', state: 'allow', setBy: ' ' });
    expect(badState).toBeNull();
    expect(blankSubject).toBeNull();
    expect(blankSetter).toBeNull();
    expect(listLinkedChatPermissions(t.id)).toEqual([]);
  });
});
