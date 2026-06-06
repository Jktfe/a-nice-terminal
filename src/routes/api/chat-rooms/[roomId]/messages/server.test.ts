import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './+server';
import {
  createChatRoom,
  findChatRoomById,
  removeMemberFromRoom,
  resetChatRoomStoreForTests
} from '$lib/server/chatRoomStore';
import {
  listMessagesInRoom,
  postBreakMessage,
  postMessage,
  resetChatMessageStoreForTests,
  softDeleteMessage
} from '$lib/server/chatMessageStore';
import {
  addReactionToMessage,
  resetMessageReactionStoreForTests
} from '$lib/server/messageReactionStore';
import { resetIdentityDbForTests } from '$lib/server/db';
import { upsertTerminal } from '$lib/server/terminalsStore';
import { addMembership } from '$lib/server/roomMembershipsStore';
import { createBrowserSession } from '$lib/server/browserSessionStore';
import { issueToken, resetAntchatAuthTokensForTests } from '$lib/server/antchatAuthStore';
import { resetAskStoreForTests } from '$lib/server/askStore';
import { listOpenAskCandidates } from '$lib/server/askCandidateStore';
import {
  markMessageRead,
  resetMessageReadReceiptStoreForTests
} from '$lib/server/messageReadReceiptStore';
import { createSession } from '$lib/server/antSessionStore';
import { sessionFingerprint } from '$lib/server/tokenTerminalBinding';
import {
  claimHandle,
  resolveMember
} from '$lib/server/roomHandleLeaseClean';
import { setRoomPolicy } from '$lib/server/roomPolicyStore';

type CallOptions = { roomId: string; body?: string; cookie?: string; headers?: Record<string, string> };

