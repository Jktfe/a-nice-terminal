import { describe, expect, it } from 'vitest';
import { handleResponse, init } from '../src/lib/server/agent-event-bus.js';

function confirmationEvent() {
  return JSON.stringify({
    seq: 0,
    ts: Date.now(),
    source: 'tmux',
    type: 'output',
    raw: 'Shall I proceed?',
    text: 'Shall I proceed?',
    class: 'confirmation',
    payload: { question: 'Shall I proceed?' },
  });
}

describe('agent event responses', () => {
  it('lazy-loads the driver and sends keys when a response arrives after restart', async () => {
    const writes: string[] = [];
    const metaUpdates: Array<{ msgId: string; meta: string }> = [];
    const broadcasts: any[] = [];

    init({
      getSession: (id: string) => ({
        id,
        meta: JSON.stringify({ agent_driver: 'claude-code' }),
        linked_chat_id: 'linked-chat',
      }),
      postToChat: () => {},
      writeToTerminal: (_sessionId: string, data: string) => { writes.push(data); },
      updateMessageMeta: (msgId: string, meta: string) => { metaUpdates.push({ msgId, meta }); },
      broadcastToChat: (_chatId: string, msg: any) => { broadcasts.push(msg); },
    });

    await handleResponse(
      'terminal-after-restart',
      confirmationEvent(),
      { type: 'confirm', yes: true },
      'event-message-id',
    );

    expect(writes).toEqual(['yes', '\r']);
    expect(metaUpdates).toEqual([{
      msgId: 'event-message-id',
      meta: JSON.stringify({ status: 'responded', chosen: 'confirm' }),
    }]);
    expect(broadcasts[0]).toMatchObject({
      type: 'message_updated',
      sessionId: 'linked-chat',
      msgId: 'event-message-id',
      meta: { status: 'responded', chosen: 'confirm' },
    });
  });

  it('throws when no driver is configured instead of reporting false success', async () => {
    init({
      getSession: (id: string) => ({ id, meta: '{}', linked_chat_id: 'linked-chat' }),
      postToChat: () => {},
      writeToTerminal: () => {},
      updateMessageMeta: () => {},
      broadcastToChat: () => {},
    });

    await expect(handleResponse(
      'terminal-without-driver',
      confirmationEvent(),
      { type: 'confirm', yes: true },
    )).rejects.toThrow('No agent driver configured');
  });

  it('stores delegated decision provenance and an audit run event', async () => {
    const writes: string[] = [];
    const metaUpdates: Array<{ msgId: string; meta: string }> = [];
    const broadcasts: any[] = [];
    const runEvents: any[] = [];

    init({
      getSession: (id: string) => ({
        id,
        meta: JSON.stringify({ agent_driver: 'claude-code' }),
        linked_chat_id: 'linked-chat',
      }),
      postToChat: () => {},
      writeToTerminal: (_sessionId: string, data: string) => { writes.push(data); },
      updateMessageMeta: (msgId: string, meta: string) => { metaUpdates.push({ msgId, meta }); },
      broadcastToChat: (_chatId: string, msg: any) => { broadcasts.push(msg); },
      appendRunEvent: (sessionId, source, trust, kind, text, payload, rawRef) => {
        runEvents.push({ sessionId, source, trust, kind, text, payload, rawRef });
      },
    });

    await handleResponse(
      'terminal-delegated-decision',
      confirmationEvent(),
      { type: 'confirm', yes: false },
      'event-message-id',
      {
        responseMsgId: 'response-message-id',
        responderId: 'dave-terminal',
        responderName: 'MasterDave',
        justification: 'Destructive command is not justified.',
        source: 'cli_decision',
      },
    );

    expect(writes).toEqual(['no', '\r']);
    expect(JSON.parse(metaUpdates[0].meta)).toMatchObject({
      status: 'responded',
      chosen: 'cancel',
      decision: {
        by: 'MasterDave',
        responder_id: 'dave-terminal',
        response_msg_id: 'response-message-id',
        source: 'cli_decision',
        justification: 'Destructive command is not justified.',
      },
    });
    expect(broadcasts[0].meta.decision.by).toBe('MasterDave');
    expect(runEvents[0]).toMatchObject({
      sessionId: 'terminal-delegated-decision',
      source: 'json',
      trust: 'high',
      kind: 'approval_decision',
      rawRef: 'event-message-id',
    });
    expect(runEvents[0].text).toContain('MasterDave chose cancel');
    expect(runEvents[0].payload.decision.justification).toBe('Destructive command is not justified.');
  });
});
