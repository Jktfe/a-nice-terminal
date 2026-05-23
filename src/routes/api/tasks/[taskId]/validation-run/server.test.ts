import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST } from './+server';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { resetTasksStoreForTests, createTask } from '$lib/server/tasksStore';
import { getIdentityDb } from '$lib/server/db';
import { listValidationRunsForClaim } from '$lib/server/validationLensStore';

const ADMIN_TOKEN_FOR_TESTS = 'task-validation-run-route-test-admin-token';
const ORIGINAL_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;

beforeAll(() => {
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN_FOR_TESTS;
});

afterAll(() => {
  if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
});

type AnyEvent = Parameters<typeof POST>[0];

function eventFor(taskId: string, body: unknown, withAuth = true): AnyEvent {
  const url = new URL(`http://localhost/api/tasks/${taskId}/validation-run`);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (withAuth) headers.authorization = `Bearer ${ADMIN_TOKEN_FOR_TESTS}`;
  return {
    request: new Request(url.toString(), {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    }),
    params: { taskId },
    url
  } as unknown as AnyEvent;
}

async function runPost(event: AnyEvent): Promise<Response> {
  try {
    return (await POST(event)) as Response;
  } catch (thrownByHandler) {
    if (thrownByHandler instanceof Response) return thrownByHandler;
    const httpFailure = thrownByHandler as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrownByHandler;
  }
}

function validationTaskDescription(): string {
  return [
    'Validate claim `claim_demo` using lens `jks-validation-rule`.',
    '',
    'Verifier kind: agent',
    'Requirement: 2 agents',
    'Artefact: /artefacts/art_demo',
    'Source pointer: artefact:art_demo#L1',
    '',
    'Claim:',
    '> The plan is safe.'
  ].join('\n');
}

describe('POST /api/tasks/:taskId/validation-run', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetTasksStoreForTests();
    const db = getIdentityDb();
    db.prepare('DELETE FROM validation_runs').run();
    db.prepare('DELETE FROM validation_schemas').run();
  });

  it('records a validation run from a completed verifier task', async () => {
    const room = createChatRoom({ name: 'validation room', whoCreatedIt: '@you' });
    const task = createTask({
      id: 'task_validation_demo',
      title: 'Validate claim_demo (@speedycodex)',
      description: validationTaskDescription(),
      status: 'done',
      assignedTo: '@speedycodex',
      roomId: room.id,
      planId: 'validation-art_demo',
      createdBy: '@you'
    });

    const first = await runPost(eventFor(task.id, {
      outcome: 'pass',
      score: 100,
      evidence: 'Checked against the source artefact.'
    }));
    const second = await runPost(eventFor(task.id, {
      outcome: 'pass',
      score: 100,
      evidence: 'Checked against the source artefact.'
    }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstBody = await first.json();
    const secondBody = await second.json();
    expect(firstBody.validationRun).toMatchObject({
      id: 'validation_run_task_validation_demo',
      schemaId: 'jks-validation-rule',
      claimAnchor: 'claim_demo',
      status: 'passed',
      runBy: '@speedycodex'
    });
    expect(firstBody.reused).toBe(false);
    expect(secondBody.reused).toBe(true);

    const runs = listValidationRunsForClaim('claim_demo');
    expect(runs).toHaveLength(1);
    expect(runs[0].resultJson).toContain('"verifierKind":"agent"');
    expect(runs[0].resultJson).toContain('Checked against the source artefact.');
  });

  it('rejects unfinished verifier tasks', async () => {
    const room = createChatRoom({ name: 'validation room', whoCreatedIt: '@you' });
    const task = createTask({
      id: 'task_validation_unfinished',
      title: 'Validate claim_demo (@speedycodex)',
      description: validationTaskDescription(),
      status: 'todo',
      assignedTo: '@speedycodex',
      roomId: room.id,
      planId: 'validation-art_demo',
      createdBy: '@you'
    });

    const response = await runPost(eventFor(task.id, { outcome: 'pass' }));

    expect(response.status).toBe(400);
  });

  it('rejects callers without room mutation access', async () => {
    const room = createChatRoom({ name: 'validation room', whoCreatedIt: '@you' });
    const task = createTask({
      id: 'task_validation_unauth',
      title: 'Validate claim_demo (@speedycodex)',
      description: validationTaskDescription(),
      status: 'done',
      assignedTo: '@speedycodex',
      roomId: room.id,
      planId: 'validation-art_demo',
      createdBy: '@you'
    });

    const response = await runPost(eventFor(task.id, { outcome: 'pass' }, false));

    expect(response.status).toBe(401);
  });
});
