/**
 * curatedQueue.demo.test.ts — END-TO-END PROOF of the curated queue with the
 * REAL local model (gemma4-chair, 32K). Run:
 *   node node_modules/vitest/vitest.mjs run src/lib/server/curatedQueue.demo.test.ts --reporter=basic
 * The console output IS the demo. Asserts: dedupe shrinks the queue,
 * one-in-flight holds, every item ends 'done'. The gemma call is guarded so
 * the loop-logic proof stands even if the model is down.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendFileSync, writeFileSync } from 'node:fs';
const DEMO_LOG = '/tmp/curated-queue-demo.txt';
function out(s: string){ process.stdout.write(s + '\n'); appendFileSync(DEMO_LOG, s + '\n'); }
import { resetIdentityDbForTests } from './db';
import { enqueue, listQueue, markDone, countPending, getItem, resetMessageQueueForTests } from './messageQueueStore';
import { curate } from './queueCurator';
import { maybePullForWorker } from './queueConsumer';

const ROOM = 'demo-room';
const CHAIR = '@localchair';

beforeEach(() => { process.env.ANT_FRESH_DB_PATH = ':memory:'; resetIdentityDbForTests(); resetMessageQueueForTests(); });
afterEach(() => { resetIdentityDbForTests(); delete process.env.ANT_FRESH_DB_PATH; });

function show(tag: string) {
  const items = listQueue(ROOM, CHAIR);
  out(`  queue [${tag}]: ${items.length} items`);
  for (const it of items) out(`    - [${it.status}] ${JSON.stringify(it.curatedText.slice(0, 58))} (srcs:${it.sourceMessageIds.length})`);
}

async function gemma(prompt: string): Promise<string | null> {
  try {
    const r = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gemma4-chair', prompt, stream: false, think: false, options: { num_predict: 60 } })
    });
    const j = (await r.json()) as { response?: string };
    return (j.response ?? '').trim();
  } catch {
    return null;
  }
}

describe('curated queue — end-to-end demo', () => {
  it('enqueue → curate → capacity-gated one-in-flight → worker → done', async () => {
    out('\n=== 1. ENQUEUE (5 raw inbound: 2 dups + 1 near-dup + 1 resolved-by-later) ===');
    enqueue({ roomId: ROOM, targetHandle: CHAIR, sourceMessageId: 'm1', text: '@localchair what is the status of the build?' });
    enqueue({ roomId: ROOM, targetHandle: CHAIR, sourceMessageId: 'm2', text: '@localchair what is the status of the build?' });
    enqueue({ roomId: ROOM, targetHandle: CHAIR, sourceMessageId: 'm3', text: 'status of the build please' });
    enqueue({ roomId: ROOM, targetHandle: CHAIR, sourceMessageId: 'm4', text: '@localchair summarise the room in one line' });
    enqueue({ roomId: ROOM, targetHandle: CHAIR, sourceMessageId: 'm5', text: 'nvm the build question is resolved, ignore that' });
    show('after enqueue');
    const enqueued = listQueue(ROOM, CHAIR, { status: 'pending' }).length;
    expect(enqueued).toBe(5);

    out('\n=== 2. CURATE (dedupe + condense + drop-resolved) ===');
    const summary = curate(ROOM, CHAIR);
    out(`  curator summary: ${JSON.stringify(summary)}`);
    show('after curate');
    const afterCurate = countPending(ROOM, CHAIR);
    expect(afterCurate).toBeLessThan(enqueued); // the curator demonstrably shrank the queue

    out('\n=== 3. CAPACITY-GATED PROCESSING (one-in-flight; pull only when free) ===');
    let processed = 0;
    let guard = 0;
    while (countPending(ROOM, CHAIR) > 0 && guard++ < 12) {
      const item = maybePullForWorker(ROOM, CHAIR, { readWorkerState: () => 'Waiting' });
      if (!item) break;
      expect(getItem(item.id)?.status).toBe('working');
      out(`  → pulled [${item.id}] ${JSON.stringify(item.curatedText.slice(0, 48))} (status: working)`);
      const blocked = maybePullForWorker(ROOM, CHAIR, { readWorkerState: () => 'Waiting' });
      out(`    one-in-flight: 2nd pull → ${blocked === null ? 'null ✓ (worker busy)' : 'ITEM ✗ BUG'}`);
      expect(blocked).toBeNull();
      const reply = await gemma(`You are @localchair, the room chair. Reply in ONE short sentence.\n\n${item.curatedText}`);
      out(`    🐜 gemma4-chair: ${reply === null ? '(model unreachable — loop logic still proven)' : JSON.stringify(reply.slice(0, 110))}`);
      markDone(item.id);
      processed += 1;
      out(`    done → pending left: ${countPending(ROOM, CHAIR)}`);
    }

    out('\n=== 4. FINAL STATE ===');
    show('final');
    out('=== DEMO COMPLETE ===\n');
    expect(countPending(ROOM, CHAIR)).toBe(0);
    expect(listQueue(ROOM, CHAIR, { status: 'done' }).length).toBe(processed);
    expect(processed).toBeGreaterThan(0);
  }, 90_000);
});
