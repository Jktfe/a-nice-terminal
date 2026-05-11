// Phase C of server-split-2026-05-11 — focused tests for
// replayPendingBroadcasts. Covers the three load-bearing invariants:
//   - rows replay through runSideEffects and flip to broadcast_state=done
//   - rows older than the retention window (default 24h) are marked
//     'expired', NOT replayed
//   - allowPtyInject is gated on the 30s message-age window
//   - concurrent calls are deduped via the isReplaying flag
//   - asks attached to a message are NOT re-created on replay (Tier 1
//     ownership) — we only re-broadcast the existing rows

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import getDb, { _resetForTest as _resetDbForTest, queries } from '../src/lib/server/db.js';
import { writeMessage } from '../src/lib/persist/index.js';
import {
  replayPendingBroadcasts,
  shouldAllowPtyInject,
  isExpired,
  PTY_INJECT_WINDOW_MS,
  DEFAULT_MAX_AGE_MS,
  _resetForTest as _resetCatchupForTest,
} from '../src/lib/server/processor/catchup.js';

const ROOM_ID = 'catchup-test-room';
const SENDER_ID = 'catchup-test-sender';

let dataDir = '';
let originalDataDir: string | undefined;

function setup() {
  originalDataDir = process.env.ANT_DATA_DIR;
  dataDir = mkdtempSync(join(tmpdir(), 'ant-catchup-'));
  process.env.ANT_DATA_DIR = dataDir;
  _resetDbForTest();
  _resetCatchupForTest();
  queries.createSession(ROOM_ID, 'Catchup Test Room', 'chat', '15m', null, null, '{}');
  queries.createSession(SENDER_ID, 'Sender', 'chat', '15m', null, null, '{}');
}

function teardown() {
  _resetDbForTest();
  _resetCatchupForTest();
  if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
  else process.env.ANT_DATA_DIR = originalDataDir;
  rmSync(dataDir, { recursive: true, force: true });
}

describe('replayPendingBroadcasts — Phase C catch-up loop', () => {
  beforeEach(setup);
  afterEach(() => {
    teardown();
    vi.restoreAllMocks();
  });

  it('replays 3 pending rows and flips them all to broadcast_state=done', async () => {
    for (let i = 0; i < 3; i++) {
      writeMessage({
        sessionId: ROOM_ID,
        role: 'user',
        content: `pending message ${i}`,
        senderId: SENDER_ID,
        source: 'http',
      });
    }
    const pendingBefore: any[] = queries.listPendingBroadcasts(100) as any[];
    expect(pendingBefore.length).toBe(3);

    const replayed = await replayPendingBroadcasts();
    expect(replayed).toBe(3);

    const pendingAfter: any[] = queries.listPendingBroadcasts(100) as any[];
    expect(pendingAfter.length).toBe(0);
  });

  it('marks rows older than maxAgeMs as expired and does NOT replay them', async () => {
    const result = writeMessage({
      sessionId: ROOM_ID,
      role: 'user',
      content: 'stale row',
      senderId: SENDER_ID,
      source: 'http',
    });
    // Backdate the row to two days ago using a raw SQLite UPDATE
    // (no canonical query for setting created_at — test-only path).
    getDb().prepare(`UPDATE messages SET created_at = datetime('now', '-2 days') WHERE id = ?`).run(result.message.id);

    const replayed = await replayPendingBroadcasts(24 * 60 * 60 * 1000);
    expect(replayed).toBe(0);

    const row: any = queries.getMessage(result.message.id);
    expect(row.broadcast_state).toBe('expired');
  });

  it('concurrent replay calls dedupe — only one cycle runs at a time', async () => {
    for (let i = 0; i < 2; i++) {
      writeMessage({
        sessionId: ROOM_ID,
        role: 'user',
        content: `c${i}`,
        senderId: SENDER_ID,
        source: 'http',
      });
    }
    const [a, b] = await Promise.all([
      replayPendingBroadcasts(),
      replayPendingBroadcasts(),
    ]);
    // One of the two saw isReplaying=true and returned 0 immediately;
    // the other did the actual work and returned 2.
    expect(a + b).toBe(2);
    expect([a, b].sort()).toEqual([0, 2]);
  });

  it('does NOT re-create asks on replay — Tier 1 ownership invariant', async () => {
    const result = writeMessage({
      sessionId: ROOM_ID,
      role: 'user',
      content: 'an explicit ask',
      senderId: SENDER_ID,
      asks: ['Pick a vendor for the auth library'],
      source: 'http',
    });
    const askCountBefore = (queries.getAsksByMessage(result.message.id) as any[]).length;
    expect(askCountBefore).toBeGreaterThan(0);

    await replayPendingBroadcasts();

    const askCountAfter = (queries.getAsksByMessage(result.message.id) as any[]).length;
    expect(askCountAfter).toBe(askCountBefore);
  });

  it('does not throw if the pending queue is empty', async () => {
    const replayed = await replayPendingBroadcasts();
    expect(replayed).toBe(0);
  });

});

