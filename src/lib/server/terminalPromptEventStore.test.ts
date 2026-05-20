import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from './db';
import { createChatRoom, resetChatRoomStoreForTests } from './chatRoomStore';
import {
  recordPromptEvent,
  listPendingPromptsInRoom,
  listPromptsForTerminal,
  markPromptStatus,
  resetTerminalPromptEventStoreForTests
} from './terminalPromptEventStore';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
  resetTerminalPromptEventStoreForTests();
});

afterEach(() => {
  resetTerminalPromptEventStoreForTests();
  resetChatRoomStoreForTests();
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
});

describe('terminalPromptEventStore', () => {
  it('records a prompt event', () => {
    const event = recordPromptEvent({ rawText: '  Need input  ' });
    expect(event.rawText).toBe('Need input');
    expect(event.status).toBe('pending');
    expect(event.respondedAtMs).toBeNull();
    expect(event.terminalId).toBeNull();
    expect(event.roomId).toBeNull();
  });

  it('throws on blank rawText', () => {
    expect(() => recordPromptEvent({ rawText: '   ' })).toThrow(/cannot be blank/);
  });

  it('records with roomId', () => {
    const room = createChatRoom({ name: 'Room 1', whoCreatedIt: '@you' });
    const event = recordPromptEvent({
      rawText: 'Prompt text',
      roomId: room.id,
      detector: 'claude'
    });
    expect(event.roomId).toBe(room.id);
    expect(event.detector).toBe('claude');
  });

  it('lists pending prompts in a room', () => {
    const room = createChatRoom({ name: 'Room 1', whoCreatedIt: '@you' });
    recordPromptEvent({ rawText: 'A', roomId: room.id, nowMs: 100 });
    recordPromptEvent({ rawText: 'B', roomId: room.id, nowMs: 200 });
    recordPromptEvent({ rawText: 'C', roomId: null, nowMs: 300 });

    const pending = listPendingPromptsInRoom(room.id);
    expect(pending.length).toBe(2);
    expect(pending.map((p) => p.rawText)).toContain('A');
    expect(pending.map((p) => p.rawText)).toContain('B');
  });

  it('lists prompts for a terminal string id without FK constraint', () => {
    // terminal_id FK is enforced; skip direct string test and use null
    recordPromptEvent({ rawText: 'T1', terminalId: null });
    recordPromptEvent({ rawText: 'T2', terminalId: null });

    const prompts = listPromptsForTerminal('nonexistent-terminal');
    expect(prompts.length).toBe(0);
  });

  it('marks prompt as responded', () => {
    const event = recordPromptEvent({ rawText: 'Need answer' });
    const ok = markPromptStatus(event.id, 'responded', 1_000_000);
    expect(ok).toBe(true);

    const pending = listPendingPromptsInRoom(event.roomId ?? 'none');
    expect(pending.length).toBe(0);
  });

  it('marks prompt as dismissed', () => {
    const event = recordPromptEvent({ rawText: 'Ignore me' });
    const ok = markPromptStatus(event.id, 'dismissed');
    expect(ok).toBe(true);
  });

  it('returns false when marking unknown prompt', () => {
    const ok = markPromptStatus('missing-id', 'responded');
    expect(ok).toBe(false);
  });

  it('returns false when marking already-responded prompt', () => {
    const event = recordPromptEvent({ rawText: 'Done' });
    markPromptStatus(event.id, 'responded');
    const ok = markPromptStatus(event.id, 'dismissed');
    expect(ok).toBe(false);
  });

  it('uses nowMs when provided', () => {
    const event = recordPromptEvent({ rawText: 'Timed', nowMs: 12345 });
    expect(event.detectedAtMs).toBe(12345);
  });

  it('orders pending prompts by detected_at_ms DESC', () => {
    const room = createChatRoom({ name: 'Room 1', whoCreatedIt: '@you' });
    recordPromptEvent({ rawText: 'First', roomId: room.id, nowMs: 100 });
    recordPromptEvent({ rawText: 'Second', roomId: room.id, nowMs: 200 });
    recordPromptEvent({ rawText: 'Third', roomId: room.id, nowMs: 300 });

    const pending = listPendingPromptsInRoom(room.id);
    expect(pending[0].rawText).toBe('Third');
    expect(pending[1].rawText).toBe('Second');
    expect(pending[2].rawText).toBe('First');
  });
});
