/**
 * Chat invite exchange endpoint — open (password-gated).
 *
 * POST /api/chat-invites/:inviteId/exchange    body: password, kind, handle?
 *   → 200 tokenId + tokenSecret  (tokenSecret returned ONCE; never re-derivable)
 *   → 400 missing/malformed body, bad enum, kind not permitted by invite
 *   → 401 invite cannot be used (revoked OR wrong password OR not found —
 *         collapsed into ONE message to avoid leaking which condition triggered)
 *
 * No admin gate — exchange uses the invite password as its auth. Never
 * echoes password_hash, token_hash, or failed_attempts.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  ChatInviteRevokedError,
  ChatInviteHandleNotAllowedError,
  exchangePasswordForToken,
  type InviteKind
} from '$lib/server/chatInviteStore';

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

function requireKindEnum(value: unknown): InviteKind {
  if (typeof value !== 'string' || !ALLOWED_KINDS.has(value as InviteKind)) {
    throw error(400, 'Field kind must be one of cli, mcp, web.');
  }
  return value as InviteKind;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw error(400, `Field ${field} must be a string when present.`);
  return value;
}

export const POST: RequestHandler = async ({ params, request }) => {
  const inviteId = params.inviteId ?? '';
  if (inviteId.length === 0) {
    throw error(400, 'URL inviteId is required.');
  }
  const body = await parseRequiredJsonBody(request);
  const password = requireString(body, 'password');
  const kind = requireKindEnum(body.kind);
  const handle = optionalString(body.handle, 'handle') ?? null;
  try {
    const result = exchangePasswordForToken({ inviteId, password, kind, handle });
    return json({ tokenId: result.tokenId, tokenSecret: result.tokenSecret });
  } catch (failure) {
    if (failure instanceof Response) throw failure;
    if (failure instanceof ChatInviteRevokedError) {
      throw error(401, 'invite cannot be used');
    }
    if (failure instanceof ChatInviteHandleNotAllowedError) {
      // B2-1: distinct 403 — password was correct but the inviter did
      // not consent to this handle. Not collapsed into the 401 so the
      // caller can tell "wrong password" from "not on allowlist".
      throw error(403, 'handle not permitted by invite');
    }
    if (failure instanceof Error && failure.message.toLowerCase().includes('does not permit kind')) {
      throw error(400, 'kind not permitted');
    }
    throw failure;
  }
};
