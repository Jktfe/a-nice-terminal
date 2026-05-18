import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  registerStream,
  deregisterStream,
  closeByTokenId,
  closeByInviteId,
  _streamCount,
} from '../src/lib/server/mcp-streams.js';

describe('mcp-streams', () => {
  beforeEach(() => {
    const g = globalThis as any;
    if (g.__antMcpStreams) g.__antMcpStreams.clear();
  });

  it('registerStream adds a stream', () => {
    const key = Symbol('k1');
    const close = vi.fn();
    registerStream(key, { tokenId: 't1', inviteId: 'i1', roomId: 'r1', close });
    expect(_streamCount()).toBe(1);
  });

  it('deregisterStream removes a stream by key', () => {
    const key = Symbol('k2');
    const close = vi.fn();
    registerStream(key, { tokenId: 't2', inviteId: 'i2', roomId: 'r2', close });
    expect(_streamCount()).toBe(1);
    deregisterStream(key);
    expect(_streamCount()).toBe(0);
  });

  it('deregisterStream is a no-op for unknown key', () => {
    deregisterStream(Symbol('missing'));
    expect(_streamCount()).toBe(0);
  });

  it('closeByTokenId closes and removes matching streams', () => {
    const keyA = Symbol('a');
    const keyB = Symbol('b');
    const closeA = vi.fn();
    const closeB = vi.fn();
    registerStream(keyA, { tokenId: 'tx', inviteId: 'iA', roomId: 'rA', close: closeA });
    registerStream(keyB, { tokenId: 'tx', inviteId: 'iB', roomId: 'rB', close: closeB });
    expect(_streamCount()).toBe(2);

    const n = closeByTokenId('tx');
    expect(n).toBe(2);
    expect(closeA).toHaveBeenCalledTimes(1);
    expect(closeA).toHaveBeenCalledWith('revoked');
    expect(closeB).toHaveBeenCalledTimes(1);
    expect(closeB).toHaveBeenCalledWith('revoked');
    expect(_streamCount()).toBe(0);
  });

  it('closeByTokenId skips non-matching streams', () => {
    const keyA = Symbol('a');
    const keyB = Symbol('b');
    const closeA = vi.fn();
    const closeB = vi.fn();
    registerStream(keyA, { tokenId: 'tx', inviteId: 'iA', roomId: 'rA', close: closeA });
    registerStream(keyB, { tokenId: 'ty', inviteId: 'iB', roomId: 'rB', close: closeB });

    const n = closeByTokenId('ty');
    expect(n).toBe(1);
    expect(closeA).not.toHaveBeenCalled();
    expect(closeB).toHaveBeenCalledOnce();
    expect(_streamCount()).toBe(1);
  });

  it('closeByInviteId closes and removes matching streams', () => {
    const keyA = Symbol('a');
    const keyB = Symbol('b');
    const closeA = vi.fn();
    const closeB = vi.fn();
    registerStream(keyA, { tokenId: 'tA', inviteId: 'ix', roomId: 'rA', close: closeA });
    registerStream(keyB, { tokenId: 'tB', inviteId: 'ix', roomId: 'rB', close: closeB });

    const n = closeByInviteId('ix');
    expect(n).toBe(2);
    expect(closeA).toHaveBeenCalledTimes(1);
    expect(closeB).toHaveBeenCalledTimes(1);
    expect(_streamCount()).toBe(0);
  });

  it('closeByInviteId skips non-matching streams', () => {
    const keyA = Symbol('a');
    const keyB = Symbol('b');
    const closeA = vi.fn();
    const closeB = vi.fn();
    registerStream(keyA, { tokenId: 'tA', inviteId: 'ix', roomId: 'rA', close: closeA });
    registerStream(keyB, { tokenId: 'tB', inviteId: 'iy', roomId: 'rB', close: closeB });

    const n = closeByInviteId('iy');
    expect(n).toBe(1);
    expect(closeA).not.toHaveBeenCalled();
    expect(closeB).toHaveBeenCalledOnce();
    expect(_streamCount()).toBe(1);
  });

  it('survives a throwy close callback', () => {
    const keyA = Symbol('a');
    const keyB = Symbol('b');
    const closeA = vi.fn(() => { throw new Error('boom'); });
    const closeB = vi.fn();
    registerStream(keyA, { tokenId: 'tx', inviteId: 'iA', roomId: 'rA', close: closeA });
    registerStream(keyB, { tokenId: 'tx', inviteId: 'iB', roomId: 'rB', close: closeB });

    const n = closeByTokenId('tx');
    expect(n).toBe(2);
    expect(closeA).toHaveBeenCalledTimes(1);
    expect(closeB).toHaveBeenCalledTimes(1);
    expect(_streamCount()).toBe(0);
  });

  it('_streamCount returns 0 when empty', () => {
    expect(_streamCount()).toBe(0);
  });
});
