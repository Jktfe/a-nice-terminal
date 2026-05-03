import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import getDb, { queries } from '../src/lib/server/db.js';
import { GET } from '../src/routes/api/plan/+server.js';

const TEST_SESSION = 'test-session-plan-live-api';
const OTHER_SESSION = 'test-session-plan-live-api-other';
const TEST_PLAN = 'ant-r4';

function planPayload(overrides: Record<string, unknown>) {
  return JSON.stringify({
    plan_id: TEST_PLAN,
    title: 'Live plan event',
    order: 1,
    ...overrides,
  });
}

async function jsonFrom(response: Response) {
  return response.json() as Promise<{
    session_id: string | null;
    plan_id: string;
    limit: number;
    count: number;
    events: Array<{
      id: string;
      session_id: string;
      ts: number;
      ts_ms: number;
      source: string;
      trust: string;
      kind: string;
      text: string;
      payload: Record<string, unknown>;
      raw_ref: string | null;
      created_at: string | null;
    }>;
    errors: Array<{ id: string; kind: string; errors: string[] }>;
  }>;
}

describe('/api/plan live route', () => {
  beforeAll(() => {
    const db = getDb();
    db.prepare('INSERT OR IGNORE INTO sessions (id, name, type) VALUES (?, ?, ?)').run(TEST_SESSION, 'Plan live API', 'chat');
    db.prepare('INSERT OR IGNORE INTO sessions (id, name, type) VALUES (?, ?, ?)').run(OTHER_SESSION, 'Plan live API other', 'chat');
    db.prepare('DELETE FROM run_events WHERE session_id IN (?, ?)').run(TEST_SESSION, OTHER_SESSION);
  });

  afterAll(() => {
    const db = getDb();
    db.prepare('DELETE FROM run_events WHERE session_id IN (?, ?)').run(TEST_SESSION, OTHER_SESSION);
  });

  it('returns validated plan_* events in PlanView-compatible shape', async () => {
    queries.appendRunEvent(
      TEST_SESSION,
      1_710_000_000_001,
      'json',
      'high',
      'plan_section',
      'Section',
      planPayload({ title: 'Section', order: 1 }),
      'raw-ref-1',
    );
    queries.appendRunEvent(
      TEST_SESSION,
      1_710_000_000_002,
      'json',
      'high',
      'plan_test',
      'Test',
      planPayload({ title: 'Test', order: 2, milestone_id: 'M1', status: 'passing' }),
      null,
    );

    const response = GET({
      url: new URL(`http://localhost/api/plan?session_id=${TEST_SESSION}&plan_id=${TEST_PLAN}`),
    } as Parameters<typeof GET>[0]);
    const body = await jsonFrom(response);

    expect(body).toMatchObject({
      session_id: TEST_SESSION,
      plan_id: TEST_PLAN,
      limit: 1000,
      count: 2,
      errors: [],
    });
    expect(body.events.map((event) => event.kind)).toEqual(['plan_section', 'plan_test']);
    expect(body.events[0]).toMatchObject({
      id: expect.any(String),
      session_id: TEST_SESSION,
      ts: 1_710_000_000_001,
      ts_ms: 1_710_000_000_001,
      source: 'json',
      trust: 'high',
      kind: 'plan_section',
      text: 'Section',
      payload: { plan_id: TEST_PLAN, title: 'Section', order: 1 },
      raw_ref: 'raw-ref-1',
    });
  });

  it('auto-discovers a session with the requested plan when session_id is omitted', async () => {
    queries.appendRunEvent(
      OTHER_SESSION,
      1_710_000_000_010,
      'json',
      'high',
      'plan_milestone',
      'Other session milestone',
      planPayload({ title: 'Other session milestone', order: 1, status: 'active' }),
      null,
    );

    const response = GET({
      url: new URL(`http://localhost/api/plan?plan_id=${TEST_PLAN}&limit=1`),
    } as Parameters<typeof GET>[0]);
    const body = await jsonFrom(response);

    expect(body.session_id).toBeTruthy();
    expect(body.plan_id).toBe(TEST_PLAN);
    expect(body.count).toBeGreaterThanOrEqual(1);
    expect(body.events.every((event) => event.payload.plan_id === TEST_PLAN)).toBe(true);
  });

  it('reports invalid plan payloads instead of silently returning malformed events', async () => {
    queries.appendRunEvent(
      TEST_SESSION,
      1_710_000_000_020,
      'json',
      'high',
      'plan_section',
      'Malformed',
      JSON.stringify({ plan_id: TEST_PLAN, title: '', order: 'bad' }),
      null,
    );

    const response = GET({
      url: new URL(`http://localhost/api/plan?session_id=${TEST_SESSION}&plan_id=${TEST_PLAN}`),
    } as Parameters<typeof GET>[0]);
    const body = await jsonFrom(response);

    expect(body.errors.length).toBeGreaterThanOrEqual(1);
    expect(body.errors.at(-1)?.errors).toContain('title must be a non-empty string');
    expect(body.errors.at(-1)?.errors).toContain('order must be a finite number');
    expect(body.events.every((event) => event.payload.title !== '')).toBe(true);
  });
});
