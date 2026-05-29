/**
 * Tests for the lifecycle Phase A1 store helpers (JWPK A Team
 * msg_w7sfmc4hpp + msg_7uvr35x0xr 2026-05-29):
 *
 *   terminalsStore:
 *     - setTerminalStatus (live → archived → deleted, idempotent)
 *     - setTerminalLastPath (set / clear-on-null / clear-on-whitespace)
 *     - getLiveTerminalsByHandle (handle-binding conflict check)
 *     - getLiveTerminalByName (name conflict check)
 *
 *   terminalRecordsStore:
 *     - appendHandleAlias (NULL → array, append, dedupe)
 *     - getHandleAliases (NULL → empty array)
 *
 * Phase A2/A3/B/C are follow-up PRs — this slice is data-layer only.
 */
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getLiveTerminalByName,
  getLiveTerminalsByHandle,
  getTerminalById,
  setTerminalLastPath,
  setTerminalStatus,
  upsertTerminal
} from './terminalsStore';
import {
  appendHandleAlias,
  createTerminalRecord,
  getHandleAliases
} from './terminalRecordsStore';
import { addMembership } from './roomMembershipsStore';
import { resetIdentityDbForTests } from './db';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;
const previousMemoryVaultPath = process.env.ANT_MEMORY_VAULT_PATH;

beforeEach(() => {
  // Use a fresh temp DB per test (same pattern as roomMembershipsStore.test)
  // so addMembership's preamble side-effects don't pollute a shared DB.
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-lifecycle-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_MEMORY_VAULT_PATH = '/tmp/ant-memory-pack-test';
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
  if (previousMemoryVaultPath === undefined) delete process.env.ANT_MEMORY_VAULT_PATH;
  else process.env.ANT_MEMORY_VAULT_PATH = previousMemoryVaultPath;
});

describe('setTerminalStatus', () => {
  it('defaults to "live" on a fresh upsert', () => {
    const t = upsertTerminal({
      pid: 700_001,
      pid_start: 'lifecycle-status-default',
      name: 'lifecycle-status-default'
    });
    const row = getTerminalById(t.id);
    expect(row?.status).toBe('live');
  });

  it('flip live → archived persists', () => {
    const t = upsertTerminal({
      pid: 700_002,
      pid_start: 'lifecycle-status-archive',
      name: 'lifecycle-status-archive'
    });
    expect(setTerminalStatus(t.id, 'archived')).toBe(true);
    expect(getTerminalById(t.id)?.status).toBe('archived');
  });

  it('flip live → deleted persists', () => {
    const t = upsertTerminal({
      pid: 700_003,
      pid_start: 'lifecycle-status-deleted',
      name: 'lifecycle-status-deleted'
    });
    expect(setTerminalStatus(t.id, 'deleted')).toBe(true);
    expect(getTerminalById(t.id)?.status).toBe('deleted');
  });

  it('is idempotent — flipping to the current status still returns true', () => {
    // The agentStatusPoller (Phase A3) fires on every tick; this contract
    // means it can blindly call setTerminalStatus(id, 'archived') without
    // tracking prior state. Returns true for existing row, false for
    // unknown id.
    const t = upsertTerminal({
      pid: 700_004,
      pid_start: 'lifecycle-status-idempotent',
      name: 'lifecycle-status-idempotent'
    });
    setTerminalStatus(t.id, 'archived');
    expect(setTerminalStatus(t.id, 'archived')).toBe(true);
    expect(getTerminalById(t.id)?.status).toBe('archived');
  });

  it('returns false for an unknown terminalId', () => {
    expect(setTerminalStatus('does-not-exist', 'archived')).toBe(false);
  });
});

describe('setTerminalLastPath', () => {
  it('persists a non-empty path', () => {
    const t = upsertTerminal({
      pid: 700_010,
      pid_start: 'lifecycle-path-set',
      name: 'lifecycle-path-set'
    });
    expect(setTerminalLastPath(t.id, '/Users/you/CascadeProjects/a-nice-terminal')).toBe(true);
    expect(getTerminalById(t.id)?.last_path).toBe('/Users/you/CascadeProjects/a-nice-terminal');
  });

  it('clears the field when passed null', () => {
    const t = upsertTerminal({
      pid: 700_011,
      pid_start: 'lifecycle-path-clear-null',
      name: 'lifecycle-path-clear-null'
    });
    setTerminalLastPath(t.id, '/tmp/something');
    expect(setTerminalLastPath(t.id, null)).toBe(true);
    expect(getTerminalById(t.id)?.last_path ?? null).toBeNull();
  });

  it('clears the field when passed an empty / whitespace-only string', () => {
    const t = upsertTerminal({
      pid: 700_012,
      pid_start: 'lifecycle-path-clear-empty',
      name: 'lifecycle-path-clear-empty'
    });
    setTerminalLastPath(t.id, '/tmp/something');
    expect(setTerminalLastPath(t.id, '   ')).toBe(true);
    expect(getTerminalById(t.id)?.last_path ?? null).toBeNull();
  });

  it('returns false for an unknown terminalId', () => {
    expect(setTerminalLastPath('does-not-exist', '/tmp/x')).toBe(false);
  });
});

