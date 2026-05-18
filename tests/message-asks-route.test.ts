import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import getDb, { _resetForTest, queries } from '../src/lib/server/db.js';

const broadcast = vi.fn();
const broadcastGlobal = vi.fn();

vi.mock('$lib/server/ws-broadcast.js', () => ({
  broadcast,
  broadcastGlobal,
}));

const { PATCH } = await import('../src/routes/api/sessions/[id]/messages/[msg_id]/asks/+server.js');

let dataDir = '';
let originalDataDir: string | undefined;

function patchEvent(roomId: string, msgId: string, body: unknown) {
  return {
    params: { id: roomId, msg_id: msgId },
    request: new Request(`https://ant.test/api/sessions/${roomId}/messages/${msgId}/asks`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  } as any;
}

async function expectHttpError(action: () => unknown | Promise<unknown>, status: number) {
  try {
    await action();
  } catch (err) {
    expect(err).toMatchObject({ status });
    return;
  }
  throw new Error(`Expected HTTP ${status}`);
}

function createAsk(id: string, sessionId = 'room-a', sourceMessageId: string | null = 'msg-a1') {
  queries.createAsk(
    id,
    sessionId,
    sourceMessageId,
    `Ask ${id}`,
    `Body ${id}`,
    null,
    'open',
    '@you',
    'human',
    'normal',
    '@codex',
    0,
    0,
    '{}',
  );
}

describe('/api/sessions/:id/messages/:msg_id/asks', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-message-asks-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    getDb();
    broadcast.mockReset();
    broadcastGlobal.mockReset();

    queries.createSession('room-a', 'Room A', 'chat', 'forever', null, null, '{}');
    queries.createSession('room-b', 'Room B', 'chat', 'forever', null, null, '{}');
    queries.createSession('terminal-a', 'Terminal A', 'terminal', 'forever', null, null, '{}');
    queries.createSession('archived-room', 'Archived Room', 'chat', 'forever', null, null, '{}');
    queries.createSession('deleted-room', 'Deleted Room', 'chat', 'forever', null, null, '{}');
    queries.archiveSession('archived-room');
    queries.softDeleteSession('deleted-room');

    const askMeta = JSON.stringify({
      asks: ['Need operator approval'],
      inferred_asks: ['Should the agent continue?'],
      ask_ids: ['ask-1', 'ask-2'],
    });
    queries.createMessage('msg-a1', 'room-a', 'assistant', 'contains asks', 'text', 'complete', '@codex', null, null, 'message', askMeta);
    queries.createMessage('msg-b1', 'room-b', 'assistant', 'other room', 'text', 'complete', '@codex', null, null, 'message', askMeta);
    queries.createMessage('msg-terminal', 'terminal-a', 'assistant', 'terminal', 'text', 'complete', '@codex', null, null, 'message', askMeta);
    queries.createMessage('msg-archived', 'archived-room', 'assistant', 'archived', 'text', 'complete', '@codex', null, null, 'message', askMeta);
    queries.createMessage('msg-deleted', 'deleted-room', 'assistant', 'deleted', 'text', 'complete', '@codex', null, null, 'message', askMeta);
    createAsk('ask-1');
    createAsk('ask-2');
  });

  afterEach(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('persists resolved ask indices and broadcasts message and ask updates', async () => {
    const response = await PATCH(patchEvent('room-a', 'msg-a1', { resolved: [0, 1] }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(JSON.parse((queries.getMessage('msg-a1') as any).meta)).toMatchObject({ asks_resolved: [0, 1] });
    expect(queries.getAsk('ask-1')).toMatchObject({
      status: 'answered',
      answer: 'Resolved from pinned ask panel',
      answer_action: 'answer',
    });
    expect(queries.getAsk('ask-2')).toMatchObject({ status: 'answered' });
    expect(broadcast).toHaveBeenCalledWith('room-a', {
      type: 'message_updated',
      sessionId: 'room-a',
      msgId: 'msg-a1',
      meta: expect.objectContaining({ asks_resolved: [0, 1] }),
    });
    expect(broadcast).toHaveBeenCalledWith('room-a', {
      type: 'ask_updated',
      sessionId: 'room-a',
      ask: expect.objectContaining({ id: 'ask-1', status: 'answered' }),
    });
    expect(broadcastGlobal).toHaveBeenCalledWith({
      type: 'ask_updated',
      sessionId: 'room-a',
      ask: expect.objectContaining({ id: 'ask-1', status: 'answered' }),
    });
  });

  it('rejects malformed JSON and invalid resolved index payloads without broadcasting', async () => {
    const malformed = await PATCH(patchEvent('room-a', 'msg-a1', '{'));
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: 'Invalid JSON' });

    const nonArray = await PATCH(patchEvent('room-a', 'msg-a1', { resolved: '0' }));
    expect(nonArray.status).toBe(400);
    expect(await nonArray.json()).toEqual({ error: 'resolved must be an array of non-negative integers' });

    const duplicate = await PATCH(patchEvent('room-a', 'msg-a1', { resolved: [0, 0] }));
    expect(duplicate.status).toBe(400);
    expect(await duplicate.json()).toEqual({ error: 'resolved indices must be unique' });

    const outOfRange = await PATCH(patchEvent('room-a', 'msg-a1', { resolved: [2] }));
    expect(outOfRange.status).toBe(400);
    expect(await outOfRange.json()).toEqual({ error: 'resolved index out of range' });

    expect(broadcast).not.toHaveBeenCalled();
    expect(broadcastGlobal).not.toHaveBeenCalled();
  });

  it('rejects missing, non-chat, inactive, and cross-room message targets', async () => {
    await expectHttpError(() => PATCH(patchEvent('missing-room', 'msg-a1', { resolved: [0] })), 404);
    await expectHttpError(() => PATCH(patchEvent('terminal-a', 'msg-terminal', { resolved: [0] })), 400);
    await expectHttpError(() => PATCH(patchEvent('archived-room', 'msg-archived', { resolved: [0] })), 410);
    await expectHttpError(() => PATCH(patchEvent('deleted-room', 'msg-deleted', { resolved: [0] })), 410);

    const crossRoom = await PATCH(patchEvent('room-b', 'msg-a1', { resolved: [0] }));
    expect(crossRoom.status).toBe(404);
    expect(await crossRoom.json()).toEqual({ error: 'message not found' });

    const missingMessage = await PATCH(patchEvent('room-a', 'missing-msg', { resolved: [0] }));
    expect(missingMessage.status).toBe(404);
    expect(await missingMessage.json()).toEqual({ error: 'message not found' });

    expect(JSON.parse((queries.getMessage('msg-a1') as any).meta)).not.toHaveProperty('asks_resolved');
    expect(broadcast).not.toHaveBeenCalled();
    expect(broadcastGlobal).not.toHaveBeenCalled();
  });
});
