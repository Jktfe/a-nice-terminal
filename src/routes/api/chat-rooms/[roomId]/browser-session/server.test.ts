import { beforeEach, describe, expect, it } from 'vitest';
import { POST } from './+server';
import { createChatRoom, findChatRoomById, inviteAgentToRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { setRoomMode } from '$lib/server/roomModesStore';
import { getIdentityDb, resetIdentityDbForTests } from '$lib/server/db';
import { addMembership } from '$lib/server/roomMembershipsStore';
import { adoptExternalProcessForTerminal, upsertTerminal } from '$lib/server/terminalsStore';
import { createTerminalRecord } from '$lib/server/terminalRecordsStore';
import { createOwner } from '$lib/server/ownersStore';
import { createHumanConsentGrant } from '$lib/server/humanConsentGrantsStore';

type PostOptions = {
  roomId: string;
  body?: string;
  origin?: string | null;
  host?: string | null;
  url?: string;
};

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
});

function bindIdentityMembership(roomId: string, handle: string): void {
  const terminal = upsertTerminal({ pid: 777, pid_start: `pst-${handle}`, name: `term-${roomId}-${handle}` });
  addMembership({ room_id: roomId, handle, terminal_id: terminal.id });
}

async function callPost(options: PostOptions): Promise<Response> {
  const targetUrl = options.url ?? `https://ant.local/api/chat-rooms/${options.roomId}/browser-session`;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.origin !== null) headers.origin = options.origin ?? new URL(targetUrl).origin;
  if (options.host !== null) headers.host = options.host ?? new URL(targetUrl).host;
  const request = new Request(targetUrl, { method: 'POST', headers, body: options.body });
  const event = {
    request,
    params: { roomId: options.roomId },
    url: new URL(targetUrl)
  } as unknown as Parameters<typeof POST>[0];
  try {
    return (await POST(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const failure = thrown as { status?: number; body?: unknown };
    if (typeof failure.status === 'number') {
      return new Response(JSON.stringify(failure.body ?? {}), { status: failure.status });
    }
    throw thrown;
  }
}

function browserSessionCount(): number {
  const row = getIdentityDb().prepare(`SELECT COUNT(*) AS count FROM browser_sessions`).get() as { count: number };
  return row.count;
}

describe('POST /api/chat-rooms/:roomId/browser-session', () => {
  it('mints a browser session cookie for an existing room member with identity membership', async () => {
    const room = createChatRoom({ name: 'browser', whoCreatedIt: '@you' });
    bindIdentityMembership(room.id, '@you');
    const response = await callPost({ roomId: room.id, body: JSON.stringify({ authorHandle: '@you' }) });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.browserSession).toMatchObject({
      room_id: room.id,
      handle: '@you'
    });
    expect(JSON.stringify(body)).not.toContain('bws_');
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('ant_browser_session=bws_');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain(`Path=/api/chat-rooms/${room.id}`);
    // 30-day TTL — bumped from 24h in 100f44b (JWPK 'I can't sign in
    // every day' fix). 30 * 86_400 = 2_592_000.
    expect(setCookie).toContain('Max-Age=2592000');
  });

  // GAP-55 (2026-05-14, JWPK Tailscale dogfood evidence): browser-only
  // operators (no `ant register` ever run from a CLI) hit this route for
  // a room they're already a model-member of, but lacked a terminal binding.
  // The strict pre-fix 403 silently broke the entire downstream SSE chain.
  // Option A lazy-creates a synthetic browser terminal + room_memberships
  // row so the route returns 201 + valid session cookie.
  it('GAP-55: room model-member without a terminal binding gets a synthetic terminal + 201 session', async () => {
    const room = createChatRoom({ name: 'browser', whoCreatedIt: '@you' });
    const response = await callPost({ roomId: room.id, body: JSON.stringify({ authorHandle: '@you' }) });
    expect(response.status).toBe(201);
    expect(browserSessionCount()).toBe(1);
    const payload = await response.json();
    expect(payload.browserSession.handle).toBe('@you');
  });

  it('binds agent browser-session mint to the live terminal record before browser fallback', async () => {
    const record = createTerminalRecord({
      sessionId: 'codex-live-session',
      name: 'evolveantcodex',
      handle: '@evolveantcodex',
      agentKind: 'codex',
      tmuxTargetPane: 'codex-live-session:0.0'
    });
    adoptExternalProcessForTerminal({
      record,
      pid: 4242,
      pidStart: 'pid-start-codex',
      ttlSeconds: 3600
    });
    const room = createChatRoom({ name: 'codex side room', whoCreatedIt: '@evolveantcodex' });

    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({ authorHandle: '@evolveantcodex' })
    });

    expect(response.status).toBe(201);
    const membership = getIdentityDb()
      .prepare(`SELECT terminal_id FROM room_memberships WHERE room_id = ? AND handle = ? AND revoked_at_ms IS NULL`)
      .get(room.id, '@evolveantcodex') as { terminal_id: string } | undefined;
    expect(membership?.terminal_id).toBe('codex-live-session');
  });

  it('CLOSED rooms reject an arbitrary existing identity handle that is not in the room model', async () => {
    // Contract update post-d61203e (feat(doors): open-room auto-join):
    // OPEN rooms (brainstorm, default) now auto-join non-members via the
    // browser-session mint path. This security invariant only fires on
    // CLOSED rooms, where the reject-path must still hold. The test
    // explicitly closes the room before probing.
    const room = createChatRoom({ name: 'browser', whoCreatedIt: '@you' });
    setRoomMode({ roomId: room.id, mode: 'closed', set_by: '@you' });
    bindIdentityMembership(room.id, '@stranger');
    const response = await callPost({ roomId: room.id, body: JSON.stringify({ authorHandle: '@stranger' }) });
    expect(response.status).toBe(403);
    expect(browserSessionCount()).toBe(0);
  });

  // OPEN-room auto-join SHIPPED — d61203e (open-room semantics) +
  // followup-fix that deletes the FK-child-2ting pre-emptive
  // addMembership({terminal_id: ''}) at line 118 and lets the
  // lazy-create synthetic-terminal block below (lines ~120-128)
  // handle BOTH terminal upsert AND addMembership atomically with a
  // valid FK reference.
  it('OPEN rooms auto-join an arbitrary stranger via browser-session mint', async () => {
    const room = createChatRoom({ name: 'browser', whoCreatedIt: '@you' });
    const response = await callPost({ roomId: room.id, body: JSON.stringify({ authorHandle: '@stranger' }) });
    expect(response.status).toBe(201);
    expect(browserSessionCount()).toBe(1);
    const payload = await response.json();
    expect(payload.browserSession.handle).toBe('@stranger');
    expect(findChatRoomById(room.id)?.members.some((member) => member.handle === '@stranger' && member.kind === 'agent')).toBe(true);
  });

  it('normalises authorHandle against both room model and identity membership', async () => {
    const room = createChatRoom({ name: 'browser', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@codex' });
    bindIdentityMembership(room.id, '@codex');
    const response = await callPost({ roomId: room.id, body: JSON.stringify({ authorHandle: ' codex ' }) });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.browserSession.handle).toBe('@codex');
  });

  it('rejects cross-origin, missing-origin, and host-mismatch POSTs before minting', async () => {
    const room = createChatRoom({ name: 'browser', whoCreatedIt: '@you' });
    bindIdentityMembership(room.id, '@you');
    expect((await callPost({
      roomId: room.id,
      body: JSON.stringify({ authorHandle: '@you' }),
      origin: 'https://evil.local'
    })).status).toBe(403);
    expect((await callPost({
      roomId: room.id,
      body: JSON.stringify({ authorHandle: '@you' }),
      origin: null
    })).status).toBe(403);
    expect((await callPost({
      roomId: room.id,
      body: JSON.stringify({ authorHandle: '@you' }),
      host: 'wrong.local'
    })).status).toBe(403);
    expect(browserSessionCount()).toBe(0);
  });

  // plan_consent_gate_2026_05_20 T5: mint-gate fail-closed on
   // human-handle impersonation. The gate is keyed off owner_id, not the
   // handle string — a handle that resolves via owner_handles to a real
   // human owner triggers the gate; agent handles fall through unchanged.
  describe('consent gate (T5 mint-gate)', () => {
    it('rejects a human-handle mint when caller has no active grant', async () => {
      const owner = createOwner({ handle: '@james', password: 'pw-test' });
      const room = createChatRoom({ name: 'consent-no-grant', whoCreatedIt: '@james' });
      // caller terminal exists and is supplied in pidChain, but has no
      // consent grant for owner_id — gate must throw 403 with structured
      // human_impersonation_no_grant body before any session is minted.
      const callerTerminal = upsertTerminal({ pid: 9991, pid_start: 'pst-caller', name: 'caller' });
      const response = await callPost({
        roomId: room.id,
        body: JSON.stringify({
          authorHandle: '@james',
          pidChain: [{ pid: callerTerminal.pid, pid_start: callerTerminal.pid_start }]
        })
      });
      expect(response.status).toBe(403);
      const payload = await response.json().catch(() => ({}));
      expect(JSON.stringify(payload)).toMatch(/human_impersonation_no_grant/);
      expect(browserSessionCount()).toBe(0);
      // owner row should still exist; just confirming setup wasn't shorted
      expect(owner.id).toBeTruthy();
    });

    it('allows a human-handle mint when caller terminal has an active grant', async () => {
      const owner = createOwner({ handle: '@james', password: 'pw-test' });
      const room = createChatRoom({ name: 'consent-with-grant', whoCreatedIt: '@james' });
      // owner's own terminal needs to exist as a terminals row so the
      // human_consent_grants FK (created_by_terminal_id) holds.
      const ownerSelfTerminal = upsertTerminal({ pid: 1, pid_start: 'pst-owner', name: 'owner-self' });
      const callerTerminal = upsertTerminal({ pid: 9992, pid_start: 'pst-grant', name: 'grant-caller' });
      createHumanConsentGrant({
        ownerId: owner.id,
        grantedToTerminalId: callerTerminal.id,
        grantedToHandle: '@james',
        createdByTerminalId: ownerSelfTerminal.id,
        durationMs: 30 * 60_000,
        maxUses: 5
      });
      const response = await callPost({
        roomId: room.id,
        body: JSON.stringify({
          authorHandle: '@james',
          pidChain: [{ pid: callerTerminal.pid, pid_start: callerTerminal.pid_start }]
        })
      });
      expect(response.status).toBe(201);
      expect(browserSessionCount()).toBe(1);
      const payload = await response.json();
      expect(payload.browserSession.handle).toBe('@james');
    });

    it('lets an agent handle mint pass — gate does not fire on non-human owners', async () => {
      const room = createChatRoom({ name: 'consent-agent-pass', whoCreatedIt: '@you' });
      // @codex is NOT in owner_handles → resolveHumanOwnership returns
      // { kind: 'agent' } and the gate never runs. Behaviour identical
      // to the GAP-55 auto-join path proven in test above.
      const response = await callPost({
        roomId: room.id,
        body: JSON.stringify({ authorHandle: '@codex' })
      });
      expect(response.status).toBe(201);
      expect(browserSessionCount()).toBe(1);
      const payload = await response.json();
      expect(payload.browserSession.handle).toBe('@codex');
    });
  });

  it('omits Secure on http but keeps strict cookie attributes', async () => {
    const room = createChatRoom({ name: 'browser', whoCreatedIt: '@you' });
    bindIdentityMembership(room.id, '@you');
    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({ authorHandle: '@you' }),
      url: `http://localhost/api/chat-rooms/${room.id}/browser-session`
    });
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).not.toContain('Secure');
  });
});
