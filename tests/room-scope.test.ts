import { describe, it, expect } from 'vitest';
import { roomScope, assertSameRoom, assertNotRoomScoped, assertCanWrite } from '../src/lib/server/room-scope.js';

function makeEvent(locals?: Record<string, unknown>) {
  return { locals } as any;
}

function expectThrows403(fn: () => void) {
  try {
    fn();
    throw new Error('Expected function to throw, but it did not');
  } catch (err: any) {
    expect(err.status).toBe(403);
  }
}

describe('roomScope', () => {
  it('returns null when locals is absent', () => {
    expect(roomScope(makeEvent())).toBeNull();
  });

  it('returns null when roomScope is missing', () => {
    expect(roomScope(makeEvent({}))).toBeNull();
  });

  it('returns null when roomScope is not an object', () => {
    expect(roomScope(makeEvent({ roomScope: 'bad' }))).toBeNull();
  });

  it('extracts roomId and kind', () => {
    expect(roomScope(makeEvent({ roomScope: { roomId: 'r1', kind: 'cli' } })))
      .toEqual({ roomId: 'r1', kind: 'cli' });
  });

  it('treats missing kind as null', () => {
    expect(roomScope(makeEvent({ roomScope: { roomId: 'r1' } })))
      .toEqual({ roomId: 'r1', kind: null });
  });

  it('treats non-string kind as null', () => {
    expect(roomScope(makeEvent({ roomScope: { roomId: 'r1', kind: 123 } })))
      .toEqual({ roomId: 'r1', kind: null });
  });

  it('returns null when roomId is not a string', () => {
    expect(roomScope(makeEvent({ roomScope: { roomId: 123 } }))).toBeNull();
  });
});

describe('assertSameRoom', () => {
  it('passes when no scope (master key)', () => {
    expect(() => assertSameRoom(makeEvent(), 'r1')).not.toThrow();
  });

  it('passes when scope matches expected room', () => {
    expect(() => assertSameRoom(makeEvent({ roomScope: { roomId: 'r1' } }), 'r1')).not.toThrow();
  });

  it('throws 403 when scope mismatches', () => {
    expectThrows403(() => assertSameRoom(makeEvent({ roomScope: { roomId: 'r1' } }), 'r2'));
  });
});

describe('assertNotRoomScoped', () => {
  it('passes when no scope (master key)', () => {
    expect(() => assertNotRoomScoped(makeEvent())).not.toThrow();
  });

  it('throws 403 when scope exists', () => {
    expectThrows403(() => assertNotRoomScoped(makeEvent({ roomScope: { roomId: 'r1' } })));
  });
});

describe('assertCanWrite', () => {
  it('passes when no scope (master key)', () => {
    expect(() => assertCanWrite(makeEvent())).not.toThrow();
  });

  it('passes when kind is cli', () => {
    expect(() => assertCanWrite(makeEvent({ roomScope: { roomId: 'r1', kind: 'cli' } }))).not.toThrow();
  });

  it('passes when kind is mcp', () => {
    expect(() => assertCanWrite(makeEvent({ roomScope: { roomId: 'r1', kind: 'mcp' } }))).not.toThrow();
  });

  it('passes when kind is null (legacy)', () => {
    expect(() => assertCanWrite(makeEvent({ roomScope: { roomId: 'r1', kind: null } }))).not.toThrow();
  });

  it('throws 403 when kind is web', () => {
    expectThrows403(() => assertCanWrite(makeEvent({ roomScope: { roomId: 'r1', kind: 'web' } })));
  });

  it('throws 403 when kind is unknown', () => {
    expectThrows403(() => assertCanWrite(makeEvent({ roomScope: { roomId: 'r1', kind: 'other' } })));
  });
});
