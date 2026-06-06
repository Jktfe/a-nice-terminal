import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests } from './db';
import { createChatRoom } from './chatRoomStore';
import { postMessage } from './chatMessageStore';
import { addReactionToMessage } from './messageReactionStore';
import { buildBlockSummaryInput } from './blockSummariser';
import { OPEN_BLOCK_ID } from './roomBlocksStore';

let tmpDir: string;
const prevDb = process.env.ANT_FRESH_DB_PATH;
const prevVault = process.env.ANT_MEMORY_VAULT_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-blocksum-'));
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

describe('blockSummariser — reaction-weighted summary input', () => {
  it('weights messages by reaction count and ranks highlights', () => {
    const room = createChatRoom({ name: 'sum', whoCreatedIt: '@you' });
    const m1 = postMessage({ roomId: room.id, authorHandle: '@a', body: 'unreacted', kind: 'agent' });
    const m2 = postMessage({ roomId: room.id, authorHandle: '@b', body: 'the good one', kind: 'agent' });
    const m3 = postMessage({ roomId: room.id, authorHandle: '@a', body: 'also liked', kind: 'agent' });

    // m2 = two reactions (weight 3), m3 = one (weight 2), m1 = none (weight 1)
    addReactionToMessage({ messageId: m2.id, reactorHandle: '@x', emoji: '👍' });
    addReactionToMessage({ messageId: m2.id, reactorHandle: '@y', emoji: '👍' });
    addReactionToMessage({ messageId: m3.id, reactorHandle: '@z', emoji: '🙌' });

    const input = buildBlockSummaryInput(room.id, OPEN_BLOCK_ID)!;

    expect(input.messageCount).toBe(3);
    expect(input.totalReactions).toBe(3);
    expect(input.participants).toEqual(['@a', '@b']); // distinct, first-seen
    const weightById = Object.fromEntries(input.weightedMessages.map((m) => [m.id, m.weight]));
    expect(weightById[m1.id]).toBe(1);
    expect(weightById[m2.id]).toBe(3);
    expect(weightById[m3.id]).toBe(2);

    // highlights: only reacted messages, highest weight first; m1 excluded
    expect(input.highlights.map((m) => m.body)).toEqual(['the good one', 'also liked']);
  });

  it('an unreacted block has no highlights (not an arbitrary top-N)', () => {
    const room = createChatRoom({ name: 'flat', whoCreatedIt: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@a', body: 'm', kind: 'agent' });
    const input = buildBlockSummaryInput(room.id, OPEN_BLOCK_ID)!;
    expect(input.highlights).toEqual([]);
    expect(input.weightedMessages[0].weight).toBe(1);
  });

  it('returns null for an unknown block', () => {
    const room = createChatRoom({ name: 'x', whoCreatedIt: '@you' });
    expect(buildBlockSummaryInput(room.id, 'nope')).toBeNull();
  });
});