describe('catchup isReplaying flag is globalThis-backed (AGENTS.md singleton rule)', () => {
  // SvelteKit hot reload and mixed import paths (server.ts boot
  // poller vs the /api/internal/notify-new-message route) can create
  // duplicate module instances. If isReplaying lived as a
  // module-local let, each duplicate would carry its own flag and
  // the poller + the notify endpoint could replay the same pending
  // rows concurrently. The fix is to back the state on globalThis
  // so every importer reads/writes the same object.

  it('stores state on globalThis under the documented key', async () => {
    const mod = await import('../src/lib/server/processor/catchup.js');
    mod._resetForTest();

    const key = '__ant_catchup_state__';
    const state = (globalThis as any)[key];
    expect(state).toBeTruthy();
    expect(typeof state.isReplaying).toBe('boolean');

    // The module's view of the flag IS the global object — same
    // identity, same reads. A second "module copy" (which a hot
    // reload or mixed import path would produce in dev) would read
    // the same object via the same globalThis key.
    state.isReplaying = true;
    expect(mod._isReplayingForTest()).toBe(true);
    state.isReplaying = false;
    expect(mod._isReplayingForTest()).toBe(false);
  });

  it('_resetForTest clears the global state, not a fresh module-local copy', async () => {
    const key = '__ant_catchup_state__';
    (globalThis as any)[key].isReplaying = true;
    expect((globalThis as any)[key].isReplaying).toBe(true);

    const mod = await import('../src/lib/server/processor/catchup.js');
    mod._resetForTest();

    // The reset acted on globalThis, not on a fresh module-local var.
    expect((globalThis as any)[key].isReplaying).toBe(false);
    expect(mod._isReplayingForTest()).toBe(false);
  });
});

describe('catchup helpers — age-window decisions', () => {
  // These are the pure functions catchup.replayPendingBroadcasts
  // delegates to for the two age-driven decisions: "should I let PTY
  // injection happen?" and "should I mark this row expired?". Unit
  // testing them in isolation pins the 30s and 24h thresholds
  // without needing to spy on the live router or backdate messages.

  it('shouldAllowPtyInject returns true for fresh messages and false past the 30s window', () => {
    expect(shouldAllowPtyInject(0)).toBe(true);
    expect(shouldAllowPtyInject(1_000)).toBe(true);
    expect(shouldAllowPtyInject(PTY_INJECT_WINDOW_MS - 1)).toBe(true);
    expect(shouldAllowPtyInject(PTY_INJECT_WINDOW_MS)).toBe(false);
    expect(shouldAllowPtyInject(PTY_INJECT_WINDOW_MS + 1)).toBe(false);
    expect(shouldAllowPtyInject(60_000)).toBe(false);
    expect(shouldAllowPtyInject(6 * 60 * 60 * 1000)).toBe(false);
  });

  it('isExpired returns false inside the retention window and true outside', () => {
    expect(isExpired(0)).toBe(false);
    expect(isExpired(60_000)).toBe(false);
    expect(isExpired(DEFAULT_MAX_AGE_MS - 1)).toBe(false);
    expect(isExpired(DEFAULT_MAX_AGE_MS + 1)).toBe(true);
    expect(isExpired(7 * 24 * 60 * 60 * 1000)).toBe(true);
  });

  it('isExpired respects a custom maxAgeMs argument', () => {
    expect(isExpired(60_000, 30_000)).toBe(true);
    expect(isExpired(60_000, 90_000)).toBe(false);
  });
});
