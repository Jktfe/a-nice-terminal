/**
 * permissionCallerIdentity tests — Sec-iter2 Fix #3 (2026-05-30
 * enterprise security pass). Validates the typed
 * AuthoritativeCallerIdentity contract: admin-bearer requests return
 * `{ handle: ADMIN_BEARER_HANDLE, isAdminBearer: true }`; pidChain-
 * resolved callers return `{ handle: <terminal_records.handle>,
 * isAdminBearer: false }`; fail-closed behaviours preserved.
 *
 * The structural point of the typed result is to remove the
 * string-equality between caller.handle and ADMIN_BEARER_HANDLE that
 * the rest of the codebase used to short-circuit admin authority —
 * those consumers now read `isAdminBearer` instead. This file pins
 * the shape so a future refactor cannot silently drop the
 * discriminator.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolveAuthoritativeCallerIdentity,
  resolveAuthoritativeCallerIdentityFromPidChain,
  resolveAuthoritativeCallerHandle,
  resolveAuthoritativeCallerHandleFromPidChain
} from './permissionCallerIdentity';
import { ADMIN_BEARER_HANDLE } from './chatRoomAuthGate';
import { getIdentityDb, resetIdentityDbForTests } from './db';
import { upsertTerminal } from './terminalsStore';
import { createTerminalRecord } from './terminalRecordsStore';

const TEST_ADMIN = 'admin-token-for-pci-tests';
const previousAdminToken = process.env.ANT_ADMIN_TOKEN;
const previousDbEnv = process.env.ANT_FRESH_DB_PATH;
let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-pci-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_ADMIN_TOKEN = TEST_ADMIN;
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousAdminToken === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = previousAdminToken;
  if (previousDbEnv === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousDbEnv;
});

function requestWithBearer(token: string): Request {
  return new Request('http://localhost/', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` }
  });
}

function requestNoAuth(): Request {
  return new Request('http://localhost/', { method: 'POST' });
}

describe('resolveAuthoritativeCallerIdentity (body variant)', () => {
  it('returns { handle: ADMIN_BEARER_HANDLE, isAdminBearer: true } for valid admin-bearer', () => {
    const result = resolveAuthoritativeCallerIdentity(requestWithBearer(TEST_ADMIN), {});
    expect(result.handle).toBe(ADMIN_BEARER_HANDLE);
    expect(result.isAdminBearer).toBe(true);
  });

  it('returns isAdminBearer=false for a pidChain-resolved caller (even if their handle happens to equal "@admin")', () => {
    // Sec-iter2 Fix #3 core invariant: a caller whose terminal_records.handle
    // is the literal '@admin' (planted via raw SQL since the public API
    // rejects it via Fix #1) must STILL have isAdminBearer=false. The
    // structural fix is that admin authority depends SOLELY on a proven
    // admin-bearer token, not on what string happens to be in the handle
    // column.
    const terminal = upsertTerminal({
      pid: 91000,
      pid_start: '2026-05-30T02:00:00.000Z',
      name: 'spoofer'
    });
    const now = Date.now();
    getIdentityDb().prepare(
      `INSERT INTO terminal_records (session_id, name, auto_forward_chat, tmux_target_pane, handle, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(terminal.id, 'spoofer', 1, `${terminal.id}:0.0`, ADMIN_BEARER_HANDLE, now, now);

    const result = resolveAuthoritativeCallerIdentity(requestNoAuth(), {
      pidChain: [{ pid: 91000, pid_start: '2026-05-30T02:00:00.000Z' }]
    });
    // handle field carries the spoofed string for display/audit, but
    // isAdminBearer is FALSE so consumers reading the discriminator
    // don't grant admin authority.
    expect(result.handle).toBe(ADMIN_BEARER_HANDLE);
    expect(result.isAdminBearer).toBe(false);
  });

  it('returns isAdminBearer=false for a legitimate non-admin caller', () => {
    upsertTerminal({
      pid: 92000,
      pid_start: '2026-05-30T02:00:01.000Z',
      name: 'legit'
    });
    createTerminalRecord({
      sessionId: 'will-be-replaced', // upsert returns its own id below
      name: 'legit-record',
      handle: '@legit'
    });
    // Re-create record on the upsertTerminal id for the pidChain to match.
    const terminal = upsertTerminal({
      pid: 92000,
      pid_start: '2026-05-30T02:00:01.000Z',
      name: 'legit'
    });
    createTerminalRecord({
      sessionId: terminal.id,
      name: 'legit-on-id',
      handle: '@legit-user'
    });
    const result = resolveAuthoritativeCallerIdentity(requestNoAuth(), {
      pidChain: [{ pid: 92000, pid_start: '2026-05-30T02:00:01.000Z' }]
    });
    expect(result.handle).toBe('@legit-user');
    expect(result.isAdminBearer).toBe(false);
  });

  it('admin-bearer takes precedence over pidChain (the bearer is the authority signal)', () => {
    const terminal = upsertTerminal({
      pid: 93000,
      pid_start: '2026-05-30T02:00:02.000Z',
      name: 'mixed'
    });
    createTerminalRecord({
      sessionId: terminal.id,
      name: 'mixed-record',
      handle: '@whoever'
    });
    const req = new Request('http://localhost/', {
      method: 'POST',
      headers: { authorization: `Bearer ${TEST_ADMIN}` }
    });
    const result = resolveAuthoritativeCallerIdentity(req, {
      pidChain: [{ pid: 93000, pid_start: '2026-05-30T02:00:02.000Z' }]
    });
    expect(result.handle).toBe(ADMIN_BEARER_HANDLE);
    expect(result.isAdminBearer).toBe(true);
  });
});

describe('resolveAuthoritativeCallerIdentityFromPidChain (GET variant)', () => {
  it('returns null when pidChain is empty and no admin-bearer', () => {
    const result = resolveAuthoritativeCallerIdentityFromPidChain(requestNoAuth(), []);
    expect(result).toBeNull();
  });

  it('returns admin identity (typed) for admin-bearer even when pidChain is empty', () => {
    const result = resolveAuthoritativeCallerIdentityFromPidChain(
      requestWithBearer(TEST_ADMIN),
      []
    );
    expect(result).not.toBeNull();
    expect(result!.handle).toBe(ADMIN_BEARER_HANDLE);
    expect(result!.isAdminBearer).toBe(true);
  });

  it('resolves pidChain to terminal_records.handle with isAdminBearer=false', () => {
    const terminal = upsertTerminal({
      pid: 94000,
      pid_start: '2026-05-30T02:00:03.000Z',
      name: 'get-caller'
    });
    createTerminalRecord({
      sessionId: terminal.id,
      name: 'get-record',
      handle: '@get-user'
    });
    const result = resolveAuthoritativeCallerIdentityFromPidChain(requestNoAuth(), [
      { pid: 94000, pid_start: '2026-05-30T02:00:03.000Z' }
    ]);
    expect(result).not.toBeNull();
    expect(result!.handle).toBe('@get-user');
    expect(result!.isAdminBearer).toBe(false);
  });
});

describe('back-compat: legacy bare-string variants still work', () => {
  it('resolveAuthoritativeCallerHandle returns the bare admin handle for admin-bearer', () => {
    const handle = resolveAuthoritativeCallerHandle(requestWithBearer(TEST_ADMIN), {});
    expect(handle).toBe(ADMIN_BEARER_HANDLE);
  });

  it('resolveAuthoritativeCallerHandleFromPidChain returns null when no auth + no chain', () => {
    expect(resolveAuthoritativeCallerHandleFromPidChain(requestNoAuth(), [])).toBeNull();
  });
});
