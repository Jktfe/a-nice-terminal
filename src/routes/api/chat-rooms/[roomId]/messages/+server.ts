/**
 * Post and read messages for one chat room.
 *
 * GET  /api/chat-rooms/:roomId/messages
 *   → returns the newest message page, oldest first within the page.
 *   Query: ?limit=100&before=<postOrder> fetches older rows before a cursor.
 * POST /api/chat-rooms/:roomId/messages
 *   Body: { body, authorHandle?, kind?, parentMessageId? }
 *   → adds one message and returns it.
 *   → 400 if parentMessageId is present but not a non-empty string.
 *   → 404 if parentMessageId is given but references no message in
 *     THIS room (cross-room and unknown both surface as the same
 *     404 to avoid leaking other-room state). No message is created
 *     when validation fails — caller can re-GET to confirm.
 *
 * Backs M30 chat-messages-foundation (slice 1+2 threading).
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { postMessage, postSystemMessage, listMessagesInRoom, listMessagesPageInRoom, generateMessageId } from '$lib/server/chatMessageStore';
import { parseTrackerCommand } from '$lib/composer/composerSlashCommands';
import { createTracker } from '$lib/server/trackerStore';
import { parseColumnSpec, postTrackerCreateReceipt, registerTrackerArtefact } from '$lib/server/trackerRouteHelpers';
import { resolveHumanOwnership, gateAndConsumeForWrite } from '$lib/server/consentGate';
import { canonicaliseOperatorHandle, getOperatorHandle, isOperatorHandle } from '$lib/server/operatorHandle';
import { isReservedHandle } from '$lib/server/handleValidation';
import { broadcastToRoom } from '$lib/server/eventBroadcast';
import { doesChatRoomExist, ensureAgentMemberInRoom } from '$lib/server/chatRoomStore';
import { fanoutMessageToRoomTerminals } from '$lib/server/pty-inject-fanout';
import { parsePidChainFromBody, resolveServerSideHandle } from '$lib/server/identityGate';
import { findActiveGrantForCaller } from '$lib/server/callerGrantsStore';
import { getRoomMode } from '$lib/server/roomModesStore';
import { getTerminalIdByHandle, addMembership } from '$lib/server/roomMembershipsStore';
import { mirrorAddMembership } from '$lib/server/v02ChatRoomBridge';
import { lookupTerminalByPidChain, touchLastMessageSentAt } from '$lib/server/terminalsStore';
import {
  evaluateTokenTerminalBinding,
  tokenBindingAction,
  tokenTerminalBindingMode,
  sessionFingerprint,
  terminalFp
} from '$lib/server/tokenTerminalBinding';
import { resolveBrowserSessionSecret, touchBrowserSessionLastSeen, createBrowserSession } from '$lib/server/browserSessionStore';
import { upsertTerminal } from '$lib/server/terminalsStore';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { AUTH_DEPRECATION_HINT_BODY } from '$lib/server/authDeprecation';
import {
  bearerTokenFromHeader,
  resolveToken as resolveAntchatToken,
  userShapeForEmail as antchatUserShapeForEmail
} from '$lib/server/antchatAuthStore';
import { resolveAccountsBearerIdentity } from '$lib/server/accountsBearerIdentity';
import { hasBareEveryoneMention } from '$lib/chat/mentionRouting';
import { collectAskCandidatesFromMessage } from '$lib/server/askCandidateStore';
import { requireChatRoomReadAccess } from '$lib/server/chatRoomReadGate';
import { getContextBreakEnforcement } from '$lib/server/contextBreakSettingsStore';
import { summariseReactionsForMessage } from '$lib/server/messageReactionStore';
import { buildPermissionDeniedPayload } from '$lib/server/permissionDeniedPayload';
import { resolveApproversFor } from '$lib/server/permissionApproverResolver';
import { listReadersForMessages } from '$lib/server/messageReadReceiptStore';
import { resolveOrNull } from '$lib/server/sessionResolver';
import { resolveCallerIdentity, readIdentityReadMode } from '$lib/server/callerIdentityResolver';
import { approveRequest, getPermissionRequest } from '$lib/server/permissionRequestsStore';
import { corroboratePaneFact } from '$lib/server/paneFactCorroboration';
import { getRoomPolicy } from '$lib/server/roomPolicyStore';
import { decidePost } from '$lib/server/roomAccessGate';
import { filterVisibleMessages } from '$lib/server/visibleContentScope';
// CLEAN MODEL (identity rebuild): the ONE writer — handle-keyed lease store
// (room, handle, session), reuse-rules 1-4, no terminal_id in the identity path.
import {
  isMember as isCleanMember,
  displayHandleForSession,
  claimHandle
} from '$lib/server/roomHandleLeaseClean';

const DEFAULT_MESSAGE_PAGE_SIZE = 100;
const MAX_MESSAGE_PAGE_SIZE = 200;

export const GET: RequestHandler = async ({ params, request, url }) => {
  const room = findChatRoomById(params.roomId);
  if (!room) {
    throw error(404, 'Room not found.');
  }
  const access = await requireChatRoomReadAccess(request, room);
  // The viewer's resolved handle FAMILY (multiple aliases for one user)
  // is passed to `summariseReactionsForMessage` so `viewerHasReacted` is
  // true whenever any of the viewer's aliases reacted — not just the
  // primary. This matters because requireChatRoomReadAccess expands one
  // bearer into a family (e.g. `@jamesK`/`@you`/`@james`) and a reaction
  // recorded under any of them belongs to the same viewer.
  // Homebrew msg_znoxuoppy8 2026-05-27.
  const viewerHandles = access.handles;
  const limit = parseLimit(url.searchParams.get('limit'));
  const before = parseBefore(url.searchParams.get('before'));
  // Server-side context-break boundary (JWPK msg_ef2p1p75j9, 2026-05-23):
  // by default the endpoint returns only messages since the most recent
  // system-break in the room. Caller can opt out with ?include_pre_break=true
  // to get full history with pagination as before. β2 user-setting toggle
  // will gate whether the opt-out is honoured per user.
  const enforcement = getContextBreakEnforcement(params.roomId);
  const includePreBreak =
    enforcement !== 'hard' && url.searchParams.get('include_pre_break') === 'true';
  const page = listVisibleMessagesPageInRoom({
    roomId: params.roomId,
    limit,
    sinceBreak: !includePreBreak,
    ...(before !== undefined && { beforePostOrder: before })
  });
  const messagesWithReactions = page.messages.map((message) => withReactionSummaries(message, viewerHandles));
  const readersByMessageId = listReadersForMessages(messagesWithReactions.map((message) => message.id));
  return json({
    messages: messagesWithReactions.map((message) => {
      const readReceipts = readersByMessageId[message.id] ?? [];
      return readReceipts.length > 0 ? { ...message, readReceipts } : message;
    }),
    paging: {
      limit,
      before: before ?? null,
      hasMore: page.hasMore,
      nextBefore: page.nextBefore,
      sinceBreak: !includePreBreak
    }
  });
};

function listVisibleMessagesPageInRoom(input: {
  roomId: string;
  beforePostOrder?: number;
  limit: number;
  sinceBreak?: boolean;
}): ReturnType<typeof listMessagesPageInRoom> {
  const normalizedLimit = Math.max(1, Math.floor(input.limit));
  const targetVisibleRows = normalizedLimit + 1;
  const rawBatchLimit = Math.max(normalizedLimit, 50);
  let cursor = input.beforePostOrder;
  const visibleNewestFirst: ReturnType<typeof listMessagesPageInRoom>['messages'] = [];

  while (visibleNewestFirst.length < targetVisibleRows) {
    const rawPage = listMessagesPageInRoom({
      roomId: input.roomId,
      limit: rawBatchLimit,
      sinceBreak: input.sinceBreak,
      ...(cursor !== undefined && { beforePostOrder: cursor })
    });

    if (rawPage.messages.length === 0) break;

    const visibleInBatch = filterVisibleMessages(rawPage.messages, {});
    visibleNewestFirst.push(...visibleInBatch.reverse());

    if (!rawPage.hasMore) break;
    cursor = rawPage.messages[0].postOrder;
  }

  const newestVisiblePage = visibleNewestFirst.slice(0, normalizedLimit);
  const messages = newestVisiblePage.reverse();
  const hasMore = visibleNewestFirst.length > normalizedLimit;
  return {
    messages,
    hasMore,
    nextBefore: hasMore && messages.length > 0 ? messages[0].postOrder : null
  };
}

function withReactionSummaries(
  message: ReturnType<typeof listMessagesPageInRoom>['messages'][number],
  viewerHandles: readonly string[]
) {
  const reactions = summariseReactionsForMessage(message.id, viewerHandles);
  if (reactions.length === 0) return message;
  return { ...message, reactions };
}

export const POST: RequestHandler = async ({ params, request }) => {
  const rawBody = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== 'object') {
    throw error(400, 'Send a JSON body with at least a body field.');
  }

  const messageBody = (rawBody as { body?: unknown }).body;
  if (typeof messageBody !== 'string') {
    throw error(400, 'The body field must be a string.');
  }

  if (getRoomMode(params.roomId) === 'closed') {
    throw error(409, "Room is closed (read-only). Use 'ant room mode --room ID --set brainstorm|heads-down' to reopen.");
  }

  const authorHandleRaw = (rawBody as { authorHandle?: unknown }).authorHandle;
  const clientAuthorHandle =
    typeof authorHandleRaw === 'string' && authorHandleRaw.trim().length > 0
      ? authorHandleRaw
      : null;

  const {
    handle: authorHandle,
    warningHeader,
    clearStaleBrowserCookie,
    mintFreshBrowserSessionCookie,
    callerTerminalId,
    authPath
  } = await resolveMessageAuthorOnSeam(params.roomId, request, rawBody, clientAuthorHandle);

  // plan_consent_gate_2026_05_20 T6: fail-closed post-gate. If the resolved
  // authorHandle maps to a human owner_id, the caller MUST either be on the
  // owner's own terminal (self-post carve-out) OR consume one unit of an
  // active human_consent_grant. The bearer auth path is treated as self-post
  // because the bearer token is the human's own first-party credential.
  //
  // Order matters: the gate runs BEFORE the auto-join membership step below.
  // If we let auto-join run first it would mint a (room, @human, agentTerminal)
  // membership row that the consent gate's self-post carve-out would honour,
  // back-dooring around the explicit grant requirement.
  //
  // We pre-allocate the message id so the gate's audit row (action='consumed',
  // message_id=...) and the chat_messages.id are byte-identical.
  const preallocatedMessageId = generateMessageId();
  let consumedGrantId: string | null = null;
  if (authPath !== 'bearer') {
    const ownership = resolveHumanOwnership(authorHandle);
    if (ownership.kind === 'human') {
      if (!callerTerminalId) {
        // Human-kind handle resolved but no terminal identity attached to the
        // request — an agent without a terminal is trying to write as a human.
        // Deny fail-closed; downstream surfaces should establish a terminal
        // identity (cookie or pidChain → terminal) before retrying.
        //
        // Stage A: wrap with structured payload while preserving the legacy
        // message string for the existing audit/test assertions on
        // 'human_impersonation_no_terminal'.
        const room = findChatRoomById(params.roomId);
        throw error(
          403,
          buildPermissionDeniedPayload({
            action: 'chat.impersonate_human',
            target_kind: 'room',
            target_id: params.roomId,
            target_display_name: room?.name,
            reason: 'human_consent_required',
            grantee_handle: authorHandle,
            approvers: resolveApproversFor({
              targetKind: 'room',
              targetId: params.roomId
            }),
            message: 'human_impersonation_no_terminal'
          })
        );
      }
      const gateResult = gateAndConsumeForWrite({
        ownerId: ownership.ownerId,
        callerTerminalId,
        callerHandle: authorHandle,
        messageId: preallocatedMessageId
      });
      consumedGrantId = gateResult.grantId;
    }
  }

  // Rules manual sections 3 + 12: "When that terminal posts to an open room,
  // ANT can add it to the room automatically and let the message through."
  // Ratified by JWPK on ask_c60n2lgw3zimpbqz37b ("Align the code!"). If the
  // resolved author has no room_memberships row, mint one from the pidChain-
  // resolved terminal so the author surfaces in the participant list and
  // listMembershipsForRoom-driven fanout / status / typing surfaces pick them
  // up. Browser-session callers already have a membership minted at login,
  // so this only fires on the pidChain path. Closed rooms 409'd at line 70
  // before reaching here, so addMembership only runs in open modes.
  if (getTerminalIdByHandle(params.roomId, authorHandle) === null) {
    const pidChainForAutoJoin = parsePidChainFromBody(rawBody);
    const terminalForAutoJoin = lookupTerminalByPidChain(pidChainForAutoJoin);
    if (terminalForAutoJoin) {
      try {
        addMembership({
          room_id: params.roomId,
          handle: authorHandle,
          terminal_id: terminalForAutoJoin.id
        });
        // M9c dual-write: mirror the auto-join into v02_memberships so the
        // v0.2 substrate reflects the same auto-add. Best-effort.
        mirrorAddMembership({
          roomId: params.roomId,
          handle: authorHandle
        });
      } catch {
        /* auto-add is best-effort; the post still proceeds. addMembership is
           idempotent so a concurrent add from another path is a no-op. */
      }
    }
  }
  if (resolveHumanOwnership(authorHandle).kind === 'agent') {
    ensureAgentMemberInRoom({
      roomId: params.roomId,
      agentHandle: authorHandle
    });
  }

  const kindRaw = (rawBody as { kind?: unknown }).kind;
  const kind = validateMessageKind(kindRaw);

  const parentMessageIdRaw = (rawBody as { parentMessageId?: unknown })
    .parentMessageId;
  const parentMessageId = validateAndResolveParentMessageId(
    parentMessageIdRaw,
    params.roomId
  );

  // M3.4b T2: optional discussion_id (snake_case wire per B1). No
  // existence check + no closed-discussion reject (Q3-3c soft-close).
  const discussionIdRaw = (rawBody as { discussion_id?: unknown }).discussion_id;
  const discussion_id =
    typeof discussionIdRaw === 'string' && discussionIdRaw.length > 0 ? discussionIdRaw : undefined;

  // Server-side /tracker (JWPK msg_ujjxkn7zr6): the web composer intercepts
  // `/tracker …` client-side, but a raw message POST from a TERMINAL or
  // `ant chat send` reaches here and would otherwise post the command as plain
  // text. Detect + execute it as the already-resolved+gated author (every auth
  // and consent check above has run), then return the created tracker instead
  // of posting the literal command. The tracker's own create-receipt (an
  // ant-tracker fence) is what renders in the thread.
  const trackerCmd = parseTrackerCommand(messageBody);
  if (trackerCmd) {
    const cmdHeaders: Record<string, string> = {};
    if (warningHeader) cmdHeaders[warningHeader.name] = warningHeader.value;
    if (mintFreshBrowserSessionCookie) cmdHeaders['set-cookie'] = mintFreshBrowserSessionCookie;
    else if (clearStaleBrowserCookie)
      cmdHeaders['set-cookie'] = `ant_browser_session=; HttpOnly; SameSite=Strict; Path=/api/chat-rooms/${params.roomId}; Max-Age=0`;
    const tracker = createTracker({
      roomId: params.roomId,
      title: trackerCmd.title,
      columns: parseColumnSpec(trackerCmd.columnSpec),
      createdByHandle: authorHandle
    });
    postTrackerCreateReceipt(params.roomId, tracker.id, tracker.title, authorHandle);
    registerTrackerArtefact(params.roomId, tracker.id, tracker.title, authorHandle);
    return json({ tracker }, { status: 201, headers: cmdHeaders });
  }

  // Chat-typeable approve (JWPK taste ruling, ANT sorted msg_n4gdutadlh
  // 2026-06-10): "approve <requestId>" typed in any room approves a held
  // permission request — riding the SAME witnessed author resolution as
  // every other post, so an approval is an attributed, gated, ledgerable
  // act, not a side-channel. Strict shape (whole message, optional leading
  // slash) so the word approve mid-sentence stays an ordinary message.
  const approveMatch = messageBody.trim().match(/^\/?approve\s+(req[_-][\w-]+)$/i);
  if (approveMatch) {
    const requestId = approveMatch[1];
    const held = getPermissionRequest(requestId);
    if (!held) throw error(404, `No permission request ${requestId}.`);
    if (held.status !== 'pending') {
      throw error(409, `Request ${requestId} is already ${held.status}.`);
    }
    const authorIsApprover = held.approverHandles.some(
      (approver) => approver.handle === canonicaliseOperatorHandle(authorHandle)
        || approver.handle === authorHandle
    );
    const authorIsOperator = isOperatorHandle(authorHandle);
    if (!authorIsApprover && !authorIsOperator) {
      throw error(403, buildPermissionDeniedPayload({
        action: 'permission.approve',
        target_kind: held.targetKind as 'room',
        target_id: held.targetId,
        reason: 'no_grant',
        grantee_handle: authorHandle,
        approvers: held.approverHandles,
        message: 'only a listed approver (or the operator) can approve this request'
      }));
    }
    const approved = approveRequest({ requestId, decidedByHandle: authorHandle });
    const receipt = postSystemMessage({
      roomId: params.roomId,
      body: `✅ ${authorHandle} approved ${requestId} — ${held.action} on ${held.targetKind} ${held.targetId} for ${held.requesterHandle} (grant ${approved.grant.grantId})`
    });
    return json(
      {
        approval: {
          requestId,
          status: 'approved',
          decidedByHandle: authorHandle,
          grantId: approved.grant.grantId
        },
        message: receipt
      },
      { status: 201 }
    );
  }

  try {
    const newMessage = postMessage({
      id: preallocatedMessageId,
      roomId: params.roomId,
      authorHandle,
      body: messageBody,
      kind,
      consumedGrantId,
      ...(parentMessageId !== undefined && { parentMessageId }),
      ...(discussion_id !== undefined && { discussion_id })
    });
    // M3.4a-v2 T3d Q5 touchpoint: bump last_message_sent_at_ms when author
    // resolves to a registered terminal. Best-effort — failures don't block
    // the 201 response. Powers the ANT-activity tertiary cascade branch.
    const authorTerminalId = getTerminalIdByHandle(params.roomId, authorHandle);
    if (authorTerminalId) touchLastMessageSentAt(authorTerminalId);
    try {
      collectAskCandidatesFromMessage(newMessage);
    } catch {
      /* ask-candidate inference is best-effort; route still returns 201 */
    }
    try {
      fanoutMessageToRoomTerminals(params.roomId, newMessage, {
        forceBroadcastToAll: hasBareEveryoneMention(messageBody)
      });
    } catch {
      /* fanout is best-effort; route still returns 201 with the message */
    }
    // GAP-55 T2-A: SSE broadcast so subscribed browsers refresh without poll.
    try {
      broadcastToRoom(params.roomId, { type: 'message_added', message: newMessage });
    } catch {
      /* broadcast is best-effort; route still returns 201 */
    }
    // #117 fix: emit a live activity tick so the AgentStatusFooter (and
    // room cards downstream) can flip the author from idle to working
    // without waiting for the next poll cycle. Best-effort.
    try {
      broadcastToRoom(params.roomId, {
        type: 'agent_activity',
        handle: authorHandle,
        status: 'working',
        at: new Date().toISOString()
      });
    } catch {
      /* broadcast is best-effort */
    }
    const responseHeaders: Record<string, string> = {};
    if (warningHeader) responseHeaders[warningHeader.name] = warningHeader.value;
    if (mintFreshBrowserSessionCookie) {
      // JWPK msg_y19mranqab + msg_wpc9zyyykp (2026-05-19): auto-minted
      // browser_session because the client onMount rebind raced this POST.
      // Attach the fresh cookie so the browser stores it for the next post.
      responseHeaders['set-cookie'] = mintFreshBrowserSessionCookie;
    } else if (clearStaleBrowserCookie) {
      // GAP-24 (2026-05-14): browser had a stale ant_browser_session cookie
      // that no longer resolves. Tell it to drop the cookie so subsequent
      // POSTs take the cookie-less deprecation-gate path cleanly.
      responseHeaders['set-cookie'] = `ant_browser_session=; HttpOnly; SameSite=Strict; Path=/api/chat-rooms/${params.roomId}; Max-Age=0`;
    }
    return json({ message: newMessage }, { status: 201, headers: responseHeaders });
  } catch (causeOfFailure) {
    const reason =
      causeOfFailure instanceof Error ? causeOfFailure.message : 'Could not post the message.';
    throw error(400, reason);
  }
};

