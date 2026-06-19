import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '$lib/server/db';
import { resetAskStoreForTests } from '$lib/server/askStore';
import {
  collectAskCandidatesFromMessage,
  resetAskCandidateStoreForTests
} from '$lib/server/askCandidateStore';
import {
  postMessage,
  resetChatMessageStoreForTests
} from '$lib/server/chatMessageStore';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { POST } from './+server';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;
const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const TEST_ADMIN_TOKEN = 'ask-candidate-dismiss-test-admin';

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  process.env.ANT_ADMIN_TOKEN = TEST_ADMIN_TOKEN;
  resetIdentityDbForTests();
  resetAskCandidateStoreForTests();
  resetAskStoreForTests();
  resetChatMessageStoreForTests();
  resetChatRoomStoreForTests();
});

afterEach(() => {
  resetAskCandidateStoreForTests();
  resetAskStoreForTests();
  resetChatMessageStoreForTests();
  resetChatRoomStoreForTests();
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
  if (PREV_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN_TOKEN;
});

function req(candidateId: string, body?: unknown, authenticated = true): Parameters<typeof POST>[0] {
  const headers = authenticated ? { authorization: `Bearer ${TEST_ADMIN_TOKEN}` } : undefined;
  return {
    params: { candidateId },
    request: new Request('http://x/api/ask-candidates/' + candidateId + '/dismiss', {
      method: 'POST',
      headers,
      body: body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)
    })
  } as Parameters<typeof POST>[0];
}

function seedCandidate() {
  const room = createChatRoom({ name: 'candidate-room', whoCreatedIt: '@you' });
  const message = postMessage({
    roomId: room.id,
    authorHandle: '@codex',
    body: '@you should this be dismissed?'
  });
  const [candidate] = collectAskCandidatesFromMessage(message);
  return { room, candidate };
}

describe('POST /api/ask-candidates/:candidateId/dismiss', () => {
  it('rejects anonymous dismissal before mutation', async () => {
    const { candidate } = seedCandidate();

    await expect(POST(req(candidate.id, {}, false))).rejects.toMatchObject({ status: 401 });
  });

  it('dismisses a candidate and defaults the actor to the canonical operator', async () => {
    const { candidate } = seedCandidate();

    const res = await POST(req(candidate.id));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.candidate).toMatchObject({
      id: candidate.id,
      status: 'dismissed',
      dismissedByHandle: '@JWPK',
      dismissedAt: expect.any(String)
    });
  });

  it('normalizes dismissedByHandle values', async () => {
    const { candidate } = seedCandidate();

    const res = await POST(req(candidate.id, { dismissedByHandle: 'svelte' }));
    const body = await res.json();

    expect(body.candidate.dismissedByHandle).toBe('@svelte');
  });

  it('rejects malformed bodies and missing candidates', async () => {
    const { candidate } = seedCandidate();

    await expect(POST(req(candidate.id, '{'))).rejects.toMatchObject({ status: 400 });
    await expect(POST(req(candidate.id, ['not-object']))).rejects.toMatchObject({ status: 400 });
    await expect(POST(req('cand_missing', {}))).rejects.toMatchObject({ status: 404 });
  });
});
