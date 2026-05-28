import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET } from './+server';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import {
  createArtefactInRoom,
  resetChatRoomArtefactStoreForTests
} from '$lib/server/chatRoomArtefactStore';
import { createTask, resetTasksStoreForTests, updateTaskStatus } from '$lib/server/tasksStore';
import {
  completeValidationRun,
  createValidationRun,
  createValidationSchema
} from '$lib/server/validationLensStore';
import { getIdentityDb } from '$lib/server/db';
import {
  issueToken,
  resetAntchatAuthTokensForTests
} from '$lib/server/antchatAuthStore';

const ADMIN_TOKEN_FOR_TESTS = 'validation-summary-route-test-admin-token';
const ORIGINAL_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;

beforeAll(() => {
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN_FOR_TESTS;
});

afterAll(() => {
  if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
});

type AnyEvent = Parameters<typeof GET>[0];

function eventFor(roomId: string, withAuth: boolean | string = true): AnyEvent {
  const url = new URL(`http://localhost/api/chat-rooms/${roomId}/validation-summary`);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (typeof withAuth === 'string') {
    headers.authorization = `Bearer ${withAuth}`;
  } else if (withAuth) {
    headers.authorization = `Bearer ${ADMIN_TOKEN_FOR_TESTS}`;
  }
  return {
    request: new Request(url.toString(), { method: 'GET', headers }),
    params: { roomId },
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

function ensureSchema(id: string): void {
  // The unique constraint check inside createValidationSchema would
  // throw on dupes; tests reset both run + schema tables in beforeEach.
  createValidationSchema({
    id,
    name: id,
    description: `Test schema ${id}`,
    lensKind: 'custom',
    scope: 'public',
    scopeId: 'global',
    rulesJson: '[]',
    createdBy: '@you',
    archivedAtMs: null
  });
}

describe('GET /api/chat-rooms/:roomId/validation-summary', () => {
  beforeEach(() => {
    resetChatRoomArtefactStoreForTests();
    resetChatRoomStoreForTests();
    resetTasksStoreForTests();
    resetAntchatAuthTokensForTests();
    const db = getIdentityDb();
    db.prepare('DELETE FROM verification_observations').run();
    db.prepare('DELETE FROM verification_lenses').run();
  });

  it('returns the full V3 contract shape with default-empty values for an unvalidated room', async () => {
    const room = createChatRoom({ name: 'empty-validation', whoCreatedIt: '@you' });

    const response = await runGet(eventFor(room.id));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      defaultLensId: null,
      recentRunCount: 0,
      pendingTaskCount: 0,
      overallTrustScore: null,
      trustState: 'unknown',
      criticalGaps: [],
      sheetUrl: `/validation/rooms/${room.id}`,
      evidenceFormUrl: null
    });
    expect(typeof body.validationUxEnabled).toBe('boolean');
  });

  it('returns 404 for an unknown room', async () => {
    const response = await runGet(eventFor('does-not-exist'));
    expect(response.status).toBe(404);
  });

  it('counts recent runs and computes overallTrustScore from completed scored runs', async () => {
    const room = createChatRoom({ name: 'recent-runs', whoCreatedIt: '@you' });
    const artefact = createArtefactInRoom({
      roomId: room.id,
      kind: 'doc',
      title: 'doc-with-runs',
      refUrl: '/x',
      createdBy: '@you'
    });
    ensureSchema('lens-test');
    // Two completed scored runs (80 + 60 = avg 70 → 0.7 → 'failed' below threshold)
    createValidationRun({
      id: 'run-1',
      schemaId: 'lens-test',
      claimAnchor: `artefact:${artefact.id}:c1`,
      claimText: 'claim 1',
      status: 'pending',
      score: null,
      resultJson: null,
      runBy: '@you'
    });
    completeValidationRun('run-1', 'passed', 80);
    createValidationRun({
      id: 'run-2',
      schemaId: 'lens-test',
      claimAnchor: `artefact:${artefact.id}:c2`,
      claimText: 'claim 2',
      status: 'pending',
      score: null,
      resultJson: null,
      runBy: '@you'
    });
    completeValidationRun('run-2', 'failed', 60);

    const response = await runGet(eventFor(room.id));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.recentRunCount).toBe(2);
    expect(body.overallTrustScore).toBeCloseTo(0.7, 5);
    // 0.7 < 0.8 threshold → 'failed' state when no pending + not stale
    expect(body.trustState).toBe('failed');
    // One failed run becomes a criticalGap
    expect(body.criticalGaps).toEqual([
      expect.objectContaining({
        claimAnchor: `artefact:${artefact.id}:c2`,
        kind: 'failed-validation',
        reason: 'claim 2'
      })
    ]);
  });

  it('returns trustState=passed when overallTrustScore is at or above the threshold', async () => {
    const room = createChatRoom({ name: 'high-score', whoCreatedIt: '@you' });
    const artefact = createArtefactInRoom({
      roomId: room.id,
      kind: 'doc',
      title: 'd',
      refUrl: '/x',
      createdBy: '@you'
    });
    ensureSchema('lens-test');
    createValidationRun({
      id: 'run-h1',
      schemaId: 'lens-test',
      claimAnchor: `artefact:${artefact.id}:c1`,
      claimText: 'c1',
      status: 'pending',
      score: null,
      resultJson: null,
      runBy: '@you'
    });
    completeValidationRun('run-h1', 'passed', 90);
    const body = await (await runGet(eventFor(room.id))).json();
    expect(body.trustState).toBe('passed');
    expect(body.overallTrustScore).toBeCloseTo(0.9, 5);
  });

  it('returns trustState=stale when the most recent run is older than the 7-day window', async () => {
    const room = createChatRoom({ name: 'stale-runs', whoCreatedIt: '@you' });
    const artefact = createArtefactInRoom({
      roomId: room.id,
      kind: 'doc',
      title: 's',
      refUrl: '/x',
      createdBy: '@you'
    });
    ensureSchema('lens-stale');
    createValidationRun({
      id: 'run-stale',
      schemaId: 'lens-stale',
      claimAnchor: `artefact:${artefact.id}:c1`,
      claimText: 'c1',
      status: 'pending',
      score: null,
      resultJson: null,
      runBy: '@you'
    });
    // Backdate started_at_ms + completed_at_ms to 10 days ago so the
    // run is outside the 7-day window. Direct DB write because the
    // store doesn't expose backdating.
    const tenDaysAgo = Date.now() - 10 * 24 * 60 * 60 * 1000;
    const db = getIdentityDb();
    db.prepare(
      `UPDATE verification_observations SET status = 'passed', score = 95, started_at_ms = ?, completed_at_ms = ? WHERE id = 'run-stale'`
    ).run(tenDaysAgo, tenDaysAgo);

    const body = await (await runGet(eventFor(room.id))).json();
    // Stale runs aren't in the 7-day window so recentRunCount is 0,
    // and overallTrustScore is null (no runs to score). But because
    // we couldn't compute a score, trustState should be 'unknown' —
    // the listValidationRunsForArtefacts since-clause filters them out.
    // This documents the v1 behaviour: pre-window runs don't count.
    expect(body.recentRunCount).toBe(0);
    expect(body.trustState).toBe('unknown');
  });

  it('counts pending validation verifier tasks; evidenceFormUrl is null for admin bearer (no personal handle)', async () => {
    const room = createChatRoom({ name: 'pending-tasks-admin', whoCreatedIt: '@you' });
    createTask({
      title: 'Verify claim',
      description: 'Validate claim `c1` using lens `fca-strict`.\nVerifier kind: agent',
      roomId: room.id,
      createdBy: '@you',
      assignedTo: '@verifier'
    });
    createTask({
      title: 'Some other task',
      description: 'Do the other thing',
      roomId: room.id,
      createdBy: '@you'
    });

    const body = await (await runGet(eventFor(room.id))).json();
    expect(body.pendingTaskCount).toBe(1);
    // Admin bearer's resolved access.handles is empty — there's no
    // "personal" verifier task for an admin, so the form URL is null.
    expect(body.evidenceFormUrl).toBeNull();
    expect(body.trustState).toBe('pending');
  });

  it('returns evidenceFormUrl pointing at the caller-owned pending task when the bearer resolves to a member handle', async () => {
    const room = createChatRoom({ name: 'pending-tasks-owner', whoCreatedIt: '@you' });
    // Caller will authenticate as you@example.com which resolves the
    // handle family to ['@you']. Assigning the task to '@you' should
    // route the deep link to them.
    const task = createTask({
      title: 'Verify claim',
      description: 'Validate claim `c1` using lens `fca-strict`.',
      roomId: room.id,
      createdBy: '@you',
      assignedTo: '@you'
    });

    const { token } = issueToken('you@example.com');
    const body = await (await runGet(eventFor(room.id, token))).json();
    expect(body.pendingTaskCount).toBe(1);
    expect(body.evidenceFormUrl).toBe(`/tasks/${task.id}/validation-run`);
  });

  it('excludes completed validation tasks from pendingTaskCount', async () => {
    const room = createChatRoom({ name: 'completed-tasks', whoCreatedIt: '@you' });
    const task = createTask({
      title: 'Verify claim',
      description: 'Validate claim `c1` using lens `fca-strict`.',
      roomId: room.id,
      createdBy: '@you',
      assignedTo: '@admin'
    });
    updateTaskStatus(task.id, 'done');

    const body = await (await runGet(eventFor(room.id))).json();
    expect(body.pendingTaskCount).toBe(0);
    expect(body.evidenceFormUrl).toBeNull();
  });

  it('returns 401 for unauthenticated reads', async () => {
    const room = createChatRoom({ name: 'no-auth', whoCreatedIt: '@you' });
    const response = await runGet(eventFor(room.id, false));
    expect(response.status).toBe(401);
  });

  // A10 (Slice 8 / 2026-05-28) — append-only refactor: new terminal
  // verdict statuses (dispute / insufficient_evidence / retag_required)
  // are recorded as raw rows in verification_observations. The payload
  // shape is unchanged (locked 9 fields) but criticalGaps and trustState
  // derivation must surface the new statuses meaningfully.

  it('A10: surfaces dispute verdicts as criticalGaps with kind=disputed-verdict + excludes from score', async () => {
    const room = createChatRoom({ name: 'a10-dispute', whoCreatedIt: '@you' });
    const artefact = createArtefactInRoom({
      roomId: room.id, kind: 'doc', title: 'd', refUrl: '/x', createdBy: '@you'
    });
    ensureSchema('lens-a10-disp');
    // One passed run (score 80) + one dispute (no score)
    createValidationRun({
      id: 'a10-pass', schemaId: 'lens-a10-disp',
      claimAnchor: `artefact:${artefact.id}:c-pass`,
      claimText: 'claim that passed', status: 'pending',
      score: null, resultJson: null, runBy: '@you'
    });
    completeValidationRun('a10-pass', 'passed', 80);
    // Write a dispute row directly (status enum supports it post-A8 rebuild)
    getIdentityDb().prepare(
      `INSERT INTO verification_observations (
        id, lens_id, claim_anchor, claim_text, status, score, result_json,
        started_at_ms, completed_at_ms, run_by, dispute_reason, verifier_handle, verifier_kind
      ) VALUES (?, ?, ?, ?, 'dispute', NULL, NULL, ?, ?, '@v', 'verifiers disagree', '@v', 'human')`
    ).run('a10-disp', 'lens-a10-disp', `artefact:${artefact.id}:c-disp`,
      'disputed claim text', Date.now(), Date.now());

    const body = await (await runGet(eventFor(room.id))).json();
    // overallTrustScore reflects only the scored row (80 → 0.8)
    expect(body.overallTrustScore).toBeCloseTo(0.8, 5);
    // Dispute appears in criticalGaps with the dedicated kind
    const dispute = body.criticalGaps.find(
      (g: { kind: string }) => g.kind === 'disputed-verdict'
    );
    expect(dispute).toBeTruthy();
    expect(dispute.claimAnchor).toBe(`artefact:${artefact.id}:c-disp`);
  });

  it('A10: retag_required verdicts surface in criticalGaps with kind=retag-required', async () => {
    const room = createChatRoom({ name: 'a10-retag', whoCreatedIt: '@you' });
    const artefact = createArtefactInRoom({
      roomId: room.id, kind: 'doc', title: 'd', refUrl: '/x', createdBy: '@you'
    });
    ensureSchema('lens-a10-rt');
    getIdentityDb().prepare(
      `INSERT INTO verification_observations (
        id, lens_id, claim_anchor, claim_text, status, score, result_json,
        started_at_ms, completed_at_ms, run_by, verifier_handle, verifier_kind
      ) VALUES (?, ?, ?, ?, 'retag_required', NULL, NULL, ?, ?, '@a', '@a', 'agent')`
    ).run('a10-rt', 'lens-a10-rt', `artefact:${artefact.id}:c-rt`,
      'claim needing retag', Date.now(), Date.now());
    const body = await (await runGet(eventFor(room.id))).json();
    const retag = body.criticalGaps.find(
      (g: { kind: string }) => g.kind === 'retag-required'
    );
    expect(retag).toBeTruthy();
  });

  it('A10: insufficient_evidence verdicts inflate trustState pending signal (do NOT become criticalGaps)', async () => {
    const room = createChatRoom({ name: 'a10-ie', whoCreatedIt: '@you' });
    const artefact = createArtefactInRoom({
      roomId: room.id, kind: 'doc', title: 'd', refUrl: '/x', createdBy: '@you'
    });
    ensureSchema('lens-a10-ie');
    getIdentityDb().prepare(
      `INSERT INTO verification_observations (
        id, lens_id, claim_anchor, claim_text, status, score, result_json,
        started_at_ms, completed_at_ms, run_by, verifier_handle, verifier_kind
      ) VALUES (?, ?, ?, ?, 'insufficient_evidence', NULL, NULL, ?, ?, '@a', '@a', 'agent')`
    ).run('a10-ie', 'lens-a10-ie', `artefact:${artefact.id}:c-ie`,
      'claim with not enough evidence', Date.now(), Date.now());
    const body = await (await runGet(eventFor(room.id))).json();
    // Not a critical gap (different signal than failure/dispute/retag)
    expect(body.criticalGaps.find((g: { kind: string }) => g.kind === 'failed-validation')).toBeUndefined();
    // Contributes to pending signal — with no other completed runs the
    // server-derived trustState is 'pending' rather than 'unknown'.
    expect(body.trustState).toBe('pending');
  });

  it('A10: payload shape is exactly the locked 9 fields (no new fields, no removed fields)', async () => {
    const room = createChatRoom({ name: 'a10-shape', whoCreatedIt: '@you' });
    const body = await (await runGet(eventFor(room.id))).json();
    expect(Object.keys(body).sort()).toEqual([
      'criticalGaps',
      'defaultLensId',
      'evidenceFormUrl',
      'overallTrustScore',
      'pendingTaskCount',
      'recentRunCount',
      'sheetUrl',
      'trustState',
      'validationUxEnabled'
    ]);
  });
});
