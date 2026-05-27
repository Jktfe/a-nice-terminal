import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { POST } from './+server';
import { createArtefactInRoom, resetChatRoomArtefactStoreForTests } from '$lib/server/chatRoomArtefactStore';
import { upsertArtefactContent, resetChatRoomArtefactContentStoreForTests } from '$lib/server/chatRoomArtefactContentStore';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { resetPolicyStoreForTests } from '$lib/server/policyStore';
import { ensureJksValidationRulePolicy, JKS_VALIDATION_RULE_SLUG } from '$lib/server/validationPolicyPresets';
import { listTasks, resetTasksStoreForTests } from '$lib/server/tasksStore';
import {
  completeValidationRun,
  createValidationRun,
  createValidationSchema
} from '$lib/server/validationLensStore';
import { getIdentityDb } from '$lib/server/db';

const ADMIN_TOKEN_FOR_TESTS = 'artefact-validation-route-test-admin-token';
const ORIGINAL_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;

beforeAll(() => {
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN_FOR_TESTS;
});

afterAll(() => {
  if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
});

type AnyEvent = Parameters<typeof POST>[0];

function eventFor(artefactId: string, body: unknown, withAuth = true): AnyEvent {
  const url = new URL(`http://localhost/api/artefacts/${artefactId}/validate`);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (withAuth) headers.authorization = `Bearer ${ADMIN_TOKEN_FOR_TESTS}`;
  return {
    request: new Request(url.toString(), {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    }),
    params: { artefactId },
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

describe('POST /api/artefacts/:artefactId/validate', () => {
  beforeEach(() => {
    resetChatRoomArtefactContentStoreForTests();
    resetChatRoomArtefactStoreForTests();
    resetChatRoomStoreForTests();
    resetPolicyStoreForTests();
    resetTasksStoreForTests();
    const db = getIdentityDb();
    db.prepare('DELETE FROM validation_runs').run();
    db.prepare('DELETE FROM validation_schemas').run();
  });

  it('applies a policy lens to a markdown artefact and returns claim-level scores', async () => {
    const room = createChatRoom({ name: 'validation room', whoCreatedIt: '@you' });
    const artefact = createArtefactInRoom({
      roomId: room.id,
      kind: 'doc',
      title: 'Alternative Track',
      refUrl: `/api/chat-rooms/${room.id}/docs/alt-doc`,
      createdBy: '@speedycodex'
    });
    upsertArtefactContent({
      id: 'alt-doc',
      artefactId: artefact.id,
      roomId: room.id,
      kind: 'doc',
      contentFormat: 'markdown',
      contentBody: [
        '# Alternative Track',
        '',
        'This launch carries a security risk and needs 3 reviewers.',
        '',
        'See https://example.com/source for the evidence.'
      ].join('\n'),
      updatedByHandle: '@speedycodex'
    });
    const policy = ensureJksValidationRulePolicy({ ownerHandle: '@you', actorKind: 'human' });

    const response = await runPost(eventFor(artefact.id, { policySlug: JKS_VALIDATION_RULE_SLUG }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.artefact).toMatchObject({ id: artefact.id, title: 'Alternative Track', roomId: room.id });
    expect(body.lens).toMatchObject({ slug: policy.slug, name: policy.name });
    expect(body.claims).toHaveLength(2);
    expect(body.claims.map((claim: { kind: string }) => claim.kind)).toEqual(['number', 'link']);
    expect(body.score).toMatchObject({ totalClaims: 2, passedClaims: 0, percent: 0 });
    expect(body.score.claimResults[0]).toMatchObject({
      id: body.claims[0].id,
      passed: false
    });
    expect(body.orchestration.summary.totalClaims).toBe(2);
    expect(body.orchestration.summary.missingSlots).toBeGreaterThan(0);
  });

  it('rejects callers without read access to the artefact room', async () => {
    const room = createChatRoom({ name: 'private validation room', whoCreatedIt: '@you' });
    const artefact = createArtefactInRoom({
      roomId: room.id,
      kind: 'doc',
      title: 'Hidden',
      createdBy: '@you'
    });
    upsertArtefactContent({
      id: 'hidden-doc',
      artefactId: artefact.id,
      roomId: room.id,
      kind: 'doc',
      contentFormat: 'markdown',
      contentBody: 'This is a material launch claim.',
      updatedByHandle: '@you'
    });
    ensureJksValidationRulePolicy({ ownerHandle: '@you', actorKind: 'human' });

    const response = await runPost(eventFor(artefact.id, { policySlug: JKS_VALIDATION_RULE_SLUG }, false));

    expect(response.status).toBe(401);
  });

  it('uses the built-in JK lens when the editable policy has not been seeded yet', async () => {
    const room = createChatRoom({ name: 'validation room', whoCreatedIt: '@you' });
    const artefact = createArtefactInRoom({
      roomId: room.id,
      kind: 'doc',
      title: 'Unseeded lens doc',
      createdBy: '@you'
    });
    upsertArtefactContent({
      id: 'unseeded-doc',
      artefactId: artefact.id,
      roomId: room.id,
      kind: 'doc',
      contentFormat: 'markdown',
      contentBody: 'The plan has 12 claims and a security dependency.',
      updatedByHandle: '@you'
    });

    const response = await runPost(eventFor(artefact.id, {}));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.lens).toMatchObject({
      id: `preset:${JKS_VALIDATION_RULE_SLUG}`,
      slug: JKS_VALIDATION_RULE_SLUG
    });
    expect(body.score.totalClaims).toBe(1);
  });

  it('creates idempotent verifier work items when requested', async () => {
    const room = createChatRoom({ name: 'validation room', whoCreatedIt: '@you' });
    const artefact = createArtefactInRoom({
      roomId: room.id,
      kind: 'doc',
      title: 'Claims to verify',
      createdBy: '@speedycodex'
    });
    upsertArtefactContent({
      id: 'claims-doc',
      artefactId: artefact.id,
      roomId: room.id,
      kind: 'doc',
      contentFormat: 'markdown',
      contentBody: 'This security launch has 3 material checks.',
      updatedByHandle: '@speedycodex'
    });
    ensureJksValidationRulePolicy({ ownerHandle: '@you', actorKind: 'human' });

    const first = await runPost(eventFor(artefact.id, {
      policySlug: JKS_VALIDATION_RULE_SLUG,
      createWork: true
    }));
    const second = await runPost(eventFor(artefact.id, {
      policySlug: JKS_VALIDATION_RULE_SLUG,
      createWork: true
    }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstBody = await first.json();
    const secondBody = await second.json();
    expect(firstBody.validationWork.created).toBe(2);
    expect(firstBody.validationWork.reused).toBe(0);
    expect(secondBody.validationWork.created).toBe(0);
    expect(secondBody.validationWork.reused).toBe(2);
    expect(firstBody.validationWork.items[0]).toMatchObject({
      claimId: firstBody.claims[0].id,
      sourcePointer: firstBody.claims[0].source.pointer,
      verifierKind: 'agent'
    });

    const tasks = listTasks({ roomId: room.id });
    expect(tasks).toHaveLength(2);
    expect(tasks[0].title).toContain(firstBody.claims[0].id);
    expect(tasks[0].description).toContain(firstBody.claims[0].text);
    expect(tasks[0].description).toContain(firstBody.claims[0].source.pointer);
    expect(tasks.map((task) => task.planId)).toEqual([`validation-${artefact.id}`, `validation-${artefact.id}`]);
  });

  it('scores claims using completed validation runs for the selected lens', async () => {
    const room = createChatRoom({ name: 'validation room', whoCreatedIt: '@you' });
    const artefact = createArtefactInRoom({
      roomId: room.id,
      kind: 'doc',
      title: 'Verified claims',
      createdBy: '@speedycodex'
    });
    upsertArtefactContent({
      id: 'verified-claims-doc',
      artefactId: artefact.id,
      roomId: room.id,
      kind: 'doc',
      contentFormat: 'markdown',
      contentBody: 'The plan is safe.',
      updatedByHandle: '@speedycodex'
    });
    ensureJksValidationRulePolicy({ ownerHandle: '@you', actorKind: 'human' });
    createValidationSchema({
      id: JKS_VALIDATION_RULE_SLUG,
      name: "JK's Validation Rule",
      description: 'Test schema row for validation runs',
      lensKind: 'custom',
      rulesJson: '{}',
      createdBy: '@you',
      archivedAtMs: null
    });

    const before = await runPost(eventFor(artefact.id, { policySlug: JKS_VALIDATION_RULE_SLUG }));
    const beforeBody = await before.json();
    const claim = beforeBody.claims[0];
    createValidationRun({
      id: 'run-agent-pass',
      schemaId: JKS_VALIDATION_RULE_SLUG,
      claimAnchor: claim.id,
      claimText: claim.text,
      status: 'pending',
      score: null,
      resultJson: JSON.stringify({ verifierKind: 'agent' }),
      runBy: '@speedycodex'
    });
    completeValidationRun('run-agent-pass', 'passed', 100, JSON.stringify({ verifierKind: 'agent' }));
    createValidationRun({
      id: 'run-agent-pass-2',
      schemaId: JKS_VALIDATION_RULE_SLUG,
      claimAnchor: claim.id,
      claimText: claim.text,
      status: 'pending',
      score: null,
      resultJson: JSON.stringify({ verifierKind: 'agent' }),
      runBy: '@speedykimi'
    });
    completeValidationRun('run-agent-pass-2', 'passed', 100, JSON.stringify({ verifierKind: 'agent' }));

    const after = await runPost(eventFor(artefact.id, { policySlug: JKS_VALIDATION_RULE_SLUG }));

    expect(after.status).toBe(200);
    const afterBody = await after.json();
    expect(beforeBody.score.percent).toBe(0);
    expect(afterBody.score).toMatchObject({
      totalClaims: 1,
      passedClaims: 1,
      percent: 100
    });
    expect(afterBody.claims[0].checks).toEqual([
      { verifierKind: 'agent', outcome: 'pass' },
      { verifierKind: 'agent', outcome: 'pass' }
    ]);
  });

  it('routes verifier work to supplied participants when available', async () => {
    const room = createChatRoom({ name: 'validation room', whoCreatedIt: '@you' });
    const artefact = createArtefactInRoom({
      roomId: room.id,
      kind: 'doc',
      title: 'Claims with participants',
      createdBy: '@speedycodex'
    });
    upsertArtefactContent({
      id: 'participant-claims-doc',
      artefactId: artefact.id,
      roomId: room.id,
      kind: 'doc',
      contentFormat: 'markdown',
      contentBody: 'This launch has 7 compliance checks.',
      updatedByHandle: '@speedycodex'
    });
    ensureJksValidationRulePolicy({ ownerHandle: '@you', actorKind: 'human' });

    const response = await runPost(eventFor(artefact.id, {
      policySlug: JKS_VALIDATION_RULE_SLUG,
      createWork: true,
      participants: [
        { kind: 'agent', handle: '@speedycodex' },
        { kind: 'agent', handle: '@speedykimi' }
      ]
    }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.orchestration.summary.assignments).toBe(2);
    expect(body.orchestration.summary.missingSlots).toBe(0);
    expect(body.validationWork.created).toBe(2);
    expect(body.validationWork.items.map((item: { assignedTo: string | null }) => item.assignedTo)).toEqual([
      '@speedycodex',
      '@speedykimi'
    ]);

    const tasks = listTasks({ roomId: room.id });
    expect(tasks.map((task) => task.assignedTo)).toEqual(['@speedycodex', '@speedykimi']);
  });

  it('extracts validation claims from univer-json deck text elements', async () => {
    const room = createChatRoom({ name: 'univer validation room', whoCreatedIt: '@you' });
    const artefact = createArtefactInRoom({
      roomId: room.id,
      kind: 'deck',
      title: 'Editable deck',
      createdBy: '@speedycodex'
    });
    upsertArtefactContent({
      id: 'editable-deck-content',
      artefactId: artefact.id,
      roomId: room.id,
      kind: 'deck',
      contentFormat: 'univer-json',
      contentBody: JSON.stringify({
        id: 'deck-test',
        title: 'Editable deck',
        body: {
          pageOrder: ['slide-1'],
          pages: {
            'slide-1': {
              id: 'slide-1',
              title: 'Claims',
              pageElements: {
                claim: {
                  id: 'claim',
                  type: 2,
                  richText: { text: 'The Univer deck has 4 validation checks.' }
                }
              }
            }
          }
        }
      }),
      updatedByHandle: '@speedycodex'
    });
    ensureJksValidationRulePolicy({ ownerHandle: '@you', actorKind: 'human' });

    const response = await runPost(eventFor(artefact.id, { policySlug: JKS_VALIDATION_RULE_SLUG }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.claims).toHaveLength(1);
    expect(body.claims[0]).toMatchObject({
      text: 'The Univer deck has 4 validation checks.',
      source: {
        tool: 'deck',
        pointer: `artefact:${artefact.id}#L1`
      }
    });
    expect(body.score.totalClaims).toBe(1);
  });

  it('allows the seeded Univer demo artefact to validate without a browser session', async () => {
    const room = createChatRoom({ name: 'demo room', whoCreatedIt: '@you' });
    const artefact = createArtefactInRoom({
      id: 'univer_demo_5892abff',
      roomId: room.id,
      kind: 'deck',
      title: 'Demo deck',
      createdBy: '@speedycodex'
    });
    upsertArtefactContent({
      id: 'univer_demo_content_2f3cbf38',
      artefactId: artefact.id,
      roomId: room.id,
      kind: 'deck',
      contentFormat: 'univer-json',
      contentBody: JSON.stringify({
        body: {
          pageOrder: ['slide-1'],
          pages: {
            'slide-1': {
              id: 'slide-1',
              title: 'Demo',
              pageElements: {
                claim: {
                  id: 'claim',
                  type: 2,
                  richText: { text: 'The public Univer demo has 4 validation checks.' }
                }
              }
            }
          }
        }
      }),
      updatedByHandle: '@speedycodex'
    });
    ensureJksValidationRulePolicy({ ownerHandle: '@you', actorKind: 'human' });

    const response = await runPost(eventFor(artefact.id, {}, false));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.claims[0].text).toBe('The public Univer demo has 4 validation checks.');
  });

  it('rejects artefacts without stored markdown content', async () => {
    const room = createChatRoom({ name: 'validation room', whoCreatedIt: '@you' });
    const artefact = createArtefactInRoom({
      roomId: room.id,
      kind: 'html',
      title: 'External mock',
      refUrl: 'https://example.com/mock.html',
      createdBy: '@you'
    });
    ensureJksValidationRulePolicy({ ownerHandle: '@you', actorKind: 'human' });

    const response = await runPost(eventFor(artefact.id, { policySlug: JKS_VALIDATION_RULE_SLUG }));

    expect(response.status).toBe(404);
  });

  it('resolves a lensSchemaId against the V2 lens designer schema via the bridge', async () => {
    // Wired 2026-05-27 after @speedycodex shipped 8a8611d (lens CRUD + audit).
    // The endpoint now resolves a V2-shape rules_json through the bridge
    // instead of requiring a hand-authored policy slug.
    const room = createChatRoom({ name: 'lens-schema-id', whoCreatedIt: '@you' });
    const artefact = createArtefactInRoom({
      roomId: room.id,
      kind: 'doc',
      title: 'Validated via lens schema',
      refUrl: `/api/chat-rooms/${room.id}/docs/lens-doc`,
      createdBy: '@you'
    });
    upsertArtefactContent({
      id: 'lens-doc',
      artefactId: artefact.id,
      roomId: room.id,
      kind: 'doc',
      contentFormat: 'markdown',
      contentBody: 'A material claim about quarterly performance.',
      updatedByHandle: '@you'
    });

    const lensSchemaId = `lens-${randomUUID()}`;
    createValidationSchema({
      id: lensSchemaId,
      name: 'Test V2 lens',
      description: 'For artefact-validation lensSchemaId path',
      lensKind: 'custom',
      scope: 'public',
      scopeId: 'global',
      rulesJson: JSON.stringify({
        version: 2,
        blocks: {
          claim_material: {
            mode: 'all',
            requirements: [{ kind: 'agent', count: 2 }, { kind: 'person', count: 1 }]
          }
        },
        fallback: { mode: 'any', requirements: [{ kind: 'agent', count: 1 }] }
      }),
      createdBy: '@you',
      archivedAtMs: null
    });

    const response = await runPost(eventFor(artefact.id, { lensSchemaId }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.lens.id).toBe(lensSchemaId);
    expect(body.lens.name).toBe('Test V2 lens');
  });

  it('rejects when policySlug and lensSchemaId are both supplied', async () => {
    const room = createChatRoom({ name: 'both-supplied', whoCreatedIt: '@you' });
    const artefact = createArtefactInRoom({
      roomId: room.id,
      kind: 'doc',
      title: 'doc',
      refUrl: '/x',
      createdBy: '@you'
    });

    const response = await runPost(
      eventFor(artefact.id, {
        policySlug: JKS_VALIDATION_RULE_SLUG,
        lensSchemaId: 'lens-doesnt-matter'
      })
    );
    expect(response.status).toBe(400);
  });

  it('returns 404 when lensSchemaId references an unknown schema', async () => {
    const room = createChatRoom({ name: 'missing-lens', whoCreatedIt: '@you' });
    const artefact = createArtefactInRoom({
      roomId: room.id,
      kind: 'doc',
      title: 'doc',
      refUrl: '/x',
      createdBy: '@you'
    });
    upsertArtefactContent({
      id: 'missing-lens-doc',
      artefactId: artefact.id,
      roomId: room.id,
      kind: 'doc',
      contentFormat: 'markdown',
      contentBody: 'claim',
      updatedByHandle: '@you'
    });

    const response = await runPost(eventFor(artefact.id, { lensSchemaId: 'lens-nope' }));
    expect(response.status).toBe(404);
  });

  it('returns 400 when lensSchemaId resolves to a schema with malformed rules_json', async () => {
    const room = createChatRoom({ name: 'malformed-rules', whoCreatedIt: '@you' });
    const artefact = createArtefactInRoom({
      roomId: room.id,
      kind: 'doc',
      title: 'doc',
      refUrl: '/x',
      createdBy: '@you'
    });
    upsertArtefactContent({
      id: 'malformed-doc',
      artefactId: artefact.id,
      roomId: room.id,
      kind: 'doc',
      contentFormat: 'markdown',
      contentBody: 'claim',
      updatedByHandle: '@you'
    });

    const lensSchemaId = `lens-${randomUUID()}`;
    createValidationSchema({
      id: lensSchemaId,
      name: 'Malformed lens',
      description: null,
      lensKind: 'custom',
      scope: 'public',
      scopeId: 'global',
      rulesJson: 'not json',
      createdBy: '@you',
      archivedAtMs: null
    });

    const response = await runPost(eventFor(artefact.id, { lensSchemaId }));
    expect(response.status).toBe(400);
  });
});