function validateMessageKind(kindRaw: unknown): 'human' | 'agent' {
  if (kindRaw === undefined) return 'human';
  if (kindRaw === 'human' || kindRaw === 'agent') return kindRaw;
  throw error(400, 'The kind field must be human or agent.');
}

function parseLimit(rawLimit: string | null): number {
  if (rawLimit === null || rawLimit.trim().length === 0) return DEFAULT_MESSAGE_PAGE_SIZE;
  const parsed = Number(rawLimit);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw error(400, 'limit must be a positive integer.');
  }
  return Math.min(parsed, MAX_MESSAGE_PAGE_SIZE);
}

function parseBefore(rawBefore: string | null): number | undefined {
  if (rawBefore === null || rawBefore.trim().length === 0) return undefined;
  const parsed = Number(rawBefore);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw error(400, 'before must be a positive postOrder integer.');
  }
  return parsed;
}

function normalizeHandle(rawHandle: string): string {
  const trimmed = rawHandle.trim();
  if (trimmed.length === 0) return trimmed;
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

function canonicalClaimedHandle(rawHandle: string): string {
  return canonicaliseOperatorHandle(rawHandle);
}

function canonicalBrowserHandle(rawHandle: string): string {
  return canonicaliseOperatorHandle(rawHandle);
}

function getCookieValues(request: Request, cookieName: string): string[] {
  // Browsers can send MULTIPLE cookies with the same name when paths differ
  // (e.g. demo-login mints Path=/ + per-room mint Path=/api/chat-rooms/{id}).
  // Per RFC 6265 §5.4 the more-specific path comes first, but we resolve
  // ALL matches against the room-bound secret so a stale Path=/ cookie can't
  // mask a valid Path=/api/chat-rooms/{id} cookie. Fixes the antv4 re-auth
  // bug (JWPK msg_y0p7c8j3sr + msg_rlcmtdhngu, 2026-05-19) where the
  // demo-login cookie collided with the per-room mint and produced spurious
  // 'Server-resolved identity required' rejections on every refresh.
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return [];
  const matches: string[] = [];
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) continue;
    if (trimmed.slice(0, separatorIndex) === cookieName) {
      const rawValue = trimmed.slice(separatorIndex + 1);
      try {
        matches.push(decodeURIComponent(rawValue));
      } catch {
        matches.push(rawValue);
      }
    }
  }
  return matches;
}

