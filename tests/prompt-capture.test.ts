import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import getDb, { queries } from '../src/lib/server/db.js';

const TEST_TERMINAL = 'prompt-capture-test-terminal';
const broadcasts: Array<{ sessionId: string; message: any }> = [];

vi.mock('../src/lib/server/ws-broadcast.js', () => ({
  broadcast: (sessionId: string, message: any) => {
    broadcasts.push({ sessionId, message });
  },
}));

const {
  capturePromptInput,
  normalisePromptInput,
} = await import('../src/lib/server/prompt-capture.js');

function resetSession() {
  const db = getDb();
  db.prepare('DELETE FROM run_events WHERE session_id = ?').run(TEST_TERMINAL);
  db.prepare('DELETE FROM sessions WHERE id = ?').run(TEST_TERMINAL);
  queries.createSession(TEST_TERMINAL, 'Prompt Capture Test Terminal', 'terminal', 'forever', null, '/tmp/ant-prompt-test', '{}');
  broadcasts.length = 0;
}

describe('prompt capture', () => {
  beforeEach(resetSession);

  afterAll(() => {
    const db = getDb();
    db.prepare('DELETE FROM run_events WHERE session_id = ?').run(TEST_TERMINAL);
    db.prepare('DELETE FROM sessions WHERE id = ?').run(TEST_TERMINAL);
  });

  it('normalises high-level prompt chunks but ignores raw control and single-key input', () => {
    expect(normalisePromptInput('\r')).toBeNull();
    expect(normalisePromptInput('\x1b[A')).toBeNull();
    expect(normalisePromptInput('y')).toBeNull();
    expect(normalisePromptInput('Please continue with the plan\r')).toBe('Please continue with the plan');
  });

  it('records injected prompts as first-class run_events and broadcasts them', () => {
    const event = capturePromptInput(
      TEST_TERMINAL,
      'Please continue with the plan',
      {
        captureSource: 'terminal_input',
        transport: 'websocket',
        tsMs: 1_777_777_000_000,
      },
    );

    expect(event).toMatchObject({
      session_id: TEST_TERMINAL,
      source: 'terminal',
      trust: 'medium',
      kind: 'prompt',
      text: 'Please continue with the plan',
      payload: {
        prompt: 'Please continue with the plan',
        capture_source: 'terminal_input',
        transport: 'websocket',
      },
    });
    expect(broadcasts[0]).toMatchObject({
      sessionId: TEST_TERMINAL,
      message: {
        type: 'run_event_created',
        sessionId: TEST_TERMINAL,
        event: { kind: 'prompt' },
      },
    });

    const row = getDb()
      .prepare('SELECT kind, text, payload FROM run_events WHERE session_id = ?')
      .get(TEST_TERMINAL) as any;
    expect(row.kind).toBe('prompt');
    expect(row.text).toBe('Please continue with the plan');
    expect(JSON.parse(row.payload)).toMatchObject({
      capture_source: 'terminal_input',
      transport: 'websocket',
    });
  });

  it('dedupes repeated prompt chunks inside the short terminal submit window', () => {
    const first = capturePromptInput(TEST_TERMINAL, 'Run the tests', {
      captureSource: 'api_terminal_input',
      transport: 'rest',
      tsMs: 1_777_777_000_000,
    });
    const second = capturePromptInput(TEST_TERMINAL, 'Run the tests', {
      captureSource: 'api_terminal_input',
      transport: 'rest',
      tsMs: 1_777_777_000_500,
    });

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    const count = getDb()
      .prepare('SELECT COUNT(*) AS count FROM run_events WHERE session_id = ? AND kind = ?')
      .get(TEST_TERMINAL, 'prompt') as { count: number };
    expect(count.count).toBe(1);
  });

  it('preserves chat injection provenance in the prompt payload', () => {
    const event = capturePromptInput(TEST_TERMINAL, '[antchat message for you] build the deck', {
      captureSource: 'chat_injection',
      transport: 'pty-injection',
      messageId: 'msg-123',
      roomId: 'room-abc',
      target: '@codex',
      tsMs: 1_777_777_010_000,
    });

    expect(event).toMatchObject({
      kind: 'prompt',
      payload: {
        capture_source: 'chat_injection',
        transport: 'pty-injection',
        message_id: 'msg-123',
        room_id: 'room-abc',
        target: '@codex',
      },
    });
  });
});
