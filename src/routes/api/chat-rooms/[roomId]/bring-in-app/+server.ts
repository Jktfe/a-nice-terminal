/**
 * POST /api/chat-rooms/:roomId/bring-in-app
 *   Body: { target: 'claude-desktop' | 'claude-mobile' | 'chatgpt' | 'codex-desktop' | 'gemini' }
 *   → 200 { launchId, payload, target, launchedAtMs }
 *   → 400 invalid target
 *   → 401 no auth
 *   → 404 unknown room
 *
 * Premium feature spec at docs/research/bring-in-app-spec-2026-05-25.md
 * (JWPK msg_a0s51ioct6 2026-05-25 — "Q2: Yes proceed"). Server mints a
 * RoomContextPayload + records the launch event. Per-target launch
 * (URL scheme / clipboard / Share Sheet) is the CLIENT's job; this
 * endpoint hands over the data and the audit trail.
 *
 * Auth: room-mutation gate (same as PATCH /name + PATCH /description) —
 * caller must be admin bearer, accounts-bearer for a room member, or
 * have a browser-session cookie scoped to the room.
 *
 * Tier gating: API endpoint is `bring_in_app_api: true` for all tiers
 * (so OSS self-hosters can wire it); UX gating happens at the client
 * via `bring_in_app_ux` feature flag.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { doesChatRoomExist } from '$lib/server/chatRoomStore';
import { requireChatRoomMutationAuth } from '$lib/server/chatRoomAuthGate';
import {
  isAllowedBringInTarget,
  mintRoomContextPayload,
  recordBringInLaunch,
  payloadByteSize
} from '$lib/server/bringInAppStore';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function parseRequiredJsonBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length === 0) {
    throw error(400, 'Body must be a JSON object with a target field.');
  }
  try {
    const parsed = JSON.parse(text);
    if (!isPlainObject(parsed)) {
      throw error(400, 'Body must be a JSON object.');
    }
    return parsed;
  } catch (cause) {
    if (cause instanceof SyntaxError) {
      throw error(400, 'Body must be valid JSON.');
    }
    throw cause;
  }
}

export const POST: RequestHandler = async ({ params, request }) => {
  if (!doesChatRoomExist(params.roomId)) {
    throw error(404, 'Room not found.');
  }

  const body = await parseRequiredJsonBody(request);

  // Use the same auth gate as /name + /description so a caller has to
  // be a room member (or admin) to mint context for the room.
  const auth = requireChatRoomMutationAuth(params.roomId, request, body);
  const operatorHandle = auth.handle;

  const target = body.target;
  if (!isAllowedBringInTarget(target)) {
    throw error(
      400,
      'target must be one of: claude-desktop | claude-mobile | chatgpt | codex-desktop | gemini'
    );
  }

  const payload = mintRoomContextPayload({ roomId: params.roomId });
  if (!payload) {
    throw error(404, 'Room not found.');
  }

  const record = recordBringInLaunch({
    roomId: params.roomId,
    target,
    operatorHandle,
    payloadByteSize: payloadByteSize(payload)
  });

  return json({
    launchId: record.id,
    target: record.target,
    launchedAtMs: record.launchedAtMs,
    payload
  });
};