type AuthorResolution = {
  handle: string;
  warningHeader?: { name: string; value: string };
  /** GAP-24 (2026-05-14): set true when caller had a stale browser
   *  cookie + we fell through to deprecation gate. The route handler
   *  writes a Max-Age=0 Set-Cookie so the browser drops the stale value
   *  and the next POST takes the clean (cookie-less) path. */
  clearStaleBrowserCookie?: boolean;
  /** JWPK msg_y19mranqab + msg_wpc9zyyykp (2026-05-19): when the server
   *  auto-mints a browser_session inline because the client races a new
   *  room's onMount rebind, we attach the freshly-minted cookie to the
   *  201 response so subsequent posts no longer race. Holds the full
   *  cookie header value (already includes Path/HttpOnly/SameSite). */
  mintFreshBrowserSessionCookie?: string;
  /** plan_consent_gate_2026_05_20 T6: the terminal id the caller proved
   *  ownership of via cookie / pidChain. Used by the post-side consent
   *  gate to verify an agent posting AS a human has an active grant for
   *  THIS specific terminal. Undefined when no terminal could be tied to
   *  the request (e.g. bearer-only auth — see authPath flag). */
  callerTerminalId?: string;
  /** plan_consent_gate_2026_05_20 T6: how the caller authenticated. The
   *  consent gate treats 'bearer' as authenticated self-post (no grant
   *  needed) because a bearer token is a first-party human credential. */
  authPath: 'bearer' | 'cookie' | 'pidchain' | 'caller-grant' | 'ant-session' | 'witness';
};

