import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from './db';
import { upsertTerminal } from './terminalsStore';
import {
  installHookNonce,
  verifyAndRotateHookNonce,
} from './agentStatusHookAuth';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
});

describe('agentStatusHookAuth', () => {
  it('installs a nonce and returns it', () => {
    const term = upsertTerminal({ pid: 1, pid_start: 'start', name: 't1' });
    const nonce = installHookNonce(term.id);
    expect(nonce).toBeTruthy();
    expect(nonce!.length).toBe(64);
  });

  it('returns null for unknown terminal', () => {
    const nonce = installHookNonce('missing');
    expect(nonce).toBeNull();
  });

  it('verifies and rotates the nonce', () => {
    const term = upsertTerminal({ pid: 2, pid_start: 'start', name: 't2' });
    const nonce = installHookNonce(term.id)!;
    const nextNonce = verifyAndRotateHookNonce(term.id, nonce);
    expect(nextNonce).toBeTruthy();
    expect(nextNonce).not.toBe(nonce);
  });

  it('returns null on wrong nonce', () => {
    const term = upsertTerminal({ pid: 3, pid_start: 'start', name: 't3' });
    installHookNonce(term.id);
    const nextNonce = verifyAndRotateHookNonce(term.id, 'wrong-nonce');
    expect(nextNonce).toBeNull();
  });

  it('returns null when no nonce installed', () => {
    const term = upsertTerminal({ pid: 4, pid_start: 'start', name: 't4' });
    const nextNonce = verifyAndRotateHookNonce(term.id, 'anything');
    expect(nextNonce).toBeNull();
  });

  it('returns null for unknown terminal on verify', () => {
    const nextNonce = verifyAndRotateHookNonce('missing', 'nonce');
    expect(nextNonce).toBeNull();
  });

  it('rejects previously-used nonce after rotation', () => {
    const term = upsertTerminal({ pid: 5, pid_start: 'start', name: 't5' });
    const nonce1 = installHookNonce(term.id)!;
    const nonce2 = verifyAndRotateHookNonce(term.id, nonce1)!;
    const retry = verifyAndRotateHookNonce(term.id, nonce1);
    expect(retry).toBeNull();
    expect(verifyAndRotateHookNonce(term.id, nonce2)).toBeTruthy();
  });
});
