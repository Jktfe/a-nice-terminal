/**
 * demo-curated-queue.ts — end-to-end proof of the curated queue.
 * Run: bun run scripts/demo-curated-queue.ts  (from the worktree root)
 *
 * Proves the full loop with the REAL local model (gemma4-chair, 32K):
 *   enqueue (incl. dups + a resolved one) → curate (dedupe/condense/drop) →
 *   capacity-gated pull (one-in-flight) → Gemma worker processes → done → next.
 * Box-safe: worker is the 10GB 32K model; curator condense is rule-based here
 * (the condenseFn seam can be `perspective --fm` in prod — probed separately).
 */
process.env.ANT_FRESH_DB_PATH = `/tmp/curated-queue-demo-${Date.now()}.db`;

const { enqueue, listQueue, markDone, countPending, getItem } = await import('../src/lib/server/messageQueueStore.ts');
const { curate } = await import('../src/lib/server/queueCurator.ts');
const { maybePullForWorker } = await import('../src/lib/server/queueConsumer.ts');

const ROOM = 'demo-room';
const CHAIR = '@localchair';
const OLLAMA = 'http://localhost:11434/api/generate';

function line(s = '') { console.log(s); }
function show(tag: string) {
  const items = listQueue(ROOM, CHAIR);
  line(`  queue [${tag}]: ${items.length} items`);
  for (const it of items) line(`    - [${it.status}] ${JSON.stringify(it.curatedText.slice(0, 60))} (srcs:${it.sourceMessageIds.length})`);
}

async function gemma(prompt: string): Promise<string> {
  const r = await fetch(OLLAMA, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gemma4-chair', prompt, stream: false, think: false, options: { num_predict: 60 } })
  });
  const j = await r.json();
  return (j.response ?? '').trim();
}

line('=== 1. ENQUEUE (5 raw inbound, incl. 2 dups + 1 resolved-by-later) ===');
enqueue({ roomId: ROOM, targetHandle: CHAIR, sourceMessageId: 'm1', text: '@localchair what is the status of the build?' });
enqueue({ roomId: ROOM, targetHandle: CHAIR, sourceMessageId: 'm2', text: '@localchair what is the status of the build?' }); // exact dup
enqueue({ roomId: ROOM, targetHandle: CHAIR, sourceMessageId: 'm3', text: 'status of the build please' }); // near-dup
enqueue({ roomId: ROOM, targetHandle: CHAIR, sourceMessageId: 'm4', text: '@localchair summarise the room in one line' });
enqueue({ roomId: ROOM, targetHandle: CHAIR, sourceMessageId: 'm5', text: 'nvm the build question is resolved, ignore that' }); // resolves the build asks
show('after enqueue');

line('\n=== 2. CURATE (curator triages: dedupe + condense + drop-resolved) ===');
const summary = curate(ROOM, CHAIR);
line(`  curator summary: ${JSON.stringify(summary)}`);
show('after curate');

line('\n=== 3. CAPACITY-GATED PROCESSING (one-in-flight; worker pulls only when free) ===');
let guard = 0;
while (countPending(ROOM, CHAIR) > 0 && guard++ < 10) {
  // worker reports FREE (injected) — in prod this reads agentStateReader
  const item = maybePullForWorker(ROOM, CHAIR, { readWorkerState: () => 'Waiting' });
  if (!item) break;
  line(`  → pulled [${item.id}] ${JSON.stringify(item.curatedText.slice(0, 50))} → status now: ${getItem(item.id)?.status}`);
  // one-in-flight check: a second pull while this is 'working' must return null
  const blocked = maybePullForWorker(ROOM, CHAIR, { readWorkerState: () => 'Waiting' });
  line(`    one-in-flight guard: second pull returned ${blocked === null ? 'null ✓ (worker busy)' : 'AN ITEM ✗ (BUG)'}`);
  const reply = await gemma(`You are @localchair, the room chair. Reply in ONE short sentence.\n\n${item.curatedText}`);
  line(`    🐜 gemma4-chair: ${JSON.stringify(reply.slice(0, 120))}`);
  markDone(item.id);
  line(`    marked done → pending left: ${countPending(ROOM, CHAIR)}`);
}

line('\n=== 4. FINAL STATE ===');
show('final');
line('\n=== DEMO COMPLETE ===');