async function resolveAccountsBearerHandle(token: string): Promise<string | null> {
  const identity = await resolveAccountsBearerIdentity(token);
  return identity?.handle ?? null;
}

/**
 * Step 2 seam adoption — SECOND endpoint on resolveCallerIdentity (blessed
 * msg_6dtpw2o4pn, steers msg_fjbp2o97h9). The post gate is the highest-
 * blast-radius surface in the system, so the wrapper is deliberately thin:
 *
 *  - Only AGENT-SHAPED calls ride the seam (pidChain present or a durable
 *    session header). Browser-cookie and bearer identities are a different
 *    class — witnessed by cookie/credential, not pane — and putting them on
 *    the seam would generate SHADOW disagreement noise that could never
 *    flatline, poisoning the cutover gate.
 *  - LEGACY mode: the full existing resolution runs and its answer is
 *    returned untouched (the seam call is a no-op pass-through).
 *  - SHADOW: legacy answers; the corroborated-pane witness comparison is
 *    ledgered on disagreement. A legacy 403 still throws before comparison —
 *    rejected posts are not part of the proving data.
 *  - CLEAN: agent-shaped posts resolve ONLY from the corroborated witnessed
 *    binding; the legacy machinery is never invoked for them (amended AC1).
 *    Unresolved → the same fail-closed 403 as every other identity failure.
 */
