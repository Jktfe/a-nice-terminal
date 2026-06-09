import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests } from './db';
import { enqueue, listQueue, getItem, type QueueItem } from './messageQueueStore';
import { curate, normaliseForDup, similarity, defaultCondense } from './queueCurator';

let tmpDir: string;
const prevDb = process.env.ANT_FRESH_DB_PATH;
const prevVault = process.env.ANT_MEMORY_VAULT_PATH;

const ROOM = 'room_test';
const CHAIR = '@localchair';

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-curator-'));
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

/** Seed a pending item; `now` controls created_at_ms AND default priority (FIFO). */
function seed(text: string, opts: { sourceMessageId?: string; now?: number } = {}): QueueItem {
  return enqueue(
    {
      roomId: ROOM,
      targetHandle: CHAIR,
      text,
      kind: 'mention',
      sourceMessageId: opts.sourceMessageId ?? null
    },
    opts.now ?? Date.now()
  );
}

function pending() {
  return listQueue(ROOM, CHAIR, { status: 'pending' });
}

describe('queueCurator — pure helpers (model-free)', () => {
  it('normaliseForDup lowercases, strips leading @mentions + punctuation, collapses whitespace', () => {
    expect(normaliseForDup('@localchair  Fix   the BUILD!')).toBe('fix the build');
    expect(normaliseForDup('@a @b: hello   world')).toBe('hello world');
    expect(normaliseForDup('...Done.')).toBe('done');
  });

  it('similarity is order-independent token-set Jaccard', () => {
    expect(similarity('fix the build', 'fix the build')).toBe(1);
    expect(similarity('fix the build', 'build the fix')).toBe(1);
    expect(similarity('fix the build', 'totally unrelated text')).toBeLessThan(0.2);
  });

  it('defaultCondense collapses whitespace and caps length with an ellipsis', () => {
    expect(defaultCondense('a   b\n\n c')).toBe('a b c');
    const long = 'word '.repeat(300); // 1500 chars
    const out = defaultCondense(long, 100);
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('queueCurator.curate — dedupe/coalesce', () => {
  it('coalesces exact-after-normalise duplicates into the earliest, keeping earliest', () => {
    const a = seed('@localchair Fix the build', { sourceMessageId: 'm1', now: 1000 });
    const b = seed('fix the BUILD!!!', { sourceMessageId: 'm2', now: 2000 });

    const summary = curate(ROOM, CHAIR);

    expect(summary.coalesced).toBe(1);
    expect(summary.remaining).toBe(1);

    const left = pending();
    expect(left).toHaveLength(1);
    expect(left[0].id).toBe(a.id); // earliest kept
    // source ids merged onto the keeper
    expect(left[0].sourceMessageIds.sort()).toEqual(['m1', 'm2']);

    // later dup is dropped, not pending
    expect(getItem(b.id)?.status).toBe('dropped');
  });

  it('coalesces near-duplicates (>= ~0.9 similarity)', () => {
    const a = seed('please review the deploy plan for the chair', { now: 1000 });
    // same tokens, reordered + extra punctuation/mention → high Jaccard
    seed('@localchair please review the deploy plan for the chair!', { now: 2000 });

    const summary = curate(ROOM, CHAIR);

    expect(summary.coalesced).toBe(1);
    expect(summary.remaining).toBe(1);
    expect(pending()[0].id).toBe(a.id);
  });

  it('does NOT coalesce genuinely different items', () => {
    seed('fix the build', { now: 1000 });
    seed('write the release notes', { now: 2000 });

    const summary = curate(ROOM, CHAIR);

    expect(summary.coalesced).toBe(0);
    expect(summary.remaining).toBe(2);
  });
});

describe('queueCurator.curate — condense', () => {
  it('condenses via the default rule (length cap + ellipsis)', () => {
    const long = 'token '.repeat(400); // 2400 chars
    const item = seed(long, { now: 1000 });

    const summary = curate(ROOM, CHAIR);

    expect(summary.condensed).toBe(1);
    const after = getItem(item.id);
    expect(after!.curatedText.length).toBeLessThanOrEqual(600);
    expect(after!.curatedText.endsWith('…')).toBe(true);
  });

  it('uses an INJECTED condenseFn instead of the default (still model-free)', () => {
    const item = seed('the original long-ish text that the curator will rewrite', { now: 1000 });
    let called = 0;
    const condenseFn = (t: string) => {
      called++;
      return `CONDENSED(${t.length})`;
    };

    const summary = curate(ROOM, CHAIR, { condenseFn });

    expect(called).toBe(1);
    expect(summary.condensed).toBe(1);
    expect(getItem(item.id)!.curatedText).toMatch(/^CONDENSED\(\d+\)$/);
  });

  it('does not count a no-op condense (text already minimal)', () => {
    seed('short', { now: 1000 });
    const summary = curate(ROOM, CHAIR);
    expect(summary.condensed).toBe(0);
  });
});

describe('queueCurator.curate — drop-resolved (conservative)', () => {
  it('drops an earlier item when a later one resolves it via shared thread + marker', () => {
    const ask = seed('can someone restart the deploy?', { sourceMessageId: 'thread1', now: 1000 });
    const resolve = seed('nvm, restarted it myself — done', { sourceMessageId: 'thread1', now: 2000 });

    const summary = curate(ROOM, CHAIR);

    expect(summary.dropped).toBe(1);
    expect(getItem(ask.id)?.status).toBe('dropped');
    // the resolving item stays pending
    expect(getItem(resolve.id)?.status).toBe('pending');
  });

  it('drops an earlier item when a later one resolves it via near-identical subject + marker', () => {
    const ask = seed('the staging database migration is failing', { now: 1000 });
    const resolve = seed('the staging database migration is failing — resolved now', { now: 2000 });

    const summary = curate(ROOM, CHAIR);

    expect(summary.dropped).toBe(1);
    expect(getItem(ask.id)?.status).toBe('dropped');
  });

  it('NEGATIVE: does NOT drop on a bare resolution marker with no thread/subject link', () => {
    seed('the staging database migration is failing', { now: 1000 });
    // marker present but about a totally unrelated topic + different thread
    seed('the quarterly report is done', { sourceMessageId: 'other', now: 2000 });

    const summary = curate(ROOM, CHAIR);

    expect(summary.dropped).toBe(0);
    expect(summary.remaining).toBe(2);
  });

  it('NEGATIVE: does NOT drop when same thread but NO resolution marker', () => {
    seed('please look at the build', { sourceMessageId: 'thread9', now: 1000 });
    seed('and also check the lint config', { sourceMessageId: 'thread9', now: 2000 });

    const summary = curate(ROOM, CHAIR);

    expect(summary.dropped).toBe(0);
    expect(summary.remaining).toBe(2);
  });
});

describe('queueCurator.curate — summary counts', () => {
  it('reports coalesced + dropped + condensed + remaining together', () => {
    // dup pair (one coalesce)
    seed('refactor the auth gate', { now: 1000 });
    seed('@chair refactor the auth gate!', { now: 1100 });
    // resolved pair (one drop) on a shared thread
    seed('can you bump the version number?', { sourceMessageId: 't', now: 2000 });
    seed('done, bumped the version number', { sourceMessageId: 't', now: 2100 });
    // a long standalone item (one condense)
    seed('x '.repeat(400), { now: 3000 });

    const summary = curate(ROOM, CHAIR);

    expect(summary.coalesced).toBe(1);
    expect(summary.dropped).toBe(1);
    expect(summary.condensed).toBeGreaterThanOrEqual(1);
    // started 5 pending: -1 coalesced, -1 dropped = 3 remaining
    expect(summary.remaining).toBe(3);
    expect(pending()).toHaveLength(3);
  });
});

describe("queueCurator — mode 'off' (JWPK \"or not parse, it's a choice\")", () => {
  it('is a no-op: no coalesce/drop/condense, every item left raw', () => {
    // A dup pair, a resolved pair, and a long item — all of which the
    // default 'parse' mode would touch.
    seed('refactor the auth gate', { now: 1000 });
    seed('@chair refactor the auth gate!', { now: 1100 });
    seed('can you bump the version number?', { sourceMessageId: 't', now: 2000 });
    seed('done, bumped the version number', { sourceMessageId: 't', now: 2100 });
    const long = 'x '.repeat(400);
    seed(long, { now: 3000 });

    const summary = curate(ROOM, CHAIR, { mode: 'off' });

    expect(summary).toEqual({ coalesced: 0, condensed: 0, dropped: 0, remaining: 5 });
    // all five survive untouched, including the long one (no condense)
    const items = pending();
    expect(items).toHaveLength(5);
    expect(items.some((i) => i.curatedText === long)).toBe(true);
  });

  it("'parse' is the default and DOES curate the same seed (control)", () => {
    seed('refactor the auth gate', { now: 1000 });
    seed('@chair refactor the auth gate!', { now: 1100 });

    // mode omitted → default parse → the near-dup pair coalesces.
    const summary = curate(ROOM, CHAIR);
    expect(summary.coalesced).toBe(1);
    expect(pending()).toHaveLength(1);
  });

  it('mode off reports the true pending depth (does not hide the queue)', () => {
    seed('one', { now: 1000 });
    seed('two', { now: 2000 });
    seed('three', { now: 3000 });
    expect(curate(ROOM, CHAIR, { mode: 'off' }).remaining).toBe(3);
  });
});