async function callPost(options: CallOptions): Promise<Response> {
  const request = new Request(
    `http://localhost/api/chat-rooms/${options.roomId}/messages`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(options.cookie !== undefined && { cookie: options.cookie }),
        ...options.headers
      },
      body: options.body
    }
  );
  const event = {
    request,
    params: { roomId: options.roomId },
    url: new URL(`http://localhost/api/chat-rooms/${options.roomId}/messages`)
  } as unknown as Parameters<typeof POST>[0];
  try {
    return (await POST(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const failure = thrown as { status?: number; body?: { message?: string } };
    if (typeof failure?.status === 'number') {
      return new Response(JSON.stringify(failure.body ?? {}), {
        status: failure.status
      });
    }
    throw thrown;
  }
}

async function callGet(
  roomId: string,
  query = '',
  headers: Record<string, string> = {}
): Promise<Response> {
  const url = new URL(`http://localhost/api/chat-rooms/${roomId}/messages${query}`);
  const event = {
    request: new Request(url, { headers }),
    params: { roomId },
    url
  } as unknown as Parameters<typeof GET>[0];
  try {
    return (await GET(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const failure = thrown as { status?: number; body?: { message?: string } };
    if (typeof failure?.status === 'number') {
      return new Response(JSON.stringify(failure.body ?? {}), {
        status: failure.status
      });
    }
    throw thrown;
  }
}

let callerSeed = 0;
function verifiedCaller(roomId: string, handle = '@you') {
  callerSeed += 1;
  const pid = 10_000 + callerSeed;
  const pid_start = `test-pid-start-${callerSeed}`;
  const terminal = upsertTerminal({
    pid,
    pid_start,
    name: `verified-${handle.replace(/^@/, '')}-${callerSeed}`
  });
  addMembership({ room_id: roomId, handle, terminal_id: terminal.id });
  return { authorHandle: handle, pidChain: [{ pid, pid_start }] };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /api/chat-rooms/:roomId/messages pagination', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetChatMessageStoreForTests();
    resetAntchatAuthTokensForTests();
    resetAskStoreForTests();
    resetMessageReactionStoreForTests();
    resetMessageReadReceiptStoreForTests();
  });

  it('rejects unauthenticated message reads', async () => {
    const room = createChatRoom({ name: 'private-messages', whoCreatedIt: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'secret' });

    const response = await callGet(room.id);

    expect(response.status).toBe(401);
  });

  it('allows CLI message reads when the query pidChain resolves to a room member', async () => {
    const room = createChatRoom({ name: 'pidchain-read', whoCreatedIt: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'visible via pidChain' });
    const caller = verifiedCaller(room.id, '@agent');
    const query = `?pidChain=${encodeURIComponent(JSON.stringify(caller.pidChain))}`;

    const response = await callGet(room.id, query);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.messages.map((message: { body: string }) => message.body)).toContain('visible via pidChain');
  });

  it('filters deleted and synthetic browser-session rows from normal room reads', async () => {
    const room = createChatRoom({ name: 'visible-read-scope', whoCreatedIt: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'visible keeper' });
    const deleted = postMessage({ roomId: room.id, authorHandle: '@you', body: 'deleted ghost' });
    postMessage({ roomId: room.id, authorHandle: '@browser-bs_deadbeef', body: 'synthetic ghost' });
    softDeleteMessage({ messageId: deleted.id, byHandle: '@you' });
    const { token } = issueToken('you@example.com');

    const response = await callGet(room.id, '', { authorization: `Bearer ${token}` });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.messages.map((message: { body: string }) => message.body)).toEqual(['visible keeper']);
  });

  it('paginates visible rows instead of starving the page with hidden newest rows', async () => {
    const room = createChatRoom({ name: 'visible-pagination-scope', whoCreatedIt: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'visible older' });
    const visibleMiddle = postMessage({ roomId: room.id, authorHandle: '@you', body: 'visible middle' });
    const visibleNewer = postMessage({ roomId: room.id, authorHandle: '@you', body: 'visible newer' });
    const deleted = postMessage({ roomId: room.id, authorHandle: '@you', body: 'deleted newest' });
    postMessage({ roomId: room.id, authorHandle: '@browser-bs_deadbeef', body: 'synthetic newest' });
    softDeleteMessage({ messageId: deleted.id, byHandle: '@you' });
    const { token } = issueToken('you@example.com');

    const response = await callGet(room.id, '?limit=2', { authorization: `Bearer ${token}` });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.messages.map((message: { body: string }) => message.body)).toEqual([
      'visible middle',
      'visible newer'
    ]);
    expect(payload.paging).toEqual({
      limit: 2,
      before: null,
      hasMore: true,
      nextBefore: visibleMiddle.postOrder,
      sinceBreak: true
    });

    const olderResponse = await callGet(
      room.id,
      `?limit=2&before=${visibleMiddle.postOrder}`,
      { authorization: `Bearer ${token}` }
    );
    expect(olderResponse.status).toBe(200);
    const olderPayload = await olderResponse.json();
    expect(olderPayload.messages.map((message: { body: string }) => message.body)).toEqual([
      'visible older'
    ]);
    expect(olderPayload.paging.hasMore).toBe(false);
    expect(olderPayload.paging.nextBefore).toBeNull();
    expect(olderPayload.messages).not.toContainEqual(expect.objectContaining({ id: visibleMiddle.id }));
    expect(olderPayload.messages).not.toContainEqual(expect.objectContaining({ id: visibleNewer.id }));
  });

  it('hides message reads from authenticated non-members', async () => {
    // @JWPK is the operator here — auto-added as a member of @mark's room, then
    // removed to become a non-member. Pin the operator handle so that auto-add
    // is @JWPK (default-unset would auto-add @you). Verifies a separate
    // authenticated non-member can't read.
    const prior = process.env.ANT_OPERATOR_HANDLE;
    process.env.ANT_OPERATOR_HANDLE = '@JWPK';
    try {
      const room = createChatRoom({ name: 'private-messages', whoCreatedIt: '@mark' });
      postMessage({ roomId: room.id, authorHandle: '@JWPK', body: 'secret' });
      removeMemberFromRoom({ roomId: room.id, globalHandle: '@JWPK' });
      const { token } = issueToken('demo-operator-m5@example.test');

      const response = await callGet(room.id, '', { authorization: `Bearer ${token}` });

      expect(response.status).toBe(404);
    } finally {
      if (prior === undefined) delete process.env.ANT_OPERATOR_HANDLE;
      else process.env.ANT_OPERATOR_HANDLE = prior;
    }
  });

  it('returns the newest message page by default instead of the full room history', async () => {
    const room = createChatRoom({ name: 'paged-route', whoCreatedIt: '@you' });
    for (let i = 1; i <= 105; i += 1) {
      postMessage({ roomId: room.id, authorHandle: '@you', body: `message ${i}` });
    }

    const { token } = issueToken('you@example.com');
    const response = await callGet(room.id, '', { authorization: `Bearer ${token}` });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.messages).toHaveLength(100);
    expect(payload.messages[0].body).toBe('message 6');
    expect(payload.messages.at(-1).body).toBe('message 105');
    expect(payload.paging).toEqual({
      limit: 100,
      before: null,
      hasMore: true,
      nextBefore: payload.messages[0].postOrder,
      sinceBreak: true
    });
  });

  it('supports before and limit cursors for older history', async () => {
    const room = createChatRoom({ name: 'older-route', whoCreatedIt: '@you' });
    const seeded = [];
    for (let i = 1; i <= 5; i += 1) {
      seeded.push(postMessage({ roomId: room.id, authorHandle: '@you', body: `message ${i}` }));
    }

    const { token } = issueToken('you@example.com');
    const response = await callGet(
      room.id,
      `?limit=2&before=${seeded[3].postOrder}`,
      { authorization: `Bearer ${token}` }
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.messages.map((message: { body: string }) => message.body)).toEqual([
      'message 2',
      'message 3'
    ]);
    expect(payload.paging.limit).toBe(2);
    expect(payload.paging.before).toBe(seeded[3].postOrder);
    expect(payload.paging.hasMore).toBe(true);
    expect(payload.paging.nextBefore).toBe(payload.messages[0].postOrder);
  });

  it('attaches per-emoji reaction summaries to message reads', async () => {
    const room = createChatRoom({ name: 'reaction-summary-route', whoCreatedIt: '@you' });
    const first = postMessage({ roomId: room.id, authorHandle: '@you', body: 'first' });
    const second = postMessage({ roomId: room.id, authorHandle: '@you', body: 'second' });
    addReactionToMessage({ messageId: first.id, reactorHandle: '@claude', emoji: '👍' });
    addReactionToMessage({ messageId: first.id, reactorHandle: '@kimi', emoji: '👍' });
    addReactionToMessage({ messageId: first.id, reactorHandle: '@codex', emoji: '🙌' });

    const { token } = issueToken('you@example.com');
    const response = await callGet(room.id, '', { authorization: `Bearer ${token}` });

    expect(response.status).toBe(200);
    const payload = await response.json();
    const firstPayload = payload.messages.find((message: { id: string }) => message.id === first.id);
    const secondPayload = payload.messages.find((message: { id: string }) => message.id === second.id);
    // @you is the viewer (issued token), and never reacted, so viewerHasReacted
    // is false for both emojis. M1 native-app reactions toggle UX depends on
    // this field — see homebrew msg_znoxuoppy8 2026-05-27.
    expect(firstPayload.reactions).toEqual([
      { emoji: '👍', count: 2, topReactors: ['@claude', '@kimi'], viewerHasReacted: false },
      { emoji: '🙌', count: 1, topReactors: ['@codex'], viewerHasReacted: false }
    ]);
    expect(secondPayload.reactions).toBeUndefined();
  });

  it('hydrates persisted read receipts in the message history payload', async () => {
    const room = createChatRoom({ name: 'read-receipt-history', whoCreatedIt: '@you' });
    const read = postMessage({ roomId: room.id, authorHandle: '@you', body: 'read me' });
    const unread = postMessage({ roomId: room.id, authorHandle: '@you', body: 'not read' });
    markMessageRead({ messageId: read.id, readerHandle: '@agent' });

    const { token } = issueToken('you@example.com');
    const response = await callGet(room.id, '', { authorization: `Bearer ${token}` });

    expect(response.status).toBe(200);
    const payload = await response.json();
    const readPayload = payload.messages.find((message: { id: string }) => message.id === read.id);
    const unreadPayload = payload.messages.find((message: { id: string }) => message.id === unread.id);
    expect(readPayload.readReceipts).toEqual([
      expect.objectContaining({ messageId: read.id, readerHandle: '@agent' })
    ]);
    expect(unreadPayload.readReceipts).toBeUndefined();
  });

  it('sets viewerHasReacted=true when the viewer reacted but is outside the truncated topReactors', async () => {
    // Regression coverage for the M1 toggle bug homebrew flagged
    // (msg_znoxuoppy8): topReactors caps at 5, so a viewer whose reaction
    // arrived 6th+ would have been classified as "not reacted" by clients
    // inferring from topReactors. Server-truth `viewerHasReacted` fixes it.
    const room = createChatRoom({ name: 'viewer-outside-topreactors', whoCreatedIt: '@you' });
    const message = postMessage({ roomId: room.id, authorHandle: '@you', body: 'busy emoji' });
    for (const handle of ['@a', '@b', '@c', '@d', '@e']) {
      addReactionToMessage({ messageId: message.id, reactorHandle: handle, emoji: '👍' });
    }
    addReactionToMessage({ messageId: message.id, reactorHandle: '@JWPK', emoji: '👍' });

    const { token } = issueToken('you@example.com');
    const response = await callGet(room.id, '', { authorization: `Bearer ${token}` });
    expect(response.status).toBe(200);
    const payload = await response.json();
    const messagePayload = payload.messages.find((m: { id: string }) => m.id === message.id);
    const thumb = messagePayload.reactions.find((r: { emoji: string }) => r.emoji === '👍');
    expect(thumb.count).toBe(6);
    expect(thumb.topReactors).not.toContain('@JWPK');
    expect(thumb.viewerHasReacted).toBe(true);
  });

  it('keeps hard context-break mode server-side even when include_pre_break is requested', async () => {
    const room = createChatRoom({ name: 'hard-break-boundary', whoCreatedIt: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'before the break' });
    postBreakMessage({ roomId: room.id, postedByHandle: '@you', reason: 'reset' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'after the break' });
    const { token } = issueToken('you@example.com');

    const response = await callGet(
      room.id,
      '?include_pre_break=true',
      { authorization: `Bearer ${token}` }
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.messages.map((message: { body: string }) => message.body)).toEqual([
      expect.stringContaining('Context break'),
      'after the break'
    ]);
    expect(payload.paging.sinceBreak).toBe(true);
  });

  it('rejects malformed pagination parameters', async () => {
    const room = createChatRoom({ name: 'bad-page-route', whoCreatedIt: '@you' });
    const { token } = issueToken('you@example.com');
    const auth = { authorization: `Bearer ${token}` };
    const limitResponse = await callGet(room.id, '?limit=0', auth);
    expect(limitResponse.status).toBe(400);
    const beforeResponse = await callGet(room.id, '?before=abc', auth);
    expect(beforeResponse.status).toBe(400);
  });
});