async function resolveMessageAuthorOnSeam(
  roomId: string,
  request: Request,
  rawBody: unknown,
  clientAuthorHandle: string | null
): Promise<AuthorResolution> {
  const pidChain = parsePidChainFromBody(rawBody);
  const durableSessionPresent =
    typeof request.headers.get('x-ant-session-id') === 'string' &&
    (request.headers.get('x-ant-session-id') ?? '').length > 0;
  const agentShaped = pidChain.length > 0 || durableSessionPresent;
  if (!agentShaped) {
    return resolveMessageAuthorHandle(roomId, request, rawBody, clientAuthorHandle);
  }
  const paneRaw = (rawBody as { pane?: unknown } | null)?.pane;
  const presentedPane =
    typeof paneRaw === 'string' && paneRaw.trim().length > 0 ? paneRaw.trim() : null;
  const mode = readIdentityReadMode();
  if (mode === 'clean') {
    const { pane } = corroboratePaneFact(presentedPane, pidChain);
    const witnessed = resolveCallerIdentity({ pane, legacy: () => null });
    if (!witnessed.ok) {
      rejectMessageIdentity(roomId, 'No daemon-witnessed binding for this caller (clean identity mode).');
    }
    const witnessHandle = witnessed.ok ? witnessed.identity.handle : '';
    if (
      clientAuthorHandle !== null &&
      canonicalClaimedHandle(clientAuthorHandle) !== witnessHandle
    ) {
      rejectMessageIdentity(roomId, 'authorHandle does not match the witnessed identity.');
    }
    return {
      handle: witnessHandle,
      authPath: 'witness',
      ...(witnessed.ok && witnessed.identity.terminalId
        ? { callerTerminalId: witnessed.identity.terminalId }
        : {})
    };
  }
  const legacyResolution = await resolveMessageAuthorHandle(
    roomId, request, rawBody, clientAuthorHandle
  );
  if (mode === 'shadow') {
    const { pane } = corroboratePaneFact(presentedPane, pidChain);
    resolveCallerIdentity({
      pane,
      legacy: () => ({
        handle: legacyResolution.handle,
        terminalId: legacyResolution.callerTerminalId ?? null
      })
    });
  }
  return legacyResolution;
}

