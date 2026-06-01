import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET } from './+server';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { createBrowserSession } from '$lib/server/browserSessionStore';
import { addMembership } from '$lib/server/roomMembershipsStore';
import { resetTasksStoreForTests, createTask } from '$lib/server/tasksStore';
import { upsertTerminal } from '$lib/server/terminalsStore';
import {
  completeValidationRun,
  createValidationRun,
  createValidationSchema
} from '$lib/server/validationLensStore';
import { getIdentityDb } from '$lib/server/db';

const ADMIN_TOKEN_FOR_TESTS = 'validation-runs-route-test-admin-token';
const ORIGINAL_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;

beforeAll(() => {
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN_FOR_TESTS;
});

afterAll(() => {
  if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
});

type AnyEvent = Parameters<typeof GET>[0];

function eventFor(params: Record<string, string>, withAuth = true): AnyEvent {
  const url = new URL('http://localhost/api/validation-runs');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const headers: Record<string, string> = {};
  if (withAuth) headers.authorization = `Bearer ${ADMIN_TOKEN_FOR_TESTS}`;
  return {
    request: new Request(url.toString(), { headers }),
    url
  } as unknown as AnyEvent;
}

function browserSessionEventFor(params: Record<string, string>, browserSessionSecret: string): AnyEvent {
  const url = new URL('http://localhost/api/validation-runs');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return {
    request: new Request(url.toString(), {
      headers: { cookie: `ant_browser_session=${browserSessionSecret}` }
    }),
    url
  } as unknown as AnyEvent;
}

async function runGet(event: AnyEvent): Promise<Response> {
  try {
    return (await GET(event)) as Response;
  } catch (thrownByHandler) {
    if (thrownByHandler instanceof Response) return thrownByHandler;
    const httpFailure = thrownByHandler as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrownByHandler;
  }
}

function validationDescription(claimId = 'claim_demo'): string {
  return [
    `Validate claim \`${claimId}\` using lens \`jks-validation-rule\`.`,
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

function createValidationTask(input: {
  id: string;
  roomId: string;
  claimId?: string;
  createdBy?: string;
}) {
  const claimId = input.claimId ?? 'claim_demo';
  return createTask({
    id: input.id,
    title: `Validate ${claimId} (@speedycodex)`,
    description: validationDescription(claimId),
    status: 'done',
    roomId: input.roomId,
    planId: 'validation-art_demo',
    createdBy: input.createdBy ?? '@you'
  });
}

function seedValidationSchema(): void {
  createValidationSchema({
    id: 'jks-validation-rule',
    name: 'JK rule',
    description: null,
    lensKind: 'custom',
    rulesJson: '{}',
    createdBy: '@you',
    archivedAtMs: null
  });
}

function seedCompletedRun(input: {
  id: string;
  claimId: string;
  evidence: string;
  score?: number;
}): void {
  createValidationRun({
    id: input.id,
    schemaId: 'jks-validation-rule',
    claimAnchor: input.claimId,
    claimText: 'The plan is safe.',
    status: 'pending',
    score: null,
    resultJson: null,
    runBy: '@speedycodex'
  });
  completeValidationRun(
    input.id,
    'passed',
    input.score ?? 100,
    JSON.stringify({ verifierKind: 'agent', evidence: input.evidence })
  );
}

function addBrowserSessionMember(roomId: string, handle: string): void {
  const terminal = upsertTerminal({
    pid: 42,
    pid_start: 'validation-runs-auth-test',
    name: `validation-runs-auth-${roomId}-${handle}`
  });
  addMembership({ room_id: roomId, handle, terminal_id: terminal.id });
}

describe('GET /api/validation-runs', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetTasksStoreForTests();
    const db = getIdentityDb();
    db.prepare('DELETE FROM browser_sessions').run();
    db.prepare('DELETE FROM room_memberships').run();
    db.prepare("DELETE FROM terminals WHERE source = 'browser-session' OR name LIKE 'validation-runs-auth-%'").run();
    db.prepare('DELETE FROM verification_observations').run();
    db.prepare('DELETE FROM verification_lenses').run();
  });

  it('rejects unauthenticated callers before returning validation evidence', async () => {
    const room = createChatRoom({ name: 'validation room', whoCreatedIt: '@you' });
    const task = createValidationTask({ id: 'task_validation_demo', roomId: room.id });
    seedValidationSchema();
    seedCompletedRun({
      id: 'validation_run_task_validation_demo',
      claimId: 'claim_demo',
      evidence: 'sensitive evidence'
    });

    const response = await runGet(eventFor({ taskId: task.id }, false));
    expect(response.status).toBe(401);
  });

  it('returns runs for an authorised caller using the task room boundary', async () => {
    const room = createChatRoom({ name: 'validation room', whoCreatedIt: '@you' });
    const task = createValidationTask({ id: 'task_validation_demo', roomId: room.id });
    seedValidationSchema();
    seedCompletedRun({
      id: 'validation_run_task_validation_demo',
      claimId: 'claim_demo',
      evidence: 'checked source'
    });

    const response = await runGet(eventFor({ taskId: task.id }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.runs).toHaveLength(1);
    expect(body.runs[0]).toMatchObject({
      id: 'validation_run_task_validation_demo',
      claimAnchor: 'claim_demo',
      status: 'passed',
      score: 100
    });
  });

  it('rejects a browser session that belongs to another room', async () => {
    const validationRoom = createChatRoom({ name: 'validation room', whoCreatedIt: '@owner-a' });
    const otherRoom = createChatRoom({ name: 'other room', whoCreatedIt: '@owner-b' });
    addBrowserSessionMember(otherRoom.id, '@owner-b');
    const browserSession = createBrowserSession({
      roomId: otherRoom.id,
      authorHandle: '@owner-b',
      browserSessionId: 'bs_validation_wrong_room'
    });
    expect(browserSession).not.toBeNull();

    const task = createValidationTask({
      id: 'task_validation_demo',
      roomId: validationRoom.id,
      createdBy: '@owner-a'
    });
    seedValidationSchema();
    seedCompletedRun({
      id: 'validation_run_task_validation_demo',
      claimId: 'claim_demo',
      evidence: 'wrong-room-sensitive evidence'
    });

    const response = await runGet(browserSessionEventFor(
      { taskId: task.id },
      browserSession!.browserSessionSecret
    ));

    expect(response.status).toBe(404);
  });

  it('scopes returned runs to the claim carried by the requested task', async () => {
    const room = createChatRoom({ name: 'validation room', whoCreatedIt: '@you' });
    const taskOne = createValidationTask({
      id: 'task_validation_one',
      roomId: room.id,
      claimId: 'claim_one'
    });
    createValidationTask({
      id: 'task_validation_two',
      roomId: room.id,
      claimId: 'claim_two'
    });
    seedValidationSchema();
    seedCompletedRun({
      id: 'validation_run_task_one',
      claimId: 'claim_one',
      evidence: 'claim one evidence'
    });
    seedCompletedRun({
      id: 'validation_run_task_two',
      claimId: 'claim_two',
      evidence: 'claim two evidence',
      score: 50
    });

    const response = await runGet(eventFor({ taskId: taskOne.id }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.runs).toHaveLength(1);
    expect(body.runs[0].id).toBe('validation_run_task_one');
    expect(body.runs[0].claimAnchor).toBe('claim_one');
  });

  it('does not accept bare claim anchors without a task room boundary', async () => {
    const response = await runGet(eventFor({ claimAnchor: 'claim_demo' }));

    expect(response.status).toBe(400);
  });
});