describe('POST /api/chat-rooms/:roomId/messages with M30 slice 2 parentMessageId', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetChatMessageStoreForTests();
  });

  it('default POST without parentMessageId returns message with NO parent field (zero drift)', async () => {
    const room = createChatRoom({ name: 'r1', whoCreatedIt: '@you' });
    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({ body: 'standalone', ...verifiedCaller(room.id) })
    });
    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.message.parentMessageId).toBeUndefined();
    expect('parentMessageId' in payload.message).toBe(false);
  });

  it('POST with valid in-room parentMessageId returns message with the parent reference', async () => {
    const room = createChatRoom({ name: 'r2', whoCreatedIt: '@you' });
    const parent = postMessage({
      roomId: room.id,
      authorHandle: '@you',
      body: 'parent body'
    });
    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({ body: 'reply body', parentMessageId: parent.id, ...verifiedCaller(room.id) })
    });
    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.message.parentMessageId).toBe(parent.id);
  });

  it('POST with cross-room parentMessageId returns 404 and does NOT create a message', async () => {
    const roomA = createChatRoom({ name: 'rA', whoCreatedIt: '@you' });
    const roomB = createChatRoom({ name: 'rB', whoCreatedIt: '@you' });
    const parentInOther = postMessage({
      roomId: roomA.id,
      authorHandle: '@you',
      body: 'lives in A'
    });
    // Materialise caller (auto-joins + may emit system preamble) BEFORE
    // capturing baseline so the test isolates the POST's effect.
    const caller = verifiedCaller(roomB.id);
    const beforeCount = listMessagesInRoom(roomB.id).length;
    const response = await callPost({
      roomId: roomB.id,
      body: JSON.stringify({ body: 'attempt', parentMessageId: parentInOther.id, ...caller })
    });
    expect(response.status).toBe(404);
    const afterCount = listMessagesInRoom(roomB.id).length;
    expect(afterCount).toBe(beforeCount);
  });

  it('POST with nonexistent parentMessageId returns 404 and does NOT create a message', async () => {
    const room = createChatRoom({ name: 'r3', whoCreatedIt: '@you' });
    const caller = verifiedCaller(room.id);
    const beforeCount = listMessagesInRoom(room.id).length;
    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({ body: 'attempt', parentMessageId: 'msg_nope', ...caller })
    });
    expect(response.status).toBe(404);
    const afterCount = listMessagesInRoom(room.id).length;
    expect(afterCount).toBe(beforeCount);
  });

  it('POST with non-string parentMessageId returns 400 and does NOT create a message', async () => {
    const room = createChatRoom({ name: 'r4', whoCreatedIt: '@you' });
    const caller = verifiedCaller(room.id);
    const beforeCount = listMessagesInRoom(room.id).length;
    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({ body: 'attempt', parentMessageId: 42, ...caller })
    });
    expect(response.status).toBe(400);
    expect(listMessagesInRoom(room.id).length).toBe(beforeCount);
  });

  it('POST with empty-string parentMessageId returns 400 and does NOT create a message', async () => {
    const room = createChatRoom({ name: 'r5', whoCreatedIt: '@you' });
    const caller = verifiedCaller(room.id);
    const beforeCount = listMessagesInRoom(room.id).length;
    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({ body: 'attempt', parentMessageId: '', ...caller })
    });
    expect(response.status).toBe(400);
    expect(listMessagesInRoom(room.id).length).toBe(beforeCount);
  });

  it('POST with whitespace-only parentMessageId returns 400 and does NOT create a message', async () => {
    const room = createChatRoom({ name: 'r6', whoCreatedIt: '@you' });
    const caller = verifiedCaller(room.id);
    const beforeCount = listMessagesInRoom(room.id).length;
    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({ body: 'attempt', parentMessageId: '   ', ...caller })
    });
    expect(response.status).toBe(400);
    expect(listMessagesInRoom(room.id).length).toBe(beforeCount);
  });

  it('valid parentMessageId persists verbatim and is retrievable via GET', async () => {
    const room = createChatRoom({ name: 'r7', whoCreatedIt: '@you' });
    const parent = postMessage({
      roomId: room.id,
      authorHandle: '@you',
      body: 'parent'
    });
    const postResponse = await callPost({
      roomId: room.id,
      body: JSON.stringify({ body: 'reply', parentMessageId: parent.id, ...verifiedCaller(room.id) })
    });
    expect(postResponse.status).toBe(201);
    const { token } = issueToken('you@example.com');
    const getResponse = await callGet(room.id, '', { authorization: `Bearer ${token}` });
    const listPayload = await getResponse.json();
    const replyInList = listPayload.messages.find(
      (message: { body: string }) => message.body === 'reply'
    );
    expect(replyInList.parentMessageId).toBe(parent.id);
  });

  it('existing default POST behavior is preserved (kind defaults, malformed body rejected)', async () => {
    const room = createChatRoom({ name: 'r8', whoCreatedIt: '@you' });
    const goodResponse = await callPost({
      roomId: room.id,
      body: JSON.stringify({ body: 'plain', kind: 'human', ...verifiedCaller(room.id) })
    });
    expect(goodResponse.status).toBe(201);
    const malformedResponse = await callPost({
      roomId: room.id,
      body: JSON.stringify({ body: 'bad', kind: 'system', ...verifiedCaller(room.id) })
    });
    expect(malformedResponse.status).toBe(400);
  });

  it('POST creates ask candidates for bare @you and hands-up signals', async () => {
    const room = createChatRoom({ name: 'candidate-route', whoCreatedIt: '@you' });
    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({
        body: '@you please pick this up 🙌',
        ...verifiedCaller(room.id, '@codex')
      })
    });
    expect(response.status).toBe(201);
    expect(listOpenAskCandidates(room.id).map((candidate) => candidate.sourceType)).toEqual([
      'mention',
      'emoji-message'
    ]);
  });

  it('POST creates ask candidates for standalone @ shorthand and raised hand emoji', async () => {
    const room = createChatRoom({ name: 'candidate-route-short', whoCreatedIt: '@you' });
    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({
        body: '@ can you decide? 🙋‍♂️',
        ...verifiedCaller(room.id, '@codex')
      })
    });
    expect(response.status).toBe(201);
    expect(listOpenAskCandidates(room.id).map((candidate) => candidate.sourceType)).toEqual([
      'mention',
      'emoji-message'
    ]);
  });
});