async function resolveMessageAuthorHandle(
  roomId: string,
  request: Request,
  rawBody: unknown,
  clientAuthorHandle: string | null
): Promise<AuthorResolution> {
  // Step 0 (antchat Bearer bridge per JWPK msg_gqie1ekg4e demo-pressure):
  // Mac antchat clients send `Authorization: Bearer <token>` issued by
  // POST /api/auth/login. Resolve that token to a handle BEFORE the
  // cookie/pidChain checks so signed-in Mac users can post without a
  // separate browser-session ceremony.
  const antchatBearer = bearerTokenFromHeader(request.headers.get('authorization'));
  if (antchatBearer) {
    const record = resolveAntchatToken(antchatBearer);
    if (record) {
      const bearerHandle = antchatUserShapeForEmail(record.email).handle;
      if (clientAuthorHandle !== null && normalizeHandle(clientAuthorHandle) !== bearerHandle) {
        rejectMessageIdentity(roomId, 'authorHandle does not match antchat Bearer token.');
      }
      return { handle: bearerHandle, authPath: 'bearer' };
    }
    const accountsHandle = await resolveAccountsBearerHandle(antchatBearer);
    if (accountsHandle) {
      if (clientAuthorHandle !== null && normalizeHandle(clientAuthorHandle) !== accountsHandle) {
        rejectMessageIdentity(roomId, 'authorHandle does not match accounts Bearer token.');
      }
      return { handle: accountsHandle, authPath: 'bearer' };
    }
    // Invalid/expired Bearer token — fall through (cookie/pidChain may
    // still validate the request).
  }

  const antSessionResolution = resolveAntSessionAuthor(roomId, request, rawBody, clientAuthorHandle);
  if (antSessionResolution) return antSessionResolution;

  // Step 1 (cookie-first per M3.6a-v0 + M3.6a-v1 Q2 precedence): cookie
  // PRESENT-BUT-VALID-BUT-MISMATCHED-HANDLE 403s (real spoof signal).
  // GAP-24 fix (2026-05-14): cookie present but INVALID (expired / wrong
  // room / malformed secret) falls through to step 2 + step 3 during the
  // M3.6a-v1 warning phase so a stale cookie from a prior session does
  // NOT silently break composer send. The route handler clears the stale
  // cookie via Set-Cookie Max-Age=0. After the 2026-05-28 strict-flip
  // the step-3 applyDeprecationOrThrow still 403s, preserving the
  // canonical M3.6a-v1 invariant.
  let clearStaleBrowserCookie = false;
  const browserSessionSecrets = getCookieValues(request, 'ant_browser_session');
  for (const browserSessionSecret of browserSessionSecrets) {
    const resolved = resolveBrowserSessionSecret(browserSessionSecret, roomId);
    if (resolved) {
      const resolvedHandle = canonicalBrowserHandle(resolved.handle);
      if (clientAuthorHandle !== null && canonicalBrowserHandle(clientAuthorHandle) !== resolvedHandle) {
        rejectMessageIdentity(roomId, 'authorHandle does not match browser session.');
      }
      touchBrowserSessionLastSeen(resolved.session_id);
      return {
        handle: resolvedHandle,
        callerTerminalId: resolved.terminal_id,
        authPath: 'cookie'
      };
    }
  }
  if (browserSessionSecrets.length > 0) {
    // At least one ant_browser_session cookie was present but none resolved
    // for this room — flag for Path=/api/chat-rooms/{roomId} clearing.
    clearStaleBrowserCookie = true;
  }

  // Step 2 (pidChain mixed-mode per M3.6a-v1 Q2): pidChain resolves
  // server-side when present + valid. Present-but-unresolved falls through
  // to the deprecation gate.
  const pidChain = parsePidChainFromBody(rawBody);
  const resolvedHandle = resolveServerSideHandle(roomId, pidChain);
  if (resolvedHandle) {
    if (clientAuthorHandle !== null && canonicalClaimedHandle(clientAuthorHandle) !== resolvedHandle) {
      rejectMessageIdentity(roomId, 'authorHandle does not match server-resolved identity.');
    }
    const pidchainTerminal = lookupTerminalByPidChain(pidChain);
    return {
      handle: resolvedHandle,
      authPath: 'pidchain',
      ...(pidchainTerminal && { callerTerminalId: pidchainTerminal.id }),
      ...(clearStaleBrowserCookie && { clearStaleBrowserCookie: true })
    };
  }

  // #113 P0 (2026-05-17): message attribution is security-sensitive. The old
  // warning-phase fallback accepted the caller-supplied handle, and a missing
  // handle had already been defaulted to @you. That turned unresolved agent
  // posts into JWPK-looking posts. Message writes now fail closed: browser
  // session or pidChain must resolve server-side, and any claimed handle must
  // match the resolved identity.
  //
  // REVERTED 2026-05-19 (JWPK msg_ujr7k60muc): the defensive auto-mint added
  // in 856345a was a spoofing vector — any local agent process that could
  // set Origin: localhost on its POST could mint @you and impersonate the
  // operator. Reverted as 2105e65.
  //
  // JWPK msg_hf8ziydn4r + msg_zmqhwh5tpx (2026-05-19) — the RIGHT fix:
  // caller_grants. A caller whose pidChain doesn't natively resolve can
  // still post as a claimed handle IFF there's an active grant row for
  // (pid, pid_start, handle). Two kinds: 'human' (JWPK granted @you for
  // 15min in a debug shell) and 'agent' (long-lived @evolveant* grants,
  // auto-revoked on PID exit). Schema in 0caf855, store in 36242df.
  //
  // The check ONLY runs when pidChain has at least one entry (proves the
  // caller passed real PID info to the server, not a forged claim). It
  // matches against pid + pid_start + claimedHandle exactly — no fuzzy
  // matching. Empty/missing claimedHandle defaults to @you per the route's
  // existing behaviour, which means an unattributed agent post that tries
  // to land as @you must have an active human-grant.
  if (pidChain.length > 0 && clientAuthorHandle !== null) {
    const headEntry = pidChain[0];
    if (typeof headEntry.pid_start === 'string') {
      const grant = findActiveGrantForCaller({
        pid: headEntry.pid,
        pidStart: headEntry.pid_start,
        handle: canonicalClaimedHandle(clientAuthorHandle)
      });
      if (grant) {
        const pidchainTerminal = lookupTerminalByPidChain(pidChain);
        return {
          handle: grant.handle,
          authPath: 'caller-grant',
          ...(pidchainTerminal && { callerTerminalId: pidchainTerminal.id }),
          ...(clearStaleBrowserCookie && { clearStaleBrowserCookie: true })
        };
      }
    }
  }

  rejectMessageIdentity(roomId, 'server-resolved identity required.');
}

