import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests } from './db';
import { createChatRoom } from './chatRoomStore';
import { postMessage, postBreakMessage, softDeleteMessage } from './chatMessageStore';
import { listBlocks, readBlock, readCurrentBlock, OPEN_BLOCK_ID } from './roomBlocksStore';
import { setBlockDeleted } from './roomBlockStateStore';

let tmpDir: string;
const prevDb = process.env.ANT_FRESH_DB_PATH;
const prevVault = process.env.ANT_MEMORY_VAULT_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-blocks-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_MEMORY_VAULT_PATH = '/tmp/ant-memory-pack-test';
  resetIdentityDbForTests();
});
afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (prevDb === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = prevDb;
  if (prevVault === undefined) delete process.env.ANT_MEMORY_VAULT_PATH;
  else process.env.ANT_MEMORY_VAULT_PATH = prevVault;
});

/** Two messages, a break, two messages, a break, one message → 3 blocks. */
function seedThreeBlocks(): { roomId: string; break1: string; break2: string } {
  const room = createChatRoom({ name: 'blocks', whoCreatedIt: '@you' });
  postMessage({ roomId: room.id, authorHandle: '@a', body: 'b0-m1', kind: 'agent' });
  postMessage({ roomId: room.id, authorHandle: '@a', body: 'b0-m2', kind: 'agent' });
  const break1 = postBreakMessage({ roomId: room.id, reason: 'seal block 0', postedByHandle: '@you' });
  postMessage({ roomId: room.id, authorHandle: '@a', body: 'b1-m1', kind: 'agent' });
  postMessage({ roomId: room.id, authorHandle: '@b', body: 'b1-m2', kind: 'agent' });
  const break2 = postBreakMessage({ roomId: room.id, reason: 'seal block 1', postedByHandle: '@you' });
  postMessage({ roomId: room.id, authorHandle: '@a', body: 'b2-open', kind: 'agent' });
  return { roomId: room.id, break1: break1.id, break2: break2.id };
}

describe('roomBlocksStore — addressable, readable blocks', () => {
  it('partitions the room into ordered blocks with the open block last', () => {
    const { roomId, break1, break2 } = seedThreeBlocks();
    const blocks = listBlocks(roomId);
    expect(blocks.map((b) => b.index)).toEqual([0, 1, 2]);
    expect(blocks[0]).toMatchObject({ blockId: break1, open: false, breakReason: 'seal block 0', messageCount: 2 });
    expect(blocks[1]).toMatchObject({ blockId: break2, open: false, breakReason: 'seal block 1', messageCount: 2 });
    expect(blocks[2]).toMatchObject({ blockId: OPEN_BLOCK_ID, open: true, messageCount: 1 });
  });

  it('reads a prior block’s messages (the "summarise a previous section" primitive)', () => {
    const { roomId, break1 } = seedThreeBlocks();
    const read = readBlock(roomId, break1);
    expect(read?.messages.map((m) => m.body)).toEqual(['b0-m1', 'b0-m2']);
    expect(readBlock(roomId, 'no-such-block')).toBeNull();
    expect(readCurrentBlock(roomId).map((m) => m.body)).toEqual(['b2-open']);
  });

  it('skips a deleted MESSAGE by default, surfaces it for audit', () => {
    const room = createChatRoom({ name: 'del-msg', whoCreatedIt: '@you' });
    const keep = postMessage({ roomId: room.id, authorHandle: '@a', body: 'keep', kind: 'agent' });
    const stupid = postMessage({ roomId: room.id, authorHandle: '@a', body: 'stupid', kind: 'agent' });
    expect(keep.id).toBeTruthy();
    softDeleteMessage({ messageId: stupid.id, byHandle: '@a' }); // author deletes own message
    expect(readCurrentBlock(room.id).map((m) => m.body)).toEqual(['keep']); // pollution gone
    expect(readBlock(room.id, OPEN_BLOCK_ID, { includeDeleted: true })?.messages.map((m) => m.body)).toEqual([
      'keep',
      'stupid'
    ]);
  });

  it('skips a deleted BLOCK by default, retains it for audit (tombstone, never removed)', () => {
    const { roomId, break1 } = seedThreeBlocks();
    setBlockDeleted(roomId, break1, true, '@you');
    // block 0 now reads empty in the normal path...
    expect(readBlock(roomId, break1)?.messages).toEqual([]);
    expect(listBlocks(roomId)[0].deleted).toBe(true);
    // ...but the rows are intact for audit
    expect(readBlock(roomId, break1, { includeDeleted: true })?.messages.map((m) => m.body)).toEqual([
      'b0-m1',
      'b0-m2'
    ]);
    // un-delete restores it (tombstone cleared, no data lost)
    setBlockDeleted(roomId, break1, false, '@you');
    expect(readBlock(roomId, break1)?.messages.map((m) => m.body)).toEqual(['b0-m1', 'b0-m2']);
  });
});