describe('POST /api/chat-rooms/:roomId/messages IDENTITY-GATE-POSTS (transition mode)', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetChatMessageStoreForTests();
    resetIdentityDbForTests();
  });

  it('pidChain matches a registered membership: server stamps the resolved authorHandle', async () => {
    const room = createChatRoom({ name: 'rg1', whoCreatedIt: '@you' });
    const terminal = upsertTerminal({ pid: 4242, pid_start: 'lstart-a', name: 'researchant-pane' });
    addMembership({ room_id: room.id, handle: '@researchant', terminal_id: terminal.id });

    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({
        body: 'hello',
        pidChain: [{ pid: 4242, pid_start: 'lstart-a' }]
      })
    });
    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.message.authorHandle).toBe('@researchant');
  });

  it('accounts-issued bearer stamps the resolved Mac user handle', async () => {
    const room = createChatRoom({ name: 'mac-bearer-post', whoCreatedIt: '@jamesm5' });
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        user: {
          email: 'demo-operator-m5@example.test',
          handle: '@jamesm5'
        },
        homeServerUrl: 'https://your-hostname.ts.net'
      }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await callPost({
      roomId: room.id,
      headers: { authorization: 'Bearer accounts-token' },
      body: JSON.stringify({
        body: 'hello from the Mac app',
        authorHandle: '@jamesm5'
      })
    });

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.message.authorHandle).toBe('@jamesm5');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://accounts.antonline.dev/api/auth/me',
      expect.objectContaining({
        headers: { authorization: 'Bearer accounts-token' }
      })
    );
  });

  it('accounts-issued bearer rejects a mismatched client authorHandle', async () => {
    const room = createChatRoom({ name: 'mac-bearer-spoof', whoCreatedIt: '@jamesm5' });
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({
        user: {
          email: 'demo-operator-m5@example.test',
          handle: '@jamesm5'
        }
      }), { status: 200 })
    ));

    const response = await callPost({
      roomId: room.id,
      headers: { authorization: 'Bearer accounts-token' },
      body: JSON.stringify({
        body: 'spoof attempt',
        authorHandle: '@you'
      })
    });

    expect(response.status).toBe(403);
    expect(listMessagesInRoom(room.id)).toHaveLength(0);
  });

  it('pidChain resolves a terminal but the terminal has NO membership in this room: rejects without fallback', async () => {
    const otherRoom = createChatRoom({ name: 'rg2-other', whoCreatedIt: '@you' });
    const targetRoom = createChatRoom({ name: 'rg2-target', whoCreatedIt: '@you' });
    const terminal = upsertTerminal({ pid: 5555, pid_start: 'lstart-b', name: 'claude2-pane' });
    addMembership({ room_id: otherRoom.id, handle: '@claude2', terminal_id: terminal.id });
    const beforeCount = listMessagesInRoom(targetRoom.id).length;

    const response = await callPost({
      roomId: targetRoom.id,
      body: JSON.stringify({
        body: 'wrong-room',
        authorHandle: '@cli',
        pidChain: [{ pid: 5555, pid_start: 'lstart-b' }]
      })
    });
    expect(response.status).toBe(403);
    expect(listMessagesInRoom(targetRoom.id)).toHaveLength(beforeCount);
  });

  it('pidChain provided + client sends MISMATCHED authorHandle: rejects without fallback', async () => {
    const room = createChatRoom({ name: 'rg3', whoCreatedIt: '@you' });
    const terminal = upsertTerminal({ pid: 6666, pid_start: 'lstart-c', name: 'evolveantclaude-pane' });
    addMembership({ room_id: room.id, handle: '@evolveantclaude', terminal_id: terminal.id });
    const beforeCount = listMessagesInRoom(room.id).length;

    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({
        body: 'attempt-spoof',
        authorHandle: '@someone-else',
        pidChain: [{ pid: 6666, pid_start: 'lstart-c' }]
      })
    });
    expect(response.status).toBe(403);
    expect(listMessagesInRoom(room.id)).toHaveLength(beforeCount);
  });

  it('no pidChain at all: rejects instead of storing client authorHandle verbatim', async () => {
    const room = createChatRoom({ name: 'rg4', whoCreatedIt: '@you' });
    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({ body: 'legacy', authorHandle: '@cli' })
    });
    expect(response.status).toBe(403);
    expect(listMessagesInRoom(room.id)).toHaveLength(0);
  });

  it('missing authorHandle no longer defaults to @you when identity is unresolved', async () => {
    const room = createChatRoom({ name: 'rg4b', whoCreatedIt: '@you' });
    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({ body: 'anonymous agent post' })
    });
    expect(response.status).toBe(403);
    expect(listMessagesInRoom(room.id)).toHaveLength(0);
  });

  it('durable session posting to an open room auto-joins and stamps the leased handle', async () => {
    const room = createChatRoom({ name: 'durable-open-auto-join', whoCreatedIt: '@you' });
    setRoomPolicy(room.id, { joinPolicy: 'open', readPolicy: 'open' });
    // SECURITY (half 2): the session must be BOUND to a terminal, and the post
    // body must carry a pidChain resolving to that SAME terminal — a session id
    // alone is no longer a bearer credential.
    const terminal = upsertTerminal({ pid: 14_001, pid_start: 'durable-bind-a', name: 'macxeno-pane' });
    const session = createSession({ kind: 'local-cli', label: 'macxeno', terminalId: terminal.id });

    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({
        body: 'hello from a durable session',
        authorHandle: '@macxeno',
        sessionId: session.id,
        pidChain: [{ pid: 14_001, pid_start: 'durable-bind-a' }]
      })
    });

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.message.authorHandle).toBe('@macxeno');
    expect(resolveMember(room.id, '@macxeno')).toBe(session.id);
  });

  it('durable session posting to an open room receives the next free handle when preferred is taken', async () => {
    const room = createChatRoom({ name: 'durable-open-collision', whoCreatedIt: '@you' });
    setRoomPolicy(room.id, { joinPolicy: 'open', readPolicy: 'open' });
    const existing = createSession({ kind: 'local-cli', label: 'existing-macxeno' });
    // The JOINING session must be terminal-bound and post a matching pidChain
    // (half 2 cross-check); the existing lease-holder just needs to pre-exist.
    const joiningTerminal = upsertTerminal({
      pid: 14_002,
      pid_start: 'durable-bind-b',
      name: 'new-macxeno-pane'
    });
    const joining = createSession({
      kind: 'local-cli',
      label: 'new-macxeno',
      terminalId: joiningTerminal.id
    });
    claimHandle(room.id, '@macxeno', existing.id);

    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({
        body: 'collision should suffix',
        authorHandle: '@macxeno',
        sessionId: joining.id,
        pidChain: [{ pid: 14_002, pid_start: 'durable-bind-b' }]
      })
    });

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.message.authorHandle).toBe('@macxeno-1');
    expect(resolveMember(room.id, '@macxeno')).toBe(existing.id);
  });

  it('durable session posting to a non-open room without a lease is rejected', async () => {
    const room = createChatRoom({ name: 'durable-invite-reject', whoCreatedIt: '@you' });
    // Terminal-bound + matching pidChain so the half-2 cross-check PASSES and the
    // 403 here is genuinely the invite-policy rejection, not the cross-check.
    const terminal = upsertTerminal({ pid: 14_004, pid_start: 'durable-bind-d', name: 'blocked-agent-pane' });
    const session = createSession({ kind: 'local-cli', label: 'blocked-agent', terminalId: terminal.id });

    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({
        body: 'should not enter invite room',
        authorHandle: '@blocked-agent',
        sessionId: session.id,
        pidChain: [{ pid: 14_004, pid_start: 'durable-bind-d' }]
      })
    });

    expect(response.status).toBe(403);
    expect(listMessagesInRoom(room.id)).toHaveLength(0);
    expect(resolveMember(room.id, '@blocked-agent')).toBeNull();
  });

  it('durable session with an existing lease posts without minting a suffix', async () => {
    const room = createChatRoom({ name: 'durable-existing-member', whoCreatedIt: '@you' });
    // Even on the existing-lease fast path the caller must prove terminal
    // co-location (half 2): session bound to terminal + matching pidChain.
    const terminal = upsertTerminal({ pid: 14_003, pid_start: 'durable-bind-c', name: 'member-agent-pane' });
    const session = createSession({ kind: 'local-cli', label: 'member-agent', terminalId: terminal.id });
    claimHandle(room.id, '@member-agent', session.id);

    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({
        body: 'existing member post',
        authorHandle: '@member-agent',
        sessionId: session.id,
        pidChain: [{ pid: 14_003, pid_start: 'durable-bind-c' }]
      })
    });

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.message.authorHandle).toBe('@member-agent');
    expect(resolveMember(room.id, '@member-agent')).toBe(session.id);
  });

  it('clean token model: durable secret posts even when pidChain points at a different terminal', async () => {
    const room = createChatRoom({ name: 'durable-secret-mismatch-ignored', whoCreatedIt: '@you' });
    setRoomPolicy(room.id, { joinPolicy: 'open', readPolicy: 'open' });
    const ownerTerminal = upsertTerminal({ pid: 15_001, pid_start: 'half2-owner', name: 'owner-pane' });
    const session = createSession({ kind: 'local-cli', label: '@victim', terminalId: ownerTerminal.id });
    const attackerTerminal = upsertTerminal({ pid: 15_002, pid_start: 'half2-attacker', name: 'attacker-pane' });

    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({
        body: 'secret token wins; pidChain is not identity',
        authorHandle: '@victim',
        sessionId: session.id,
        pidChain: [{ pid: 15_002, pid_start: 'half2-attacker' }]
      })
    });

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.message.authorHandle).toBe('@victim');
    expect(attackerTerminal.id).not.toBe(ownerTerminal.id);
  });

  it('clean token model: durable secret with NO pidChain can post', async () => {
    const room = createChatRoom({ name: 'durable-secret-no-pidchain', whoCreatedIt: '@you' });
    setRoomPolicy(room.id, { joinPolicy: 'open', readPolicy: 'open' });
    const terminal = upsertTerminal({ pid: 15_003, pid_start: 'half2-nopid', name: 'nopid-pane' });
    const session = createSession({ kind: 'local-cli', label: '@nopid-agent', terminalId: terminal.id });

    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({
        body: 'secret token only',
        authorHandle: '@nopid-agent',
        sessionId: session.id
      })
    });

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.message.authorHandle).toBe('@nopid-agent');
    expect(terminal.id).toBeTruthy();
  });

  it('clean token model: durable secret does not require terminal_id binding', async () => {
    const room = createChatRoom({ name: 'durable-secret-unbound', whoCreatedIt: '@you' });
    setRoomPolicy(room.id, { joinPolicy: 'open', readPolicy: 'open' });
    const session = createSession({ kind: 'local-cli', label: '@unbound-agent' });
    const terminal = upsertTerminal({ pid: 15_004, pid_start: 'half2-unbound', name: 'unbound-pane' });

    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({
        body: 'unbound secret token should post',
        authorHandle: '@unbound-agent',
        sessionId: session.id,
        pidChain: [{ pid: 15_004, pid_start: 'half2-unbound' }]
      })
    });

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.message.authorHandle).toBe('@unbound-agent');
    expect(terminal.id).toBeTruthy();
  });

  it('pidChain present but no matching terminal in DB: rejects without fallback', async () => {
    const room = createChatRoom({ name: 'rg5', whoCreatedIt: '@you' });
    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({
        body: 'unknown-caller',
        authorHandle: '@cli',
        pidChain: [{ pid: 9999, pid_start: 'lstart-nope' }]
      })
    });
    expect(response.status).toBe(403);
    expect(listMessagesInRoom(room.id)).toHaveLength(0);
  });

  it('pidChain walks past the immediate pid to find a registered ancestor', async () => {
    const room = createChatRoom({ name: 'rg6', whoCreatedIt: '@you' });
    const terminal = upsertTerminal({ pid: 7777, pid_start: 'lstart-d', name: 'codex2-pane' });
    addMembership({ room_id: room.id, handle: '@codex2', terminal_id: terminal.id });

    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({
        body: 'walk-ancestry',
        pidChain: [
          { pid: 999999, pid_start: 'unregistered-child' },
          { pid: 7777, pid_start: 'lstart-d' }
        ]
      })
    });
    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.message.authorHandle).toBe('@codex2');
  });

  it('malformed pidChain entries are skipped and then rejected without fallback', async () => {
    const room = createChatRoom({ name: 'rg7', whoCreatedIt: '@you' });
    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({
        body: 'malformed',
        authorHandle: '@cli',
        pidChain: [{ pid: 'not-a-number' }, null, { pid: -1 }, 'string-not-object']
      })
    });
    expect(response.status).toBe(403);
    expect(listMessagesInRoom(room.id)).toHaveLength(0);
  });
});

