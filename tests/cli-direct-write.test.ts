// Phase D of server-split-2026-05-11 — focused tests for the CLI
// direct-write path. Covers:
//   - isLocalServer predicate: loopback only (Tailscale, .local, LAN,
//     public domains all return false).
//   - postMessageDirect writes a pending row to ant.db with the
//     'cli' source recorded.
//   - Direct-write membership gate: anonymous (no actorSessionId)
//     rejected, non-member rejected, member accepted.
//   - Greenfield exception: first post to a room with no members is
//     allowed (mirrors HTTP semantics).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { _resetForTest, queries } from '../src/lib/server/db.js';
import { writeMessage, WriteMessageError } from '../src/lib/persist/index.js';
import { isLocalServer, postMessageDirect } from '../cli/lib/api.js';

const ROOM_ID = 'cli-direct-write-room';
const ACTOR_ID = 'cli-direct-write-actor';

let dataDir = '';
let originalDataDir: string | undefined;

function setup() {
  originalDataDir = process.env.ANT_DATA_DIR;
  dataDir = mkdtempSync(join(tmpdir(), 'ant-cli-direct-'));
  process.env.ANT_DATA_DIR = dataDir;
  _resetForTest();
  queries.createSession(ROOM_ID, 'Direct Write Room', 'chat', '15m', null, null, '{}');
  queries.createSession(ACTOR_ID, 'Actor', 'chat', '15m', null, null, '{}');
}

function teardown() {
  _resetForTest();
  if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
  else process.env.ANT_DATA_DIR = originalDataDir;
  rmSync(dataDir, { recursive: true, force: true });
}

describe('isLocalServer predicate', () => {
  it('returns true for loopback addresses', () => {
    expect(isLocalServer('http://127.0.0.1:6458')).toBe(true);
    expect(isLocalServer('https://localhost:6458')).toBe(true);
    expect(isLocalServer('http://[::1]:6458')).toBe(true);
    expect(isLocalServer('http://127.0.0.1')).toBe(true);
  });

  it('returns false for Tailscale .ts.net hostnames', () => {
    expect(isLocalServer('https://mac.kingfisher-interval.ts.net:6458')).toBe(false);
    expect(isLocalServer('https://anything.ts.net')).toBe(false);
  });

  it('returns false for mDNS .local hostnames', () => {
    expect(isLocalServer('http://my-mac.local:6458')).toBe(false);
  });

  it('returns false for LAN IPs (still a network hop)', () => {
    expect(isLocalServer('http://192.168.1.50:6458')).toBe(false);
    expect(isLocalServer('http://10.0.0.7:6458')).toBe(false);
  });

  it('returns false for public domains', () => {
    expect(isLocalServer('https://ant.example.com')).toBe(false);
    expect(isLocalServer('https://anywhere.dev')).toBe(false);
  });

  it('returns false on malformed input', () => {
    expect(isLocalServer('not-a-url')).toBe(false);
    expect(isLocalServer('')).toBe(false);
  });
});

describe('writeMessage source=cli auth gate', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('rejects source=cli without actorSessionId with 403', () => {
    expect.assertions(2);
    try {
      writeMessage({
        sessionId: ROOM_ID,
        role: 'user',
        content: 'no actor',
        senderId: ACTOR_ID,
        source: 'cli',
      });
    } catch (e) {
      expect(e).toBeInstanceOf(WriteMessageError);
      expect((e as WriteMessageError).status).toBe(403);
    }
  });

  it('rejects source=cli for a non-member of an established room with 403', () => {
    // Pre-populate the room with a different member so it is NOT
    // greenfield. The actor's attempt to post then fails the
    // membership check.
    queries.addRoomMember(ROOM_ID, 'someone-else', 'participant', null, null);
    expect.assertions(2);
    try {
      writeMessage({
        sessionId: ROOM_ID,
        role: 'user',
        content: 'non-member attempt',
        senderId: ACTOR_ID,
        actorSessionId: ACTOR_ID,
        source: 'cli',
      });
    } catch (e) {
      expect(e).toBeInstanceOf(WriteMessageError);
      expect((e as WriteMessageError).status).toBe(403);
    }
  });

  it('accepts source=cli for a member of the room', () => {
    queries.addRoomMember(ROOM_ID, ACTOR_ID, 'participant', null, null);
    const result = writeMessage({
      sessionId: ROOM_ID,
      role: 'user',
      content: 'member write',
      senderId: ACTOR_ID,
      actorSessionId: ACTOR_ID,
      source: 'cli',
    });
    expect(result.message.broadcast_state).toBe('pending');
  });

  it('accepts the FIRST source=cli write on a greenfield room (no members yet)', () => {
    // Room has zero membership rows — this is the "first post" case
    // that HTTP would auto-create membership for.
    const result = writeMessage({
      sessionId: ROOM_ID,
      role: 'user',
      content: 'greenfield first write',
      senderId: ACTOR_ID,
      actorSessionId: ACTOR_ID,
      source: 'cli',
    });
    expect(result.message.broadcast_state).toBe('pending');
    // After the write, membership is auto-created by
    // ensureRoomMembershipForSender — subsequent writes pass the
    // strict member check.
    expect(queries.isRoomMember(ROOM_ID, ACTOR_ID)).toBeTruthy();
  });
});

describe('postMessageDirect end-to-end', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('writes a pending row to ant.db with broadcast_state=pending', async () => {
    const result = await postMessageDirect({
      sessionId: ROOM_ID,
      role: 'user',
      content: 'direct from CLI',
      senderId: ACTOR_ID,
      actorSessionId: ACTOR_ID,
    });
    expect(result.message.broadcast_state).toBe('pending');

    const row: any = queries.getMessage(result.message.id);
    expect(row).toBeTruthy();
    expect(row.broadcast_state).toBe('pending');
  });
});
