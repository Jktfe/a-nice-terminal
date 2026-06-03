/**
 * Claim route for the 🖐️ / 🤝 / 👐 coordination primitive.
 *
 *   GET   /api/chat-rooms/:roomId/claims?entityKind=message&entityId=msg_x
 *   POST  /api/chat-rooms/:roomId/claims
 *   PATCH /api/chat-rooms/:roomId/claims
 *
 * The entity_claims ledger is canonical; chat messages/reactions are only
 * visibility surfaces layered above this route.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { getMessageById } from '$lib/server/chatMessageStore';
import { getRoomMode } from '$lib/server/roomModesStore';
import { requireChatRoomMutationAuth } from '$lib/server/chatRoomAuthGate';
import {
  DEFAULT_WORKING_TTL_BRAINSTORM_MS,
  DEFAULT_WORKING_TTL_HEADS_DOWN_MS,
  EntityClaimConflictError,
  createClaim,
  listActiveClaimsForEntity,
  listClaimsForRoomEntity,
  updateClaimStatus,
  type ClaimKind,
  type EntityKind
} from '$lib/server/entityClaimStore';
import { emitClaimRelay } from '$lib/server/headsDownRelay';
import { sendCoordinationRelay } from '$lib/server/pty-inject-fanout';

export const GET: RequestHandler = ({ params, url }) => {
  const roomId = readRoomId(params.roomId);
  assertRoomExists(roomId);
  const entityKind = parseEntityKind(url.searchParams.get('entityKind') ?? url.searchParams.get('entity_kind'));
  const entityId = url.searchParams.get('entityId') ?? url.searchParams.get('entity_id');
  const entityIds = parseEntityIds(url.searchParams.get('entityIds') ?? url.searchParams.get('entity_ids'));
  if (entityId) {
    assertEntityBelongsToRoom(roomId, entityKind, entityId);
    return json({ claims: listActiveClaimsForEntity(entityKind, entityId) });
  }
  if (entityIds.length > 0) {
    for (const id of entityIds) assertEntityBelongsToRoom(roomId, entityKind, id);
    return json({ claims: listClaimsForRoomEntity(entityKind, entityIds) });
  }
  throw error(400, 'entityId or entityIds is required.');
};

export const POST: RequestHandler = async ({ params, request }) => {
  const roomId = readRoomId(params.roomId);
  assertRoomExists(roomId);
  const body = await parseRequiredJsonBody(request);
  // LAUNCH-BLOCKER CVE FIX D (2026-05-20): identity-gate the claims POST.
  // Without this any unauthenticated caller could create a claim in any room.
  requireChatRoomMutationAuth(roomId, request, body);
  const entityKind = parseEntityKind(readString(body, 'entityKind', 'entity_kind'));
  const entityId = readString(body, 'entityId', 'entity_id');
  const claimKind = parseClaimKind(readString(body, 'claimKind', 'claim_kind'));
  const claimedByHandle = normaliseHandle(readString(body, 'claimedByHandle', 'claimed_by_handle'));
  const ttlMs = parseOptionalTtlMs(body.ttlMs ?? body.ttl_ms);
  assertEntityBelongsToRoom(roomId, entityKind, entityId);
  assertClaimantIsRoomMember(roomId, claimedByHandle);

  try {
    const claim = createClaim({
      entity_kind: entityKind,
      entity_id: entityId,
      claim_kind: claimKind,
      claimed_by_handle: claimedByHandle,
      ttl_ms: ttlMs,
      default_working_ttl_ms: defaultWorkingTtlMsForRoom(roomId)
    });
    // Heads-down responder-relay: notify the other readers/holder of this
    // claim transition (no-op outside heads-down / non-message entities).
    emitClaimRelay(
      { roomId, entityKind, entityId, claimKind, claimedByHandle },
      (recipientHandle, body) => sendCoordinationRelay(roomId, recipientHandle, body)
    );
    return json({ claim }, { status: 201 });
  } catch (cause) {
    if (cause instanceof EntityClaimConflictError) {
      return json(
        { message: cause.message, existing: cause.existing },
        { status: 409 }
      );
    }
    const message = cause instanceof Error ? cause.message : 'Could not create claim.';
    throw error(400, message);
  }
};

export const PATCH: RequestHandler = async ({ params, request }) => {
  const roomId = readRoomId(params.roomId);
  assertRoomExists(roomId);
  const body = await parseRequiredJsonBody(request);
  // LAUNCH-BLOCKER CVE FIX D (2026-05-20)
  requireChatRoomMutationAuth(roomId, request, body);
  const claimId = readString(body, 'claimId', 'claim_id');
  const status = readString(body, 'status');
  if (status !== 'done' && status !== 'released') {
    throw error(400, 'status must be done or released.');
  }
  const overrideReasonRaw = body.overrideReason ?? body.override_reason;
  const overrideReason =
    typeof overrideReasonRaw === 'string' && overrideReasonRaw.trim().length > 0
      ? overrideReasonRaw.trim()
      : null;
  const claim = updateClaimStatus(claimId, status, { override_reason: overrideReason });
  if (!claim) throw error(404, 'Claim not found.');
  return json({ claim });
};

function readRoomId(rawRoomId: string | undefined): string {
  if (typeof rawRoomId === 'string' && rawRoomId.length > 0) return rawRoomId;
  throw error(400, 'roomId is required.');
}

function assertRoomExists(roomId: string): void {
  if (!findChatRoomById(roomId)) throw error(404, 'Room not found.');
}

function assertEntityBelongsToRoom(roomId: string, entityKind: EntityKind, entityId: string): void {
  if (entityKind === 'message') {
    const message = getMessageById(entityId);
    if (!message || message.roomId !== roomId) throw error(404, 'Message not found in this room.');
    return;
  }
  // Task-room linkage is still uneven across the legacy/new task stores.
  // For v1, the route validates message-room ownership and leaves task
  // ownership to the plan-task surface that calls this endpoint.
}

function assertClaimantIsRoomMember(roomId: string, handle: string): void {
  const room = findChatRoomById(roomId);
  if (!room?.members.some((member) => member.handle === handle)) {
    throw error(404, `${handle} is not a member of this room.`);
  }
}

function defaultWorkingTtlMsForRoom(roomId: string): number {
  return getRoomMode(roomId) === 'heads-down'
    ? DEFAULT_WORKING_TTL_HEADS_DOWN_MS
    : DEFAULT_WORKING_TTL_BRAINSTORM_MS;
}

function parseEntityKind(raw: unknown): EntityKind {
  if (raw === 'message' || raw === 'task') return raw;
  throw error(400, 'entityKind must be message or task.');
}

function parseClaimKind(raw: unknown): ClaimKind {
  if (raw === 'looking' || raw === 'working' || raw === 'pass') return raw;
  throw error(400, 'claimKind must be looking, working, or pass.');
}

function parseOptionalTtlMs(raw: unknown): number | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw error(400, 'ttlMs must be a positive number or null.');
  }
  if (raw <= 0) throw error(400, 'ttlMs must be a positive number or null.');
  return Math.floor(raw);
}

function parseEntityIds(raw: string | null): string[] {
  if (!raw) return [];
  return raw.split(',').map((id) => id.trim()).filter((id) => id.length > 0);
}

function normaliseHandle(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

function readString(body: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const raw = body[key];
    if (typeof raw === 'string' && raw.trim().length > 0) return raw.trim();
  }
  throw error(400, `${keys[0]} must be a non-empty string.`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function parseRequiredJsonBody(request: Request): Promise<Record<string, unknown>> {
  const requestBodyText = await request.text();
  if (requestBodyText.length === 0) throw error(400, 'Body must be a JSON object.');
  try {
    const parsed = JSON.parse(requestBodyText);
    if (!isPlainObject(parsed)) throw error(400, 'Body must be a JSON object.');
    return parsed;
  } catch (parseFailure) {
    if (parseFailure instanceof SyntaxError) throw error(400, 'Body must be valid JSON.');
    throw parseFailure;
  }
}