describe('M3.6a-v0 T3: browser-session identity mixed mode', () => {
  // The browser mints the `@you` sentinel; it must resolve to the configured
  // operator handle. Pin `@JWPK` so the seeded `@JWPK` membership lines up with
  // the minted `@you` session (default-unset would map `@you`→`@you`).
  const priorOperatorHandle = process.env.ANT_OPERATOR_HANDLE;
  beforeEach(() => {
    process.env.ANT_OPERATOR_HANDLE = '@JWPK';
    resetChatRoomStoreForTests();
    resetChatMessageStoreForTests();
    resetIdentityDbForTests();
  });
  afterEach(() => {
    if (priorOperatorHandle === undefined) delete process.env.ANT_OPERATOR_HANDLE;
    else process.env.ANT_OPERATOR_HANDLE = priorOperatorHandle;
  });

  function seedBrowserSession() {
    const room = createChatRoom({ name: 'browser-id', whoCreatedIt: '@JWPK' });
    const terminal = upsertTerminal({ pid: 9001, pid_start: 'browser-proof', name: 'browser-public' });
    addMembership({ room_id: room.id, handle: '@JWPK', terminal_id: terminal.id });
    const session = createBrowserSession({ roomId: room.id, authorHandle: '@you' });
    if (!session) throw new Error('expected browser session');
    return { room, session };
  }

  it('valid browser session cookie stores the resolved handle and touches last_seen', async () => {
    const { room, session } = seedBrowserSession();
    const response = await callPost({
      roomId: room.id,
      cookie: `ant_browser_session=${session.browserSessionSecret}`,
      body: JSON.stringify({ body: 'browser hello', authorHandle: '@you' })
    });
    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.message.authorHandle).toBe('@JWPK');
    const row = (await import('$lib/server/db')).getIdentityDb()
      .prepare(`SELECT last_seen_at_ms FROM browser_sessions WHERE id = ?`)
      .get(session.session.id) as { last_seen_at_ms: number | null };
    expect(typeof row.last_seen_at_ms).toBe('number');
  });

  it('browser session cookie with mismatched authorHandle returns 403 and writes no message', async () => {
    const { room, session } = seedBrowserSession();
    const beforeCount = listMessagesInRoom(room.id).length;
    const response = await callPost({
      roomId: room.id,
      cookie: `ant_browser_session=${session.browserSessionSecret}`,
      body: JSON.stringify({ body: 'spoof', authorHandle: '@someone-else' })
    });
    expect(response.status).toBe(403);
    expect(listMessagesInRoom(room.id)).toHaveLength(beforeCount);
  });

  it('GAP-24/#113: invalid browser session cookie falls through to pidChain but rejects without identity', async () => {
    const room = createChatRoom({ name: 'bad-browser-id', whoCreatedIt: '@you' });
    const response = await callPost({
      roomId: room.id,
      cookie: 'ant_browser_session=bws_not_real',
      body: JSON.stringify({ body: 'fallback unblocked', authorHandle: '@you' })
    });
    expect(response.status).toBe(403);
    expect(listMessagesInRoom(room.id)).toHaveLength(0);
  });

  it('GAP-24/#113: malformed browser session cookie also rejects without identity', async () => {
    const room = createChatRoom({ name: 'malformed-browser-id', whoCreatedIt: '@you' });
    const response = await callPost({
      roomId: room.id,
      cookie: 'ant_browser_session=%E0%A4%A',
      body: JSON.stringify({ body: 'bad cookie', authorHandle: '@you' })
    });
    expect(response.status).toBe(403);
    expect(listMessagesInRoom(room.id)).toHaveLength(0);
  });

  it('absent browser session cookie rejects legacy no-identity fallback', async () => {
    const room = createChatRoom({ name: 'legacy-browser-id', whoCreatedIt: '@you' });
    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({ body: 'legacy', authorHandle: '@legacy' })
    });
    expect(response.status).toBe(403);
    expect(listMessagesInRoom(room.id)).toHaveLength(0);
  });

  it('multiple ant_browser_session cookies (Path collision): any valid secret resolves the request', async () => {
    // Regression for the antv4 re-auth bug (JWPK msg_y0p7c8j3sr, 2026-05-19):
    // demo-login mints Path=/ and the per-room mint adds Path=/api/chat-rooms/{id},
    // both with cookie name ant_browser_session. Browsers send BOTH on requests
    // to the room API. The first-match read used to ignore the second cookie,
    // so a stale Path=/ value masked a still-valid Path=/api/chat-rooms/{id}
    // value. The resolver now iterates every match.
    const { room, session } = seedBrowserSession();
    const response = await callPost({
      roomId: room.id,
      // stale-first ordering — invalid Path=/ cookie before the valid per-room one
      cookie: `ant_browser_session=bws_stale_demo_login; ant_browser_session=${session.browserSessionSecret}`,
      body: JSON.stringify({ body: 'multi-cookie hello', authorHandle: '@you' })
    });
    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.message.authorHandle).toBe('@JWPK');
  });
});

