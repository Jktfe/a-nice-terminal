import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST } from './+server';
import { createArtefactInRoom, resetChatRoomArtefactStoreForTests } from '$lib/server/chatRoomArtefactStore';
import { upsertArtefactContent, resetChatRoomArtefactContentStoreForTests } from '$lib/server/chatRoomArtefactContentStore';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { resetPolicyStoreForTests } from '$lib/server/policyStore';
import { ensureJksValidationRulePolicy, JKS_VALIDATION_RULE_SLUG } from '$lib/server/validationPolicyPresets';

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
});
