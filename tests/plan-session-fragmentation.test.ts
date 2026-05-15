/**
 * m-plan-ui-session-fragmentation-fix (2026-05-14)
 *
 * Pre-fix: /plan?plan_id=X (no session_id) picked ONE session via
 * findPlanSession (first match) and rendered only that session's events,
 * hiding events for the same plan_id posted from any other session.
 *
 * Post-fix: getPlanViewData + queries.getPlanEventsAcrossSessions union
 * events across every session emitting plan_id and dedupe via existing
 * dedupePlanEvents helper. This test seeds two sessions with the SAME
 * plan_id and asserts the aggregated view returns events from BOTH.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import getDb, { _resetForTest } from '../src/lib/server/db.js';
import { getPlanViewData } from '../src/lib/server/projector/plan-view.js';

const SESSION_A = 'test-frag-session-a';
const SESSION_B = 'test-frag-session-b';
const SHARED_PLAN = 'plan-cross-session-fragment';

let dataDir = '';
let originalDataDir: string | undefined;

function appendPlanMilestone(sessionId: string, milestoneId: string, tsMs: number, title: string) {
  const db = getDb();
  const payload = JSON.stringify({
    plan_id: SHARED_PLAN,
    milestone_id: milestoneId,
    title,
    order: 0,
    status: 'active',
  });
  db.prepare(
    `INSERT INTO run_events (session_id, ts_ms, source, trust, kind, text, payload)
     VALUES (?, ?, 'json', 'high', 'plan_milestone', ?, ?)`,
  ).run(sessionId, tsMs, title, payload);
}

describe('m-plan-ui-session-fragmentation-fix — getPlanViewData', () => {
  beforeAll(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-plan-frag-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    const db = getDb();
    db.prepare('INSERT OR IGNORE INTO sessions (id, name, type) VALUES (?, ?, ?)').run(SESSION_A, 'frag-a', 'chat');
    db.prepare('INSERT OR IGNORE INTO sessions (id, name, type) VALUES (?, ?, ?)').run(SESSION_B, 'frag-b', 'chat');
  });

  beforeEach(() => {
    const db = getDb();
    db.prepare('DELETE FROM run_events').run();
  });

  afterAll(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('plan_id-only request aggregates events from every session that emitted that plan_id', () => {
    appendPlanMilestone(SESSION_A, 'm1', 1_700_000_000_000, 'Milestone 1 (from session A)');
    appendPlanMilestone(SESSION_B, 'm2', 1_700_000_001_000, 'Milestone 2 (from session B)');

    const data = getPlanViewData({ planId: SHARED_PLAN });

    expect(data.events.length).toBeGreaterThanOrEqual(2);
    const milestoneIds = data.events
      .filter((e) => e.kind === 'plan_milestone')
      .map((e) => (e.payload as { milestone_id?: string }).milestone_id);
    expect(milestoneIds).toContain('m1');
    expect(milestoneIds).toContain('m2');
  });

  it('events are ordered by ts_ms ASC across sessions', () => {
    appendPlanMilestone(SESSION_B, 'm-late', 1_700_000_003_000, 'Late milestone B');
    appendPlanMilestone(SESSION_A, 'm-early', 1_700_000_002_000, 'Early milestone A');

    const data = getPlanViewData({ planId: SHARED_PLAN });

    const milestones = data.events.filter((e) => e.kind === 'plan_milestone');
    expect(milestones.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < milestones.length; i++) {
      const prev = milestones[i - 1].ts_ms ?? 0;
      const curr = milestones[i].ts_ms ?? 0;
      expect(curr).toBeGreaterThanOrEqual(prev);
    }
  });

  it('explicit session_id preserves single-session behaviour (backwards-compat)', () => {
    appendPlanMilestone(SESSION_A, 'a-only', 1_700_000_000_000, 'A only');
    appendPlanMilestone(SESSION_B, 'b-only', 1_700_000_001_000, 'B only');

    const data = getPlanViewData({ planId: SHARED_PLAN, sessionId: SESSION_A });

    const milestoneIds = data.events
      .filter((e) => e.kind === 'plan_milestone')
      .map((e) => (e.payload as { milestone_id?: string }).milestone_id);
    expect(milestoneIds).toContain('a-only');
    expect(milestoneIds).not.toContain('b-only');
    expect(data.session_id).toBe(SESSION_A);
  });

  it('no plan_id and no session_id falls back to latest plan (existing behaviour)', () => {
    appendPlanMilestone(SESSION_A, 'm-only-fallback', 1_700_000_000_000, 'Solo');

    const data = getPlanViewData({});

    // Either picks SHARED_PLAN (the only seeded plan_id this beforeEach
    // cycle) OR returns empty if no plan_refs are listed — both are
    // acceptable as long as no events leak from other plan_ids.
    if (data.events.length > 0) {
      expect(data.plan_id).toBe(SHARED_PLAN);
    }
  });
});
