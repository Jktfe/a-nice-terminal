/**
 * docsStore tests — Task #124 v3-parity.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { _resetForTest as resetDbForTest } from './db';
import {
  createDoc,
  listDocsInRoom,
  getDoc,
  updateDoc,
  softDeleteDoc,
  resetDocsStoreForTests
} from './docsStore';
import { createChatRoom, resetChatRoomStoreForTests } from './chatRoomStore';

let dataDir = '';
let originalDataDir: string | undefined;

beforeEach(() => {
  originalDataDir = process.env.ANT_DATA_DIR;
  dataDir = mkdtempSync(join(tmpdir(), 'ant-docs-store-'));
  process.env.ANT_DATA_DIR = dataDir;
  resetDbForTest();
  resetDocsStoreForTests();
  resetChatRoomStoreForTests();
});

afterEach(() => {
  resetDocsStoreForTests();
  resetChatRoomStoreForTests();
  resetDbForTest();
  if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
  else process.env.ANT_DATA_DIR = originalDataDir;
  rmSync(dataDir, { recursive: true, force: true });
  dataDir = '';
});

function makeRoom(name = 'test-room') {
  return createChatRoom({ name });
}

describe('createDoc', () => {
  it('creates a doc with minimal fields', () => {
    const room = makeRoom();
    const doc = createDoc({ roomId: room.id, title: 'Hello' });
    expect(doc.title).toBe('Hello');
    expect(doc.content).toBe('');
    expect(doc.roomId).toBe(room.id);
    expect(doc.createdAtMs).toBeGreaterThan(0);
    expect(doc.updatedAtMs).toBe(doc.createdAtMs);
  });

  it('creates a doc with content', () => {
    const room = makeRoom();
    const doc = createDoc({ roomId: room.id, title: 'Guide', content: '# Guide\n\nSteps...' });
    expect(doc.title).toBe('Guide');
    expect(doc.content).toBe('# Guide\n\nSteps...');
  });

  it('trims title', () => {
    const room = makeRoom();
    const doc = createDoc({ roomId: room.id, title: '  Trimmed  ' });
    expect(doc.title).toBe('Trimmed');
  });

  it('rejects blank title', () => {
    const room = makeRoom();
    expect(() => createDoc({ roomId: room.id, title: '   ' })).toThrow('title cannot be blank');
  });
});

describe('listDocsInRoom', () => {
  it('lists docs newest-first by updated_at', () => {
    const room = makeRoom();
    const d1 = createDoc({ roomId: room.id, title: 'A' });
    const d2 = createDoc({ roomId: room.id, title: 'B' });
    const docs = listDocsInRoom(room.id);
    expect(docs.length).toBe(2);
    expect(docs[0].id).toBe(d2.id);
    expect(docs[1].id).toBe(d1.id);
  });

  it('excludes soft-deleted docs', () => {
    const room = makeRoom();
    const d1 = createDoc({ roomId: room.id, title: 'A' });
    createDoc({ roomId: room.id, title: 'B' });
    softDeleteDoc(d1.id);
    const docs = listDocsInRoom(room.id);
    expect(docs.length).toBe(1);
    expect(docs[0].title).toBe('B');
  });

  it('returns empty for unknown room', () => {
    expect(listDocsInRoom('unknown')).toEqual([]);
  });
});

describe('getDoc', () => {
  it('returns a doc by id', () => {
    const room = makeRoom();
    const doc = createDoc({ roomId: room.id, title: 'Find me' });
    const found = getDoc(doc.id);
    expect(found).toBeDefined();
    expect(found!.title).toBe('Find me');
  });

  it('returns undefined for unknown id', () => {
    expect(getDoc('no-such-id')).toBeUndefined();
  });

  it('returns undefined for soft-deleted doc', () => {
    const room = makeRoom();
    const doc = createDoc({ roomId: room.id, title: 'Gone' });
    softDeleteDoc(doc.id);
    expect(getDoc(doc.id)).toBeUndefined();
  });
});

describe('updateDoc', () => {
  it('updates title and content', () => {
    const room = makeRoom();
    const doc = createDoc({ roomId: room.id, title: 'Old', content: 'body' });
    const updated = updateDoc(doc.id, { title: 'New', content: 'new body' });
    expect(updated!.title).toBe('New');
    expect(updated!.content).toBe('new body');
    expect(updated!.updatedAtMs).toBeGreaterThan(doc.updatedAtMs!);
  });

  it('updates title only', () => {
    const room = makeRoom();
    const doc = createDoc({ roomId: room.id, title: 'Old', content: 'body' });
    const updated = updateDoc(doc.id, { title: 'New' });
    expect(updated!.title).toBe('New');
    expect(updated!.content).toBe('body');
  });

  it('rejects blank title', () => {
    const room = makeRoom();
    const doc = createDoc({ roomId: room.id, title: 'Old' });
    expect(() => updateDoc(doc.id, { title: '   ' })).toThrow('title cannot be blank');
  });

  it('returns undefined for unknown id', () => {
    expect(updateDoc('no-such-id', { title: 'X' })).toBeUndefined();
  });
});

describe('softDeleteDoc', () => {
  it('soft-deletes an existing doc', () => {
    const room = makeRoom();
    const doc = createDoc({ roomId: room.id, title: 'Delete me' });
    expect(softDeleteDoc(doc.id)).toBe(true);
    expect(getDoc(doc.id)).toBeUndefined();
  });

  it('returns false for unknown id', () => {
    expect(softDeleteDoc('no-such-id')).toBe(false);
  });

  it('returns false for already deleted doc', () => {
    const room = makeRoom();
    const doc = createDoc({ roomId: room.id, title: 'Gone' });
    softDeleteDoc(doc.id);
    expect(softDeleteDoc(doc.id)).toBe(false);
  });
});
