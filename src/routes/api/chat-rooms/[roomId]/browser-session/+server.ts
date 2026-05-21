import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ensureAgentMemberInRoom, findChatRoomById } from '$lib/server/chatRoomStore';
import { addMembership, getTerminalIdByHandle } from '$lib/server/roomMembershipsStore';
import { lookupTerminalByPidChain, upsertTerminal } from '$lib/server/terminalsStore';
import { createBrowserSession } from '$lib/server/browserSessionStore';
import { getRoomMode } from '$lib/server/roomModesStore';
import { bindRoomHandleToLiveTerminal } from '$lib/server/terminalHandleBinding';
import { parsePidChainFromBody, resolveServerSideHandle } from '$lib/server/identityGate';
import {
  canReadChatRoom,
  resolveChatRoomReadAccess,
  type ChatRoomReadAccess
} from '$lib/server/chatRoomReadGate';
import { familyHandlesForPrincipal } from '$lib/server/agentFamilyStore';
import {
  resolveHumanOwnership,
  type OwnershipResolution,
  requireHumanImpersonationConsent
} from '$lib/server/consentGate';

function normalizeHandle(rawHandle: string): string {
  const trimmed = rawHandle.trim();
  if (trimmed.length === 0) return trimmed;
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

async function parseRequiredJsonBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length === 0) throw error(400, 'Body must be a JSON object.');
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw error(400, 'Body must be a JSON object.');
    }
    return parsed as Record<string, unknown>;
  } catch (failure) {
    if (failure instanceof SyntaxError) throw error(400, 'Body must be valid JSON.');
    throw failure;
  }
}

function requireSameOrigin(request: Request, url: URL): void {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!origin || !host) throw error(403, 'same-origin browser POST required');
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    throw error(403, 'same-origin browser POST required');
  }
  // GAP-55 follow-up (2026-05-14, JWPK Tailscale dogfood): protocol
  // comparison is unreliable across the SvelteKit adapter-node + Tailscale
  // TLS-termination boundary — adapter-node default-classifies the request
  // url as `https:` even when the browser-visible scheme + Origin header
  // are plain `http:`, which deadlocks every same-origin browser-session
  // POST behind a 403. The security invariant we actually want is
  // browser-supplied Origin.host MATCHES the request Host header (proves
  // the browser was on the same hostname:port the server is serving),
  // independent of which side terminates TLS. The Origin presence itself
  // already proves the request is browser-initiated (curl etc must opt
  // in by sending Origin). So we drop the protocol check and keep host
  // equality as the canonical same-origin signal.
  if (host !== url.host || originUrl.host !== host) {
    throw error(403, 'same-origin browser POST required');
  }
}

function buildSessionCookie(
  secret: string,
  roomId: string,
  expiresAtMs: number,
  nowMs: number,
  request: Request
): string {
  const maxAgeSeconds = Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1000));
  const parts = [
    `ant_browser_session=${secret}`,
    'HttpOnly',
    'SameSite=Strict',
    `Path=/api/chat-rooms/${roomId}`,
    `Max-Age=${maxAgeSeconds}`
  ];
  // GAP-55 follow-up (2026-05-14): the Secure flag must reflect the
  // BROWSER-VISIBLE scheme, not the server-side url.protocol (which the
  // adapter-node default classifies as https for every request even when
  // the browser is on plain http). A Secure cookie issued over http is
  // silently dropped by browsers, breaking the entire downstream SSE
  // auth chain. Source-of-truth for browser scheme is the Origin header
  // (verified to match Host by requireSameOrigin above).
  const originHeader = request.headers.get('origin');
  let originIsHttps = false;
  if (originHeader) {
    try {
      originIsHttps = new URL(originHeader).protocol === 'https:';
    } catch { /* fall through; Secure stays off */ }
  }
  if (originIsHttps) parts.push('Secure');
  return parts.join('; ');
}

function accessFromPidChain(roomId: string, body: Record<string, unknown>): ChatRoomReadAccess | null {
  const handle = resolveServerSideHandle(roomId, parsePidChainFromBody(body));
  if (!handle) return null;
  return {
    isAdminBearer: false,
    source: 'pid-chain',
    handles: familyHandlesForPrincipal(handle),
    principalHandles: [normalizeHandle(handle)],
    resolvedRoomIds: [roomId]
  };
}

async function requireMintRoomAccess(
  request: Request,
  body: Record<string, unknown>,
  roomId: string,
  room: NonNullable<ReturnType<typeof findChatRoomById>>
): Promise<ChatRoomReadAccess> {
  const access =
    (await resolveChatRoomReadAccess(request, roomId)) ??
    accessFromPidChain(roomId, body);
  if (!access) throw error(401, 'Authentication required.');
  if (!canReadChatRoom(room, access)) throw error(403, 'caller cannot mint for this room.');
  return access;
}

function sameHumanOwner(a: string, b: OwnershipResolution): boolean {
  if (b.kind !== 'human') return false;
  const aOwnership = resolveHumanOwnership(a);
  return aOwnership.kind === 'human' && aOwnership.ownerId === b.ownerId;
}

