import { describe, it, expect } from 'vitest';
import {
  roomScope,
  assertSameRoom,
  assertNotRoomScoped,
  assertCanWrite,
} from '../src/lib/server/room-scope';
import type { RequestEvent } from '@sveltejs/kit';

// Build a minimal RequestEvent stub. The room-scope helpers only read
// event.locals.roomScope, so the rest of the surface can be empty objects.
function makeEvent(locals: Record<string, unknown> = {}): RequestEvent {
  return { locals } as unknown as RequestEvent;
}

function expectThrowsWithStatus(fn: () => void, status: number): void {
  try {
    fn();
    throw new Error('expected throw, none occurred');
  } catch (err: any) {
    // SvelteKit `error()` produces an object with a numeric status.
    expect(err?.status ?? err?.body?.status).toBe(status);
  }
}

describe('roomScope', () => {
  it('returns null when locals has no roomScope', () => {
    expect(roomScope(makeEvent())).toBeNull();
  });

  it('returns null when locals.roomScope is not an object', () => {
    expect(roomScope(makeEvent({ roomScope: 'admin' }))).toBeNull();
  });

  it('returns null when roomId is missing', () => {
    expect(roomScope(makeEvent({ roomScope: { kind: 'cli' } }))).toBeNull();
  });

  it('parses a fully-formed roomScope', () => {
    const scope = roomScope(makeEvent({ roomScope: { roomId: 'r-1', kind: 'cli' } }));
    expect(scope).toEqual({ roomId: 'r-1', kind: 'cli' });
  });

  it('coerces non-string kind to null without throwing', () => {
    const scope = roomScope(makeEvent({ roomScope: { roomId: 'r-1', kind: 42 } }));
    expect(scope).toEqual({ roomId: 'r-1', kind: null });
  });
});

describe('assertSameRoom', () => {
  it('is a no-op for admin (no scope)', () => {
    expect(() => assertSameRoom(makeEvent(), 'r-1')).not.toThrow();
  });

  it('passes when scope matches the URL room', () => {
    const ev = makeEvent({ roomScope: { roomId: 'r-1', kind: 'cli' } });
    expect(() => assertSameRoom(ev, 'r-1')).not.toThrow();
  });

  it('throws 403 when scope is for a different room', () => {
    const ev = makeEvent({ roomScope: { roomId: 'r-1', kind: 'cli' } });
    expectThrowsWithStatus(() => assertSameRoom(ev, 'r-2'), 403);
  });
});

describe('assertNotRoomScoped', () => {
  it('passes for admin (no scope) — admin endpoints are open to master key', () => {
    expect(() => assertNotRoomScoped(makeEvent())).not.toThrow();
  });

  it('throws 403 for any per-room bearer, even one for the right room', () => {
    const ev = makeEvent({ roomScope: { roomId: 'r-1', kind: 'cli' } });
    expectThrowsWithStatus(() => assertNotRoomScoped(ev), 403);
  });

  it('throws 403 for a web-kind bearer too — no escalation via kind', () => {
    const ev = makeEvent({ roomScope: { roomId: 'r-1', kind: 'web' } });
    expectThrowsWithStatus(() => assertNotRoomScoped(ev), 403);
  });
});

describe('assertCanWrite', () => {
  it('passes for admin (no scope)', () => {
    expect(() => assertCanWrite(makeEvent())).not.toThrow();
  });

  it('passes for cli-kind bearer', () => {
    const ev = makeEvent({ roomScope: { roomId: 'r-1', kind: 'cli' } });
    expect(() => assertCanWrite(ev)).not.toThrow();
  });

  it('passes for mcp-kind bearer', () => {
    const ev = makeEvent({ roomScope: { roomId: 'r-1', kind: 'mcp' } });
    expect(() => assertCanWrite(ev)).not.toThrow();
  });

  it('rejects web-kind bearer with 403 — read-only viewer cannot post', () => {
    const ev = makeEvent({ roomScope: { roomId: 'r-1', kind: 'web' } });
    expectThrowsWithStatus(() => assertCanWrite(ev), 403);
  });

  it('rejects unknown future kinds — allowlist, not denylist', () => {
    const ev = makeEvent({ roomScope: { roomId: 'r-1', kind: 'rss' } });
    expectThrowsWithStatus(() => assertCanWrite(ev), 403);
  });

  it('passes for legacy null-kind bearer (compatibility shim)', () => {
    const ev = makeEvent({ roomScope: { roomId: 'r-1', kind: null } });
    expect(() => assertCanWrite(ev)).not.toThrow();
  });
});
