import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import getDb, { _resetForTest, queries } from '../src/lib/server/db.js';
import {
  CHAT_BREAK_MSG_TYPE,
  loadMessagesForAgentContext,
  roomLongMemoryEnabled,
} from '../src/lib/server/chat-context.js';
import { GET as getMessages } from '../src/routes/api/sessions/[id]/messages/+server.js';

const ROOM_ID = 'chat-break-context-room';

let dataDir = '';
let originalDataDir: string | undefined;

function seedMessage(id: string, content: string, msgType = 'message') {
  queries.createMessage(
    id,
    ROOM_ID,
    msgType === CHAT_BREAK_MSG_TYPE ? 'system' : 'user',
    content,
    'text',
    'complete',
    null,
    null,
    null,
    msgType,
    '{}',
  );
}

describe('loadMessagesForAgentContext', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-chat-context-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    queries.createSession(ROOM_ID, 'Chat Break Context Room', 'chat', '15m', null, null, '{}');
  });

  afterEach(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('returns the post-break window by default', () => {
    seedMessage('before-1', 'old context');
    seedMessage('break-1', 'Start fresh from here', CHAT_BREAK_MSG_TYPE);
    seedMessage('after-1', 'new context 1');
    seedMessage('after-2', 'new context 2');

    expect(loadMessagesForAgentContext(ROOM_ID).map((m) => m.id)).toEqual([
      'after-1',
      'after-2',
    ]);
  });

  it('uses the latest break marker when multiple breaks exist', () => {
    seedMessage('before-1', 'old context');
    seedMessage('break-1', 'first reset', CHAT_BREAK_MSG_TYPE);
    seedMessage('between-1', 'between');
    seedMessage('break-2', 'second reset', CHAT_BREAK_MSG_TYPE);
    seedMessage('after-1', 'new context');

    expect(loadMessagesForAgentContext(ROOM_ID).map((m) => m.id)).toEqual(['after-1']);
  });

  it('returns full history when long memory is enabled', () => {
    seedMessage('before-1', 'old context');
    seedMessage('break-1', 'reset', CHAT_BREAK_MSG_TYPE);
    seedMessage('after-1', 'new context');
    queries.setLongMemory(ROOM_ID, true);

    expect(roomLongMemoryEnabled(ROOM_ID)).toBe(true);
    expect(loadMessagesForAgentContext(ROOM_ID).map((m) => m.id)).toEqual([
      'before-1',
      'break-1',
      'after-1',
    ]);
  });

  it('can include the break marker and cap returned context', () => {
    seedMessage('before-1', 'old context');
    seedMessage('break-1', 'reset', CHAT_BREAK_MSG_TYPE);
    seedMessage('after-1', 'new context 1');
    seedMessage('after-2', 'new context 2');

    expect(loadMessagesForAgentContext(ROOM_ID, {
      includeBreakMarker: true,
      limit: 2,
    }).map((m) => m.id)).toEqual(['after-1', 'after-2']);
  });

  it('applies since after the latest break boundary', () => {
    const db = getDb();
    const insert = db.prepare(`
      INSERT INTO messages (id, session_id, role, content, format, status, msg_type, created_at)
      VALUES (?, ?, ?, ?, 'text', 'complete', ?, ?)
    `);
    insert.run('before-1', ROOM_ID, 'user', 'old context', 'message', '2026-05-08T10:00:00.000Z');
    insert.run('break-1', ROOM_ID, 'system', 'reset', CHAT_BREAK_MSG_TYPE, '2026-05-08T10:01:00.000Z');
    insert.run('after-1', ROOM_ID, 'user', 'first new context', 'message', '2026-05-08T10:02:00.000Z');
    insert.run('after-2', ROOM_ID, 'user', 'second new context', 'message', '2026-05-08T10:03:00.000Z');

    expect(loadMessagesForAgentContext(ROOM_ID, {
      since: '2026-05-08T10:02:30.000Z',
    }).map((m) => m.id)).toEqual(['after-2']);
  });

  it('exposes opt-in agent_context without changing normal pagination', async () => {
    seedMessage('before-1', 'old context');
    seedMessage('break-1', 'reset', CHAT_BREAK_MSG_TYPE);
    seedMessage('after-1', 'new context');

    const normal = await getMessages({
      params: { id: ROOM_ID },
      url: new URL(`https://ant.test/api/sessions/${ROOM_ID}/messages?limit=50`),
    } as any) as Response;
    expect(new Set((await normal.json()).messages.map((m: any) => m.id))).toEqual(new Set([
      'before-1',
      'break-1',
      'after-1',
    ]));

    const bounded = await getMessages({
      params: { id: ROOM_ID },
      url: new URL(`https://ant.test/api/sessions/${ROOM_ID}/messages?limit=50&agent_context=1`),
    } as any) as Response;
    expect((await bounded.json()).messages.map((m: any) => m.id)).toEqual(['after-1']);
  });

  it('migrates the sessions.long_memory column with default disabled', () => {
    const columns = getDb().prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>;
    expect(columns.map((c) => c.name)).toContain('long_memory');
    expect(roomLongMemoryEnabled(ROOM_ID)).toBe(false);
  });
});
