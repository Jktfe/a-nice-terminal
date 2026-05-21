import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests } from '$lib/server/db';
import { createTask } from '$lib/server/taskStore';
import { GET } from './+server';

let tmpDir: string;
const prevDbPath = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-plan-cockpit-route-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (prevDbPath === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = prevDbPath;
});

function event(planId: string): Parameters<typeof GET>[0] {
  const url = new URL(`http://localhost/api/plans/${planId}/cockpit`);
  return { params: { planId }, request: new Request(url), url } as unknown as Parameters<typeof GET>[0];
}

async function call(planId: string): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    const response = await GET(event(planId));
    return { status: response.status, body: await response.json() };
  } catch (thrown) {
    const failure = thrown as { status?: number; body?: Record<string, unknown> };
    if (typeof failure.status === 'number') {
      return { status: failure.status, body: failure.body ?? {} };
    }
    throw thrown;
  }
}

describe('GET /api/plans/:planId/cockpit', () => {
  it('returns a cockpit projection for a task-backed plan', async () => {
    createTask({
      id: 'endpoint-task',
      subject: 'Expose cockpit endpoint',
      planId: 'plan-route',
      status: 'completed'
    });

    const response = await call('plan-route');

    expect(response.status).toBe(200);
    const cockpit = response.body.cockpit as {
      plan: { id: string };
      progress: { tasks: { total: number; completed: number; pct: number } };
      unphasedTasks: Array<{ id: string }>;
    };
    expect(cockpit.plan.id).toBe('plan-route');
    expect(cockpit.progress.tasks).toEqual({ total: 1, completed: 1, pct: 1 });
    expect(cockpit.unphasedTasks.map((task) => task.id)).toEqual(['endpoint-task']);
  });

  it('404s for a completely unknown plan', async () => {
    const response = await call('missing-plan');
    expect(response.status).toBe(404);
  });
});
