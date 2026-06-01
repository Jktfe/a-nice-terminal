import { error, json } from '@sveltejs/kit';
import {
  ChatInviteHandleNotAllowedError,
  ChatInviteRevokedError,
  exchangePasswordForToken,
  type InviteKind
} from './chatInviteStore';

const ALLOWED_KINDS: ReadonlySet<InviteKind> = new Set(['cli', 'mcp', 'web']);

export async function parseJsonObject(request: Request): Promise<Record<string, unknown>> {
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

export function optionalString(source: Record<string, unknown>, fields: string[]): string | undefined {
  for (const field of fields) {
    const value = source[field];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

export function requireBodyString(source: Record<string, unknown>, fields: string[]): string {
  const value = optionalString(source, fields);
  if (!value) throw error(400, `Field ${fields[0]} must be a non-empty string.`);
  return value;
}

export function parseKind(raw: unknown): InviteKind {
  if (raw === undefined || raw === null || raw === '') return 'cli';
  if (typeof raw !== 'string' || !ALLOWED_KINDS.has(raw as InviteKind)) {
    throw error(400, 'Field kind must be one of cli, mcp, web.');
  }
  return raw as InviteKind;
}

export function legacyExchangeResponse(input: {
  roomId: string;
  inviteId: string;
  password: string;
  kind: InviteKind;
  handle?: string;
}): Response {
  try {
    const result = exchangePasswordForToken({
      inviteId: input.inviteId,
      password: input.password,
      kind: input.kind,
      handle: input.handle ?? null
    });
    return json({
      token: result.tokenSecret,
      token_id: result.tokenId,
      tokenId: result.tokenId,
      tokenSecret: result.tokenSecret,
      invite_id: input.inviteId,
      inviteId: input.inviteId,
      room_id: input.roomId,
      roomId: input.roomId,
      kind: input.kind,
      handle: input.handle ?? null
    });
  } catch (failure) {
    if (failure instanceof Response) throw failure;
    if (failure instanceof ChatInviteRevokedError) {
      throw error(401, 'invite cannot be used');
    }
    if (failure instanceof ChatInviteHandleNotAllowedError) {
      throw error(403, 'handle not permitted by invite');
    }
    if (failure instanceof Error && failure.message.toLowerCase().includes('does not permit kind')) {
      throw error(400, 'kind not permitted');
    }
    throw failure;
  }
}