function resolveAntSessionAuthor(
  roomId: string,
  request: Request,
  rawBody: unknown,
  clientAuthorHandle: string | null
): AuthorResolution | null {
  const sessionId = extractAntSessionId(request, rawBody);
  if (!sessionId) return null;
  const session = resolveOrNull(sessionId);
  if (!session) {
    rejectMessageIdentity(roomId, 'ANT session id does not resolve.');
  }

  // R2 (token→terminal binding, 2026-06-04): the sessionToken is a BEARER
  // credential — verify the caller is actually on the terminal it was minted
  // for, so a token lifted from config.json can't post from a foreign process.
  // A pidChain resolving to a DIFFERENT terminal than the session's anchor is
  // active cross-terminal theft. Staged via ANT_TOKEN_TERMINAL_BINDING
  // (off|flag|strict, default flag): flag LOGS-not-rejects (lockout-safe — never
  // mutes a fleet whose CLI may not yet send a resolving pidChain); strict
  // rejects ONLY the wrong-terminal case. Token-only / no-pidChain stays allowed
  // until R3 makes a resolving pidChain mandatory. See tokenTerminalBinding.ts.
  const bindingPidChain = parsePidChainFromBody(rawBody);
  const callerTerminal = lookupTerminalByPidChain(bindingPidChain);
  const binding = evaluateTokenTerminalBinding(
    session.terminal_id,
    callerTerminal?.id ?? null,
    bindingPidChain.length > 0
  );
  const bindingAction = tokenBindingAction(binding);
  if (bindingAction !== 'allow') {
    // eslint-disable-next-line no-console -- observability for the flag-phase rollout
    // CREDENTIAL HYGIENE: NEVER log a raw id that could equal the secret token.
    // session.id IS the token; and a legacy session where id==terminal_id makes
    // the terminal id the token too. So EVERY id-bearing field is a fingerprint
    // (*_fp); the diagnostic signal comes from the structured non-secret fields
    // (kind / hadPidChain). No raw token can appear via any field.
    console.warn(
      `[token-binding:${tokenTerminalBindingMode()}] room=${roomId} ` +
        `session_fp=${sessionFingerprint(session.id)} ` +
        `session_terminal_fp=${terminalFp(session.terminal_id)} ` +
        `caller_terminal_fp=${terminalFp(callerTerminal?.id ?? null)} ` +
        `kind=${binding.kind} hadPidChain=${bindingPidChain.length > 0}`
    );
    if (bindingAction === 'reject') {
      rejectMessageIdentity(roomId, 'ANT session token presented from a terminal it is not bound to.');
    }
  }

  // CLEAN MODEL: membership + handle resolution via roomHandleLeaseClean
  // (handle-keyed, no terminal_id). Already a member -> render the lease's
  // current display handle (incl. the @x-N suffix per JWPK's reuse rules).
  const preferredHandle = clientAuthorHandle ?? session.label ?? session.id;
  // SECURITY (JWPK msg_1iff57erwg 2026-06-10: "No-one but me should be able to
  // change the server's handle"). An ant-session may NOT claim the operator
  // handle or any reserved handle via this post path. clientAuthorHandle is
  // caller-supplied, so without this guard a valid agent token could post with
  // authorHandle '@JWPK' into an open room where the operator's lease is free,
  // and claimHandle would grant the CLEAN @JWPK lease — the @x-N suffix rule only
  // protects an ACTIVELY-held handle, not a free one. This branch is always
  // authPath 'ant-session'; the real operator posts via the browser-session path
  // and never reaches here, so this cannot lock the operator out of their handle.
  // Companion to the register-path reservation in validateHandleForRegistration.
  if (isOperatorHandle(preferredHandle) || isReservedHandle(preferredHandle)) {
    rejectMessageIdentity(roomId, 'ANT session may not post as the operator or a reserved handle.');
  }
  if (isCleanMember(roomId, session.id)) {
    const display = displayHandleForSession(roomId, session.id);
    return { handle: display ?? preferredHandle, authPath: 'ant-session' };
  }

  // Not a member: auto-join ONLY if the room policy is open. claimHandle never
  // overwrites a held handle — a collision gets the lowest-free @x-N suffix
  // (rule 4), so a different session can't steal @JWPK.
  const policy = getRoomPolicy(roomId);
  if (decidePost(policy.joinPolicy, false) !== 'auto-join') {
    rejectMessageIdentity(roomId, 'ANT session is not a member of this room.');
  }
  const display = claimHandle(roomId, preferredHandle, session.id);
  return { handle: display, authPath: 'ant-session' };
}