describe('getLiveTerminalsByHandle', () => {
  it('returns an empty array for an unknown handle', () => {
    expect(getLiveTerminalsByHandle('@nobody-home')).toEqual([]);
  });

  it('finds the live terminal when one is bound via room_memberships', () => {
    const t = upsertTerminal({
      pid: 700_020,
      pid_start: 'lifecycle-handle-find',
      name: 'lifecycle-handle-find'
    });
    addMembership({ room_id: 'room-handle-find', handle: '@findme', terminal_id: t.id });
    const found = getLiveTerminalsByHandle('@findme');
    expect(found).toHaveLength(1);
    expect(found[0].id).toBe(t.id);
  });

  it('normalises a leading-@ omitted handle (foo == @foo)', () => {
    const t = upsertTerminal({
      pid: 700_021,
      pid_start: 'lifecycle-handle-norm',
      name: 'lifecycle-handle-norm'
    });
    addMembership({ room_id: 'room-handle-norm', handle: '@normalised', terminal_id: t.id });
    expect(getLiveTerminalsByHandle('normalised')).toHaveLength(1);
  });

  it('excludes terminals with status != "live"', () => {
    const t = upsertTerminal({
      pid: 700_022,
      pid_start: 'lifecycle-handle-archived',
      name: 'lifecycle-handle-archived'
    });
    addMembership({ room_id: 'room-handle-archived', handle: '@archived-handle', terminal_id: t.id });
    setTerminalStatus(t.id, 'archived');
    expect(getLiveTerminalsByHandle('@archived-handle')).toEqual([]);
  });

  it('excludes terminals with status = "deleted"', () => {
    const t = upsertTerminal({
      pid: 700_023,
      pid_start: 'lifecycle-handle-deleted',
      name: 'lifecycle-handle-deleted'
    });
    addMembership({ room_id: 'room-handle-deleted', handle: '@deleted-handle', terminal_id: t.id });
    setTerminalStatus(t.id, 'deleted');
    expect(getLiveTerminalsByHandle('@deleted-handle')).toEqual([]);
  });

  it('excludes orphan terminals (no room_memberships row)', () => {
    // Orphan: terminal exists + status=live, but never bound to any room.
    // Phase A2's register rule (b) only cares about handles that are
    // ACTIVELY bound somewhere — a terminal with no memberships can't
    // be conflicting with a re-register.
    upsertTerminal({
      pid: 700_024,
      pid_start: 'lifecycle-handle-orphan',
      name: 'lifecycle-handle-orphan'
    });
    expect(getLiveTerminalsByHandle('@orphan')).toEqual([]);
  });
});

describe('getLiveTerminalByName', () => {
  it('returns null for an unknown name', () => {
    expect(getLiveTerminalByName('does-not-exist')).toBeNull();
  });

  it('returns the row when a live terminal exists', () => {
    const t = upsertTerminal({
      pid: 700_030,
      pid_start: 'lifecycle-name-live',
      name: 'lifecycle-name-live'
    });
    const found = getLiveTerminalByName('lifecycle-name-live');
    expect(found?.id).toBe(t.id);
  });

  it('excludes archived terminals with the same name', () => {
    // Phase A2's register rule (a): a name freed by archive should be
    // re-usable for a new live session. So getLiveTerminalByName must
    // NOT report an archived row as a conflict.
    const t = upsertTerminal({
      pid: 700_031,
      pid_start: 'lifecycle-name-recyclable',
      name: 'lifecycle-name-recyclable'
    });
    setTerminalStatus(t.id, 'archived');
    expect(getLiveTerminalByName('lifecycle-name-recyclable')).toBeNull();
  });
});

describe('appendHandleAlias + getHandleAliases', () => {
  it('NULL handle_aliases becomes a single-element array on first append', () => {
    createTerminalRecord({ sessionId: 't_alias_first', name: 'alias-first' });
    expect(getHandleAliases('t_alias_first')).toEqual([]);
    expect(appendHandleAlias('t_alias_first', '@old')).toBe(true);
    expect(getHandleAliases('t_alias_first')).toEqual(['@old']);
  });

  it('appends a second distinct alias', () => {
    createTerminalRecord({ sessionId: 't_alias_two', name: 'alias-two' });
    appendHandleAlias('t_alias_two', '@first');
    appendHandleAlias('t_alias_two', '@second');
    expect(getHandleAliases('t_alias_two')).toEqual(['@first', '@second']);
  });

  it('skips duplicate aliases (idempotent)', () => {
    createTerminalRecord({ sessionId: 't_alias_dupe', name: 'alias-dupe' });
    appendHandleAlias('t_alias_dupe', '@dupe');
    expect(appendHandleAlias('t_alias_dupe', '@dupe')).toBe(true);
    expect(getHandleAliases('t_alias_dupe')).toEqual(['@dupe']);
  });

  it('normalises a leading-@ omitted alias', () => {
    createTerminalRecord({ sessionId: 't_alias_norm', name: 'alias-norm' });
    appendHandleAlias('t_alias_norm', 'unprefixed');
    expect(getHandleAliases('t_alias_norm')).toEqual(['@unprefixed']);
  });

  it('returns false on an unknown sessionId', () => {
    expect(appendHandleAlias('does-not-exist', '@x')).toBe(false);
  });

  it('returns [] from getHandleAliases when sessionId is unknown', () => {
    expect(getHandleAliases('does-not-exist')).toEqual([]);
  });

  it('refuses an empty / whitespace-only alias', () => {
    createTerminalRecord({ sessionId: 't_alias_empty', name: 'alias-empty' });
    expect(appendHandleAlias('t_alias_empty', '   ')).toBe(false);
    expect(getHandleAliases('t_alias_empty')).toEqual([]);
  });
});