describe('POST /api/chat-rooms/:roomId/messages M3.4a-v2 T3d touchpoint integration', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetChatMessageStoreForTests();
    resetIdentityDbForTests();
  });

  it('bumps last_message_sent_at_ms on the authoring terminal when authorHandle maps to a room member', async () => {
    const { getTerminalById } = await import('$lib/server/terminalsStore');
    const room = createChatRoom({ name: 'r-touch', whoCreatedIt: '@you' });
    const terminal = upsertTerminal({ pid: 8001, pid_start: 'tp1', name: 'mapped-author' });
    addMembership({ room_id: room.id, handle: '@mapped', terminal_id: terminal.id });
    const tBeforeMs = Date.now();

    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({
        body: 'hello from mapped handle',
        authorHandle: '@mapped',
        pidChain: [{ pid: 8001, pid_start: 'tp1' }]
      })
    });
    expect(response.status).toBe(201);

    const after = getTerminalById(terminal.id);
    expect(typeof after?.last_message_sent_at_ms).toBe('number');
    expect(after?.last_message_sent_at_ms).toBeGreaterThanOrEqual(tBeforeMs);
  });

  it('rejects when authorHandle does not map to a verified caller terminal', async () => {
    const { getTerminalById } = await import('$lib/server/terminalsStore');
    const room = createChatRoom({ name: 'r-unmapped', whoCreatedIt: '@you' });
    const terminal = upsertTerminal({ pid: 8002, pid_start: 'tp2', name: 'unrelated' });
    addMembership({ room_id: room.id, handle: '@actual-member', terminal_id: terminal.id });
    const beforeCount = listMessagesInRoom(room.id).length;

    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({ body: 'msg from unmapped name', authorHandle: '@unrelated-name' })
    });
    expect(response.status).toBe(403);
    expect(listMessagesInRoom(room.id)).toHaveLength(beforeCount);

    const after = getTerminalById(terminal.id);
    expect(after?.last_message_sent_at_ms ?? null).toBeNull();
  });
});

describe('M3.4b T2: POST /messages discussion_id passthrough', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetChatMessageStoreForTests();
  });

  it('POST with discussion_id in body → 201 + payload + list both carry discussion_id', async () => {
    const room = createChatRoom({ name: 'r-disc-route', whoCreatedIt: '@you' });
    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({ body: 'in discussion', discussion_id: 'disc-123', ...verifiedCaller(room.id) })
    });
    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.message.discussion_id).toBe('disc-123');
    const listed = listMessagesInRoom(room.id);
    expect(listed[listed.length - 1].discussion_id).toBe('disc-123');
  });

  it('POST without discussion_id → 201 + payload has no discussion_id field (zero-drift)', async () => {
    const room = createChatRoom({ name: 'r-no-disc-route', whoCreatedIt: '@you' });
    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({ body: 'root message', ...verifiedCaller(room.id) })
    });
    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.message.discussion_id).toBeUndefined();
    expect('discussion_id' in payload.message).toBe(false);
  });
});

// M3.6a-v1 T1: deprecation-window strict-403 flip. Warning phase 201 + header,
// strict phase 403 with Q3 hint body, VALID pidChain succeeds in strict phase
// (Q2 pidChain mixed-mode permanent). Phase toggled via env override.
describe('M3.6a-v1 deprecation-window strict-403 flip', () => {
  const previousEnv = process.env.ANT_AUTH_DEPRECATION_CUTOVER_MS;
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetChatMessageStoreForTests();
    resetIdentityDbForTests();
  });
  afterEach(() => {
    if (previousEnv === undefined) delete process.env.ANT_AUTH_DEPRECATION_CUTOVER_MS;
    else process.env.ANT_AUTH_DEPRECATION_CUTOVER_MS = previousEnv;
  });

  it('warning phase: POST without pidChain or cookie still returns 403 after #113 fail-closed fix', async () => {
    process.env.ANT_AUTH_DEPRECATION_CUTOVER_MS = String(Date.now() + 86_400_000);
    const room = createChatRoom({ name: 'r-warn', whoCreatedIt: '@you' });
    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({ body: 'legacy caller', authorHandle: '@legacy' })
    });
    expect(response.status).toBe(403);
    expect(response.headers.get('x-auth-deprecation')).toBeNull();
    expect(listMessagesInRoom(room.id)).toHaveLength(0);
  });

  it('strict phase: POST without pidChain or cookie returns 403 with hint body', async () => {
    process.env.ANT_AUTH_DEPRECATION_CUTOVER_MS = '0';
    const room = createChatRoom({ name: 'r-strict', whoCreatedIt: '@you' });
    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({ body: 'attempt', authorHandle: '@legacy' })
    });
    expect(response.status).toBe(403);
    const payload = await response.json();
    expect(payload.message).toMatch(/Server-resolved identity required/);
    expect(payload.message).toMatch(/POST \/api\/chat-rooms\/.*\/browser-session/);
  });

  it('strict phase: VALID pidChain still succeeds 201 (Q2 pidChain mixed-mode permanent)', async () => {
    process.env.ANT_AUTH_DEPRECATION_CUTOVER_MS = '0';
    const room = createChatRoom({ name: 'r-pid-strict', whoCreatedIt: '@you' });
    const terminal = upsertTerminal({ pid: 4242, pid_start: 'ps42', name: 'cli-caller' });
    addMembership({ room_id: room.id, handle: '@cli-caller', terminal_id: terminal.id });
    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({
        body: 'cli post',
        authorHandle: '@cli-caller',
        pidChain: [{ pid: 4242, pid_start: 'ps42' }]
      })
    });
    expect(response.status).toBe(201);
    expect(response.headers.get('x-auth-deprecation')).toBeNull();
  });

  it('auto-registers an agent delivery member into the chat-room roster on post', async () => {
    process.env.ANT_AUTH_DEPRECATION_CUTOVER_MS = '0';
    const room = createChatRoom({ name: 'r-agent-roster', whoCreatedIt: '@you' });
    const caller = verifiedCaller(room.id, '@xenoCC');
    expect(findChatRoomById(room.id)?.members.some((member) => member.handle === '@xenoCC')).toBe(false);

    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({
        body: 'router-backed post',
        ...caller
      })
    });

    expect(response.status).toBe(201);
    const updated = findChatRoomById(room.id);
    expect(updated?.members.some((member) => member.handle === '@xenoCC' && member.kind === 'agent')).toBe(true);
  });

  // GAP-24 (2026-05-14, canonical RQO32 Fix Shape B greenlight): invalid
  // cookie no longer beats valid pidChain — it falls through to step 2 +
  // step 3 of the resolver and the stale cookie is cleared. Mismatched-
  // handle on a VALID cookie still 403s (separate test). Post-2026-05-28
  // strict-flip, applyDeprecationOrThrow re-introduces the 403 with a
  // clearer hint than the prior "Invalid browser session" message.
  it('GAP-24: cookie-invalid + valid pidChain falls through to pidChain + clears stale cookie', async () => {
    process.env.ANT_AUTH_DEPRECATION_CUTOVER_MS = String(Date.now() + 86_400_000);
    const room = createChatRoom({ name: 'r-fallthrough', whoCreatedIt: '@you' });
    const terminal = upsertTerminal({ pid: 5151, pid_start: 'ps51', name: 'cli-caller' });
    addMembership({ room_id: room.id, handle: '@cli-caller', terminal_id: terminal.id });
    const response = await callPost({
      roomId: room.id,
      cookie: 'ant_browser_session=invalid-secret-xyz',
      body: JSON.stringify({
        body: 'fallthrough ok',
        authorHandle: '@cli-caller',
        pidChain: [{ pid: 5151, pid_start: 'ps51' }]
      })
    });
    expect(response.status).toBe(201);
    expect(response.headers.get('set-cookie') ?? '').toContain('ant_browser_session=;');
    expect(response.headers.get('set-cookie') ?? '').toContain('Max-Age=0');
  });
});

