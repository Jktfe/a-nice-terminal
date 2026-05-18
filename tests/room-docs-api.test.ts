import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import getDb, { _resetForTest } from '../src/lib/server/db.js';
import { createChatRoom } from '../src/lib/server/chatRoomStore.js';
import {
  DELETE as deleteDoc,
  GET as listDocs,
  PATCH as patchDoc,
  POST as createDoc,
} from '../src/routes/api/chat-rooms/[roomId]/docs/+server.js';

const ROOM_ID = 'room-docs-api';
const OTHER_ROOM_ID = 'room-docs-other';

let dataDir = '';
let originalDataDir: string | undefined;

function requestWithBody(url: string, method: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function event(roomId: string, method = 'GET', body: unknown = null, docId: string | null = null) {
  const url = new URL(`https://ant.test/api/chat-rooms/${roomId}/docs`);
  if (docId) url.searchParams.set('docId', docId);
  return {
    params: { roomId },
    url,
    request: body === null ? new Request(url, { method }) : requestWithBody(String(url), method, body),
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

describe('room docs API', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-room-docs-api-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    getDb();
    createChatRoom({ id: ROOM_ID, name: 'Docs API Room' });
    createChatRoom({ id: OTHER_ROOM_ID, name: 'Other Docs API Room' });
  });

  afterEach(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('creates, lists, updates, and soft-deletes a room doc', async () => {
    const created = await createDoc(event(ROOM_ID, 'POST', {
      title: 'Agent Skill Deck',
      content: '# Deck\n\nHow decks are shared.',
      createdBy: '@evolveantcodex',
    }));
    expect(created.status).toBe(201);
    const doc = await created.json();
    expect(doc).toMatchObject({
      roomId: ROOM_ID,
      title: 'Agent Skill Deck',
      content: '# Deck\n\nHow decks are shared.',
      createdBy: '@evolveantcodex',
    });

    const listed = await listDocs(event(ROOM_ID));
    expect(await listed.json()).toMatchObject({
      docs: [{ id: doc.id, title: 'Agent Skill Deck' }],
    });

    const patched = await patchDoc(event(ROOM_ID, 'PATCH', {
      title: 'Agent Skill Examples',
      content: 'Updated examples.',
    }, doc.id));
    expect(await patched.json()).toMatchObject({
      id: doc.id,
      title: 'Agent Skill Examples',
      content: 'Updated examples.',
    });

    const deleted = await deleteDoc(event(ROOM_ID, 'DELETE', null, doc.id));
    expect(deleted.status).toBe(204);

    const afterDelete = await listDocs(event(ROOM_ID));
    expect(await afterDelete.json()).toEqual({ docs: [] });
  });

  it('rejects unknown rooms and invalid create bodies', async () => {
    await expectHttpError(() => listDocs(event('missing-room')), 404);
    await expectHttpError(() => createDoc(event(ROOM_ID, 'POST', '{')), 400);
    await expectHttpError(() => createDoc(event(ROOM_ID, 'POST', { title: '   ' })), 400);
  });

  it('rejects cross-room updates and deletes', async () => {
    const created = await createDoc(event(ROOM_ID, 'POST', {
      title: 'Room scoped',
      content: 'Only this room can mutate it.',
    }));
    const doc = await created.json();

    await expectHttpError(
      () => patchDoc(event(OTHER_ROOM_ID, 'PATCH', { title: 'Wrong room' }, doc.id)),
      403,
    );
    await expectHttpError(
      () => deleteDoc(event(OTHER_ROOM_ID, 'DELETE', null, doc.id)),
      403,
    );
  });
});
