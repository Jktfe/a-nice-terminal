// Phase A of server-split-2026-05-11 — focused tests for the Tier 1
// persist library. Confirms the contract Phase B/C/D depend on:
//   - new rows insert with broadcast_state='pending'
//   - ask rows are written in the same call (transaction)
//   - meta carries ask_ids when asks fire
//   - reply_to validation surfaces as WriteMessageError(400)
//   - urgent/focus bypass without reason surfaces as WriteMessageError(400)

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { _resetForTest, queries } from '../src/lib/server/db.js';
import { writeMessage, WriteMessageError } from '../src/lib/persist/index.js';

const ROOM_ID = 'persist-test-room';
const SENDER_ID = 'persist-test-sender';

let dataDir = '';
let originalDataDir: string | undefined;

function setupRoom() {
  queries.createSession(ROOM_ID, 'Persist Test Room', 'chat', '15m', null, null, '{}');
  queries.createSession(SENDER_ID, 'Persist Test Sender', 'chat', '15m', null, null, '{}');
}

describe('writeMessage — Tier 1 persist library', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-persist-test-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    setupRoom();
  });

  afterEach(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('inserts the row with broadcast_state=pending', () => {
    const result = writeMessage({
      sessionId: ROOM_ID,
      role: 'user',
      content: 'hello world',
      senderId: SENDER_ID,
      source: 'http',
    });
    expect(result.message.broadcast_state).toBe('pending');

    const row: any = queries.getMessage(result.message.id);
    expect(row).toBeTruthy();
    expect(row.broadcast_state).toBe('pending');
    expect(row.broadcast_attempts).toBe(0);
  });

  it('returns the persisted shape with sender + first-post detection', () => {
    const result = writeMessage({
      sessionId: ROOM_ID,
      role: 'user',
      content: 'first message',
      senderId: SENDER_ID,
      source: 'http',
    });
    expect(result.message.session_id).toBe(ROOM_ID);
    expect(result.message.sender_id).toBe(SENDER_ID);
    expect(result.firstPost).toBe(true);
    expect(result.senderResolved.name).toBeTruthy();

    const second = writeMessage({
      sessionId: ROOM_ID,
      role: 'user',
      content: 'second message',
      senderId: SENDER_ID,
      source: 'http',
    });
    expect(second.firstPost).toBe(false);
  });

  it('writes explicit asks and rewrites meta with ask_ids', () => {
    const result = writeMessage({
      sessionId: ROOM_ID,
      role: 'user',
      content: 'we need a decision on the API',
      senderId: SENDER_ID,
      asks: ['Pick a vendor for the auth library by Friday'],
      source: 'http',
    });
    expect(result.asks.length).toBeGreaterThan(0);
    const persistedMeta = JSON.parse(result.message.meta) as Record<string, unknown>;
    expect(Array.isArray(persistedMeta.ask_ids)).toBe(true);
    expect((persistedMeta.ask_ids as string[]).length).toBe(result.asks.length);
    expect(persistedMeta.ask_id).toBe(result.asks[0].id);
  });

  it('rejects reply_to that points at a different session with WriteMessageError(400)', () => {
    // Insert a message in a DIFFERENT room
    const other = writeMessage({
      sessionId: ROOM_ID,
      role: 'user',
      content: 'parent in other room',
      senderId: SENDER_ID,
      source: 'http',
    });
    // Create a second room and try to reply to the first room's message from there
    queries.createSession('other-room', 'Other', 'chat', '15m', null, null, '{}');
    expect.assertions(2);
    try {
      writeMessage({
        sessionId: 'other-room',
        role: 'user',
        content: 'cross-session reply attempt',
        senderId: SENDER_ID,
        replyTo: other.message.id,
        source: 'http',
      });
    } catch (e) {
      expect(e).toBeInstanceOf(WriteMessageError);
      expect((e as WriteMessageError).status).toBe(400);
    }
  });

  it('rejects urgent/focus bypass without a reason with WriteMessageError(400)', () => {
    expect.assertions(2);
    try {
      writeMessage({
        sessionId: ROOM_ID,
        role: 'user',
        content: 'urgent something',
        senderId: SENDER_ID,
        meta: { urgent: true },
        source: 'http',
      });
    } catch (e) {
      expect(e).toBeInstanceOf(WriteMessageError);
      expect((e as WriteMessageError).status).toBe(400);
    }
  });

  it('accepts urgent with a reason', () => {
    const result = writeMessage({
      sessionId: ROOM_ID,
      role: 'user',
      content: 'urgent something',
      senderId: SENDER_ID,
      meta: { urgent: true, reason: 'mainline outage' },
      source: 'http',
    });
    expect(result.message.broadcast_state).toBe('pending');
  });

  it('appends a trailing space when message text ends in @handle (mention boundary)', () => {
    const result = writeMessage({
      sessionId: ROOM_ID,
      role: 'user',
      content: 'ping @everyone',
      senderId: SENDER_ID,
      source: 'http',
    });
    expect(result.message.content.endsWith(' ')).toBe(true);
  });

  it('rejects mcp source until that lane lands (only http and cli accepted)', () => {
    // Phase D widened the union to include 'cli' (with actor/membership
    // checks); 'mcp' stays rejected as 400 until its own auth lane.
    // The CLI 403 paths (missing actor, non-member) are covered in
    // tests/cli-direct-write.test.ts.
    expect.assertions(2);
    try {
      writeMessage({
        sessionId: ROOM_ID,
        role: 'user',
        content: 'attempted mcp write',
        senderId: SENDER_ID,
        source: 'mcp' as 'http',
      });
    } catch (e) {
      expect(e).toBeInstanceOf(WriteMessageError);
      expect((e as WriteMessageError).status).toBe(400);
    }
  });

  it('rolls back the message insert when a mid-transaction step throws', async () => {
    // The transaction wraps createMessage + ask writes + meta update +
    // membership upsert. We force a throw inside the wrapped body by
    // shadowing queries.updateSession (which writeMessage calls right
    // after createMessage) with a function that throws. Better-sqlite3's
    // db.transaction(fn) wrapper guarantees the message INSERT rolls
    // back when fn re-throws.
    const dbModule: any = await import('../src/lib/server/db.js');
    const original = dbModule.queries.updateSession;
    dbModule.queries.updateSession = () => {
      throw new Error('forced rollback for test');
    };
    try {
      expect(() =>
        writeMessage({
          sessionId: ROOM_ID,
          role: 'user',
          content: 'this should not survive',
          senderId: SENDER_ID,
          source: 'http',
        }),
      ).toThrow('forced rollback for test');

      // Assert no message row was left behind from this attempt
      const stranded: any[] = dbModule.queries.getMessagesBefore(ROOM_ID, '9999-12-31', 100) as any[];
      const matchingContent = stranded.filter((m) => m.content === 'this should not survive');
      expect(matchingContent.length).toBe(0);
    } finally {
      dbModule.queries.updateSession = original;
    }
  });
});
