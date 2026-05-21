/**
 * Chat invites endpoint — admin-gated create + list.
 *
 * POST /api/chat-invites             create an invite (body: roomId, label,
 *                                    password, kinds[], createdBy?)
 *   → 200 invite (PublicInviteSummary)
 *   → 400 missing/malformed body, bad enum
 *   → 401 missing or wrong admin bearer
 *   → 503 ANT_ADMIN_TOKEN env not set (fail-closed by default)
 *
 * GET  /api/chat-invites?roomId=R    list active invites for a room
 *   → 200 invites
 *   → 400 missing roomId
 *   → 401 missing/wrong admin bearer
 *   → 503 ANT_ADMIN_TOKEN env not set
 *
 * Auth: bearer compared against process.env.ANT_ADMIN_TOKEN with
 * crypto.timingSafeEqual. Fail-closed if env is unset.
 *
 * Source: chat-invites-identity-foundation baseline (chatInviteStore +
 * chatInviteCrypto). No edits to that surface here.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  createInvite,
  listActiveInvitesForRoom,
  type InviteKind
} from '$lib/server/chatInviteStore';
import { requireAdminAuth } from '$lib/server/chatInviteAuth';

const ALLOWED_KINDS: ReadonlySet<InviteKind> = new Set(['cli', 'mcp', 'web']);

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

function requireString(source: Record<string, unknown>, field: string): string {
  const value = source[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw error(400, `Field ${field} must be a non-empty string.`);
  }
  return value;
}

function requireKinds(value: unknown): InviteKind[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw error(400, 'Field kinds must be a non-empty array.');
  }
  for (const entry of value) {
    if (typeof entry !== 'string' || !ALLOWED_KINDS.has(entry as InviteKind)) {
      throw error(400, 'Field kinds must contain only cli, mcp, web.');
    }
  }
  return value as InviteKind[];
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw error(400, `Field ${field} must be a string when present.`);
  return value;
}

export const POST: RequestHandler = async ({ request }) => {
  requireAdminAuth(request);
  const body = await parseRequiredJsonBody(request);
  try {
    // B2-1: optional inviter-consented handle allowlist. Array of
    // non-empty strings; anything else → ignored (treated as open).
    const rawAllow = (body as { allowedHandles?: unknown }).allowedHandles;
    const allowedHandles = Array.isArray(rawAllow)
      ? rawAllow.filter((h): h is string => typeof h === 'string' && h.trim().length > 0)
      : null;
    const invite = createInvite({
      roomId: requireString(body, 'roomId'),
      label: requireString(body, 'label'),
      password: requireString(body, 'password'),
      kinds: requireKinds(body.kinds),
      createdBy: optionalString(body.createdBy, 'createdBy') ?? null,
      allowedHandles
    });
    return json({ invite });
  } catch (failure) {
    if (failure instanceof Response) throw failure;
    if (failure instanceof Error && failure.message.toLowerCase().includes('password must be at least')) {
      throw error(400, failure.message);
    }
    throw failure;
  }
};

export const GET: RequestHandler = async ({ url, request }) => {
  requireAdminAuth(request);
  const roomId = url.searchParams.get('roomId') ?? '';
  if (roomId.length === 0) {
    throw error(400, 'Query param roomId is required.');
  }
  const invites = listActiveInvitesForRoom(roomId);
  return json({ invites });
};