function extractAntSessionId(request: Request, rawBody: unknown): string | null {
  const fromHeader = request.headers.get('x-ant-session-id')?.trim();
  if (fromHeader) return fromHeader;
  if (!rawBody || typeof rawBody !== 'object') return null;
  const sessionId = (rawBody as { sessionId?: unknown; antSessionId?: unknown }).sessionId;
  if (typeof sessionId === 'string' && sessionId.trim().length > 0) return sessionId.trim();
  const antSessionId = (rawBody as { antSessionId?: unknown }).antSessionId;
  if (typeof antSessionId === 'string' && antSessionId.trim().length > 0) return antSessionId.trim();
  return null;
}

// REVERTED 2026-05-19: isSameOriginBrowserPost + autoMintBrowserSessionInline
// removed along with the auto-mint call site above. They were a spoofing
// vector (Origin header is not browser-only — curl can set it). See the
// revert comment in resolveMessageAuthorHandle for the full rationale.

function rejectMessageIdentity(roomId: string, reason: string): never {
  console.warn(`[identity-gate] messages-post rejected room=${roomId} reason=${reason}`);
  // Stage A 403 PermissionDenied payload (plan milestone
  // p3-stage-a-403-payload). The legacy free-form `reason` argument
  // is preserved as payload.message (or AUTH_DEPRECATION_HINT_BODY when
  // the historical sentinel matched) so existing CLI fallback paths +
  // smoke tests that match on the wedge-hint string keep working; new
  // consumers read the structured permission_denied block.
  const room = findChatRoomById(roomId);
  const legacyMessage =
    reason === 'server-resolved identity required.' ? AUTH_DEPRECATION_HINT_BODY : reason;
  throw error(
    403,
    buildPermissionDeniedPayload({
      action: 'chat.post',
      target_kind: 'room',
      target_id: roomId,
      target_display_name: room?.name,
      reason: 'identity_unresolved',
      grantee_handle: getOperatorHandle(),
      approvers: resolveApproversFor({ targetKind: 'room', targetId: roomId }),
      message: legacyMessage
    })
  );
}

// M30 slice 2 parent validation: throws 400/404 BEFORE any postMessage
// call so failed-validation requests never mutate state. Returns the
// trimmed parentMessageId on success or undefined when the field was
// omitted entirely (zero-drift default).
function validateAndResolveParentMessageId(
  parentMessageIdRaw: unknown,
  roomId: string
): string | undefined {
  if (parentMessageIdRaw === undefined) return undefined;
  if (typeof parentMessageIdRaw !== 'string') {
    throw error(400, 'parentMessageId must be a string when provided.');
  }
  const trimmed = parentMessageIdRaw.trim();
  if (trimmed.length === 0) {
    throw error(400, 'parentMessageId must not be blank when provided.');
  }
  const parentInRoom = listMessagesInRoom(roomId).find(
    (message) => message.id === trimmed
  );
  if (!parentInRoom) {
    throw error(404, 'Parent message not found in this room.');
  }
  return trimmed;
}
