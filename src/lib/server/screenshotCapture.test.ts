import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { captureScreenshotToRoom } from './screenshotCapture';
import {
  enableSharedFolder,
  SharedFolderDisabledError,
  resetScreenshotIndexStoreForTests
} from './screenshotIndexStore';
import { createChatRoom, resetChatRoomStoreForTests } from './chatRoomStore';
import { resetIdentityDbForTests } from './db';

let dbDir: string;
let uploadDir: string;
const prevDbPath = process.env.ANT_FRESH_DB_PATH;
const prevUploadRoot = process.env.ANT_UPLOAD_ROOT;

const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000005000100',
  'hex'
);

beforeEach(() => {
  dbDir = mkdtempSync(join(tmpdir(), 'ant-capture-db-'));
  uploadDir = mkdtempSync(join(tmpdir(), 'ant-capture-up-'));
  process.env.ANT_FRESH_DB_PATH = join(dbDir, 'test.db');
  process.env.ANT_UPLOAD_ROOT = uploadDir;
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
  resetScreenshotIndexStoreForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(dbDir, { recursive: true, force: true });
  rmSync(uploadDir, { recursive: true, force: true });
  if (prevDbPath === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = prevDbPath;
  if (prevUploadRoot === undefined) delete process.env.ANT_UPLOAD_ROOT;
  else process.env.ANT_UPLOAD_ROOT = prevUploadRoot;
});

describe('captureScreenshotToRoom', () => {
  it('inserts new capture: file written to canonical path + row returned', async () => {
    const room = createChatRoom({ name: 'r1', whoCreatedIt: '@you' });
    enableSharedFolder(room.id, true);
    const result = await captureScreenshotToRoom({
      roomId: room.id, takenBy: '@you', bytes: PNG_BYTES, topic: 'demo'
    });
    expect(result.kind).toBe('inserted');
    expect(result.sha).toBe(createHash('sha256').update(PNG_BYTES).digest('hex'));
    expect(existsSync(result.canonicalPath)).toBe(true);
    expect(readFileSync(result.canonicalPath)).toEqual(PNG_BYTES);
    expect(result.row.topic).toBe('demo');
    expect(result.row.bytes).toBe(PNG_BYTES.length);
  });

  it('second capture of same bytes returns kind=existing + does NOT rewrite file', async () => {
    const room = createChatRoom({ name: 'dup', whoCreatedIt: '@you' });
    enableSharedFolder(room.id, true);
    const first = await captureScreenshotToRoom({ roomId: room.id, takenBy: '@you', bytes: PNG_BYTES });
    const second = await captureScreenshotToRoom({ roomId: room.id, takenBy: '@kimi', bytes: PNG_BYTES });
    expect(second.kind).toBe('existing');
    expect(second.canonicalPath).toBe(first.canonicalPath);
    expect(second.row.taken_by).toBe('@you');
  });

  it('throws SharedFolderDisabledError when room flag is OFF + cleans up temp', async () => {
    const room = createChatRoom({ name: 'off', whoCreatedIt: '@you' });
    await expect(
      captureScreenshotToRoom({ roomId: room.id, takenBy: '@you', bytes: PNG_BYTES })
    ).rejects.toThrow(SharedFolderDisabledError);
    const tmpFiles = readdirSync(join(uploadDir, 'uploads', '.tmp'));
    expect(tmpFiles).toEqual([]);
  });

  it('rejects empty buffer with clear error', async () => {
    const room = createChatRoom({ name: 'empty', whoCreatedIt: '@you' });
    enableSharedFolder(room.id, true);
    await expect(
      captureScreenshotToRoom({ roomId: room.id, takenBy: '@you', bytes: Buffer.alloc(0) })
    ).rejects.toThrow(/empty/);
  });

  it('per-room scoping: same bytes in two different rooms write two canonical files', async () => {
    const roomA = createChatRoom({ name: 'A', whoCreatedIt: '@you' });
    const roomB = createChatRoom({ name: 'B', whoCreatedIt: '@you' });
    enableSharedFolder(roomA.id, true);
    enableSharedFolder(roomB.id, true);
    const a = await captureScreenshotToRoom({ roomId: roomA.id, takenBy: '@you', bytes: PNG_BYTES });
    const b = await captureScreenshotToRoom({ roomId: roomB.id, takenBy: '@you', bytes: PNG_BYTES });
    expect(a.canonicalPath).not.toBe(b.canonicalPath);
    expect(existsSync(a.canonicalPath)).toBe(true);
    expect(existsSync(b.canonicalPath)).toBe(true);
  });
});
