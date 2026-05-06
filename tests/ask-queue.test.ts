import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import getDb, { queries } from '../src/lib/server/db.js';
import { inferAskFromMessage } from '../src/lib/server/ask-inference.js';
import { GET as listAsks, POST as createAsk } from '../src/routes/api/asks/+server.js';
import { PATCH as patchAsk } from '../src/routes/api/asks/[id]/+server.js';

const SESSION_ID = 'test-ask-queue-room';

function cleanup() {
  const db = getDb();
  db.prepare('DELETE FROM asks WHERE session_id = ?').run(SESSION_ID);
  db.prepare('DELETE FROM messages WHERE session_id = ?').run(SESSION_ID);
  db.prepare('DELETE FROM sessions WHERE id = ?').run(SESSION_ID);
}

function jsonRequest(body: unknown): Request {
  return new Request('https://ant.example.test/api/asks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('ask queue inference', () => {
  it('infers terminal-owned action questions as candidates pending human review', () => {
    const draft = inferAskFromMessage({
      sessionId: 'room',
      messageId: 'msg',
      content: 'Want me to click yes in the raw terminal and continue?',
      senderId: '@agent',
      msgType: 'message',
    });

    expect(draft).toMatchObject({
      status: 'candidate',
      assignedTo: 'terminal',
      ownerKind: 'terminal',
      priority: 'normal',
    });
    expect(draft?.confidence).toBeGreaterThanOrEqual(0.48);
  });
});

describe('/api/asks', () => {
  beforeEach(() => {
    cleanup();
    queries.createSession(SESSION_ID, 'Ask Queue Test Room', 'chat', '15m', null, null, '{}');
  });

  afterEach(cleanup);

  it('creates, lists, and resolves durable asks', async () => {
    const createResponse = await createAsk({
      request: jsonRequest({
        session_id: SESSION_ID,
        title: 'Should the terminal continue?',
        owner_kind: 'terminal',
        assigned_to: 'terminal',
        priority: 'high',
        created_by: '@codex',
      }),
      locals: {},
    } as Parameters<typeof createAsk>[0]);
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json();
    expect(created.ask).toMatchObject({
      session_id: SESSION_ID,
      title: 'Should the terminal continue?',
      owner_kind: 'terminal',
      assigned_to: 'terminal',
      status: 'open',
      priority: 'high',
    });

    const listResponse = listAsks({
      url: new URL(`https://ant.example.test/api/asks?session_id=${SESSION_ID}&status=all`),
      locals: {},
    } as Parameters<typeof listAsks>[0]);
    const listed = await listResponse.json();
    expect(listed.asks.map((ask: any) => ask.id)).toContain(created.ask.id);

    const patchResponse = await patchAsk({
      params: { id: created.ask.id },
      request: jsonRequest({ action: 'approve', answer: 'Continue via ANT terminal input.' }),
      locals: {},
    } as Parameters<typeof patchAsk>[0]);
    const patched = await patchResponse.json();
    expect(patched.ask).toMatchObject({
      status: 'answered',
      answer_action: 'approve',
      answer: 'Continue via ANT terminal input.',
    });
  });

  it('keeps status-update noise out of the actionable ask view', async () => {
    queries.createAsk(
      'A-noise',
      SESSION_ID,
      null,
      'Open Slide/Kanwas integration slice is delivered.',
      'Open Slide/Kanwas integration slice is delivered. Tests pass and live smoke is complete.',
      null,
      'open',
      'room',
      'room',
      'normal',
      '@codex',
      1,
      0.68,
      JSON.stringify({ source: 'inferred_from_message' }),
    );
    queries.createAsk(
      'A-action',
      SESSION_ID,
      null,
      'Want me to bring the synthesis doc forward to draft 4?',
      'Synthesis doc is now behind the deck. Want me to bring it forward to draft 4?',
      null,
      'open',
      'human',
      'human',
      'normal',
      '@codex',
      1,
      0.72,
      JSON.stringify({ source: 'inferred_from_message' }),
    );

    const listResponse = listAsks({
      url: new URL(`https://ant.example.test/api/asks?session_id=${SESSION_ID}&status=open&view=actionable`),
      locals: {},
    } as Parameters<typeof listAsks>[0]);
    const listed = await listResponse.json();
    expect(listed.asks.map((ask: any) => ask.id)).toEqual(['A-action']);
  });
});