function accessIsHumanSelfMint(
  access: ChatRoomReadAccess,
  authorHandle: string,
  ownership: OwnershipResolution
): boolean {
  if (ownership.kind !== 'human') return false;
  if (!access.handles.includes(authorHandle)) return false;
  if (access.source === 'local-bearer' || access.source === 'accounts-bearer') return true;
  if (access.source !== 'browser-session') return false;
  return access.principalHandles?.some((handle) => sameHumanOwner(handle, ownership)) ?? false;
}

export const POST: RequestHandler = async ({ params, request, url }) => {
  const roomId = params.roomId ?? '';
  if (roomId.length === 0) throw error(400, 'URL roomId is required.');
  requireSameOrigin(request, url);

  const room = findChatRoomById(roomId);
  if (!room) throw error(404, 'Room not found.');
  const body = await parseRequiredJsonBody(request);
  const rawHandle = body.authorHandle;
  if (typeof rawHandle !== 'string' || rawHandle.trim().length === 0) {
    throw error(400, 'authorHandle must be a non-empty string.');
  }
  const authorHandle = normalizeHandle(rawHandle);

  const access = await requireMintRoomAccess(request, body, roomId, room);

  // plan_consent_gate_2026_05_20 T5 (JWPK-locked 2026-05-20): consent
  // gate fail-closed BEFORE we mint a session cookie for a human handle.
  // If authorHandle resolves to a human owner, the caller's terminal
  // (pidChain-resolved) must either BE the owner's own terminal (self-
  // post carve-out inside requireHumanImpersonationConsent) OR hold an
  // active human_consent_grants row. No grant + no self-post = 403 with
  // structured `human_impersonation_<reason>` body. Same-origin + room-
  // membership checks ran above; this gate enforces "no agent can post
  // as a human without that human's consent" on the mint surface. The
  // post-side and admin-bearer surfaces are gated by sibling T6/T7.
  const ownership = resolveHumanOwnership(authorHandle);
  if (ownership.kind === 'human') {
    if (!accessIsHumanSelfMint(access, authorHandle, ownership)) {
      const pidChainForGate = parsePidChainFromBody(body);
      const callerTerminal = lookupTerminalByPidChain(pidChainForGate);
      if (!callerTerminal) {
        // No terminal identity → consent cannot be evaluated; deny rather
        // than fall through. Consent requires a real, registered terminal.
        throw error(403, 'human_impersonation_no_grant');
      }
      requireHumanImpersonationConsent({
        ownerId: ownership.ownerId,
        callerTerminalId: callerTerminal.id
      });
    }
  } else if (!access.isAdminBearer && !access.handles.includes(authorHandle)) {
    throw error(403, 'caller cannot mint requested handle.');
  }

  if (!room.members.some((member) => member.handle === authorHandle)) {
    // Authenticated same-family callers may still join an open room
    // through browser-session mint. The access checks above prevent
    // anonymous callers or unrelated handles from reaching this branch.
    const mode = getRoomMode(roomId);
    if (mode === 'closed' || mode === 'heads-down') {
      throw error(403, 'authorHandle is not a room member.');
    }
  }

  // GAP-55 (2026-05-14, JWPK Tailscale dogfood evidence): browser-only
  // operators (no `ant register` ever run from a CLI) hit this route to
  // claim a session for the room they're already a member of, but lack
  // a terminal binding so getTerminalIdByHandle returns null and the
  // strict 403 used to silently break the entire downstream SSE chain
  // (EventSource never authenticates → no real-time messages → JWPK
  // sees "I still need to refresh"). Lazy-create a synthetic browser
  // terminal + room-membership row here so the M3.6a-v1 identity gate
  // downstream accepts the browser session. The terminal is scoped per
  // (room, handle); no PID since the browser tab is the "process";
  // source='browser-session-default' distinguishes from CLI registers.
  if (!bindRoomHandleToLiveTerminal(roomId, authorHandle) && !getTerminalIdByHandle(roomId, authorHandle)) {
    const syntheticTerminal = upsertTerminal({
      pid: 0,
      pid_start: `browser-session-${Date.now()}`,
      name: `browser-${roomId}-${authorHandle}`,
      source: 'browser-session-default',
      meta: { kind: 'browser-default', roomId, authorHandle }
    });
    addMembership({ room_id: roomId, handle: authorHandle, terminal_id: syntheticTerminal.id });
  }
  if (ownership.kind === 'agent') {
    ensureAgentMemberInRoom({ roomId, agentHandle: authorHandle });
  }

  const nowMs = Date.now();
  const result = createBrowserSession({ roomId, authorHandle, nowMs });
  if (!result) throw error(403, 'browser session cannot be created.');
  const cookie = buildSessionCookie(
    result.browserSessionSecret,
    roomId,
    result.session.expires_at_ms,
    nowMs,
    request
  );

  return json({
    browserSession: {
      id: result.session.id,
      room_id: result.session.room_id,
      terminal_id: result.session.terminal_id,
      handle: result.session.handle,
      expires_at_ms: result.session.expires_at_ms
    }
  }, { status: 201, headers: { 'set-cookie': cookie } });
};
