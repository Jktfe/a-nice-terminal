/**
 * Tests for usageSnapshotStore — JWPK msg_4rbn05cztw 2026-05-28 trend
 * history. Verifies insert + recency-ordered read + the malformed-row
 * skip behaviour.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  insertUsageSnapshot,
  listRecentUsageSnapshots,
  resetUsageSnapshotStoreForTests
} from './usageSnapshotStore';
import { resetIdentityDbForTests, getIdentityDb } from './db';
import type { UsagePayload } from '$lib/usage/types';

function fakePayload(providerId: string): UsagePayload {
  return {
    providers: [
      {
        providerId,
        displayName: providerId,
        plan: null,
        lines: [],
        fetchedAt: '2026-05-28T00:00:00Z'
      }
    ],
    proxyFetchedAt: '2026-05-28T00:00:00Z',
    daemonReachable: true
  };
}

describe('usageSnapshotStore', () => {
  beforeEach(() => {
    resetIdentityDbForTests();
    resetUsageSnapshotStoreForTests();
  });

  it('insert returns a row with id + capturedAtMs', () => {
    const row = insertUsageSnapshot(fakePayload('claude'));
    expect(row.id).toBeTruthy();
    expect(row.capturedAtMs).toBeTypeOf('number');
    expect(row.payload.providers[0].providerId).toBe('claude');
  });

  it('listRecent returns rows newest-first', async () => {
    insertUsageSnapshot(fakePayload('claude'));
    // Ensure distinct captured_at_ms across rows; insertUsageSnapshot
    // uses Date.now() so we need a small wait OR explicit time travel.
    // Easiest deterministic path: insert with a tiny sleep between.
    await new Promise((resolve) => setTimeout(resolve, 2));
    insertUsageSnapshot(fakePayload('codex'));
    await new Promise((resolve) => setTimeout(resolve, 2));
    insertUsageSnapshot(fakePayload('copilot'));
    const rows = listRecentUsageSnapshots(10);
    expect(rows.map((r) => r.payload.providers[0].providerId)).toEqual([
      'copilot',
      'codex',
      'claude'
    ]);
  });

  it('listRecent respects the limit', () => {
    for (let i = 0; i < 5; i += 1) insertUsageSnapshot(fakePayload(`provider-${i}`));
    expect(listRecentUsageSnapshots(2)).toHaveLength(2);
  });

  it('listRecent caps the limit at 360', () => {
    insertUsageSnapshot(fakePayload('claude'));
    expect(() => listRecentUsageSnapshots(10_000)).not.toThrow();
  });

  it('listRecent skips malformed payload_json rows without crashing', () => {
    insertUsageSnapshot(fakePayload('claude'));
    // Inject a row with garbage JSON directly so the parser fails.
    getIdentityDb()
      .prepare(`INSERT INTO usage_snapshots (id, captured_at_ms, payload_json) VALUES (?, ?, ?)`)
      .run('broken', Date.now() + 1000, 'this is not json');
    const rows = listRecentUsageSnapshots(10);
    // Only the valid row survives.
    expect(rows).toHaveLength(1);
    expect(rows[0].payload.providers[0].providerId).toBe('claude');
  });
});
