import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import getDb, { _resetForTest, queries } from '../src/lib/server/db.js';
import {
  validatePlanPayload,
  validatePlanPayloadString,
  PLAN_EVENT_KINDS,
  type PlanEventPayload,
} from '../src/lib/server/projector/types.js';
import {
  resolveProvenance,
  resolveAllProvenance,
  type ResolveContext,
} from '../src/lib/server/projector/provenance-resolver.js';
import {
  getPlanViewData,
  listPlanRefs,
} from '../src/lib/server/projector/plan-view.js';

const TEST_SESSION = 'test-session-plan-projector';
const TEST_PLAN = 'plan-m35-smoke';
let dataDir = '';
let originalDataDir: string | undefined;

function seedPayload(kind: string, overrides?: Partial<PlanEventPayload>): string {
  const base: PlanEventPayload = {
    plan_id: TEST_PLAN,
    title: 'Smoke test title',
    order: 1,
    ...overrides,
  };
  return JSON.stringify(base);
}

describe('plan-projector first-patch gate', () => {
  beforeAll(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-plan-projector-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    // Ensure DB is initialized and seed test session in an isolated test DB.
    const db = getDb();
    db.prepare('INSERT OR IGNORE INTO sessions (id, name, type) VALUES (?, ?, ?)').run(TEST_SESSION, 'test-plan-session', 'chat');
  });

  afterAll(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('validates a correct §6.5 payload', () => {
    const payload: PlanEventPayload = {
      plan_id: TEST_PLAN,
      title: 'Section 1',
      order: 0,
      status: 'active',
      owner: '@cloud-kimi',
      evidence: [{ kind: 'run_event', ref: '42', label: 'R1 decision' }],
      provenance: [{ run_event_id: '7', fallback: { source: 'tmux', query: 'decision' } }],
    };
    const result = validatePlanPayload(payload);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.plan_id).toBe(TEST_PLAN);
      expect(result.value.status).toBe('active');
    }
  });

  it('rejects a malformed payload with detailed errors', () => {
    const result = validatePlanPayload({
      plan_id: '',
      title: '',
      order: 'not-a-number',
      status: 'invalid-status',
    } as unknown as PlanEventPayload);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain('plan_id must be a non-empty string');
      expect(result.errors).toContain('title must be a non-empty string');
      expect(result.errors).toContain('order must be a finite number');
      expect(result.errors).toContain('status must be one of planned, active, blocked, archived, passing, failing, done');
    }
  });

  it('rejects unknown evidence kinds', () => {
    const result = validatePlanPayload({
      plan_id: TEST_PLAN,
      title: 'Bad evidence',
      order: 1,
      evidence: [{ kind: 'unknown', ref: 'abc' }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain('evidence contains invalid entries');
    }
  });

  it('validates payload from a JSON string', () => {
    const valid = JSON.stringify({ plan_id: TEST_PLAN, title: 'Test', order: 1 });
    const result = validatePlanPayloadString(valid);
    expect(result.ok).toBe(true);

    const invalid = 'not json {';
    const result2 = validatePlanPayloadString(invalid);
    expect(result2.ok).toBe(false);
    if (!result2.ok) {
      expect(result2.errors).toContain('payload is not valid JSON');
    }
  });

  it('validates archived as a first-class plan status', () => {
    const result = validatePlanPayload({
      plan_id: TEST_PLAN,
      title: 'Archived section',
      order: 1,
      status: 'archived',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe('archived');
  });

  it('inserts and retrieves plan events via getPlanEvents (db helper)', () => {
    // Insert a plan_section event
    const payload = seedPayload('plan_section', {
      title: 'M3.5 Architecture',
      order: 0,
      body: 'Top-level section frame.',
    });
    const event = queries.appendRunEvent(
      TEST_SESSION,
      Date.now(),
      'json',
      'high',
      'plan_section',
      'M3.5 Architecture',
      payload,
      null,
    );
    expect(event).toBeDefined();
    expect(event.kind).toBe('plan_section');

    // Insert a plan_milestone event
    const msPayload = seedPayload('plan_milestone', {
      title: 'Milestone 1: Types + Validator',
      order: 1,
      status: 'done',
      owner: '@cloud-kimi',
    });
    const msEvent = queries.appendRunEvent(
      TEST_SESSION,
      Date.now() + 1,
      'json',
      'high',
      'plan_milestone',
      'Milestone 1: Types + Validator',
      msPayload,
      null,
    );
    expect(msEvent).toBeDefined();

    // Query via getPlanEvents
    const rows = queries.getPlanEvents(
      TEST_SESSION,
      TEST_PLAN,
      [...PLAN_EVENT_KINDS],
      10,
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);

    // Validate payloads from DB
    for (const row of rows) {
      const parsed = JSON.parse(row.payload);
      const validated = validatePlanPayload(parsed);
      expect(validated.ok).toBe(true);
      if (validated.ok) {
        expect(validated.value.plan_id).toBe(TEST_PLAN);
      }
    }

    // Order check: first row should be section (order 0), second milestone (order 1)
    const ordered = rows.slice().sort((a: any, b: any) => a.ts_ms - b.ts_ms);
    expect(ordered[0].kind).toBe('plan_section');
    expect(ordered[1].kind).toBe('plan_milestone');
  });

  it('hydrates Plan View data from live plan_* run_events', () => {
    const livePlan = 'plan-live-route-smoke';
    queries.appendRunEvent(
      TEST_SESSION,
      Date.now() + 10,
      'json',
      'high',
      'plan_section',
      'Live plan section',
      seedPayload('plan_section', {
        plan_id: livePlan,
        title: 'Live plan section',
        order: 0,
      }),
      null,
    );

    const refs = listPlanRefs(20);
    expect(refs.some((r) => r.session_id === TEST_SESSION && r.plan_id === livePlan)).toBe(true);

    const data = getPlanViewData({
      sessionId: TEST_SESSION,
      planId: livePlan,
      limit: 20,
    });
    expect(data.source).toBe('live');
    expect(data.session_id).toBe(TEST_SESSION);
    expect(data.plan_id).toBe(livePlan);
    expect(data.events).toHaveLength(1);
    expect(data.events[0].kind).toBe('plan_section');
    expect(data.events[0].payload.title).toBe('Live plan section');
  });

  it('hydrates tasks linked to the selected plan for Plan View rendering', () => {
    const livePlan = 'plan-task-link-smoke';
    queries.appendRunEvent(
      TEST_SESSION,
      Date.now() + 20,
      'json',
      'high',
      'plan_section',
      'Task-linked plan section',
      seedPayload('plan_section', {
        plan_id: livePlan,
        title: 'Task-linked plan section',
        order: 0,
      }),
      null,
    );
    queries.appendRunEvent(
      TEST_SESSION,
      Date.now() + 21,
      'json',
      'high',
      'plan_milestone',
      'Task-linked milestone',
      seedPayload('plan_milestone', {
        plan_id: livePlan,
        title: 'Task-linked milestone',
        order: 1,
        milestone_id: 'm2-task-plan-link',
      }),
      null,
    );
    queries.createTask(
      'linked-task-1',
      TEST_SESSION,
      '@evolveantcodex',
      'Wire task plan metadata',
      null,
      {
        createdSource: 'cli',
        planId: livePlan,
        milestoneId: 'm2-task-plan-link',
      },
    );

    const data = getPlanViewData({
      sessionId: TEST_SESSION,
      planId: livePlan,
      limit: 20,
    });

    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0]).toMatchObject({
      id: 'linked-task-1',
      title: 'Wire task plan metadata',
      created_by: '@evolveantcodex',
      created_source: 'cli',
      plan_id: livePlan,
      milestone_id: 'm2-task-plan-link',
    });
  });

  it('hides archived plan refs by default while preserving direct access', () => {
    const livePlan = 'plan-live-visible';
    const archivedPlan = 'plan-archived-hidden';
    queries.appendRunEvent(
      TEST_SESSION,
      Date.now() + 30,
      'json',
      'high',
      'plan_section',
      'Visible section',
      seedPayload('plan_section', {
        plan_id: livePlan,
        title: 'Visible section',
        order: 0,
      }),
      null,
    );
    queries.appendRunEvent(
      TEST_SESSION,
      Date.now() + 31,
      'json',
      'high',
      'plan_section',
      'Archived section',
      seedPayload('plan_section', {
        plan_id: archivedPlan,
        title: 'Archived section',
        order: 0,
        status: 'archived',
      }),
      null,
    );

    const visibleRefs = listPlanRefs(50);
    expect(visibleRefs.some((r) => r.plan_id === livePlan)).toBe(true);
    expect(visibleRefs.some((r) => r.plan_id === archivedPlan)).toBe(false);

    const allRefs = listPlanRefs(50, { includeArchived: true });
    expect(allRefs.find((r) => r.plan_id === archivedPlan)?.archived).toBe(true);

    const direct = getPlanViewData({
      sessionId: TEST_SESSION,
      planId: archivedPlan,
      limit: 20,
    });
    expect(direct.source).toBe('live');
    expect(direct.archived).toBe(true);
    expect(direct.events.some((e) => e.payload.status === 'archived')).toBe(true);
  });

  it('resolves provenance exact → fallback → degraded ladder', () => {
    const fakeCtx: ResolveContext = {
      sessionId: TEST_SESSION,
      getRunEventById: (id) =>
        id === 42
          ? { id: 42, ts_ms: 1, source: 'json', kind: 'plan_decision', text: 'Exact hit' }
          : undefined,
      queryRunEvents: (opts) =>
        opts.textLike === 'fallback-query'
          ? [{ id: 99, ts_ms: 2, source: 'json', kind: 'plan_decision', text: 'Fallback hit' }]
          : [],
    };

    // Exact
    const exact = resolveProvenance({ run_event_id: '42' }, fakeCtx);
    expect(exact.kind).toBe('exact');
    expect(exact.label).toBe('Exact hit');
    expect(exact.href).toBe('#run-event-42');

    // Fallback
    const fallback = resolveProvenance(
      { fallback: { source: 'json', query: 'fallback-query' } },
      fakeCtx,
    );
    expect(fallback.kind).toBe('fallback');
    expect(fallback.label).toContain('Fallback hit');
    expect(fallback.warning).toBeDefined();

    // Degraded
    const degraded = resolveProvenance({}, fakeCtx);
    expect(degraded.kind).toBe('degraded');
    expect(degraded.warning).toContain('⚠');
    expect(degraded.warning).toContain('missing');
  });

  it('never silently drops provenance in resolveAllProvenance', () => {
    const fakeCtx: ResolveContext = {
      sessionId: TEST_SESSION,
      getRunEventById: () => undefined,
      queryRunEvents: () => [],
    };

    const refs = [
      { run_event_id: '999' },
      { fallback: { source: 'json', author: '@nobody' } },
      {},
    ];

    const resolved = resolveAllProvenance(refs, fakeCtx);
    expect(resolved.length).toBe(3);
    expect(resolved[0].kind).toBe('degraded');
    expect(resolved[1].kind).toBe('degraded');
    expect(resolved[2].kind).toBe('degraded');
    expect(resolved.every((r) => r.warning && r.warning.includes('⚠'))).toBe(true);
  });
});