// plan_consent_gate_2026_05_20 T6: fail-closed post-gate. "no agent can post
// as a human without that human's consent" — when a write resolves an author
// handle to a human owner_id, the caller MUST either be on the owner's own
// terminal (self-post) OR consume one unit of an active human_consent_grant.
// The consuming grant_id is recorded on chat_messages.consumed_grant_id for
// audit. Self-posts leave the column NULL.
describe('plan_consent_gate_2026_05_20 T6: post-gate + grant_id audit', () => {
  beforeEach(async () => {
    resetChatRoomStoreForTests();
    resetChatMessageStoreForTests();
    resetIdentityDbForTests();
    // File-based vitest DB persists across `resetIdentityDbForTests` (it only
    // closes the handle). Owners.primary_handle UNIQUE constraint trips when
    // each test re-uses @james. Explicit purge on a freshly-opened handle.
    const { getIdentityDb } = await import('$lib/server/db');
    const db = getIdentityDb();
    db.prepare(`DELETE FROM owner_handles`).run();
    db.prepare(`DELETE FROM human_consent_grants`).run();
    db.prepare(`DELETE FROM owners`).run();
  });

  async function importStores() {
    const { createOwner } = await import('$lib/server/ownersStore');
    const { createHumanConsentGrant } = await import('$lib/server/humanConsentGrantsStore');
    const { getIdentityDb } = await import('$lib/server/db');
    return { createOwner, createHumanConsentGrant, getIdentityDb };
  }

  it('rejects 403 when an agent posts AS a human handle with no active grant', async () => {
    const { createOwner } = await importStores();
    const { grantHumanGrant } = await import('$lib/server/callerGrantsStore');
    const room = createChatRoom({ name: 'gate-no-grant', whoCreatedIt: '@you' });
    // Make the structural operator a real owner (human-kind handle in owner_handles). With no
    // human_consent_grant tied to the agent's terminal, the post-gate denies.
    createOwner({ handle: '@JWPK', password: 'pw' });
    // Agent's terminal exists (lookupTerminalByPidChain finds it) but is NOT
    // a member of @JWPK in this room, so resolveServerSideHandle returns null
    // and the route falls through to the caller-grants path. A human caller-
    // grant lets the agent post AS @JWPK at the identity layer — and the new
    // consent gate is exactly the guard for this impersonation vector.
    upsertTerminal({ pid: 12321, pid_start: 'agent-ps', name: 'rogue-agent' });
    grantHumanGrant({
      pid: 12321,
      pidStart: 'agent-ps',
      expiresAtMs: Date.now() + 15 * 60_000,
      grantedByHandle: '@JWPK'
    });

    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({
        body: 'rogue post as @JWPK via grant',
        authorHandle: '@you',
        pidChain: [{ pid: 12321, pid_start: 'agent-ps' }]
      })
    });

    expect(response.status).toBe(403);
    const payload = await response.json();
    expect(payload.message).toMatch(/human_impersonation_/);
    expect(listMessagesInRoom(room.id)).toHaveLength(0);
  });

  it('accepts 201 + records consumed_grant_id on the row when an active grant covers the agent terminal', async () => {
    const { createOwner, createHumanConsentGrant, getIdentityDb } = await importStores();
    const { grantHumanGrant } = await import('$lib/server/callerGrantsStore');
    const room = createChatRoom({ name: 'gate-grant-ok', whoCreatedIt: '@you' });
    // Make the structural operator a real owner (human-kind handle) so the gate fires when the
    // caller-grant resolves the authorHandle to @JWPK.
    const owner = createOwner({ handle: '@JWPK', password: 'pw' });
    const agentTerminal = upsertTerminal({ pid: 13131, pid_start: 'agent-ps2', name: 'consented-agent' });
    // Caller-grant lets the agent's pidChain post as @JWPK at the identity
    // layer. The consent gate then runs and finds an active human_consent_grant
    // tied to the same terminal, consumes one unit, and records the grant_id.
    grantHumanGrant({
      pid: 13131,
      pidStart: 'agent-ps2',
      expiresAtMs: Date.now() + 15 * 60_000,
      grantedByHandle: '@JWPK'
    });
    const grant = createHumanConsentGrant({
      ownerId: owner.id,
      grantedToTerminalId: agentTerminal.id,
      grantedToHandle: '@JWPK',
      createdByTerminalId: 't_human_self',
      durationMs: 30 * 60_000,
      maxUses: 3
    });

    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({
        body: 'consented agent post',
        authorHandle: '@you',
        pidChain: [{ pid: 13131, pid_start: 'agent-ps2' }]
      })
    });
    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.message.authorHandle).toBe('@JWPK');

    const row = getIdentityDb()
      .prepare(`SELECT consumed_grant_id FROM chat_messages WHERE id = ?`)
      .get(payload.message.id) as { consumed_grant_id: string | null };
    expect(row.consumed_grant_id).toBe(grant.id);
  });

  it('self-post (human on own terminal) returns 201 with consumed_grant_id NULL', async () => {
    const { createOwner, getIdentityDb } = await importStores();
    const room = createChatRoom({ name: 'gate-self-post', whoCreatedIt: '@you' });
    // Owner exists with the SAME handle the caller will post under, and the
    // caller's terminal is the room member for that handle — the self-post
    // carve-out fires inside the gate (room_memberships join → owner).
    createOwner({ handle: '@james', password: 'pw' });
    const ownTerminal = upsertTerminal({ pid: 14141, pid_start: 'own-ps', name: 'james-own' });
    addMembership({ room_id: room.id, handle: '@james', terminal_id: ownTerminal.id });

    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({
        body: 'self post as james',
        authorHandle: '@james',
        pidChain: [{ pid: 14141, pid_start: 'own-ps' }]
      })
    });
    expect(response.status).toBe(201);
    const payload = await response.json();

    const row = getIdentityDb()
      .prepare(`SELECT consumed_grant_id FROM chat_messages WHERE id = ?`)
      .get(payload.message.id) as { consumed_grant_id: string | null };
    expect(row.consumed_grant_id).toBeNull();
  });
});

