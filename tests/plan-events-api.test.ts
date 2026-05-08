// B.4 / D.11 — POST + PATCH endpoints for plan_* run_events.
//
// These exercise appendAndBroadcastPlanEvent indirectly via the route
// handlers. The WS broadcast is best-effort and silently no-ops when no
// clients are connected, so the assertions here cover the durable side
// (run_events row landed, projector picks it up) and the validation gates.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import getDb, { _resetForTest, queries } from '../src/lib/server/db.js';
import { POST as createEvent } from '../src/routes/api/plan/events/+server';
import { PATCH as patchEvent } from '../src/routes/api/plan/events/[id]/+server';
import { getPlanViewData } from '../src/lib/server/projector/plan-view.js';

const TEST_SESSION = 'test-session-plan-events-api';
const TEST_PLAN = 'plan-events-api';
let dataDir = '';
let originalDataDir: string | undefined;

type PostArgs = Parameters<typeof createEvent>[0];
type PatchArgs = Parameters<typeof patchEvent>[0];

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/plan/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function postEvent(body: unknown) {
  return createEvent({
    request: makeRequest(body),
    locals: {},
  } as unknown as PostArgs);
}

function patchById(id: string, body: unknown) {
  return patchEvent({
    request: new Request(`http://localhost/api/plan/events/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    locals: {},
    params: { id },
  } as unknown as PatchArgs);
}

describe('/api/plan/events POST + PATCH', () => {
  beforeAll(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-plan-events-api-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    const db = getDb();
    db.prepare('INSERT OR IGNORE INTO sessions (id, name, type) VALUES (?, ?, ?)').run(
      TEST_SESSION,
      'Plan events API',
      'chat',
    );
    db.prepare('DELETE FROM run_events WHERE session_id = ?').run(TEST_SESSION);
  });

  afterAll(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('rejects unknown plan kinds with 400', async () => {
    const res = await postEvent({
      session_id: TEST_SESSION,
      kind: 'plan_bogus',
      payload: { plan_id: TEST_PLAN, title: 'x', order: 1 },
    });
    expect(res.status).toBe(400);
  });

  it('rejects payloads that fail validation', async () => {
    const res = await postEvent({
      session_id: TEST_SESSION,
      kind: 'plan_section',
      payload: { plan_id: TEST_PLAN, title: '', order: 'no' },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.details?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects unknown sessions with 404', async () => {
    const res = await postEvent({
      session_id: 'non-existent-session',
      kind: 'plan_section',
      payload: { plan_id: TEST_PLAN, title: 'x', order: 1 },
    });
    expect(res.status).toBe(404);
  });

  it('appends a plan_section visible to the projector', async () => {
    const res = await postEvent({
      session_id: TEST_SESSION,
      kind: 'plan_section',
      payload: {
        plan_id: TEST_PLAN,
        title: 'Section Alpha',
        order: 1,
        acceptance_id: 'sec-alpha',
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { event: { id: string; kind: string } };
    expect(body.event.kind).toBe('plan_section');
    expect(body.event.id).toBeTruthy();

    const view = getPlanViewData({ sessionId: TEST_SESSION, planId: TEST_PLAN });
    expect(view.events.some((e) => e.payload.title === 'Section Alpha')).toBe(true);
  });

  it('PATCH renames an event by appending a fresh row with the same identity', async () => {
    // Seed
    const seed = await postEvent({
      session_id: TEST_SESSION,
      kind: 'plan_milestone',
      payload: {
        plan_id: TEST_PLAN,
        title: 'Original title',
        order: 1,
        milestone_id: 'm-rename',
        status: 'planned',
      },
    });
    const seedBody = (await seed.json()) as { event: { id: string } };
    const eventId = seedBody.event.id;

    const res = await patchById(eventId, { title: 'Renamed title' });
    expect(res.status).toBe(200);

    const view = getPlanViewData({ sessionId: TEST_SESSION, planId: TEST_PLAN });
    const milestone = view.events.find(
      (e) => e.payload.milestone_id === 'm-rename',
    );
    expect(milestone?.payload.title).toBe('Renamed title');
  });

  it('PATCH done:true flips status to done; done:false flips to planned', async () => {
    // Seed
    const seed = await postEvent({
      session_id: TEST_SESSION,
      kind: 'plan_milestone',
      payload: {
        plan_id: TEST_PLAN,
        title: 'Toggle me',
        order: 2,
        milestone_id: 'm-toggle',
        status: 'planned',
      },
    });
    const seedBody = (await seed.json()) as { event: { id: string } };
    const id = seedBody.event.id;

    const r1 = await patchById(id, { done: true });
    expect(r1.status).toBe(200);
    const view1 = getPlanViewData({ sessionId: TEST_SESSION, planId: TEST_PLAN });
    expect(
      view1.events.find((e) => e.payload.milestone_id === 'm-toggle')?.payload.status,
    ).toBe('done');

    const r2 = await patchById(id, { done: false });
    expect(r2.status).toBe(200);
    const view2 = getPlanViewData({ sessionId: TEST_SESSION, planId: TEST_PLAN });
    expect(
      view2.events.find((e) => e.payload.milestone_id === 'm-toggle')?.payload.status,
    ).toBe('planned');
  });

  it('PATCH 404s for missing event ids', async () => {
    const res = await patchById('99999999', { title: 'nope' });
    expect(res.status).toBe(404);
  });

  it('PATCH rejects empty bodies with 400', async () => {
    const seed = await postEvent({
      session_id: TEST_SESSION,
      kind: 'plan_decision',
      payload: {
        plan_id: TEST_PLAN,
        title: 'Decision A',
        order: 1,
        parent_id: 'sec-alpha',
      },
    });
    const id = ((await seed.json()) as { event: { id: string } }).event.id;
    const res = await patchById(id, { unrelated_field: 'ignored' });
    expect(res.status).toBe(400);
  });

  it('rejects requests without session_id', async () => {
    const res = await postEvent({
      kind: 'plan_section',
      payload: { plan_id: TEST_PLAN, title: 'x', order: 1 },
    });
    expect(res.status).toBe(400);
  });
});