// R2 (token→terminal binding, 2026-06-04): the sessionToken stops being a pure
// bearer credential. Staged via ANT_TOKEN_TERMINAL_BINDING (off|flag|strict,
// default flag). flag logs-not-rejects (lockout-safe); strict rejects ONLY the
// active cross-terminal theft case; token-only/no-pidChain stays allowed at R2
// (tightens in R3). See tokenTerminalBinding.ts.
describe('POST /api/chat-rooms/:roomId/messages — R2 token→terminal binding', () => {
  const prevBindMode = process.env.ANT_TOKEN_TERMINAL_BINDING;
  afterEach(() => {
    if (prevBindMode === undefined) delete process.env.ANT_TOKEN_TERMINAL_BINDING;
    else process.env.ANT_TOKEN_TERMINAL_BINDING = prevBindMode;
  });

  function seedOwner(roomName: string, pid: number, pidStart: string, handle: string) {
    const room = createChatRoom({ name: roomName, whoCreatedIt: '@you' });
    setRoomPolicy(room.id, { joinPolicy: 'open', readPolicy: 'open' });
    const terminal = upsertTerminal({ pid, pid_start: pidStart, name: `${handle}-pane` });
    const session = createSession({
      kind: 'local-cli',
      label: handle.replace(/^@/, ''),
      terminalId: terminal.id
    });
    return { room, session };
  }

  it('STRICT: stolen token presented from a DIFFERENT terminal is rejected (negative test)', async () => {
    process.env.ANT_TOKEN_TERMINAL_BINDING = 'strict';
    const { room, session } = seedOwner('r2-strict-theft', 15_001, 'r2-owner', '@r2owner');
    upsertTerminal({ pid: 15_002, pid_start: 'r2-thief', name: 'r2-thief-pane' }); // the thief's real terminal
    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({
        body: 'stolen-token post',
        authorHandle: '@r2owner',
        sessionId: session.id,
        pidChain: [{ pid: 15_002, pid_start: 'r2-thief' }] // WRONG terminal
      })
    });
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).toMatch(/not bound|bound to/i);
  });

  it('STRICT: same token from its OWN terminal still posts (legit caller unaffected)', async () => {
    process.env.ANT_TOKEN_TERMINAL_BINDING = 'strict';
    const { room, session } = seedOwner('r2-strict-ok', 15_010, 'r2-ok', '@r2ok');
    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({
        body: 'legit post',
        authorHandle: '@r2ok',
        sessionId: session.id,
        pidChain: [{ pid: 15_010, pid_start: 'r2-ok' }] // MATCHING terminal
      })
    });
    expect(response.status).toBe(201);
  });

  it('STRICT: token-only (no pidChain) still posts at R2 — no inverted lockout (tightens in R3)', async () => {
    process.env.ANT_TOKEN_TERMINAL_BINDING = 'strict';
    const { room, session } = seedOwner('r2-strict-tokenonly', 15_020, 'r2-to', '@r2to');
    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({
        body: 'token-only post',
        authorHandle: '@r2to',
        sessionId: session.id // NO pidChain
      })
    });
    expect(response.status).toBe(201);
  });

  it('FLAG (default): a wrong-terminal token is logged but still posts — lockout-safe deploy', async () => {
    process.env.ANT_TOKEN_TERMINAL_BINDING = 'flag';
    const { room, session } = seedOwner('r2-flag-theft', 15_030, 'r2-fowner', '@r2fowner');
    upsertTerminal({ pid: 15_031, pid_start: 'r2-fthief', name: 'r2-fthief-pane' });
    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({
        body: 'flag-mode wrong-terminal',
        authorHandle: '@r2fowner',
        sessionId: session.id,
        pidChain: [{ pid: 15_031, pid_start: 'r2-fthief' }]
      })
    });
    expect(response.status).toBe(201); // logged, not rejected
  });

  it('CREDENTIAL HYGIENE: the violation log NEVER contains the raw sessionToken', async () => {
    process.env.ANT_TOKEN_TERMINAL_BINDING = 'flag';
    const { room, session } = seedOwner('r2-log-hygiene', 15_040, 'r2-log', '@r2log');
    upsertTerminal({ pid: 15_041, pid_start: 'r2-logthief', name: 'r2-logthief-pane' });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const response = await callPost({
        roomId: room.id,
        body: JSON.stringify({
          body: 'trigger a flagged violation',
          authorHandle: '@r2log',
          sessionId: session.id,
          pidChain: [{ pid: 15_041, pid_start: 'r2-logthief' }]
        })
      });
      expect(response.status).toBe(201);
      // It must have logged the violation …
      const logged = warnSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logged).toContain('[token-binding:');
      expect(logged).toContain('session_fp=');
      // … but NEVER the secret token itself.
      expect(logged).not.toContain(session.id);
      expect(logged).toContain(sessionFingerprint(session.id));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('CREDENTIAL HYGIENE: legacy id==terminal_id — the token never leaks via session_terminal either', async () => {
    process.env.ANT_TOKEN_TERMINAL_BINDING = 'flag';
    const room = createChatRoom({ name: 'r2-legacy-conflate', whoCreatedIt: '@you' });
    setRoomPolicy(room.id, { joinPolicy: 'open', readPolicy: 'open' });
    // The shape the original no-leak test STRUCTURALLY couldn't hit: a legacy
    // hand-aligned session where ant_sessions.id == terminal_id, so the
    // "terminal id" IS the token. createSession mints a random id, so force the
    // equality via the DB.
    const terminal = upsertTerminal({ pid: 15_050, pid_start: 'r2-legacy', name: 'r2-legacy-pane' });
    const session = createSession({ kind: 'local-cli', label: 'r2legacy', terminalId: terminal.id });
    const { getIdentityDb } = await import('$lib/server/db');
    getIdentityDb().prepare(`UPDATE ant_sessions SET terminal_id = id WHERE id = ?`).run(session.id);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const response = await callPost({
        roomId: room.id,
        body: JSON.stringify({ body: 'legacy conflate post', authorHandle: '@r2legacy', sessionId: session.id })
        // no pidChain → flagged violation → the log line is emitted
      });
      expect(response.status).toBe(201);
      const logged = warnSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logged).toContain('session_terminal_fp=');
      // the token == id == terminal_id must NOT appear raw via ANY field
      expect(logged).not.toContain(session.id);
      expect(logged).toContain(sessionFingerprint(session.id));
    } finally {
      warnSpy.mockRestore();
    }
  });
});
