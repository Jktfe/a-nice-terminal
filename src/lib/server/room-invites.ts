// Room invites — password hashing, token minting/validation.
// Backed by room_invites + room_tokens (see db.ts). Transport-agnostic: the
// token issued here authenticates CLI sends, WS frames, and remote-MCP calls
// alike. Revocation flows: clear room_tokens.revoked_at = kick one device;
// clear room_invites.revoked_at = kill all derived tokens.

import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'crypto';
import { nanoid } from 'nanoid';
import { queries } from './db.js';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;
const SCRYPT_SALT_BYTES = 16;

const VALID_KINDS = new Set(['cli', 'mcp', 'web'] as const);
export type InviteKind = 'cli' | 'mcp' | 'web';

export interface InviteRow {
  id: string;
  room_id: string;
  label: string;
  password_hash: string;
  kinds: string;
  created_by: string | null;
  created_at: string;
  revoked_at: string | null;
  failed_attempts: number;
  last_failed_at: string | null;
}

// Auto-revoke an invite after this many failed password attempts. Override
// with ANT_INVITE_MAX_FAILURES in the environment. Counter resets on a
// successful exchange. Spec: option (b) from room qQaO-3kw-pnnH4L5TRGLT.
export const MAX_FAILED_ATTEMPTS: number = (() => {
  const raw = process.env.ANT_INVITE_MAX_FAILURES;
  if (!raw) return 5;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 5;
})();

export interface TokenRow {
  id: string;
  invite_id: string;
  room_id: string;
  token_hash: string;
  kind: InviteKind;
  handle: string | null;
  meta: string;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
}

export function hashPassword(plain: string): string {
  if (typeof plain !== 'string' || plain.length < 4) {
    throw new Error('Password must be at least 4 characters');
  }
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const derived = scryptSync(plain, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  if (typeof plain !== 'string' || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4], 'base64url');
  const expected = Buffer.from(parts[5], 'base64url');
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  let derived: Buffer;
  try {
    derived = scryptSync(plain, salt, expected.length, { N, r, p });
  } catch {
    return false;
  }
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

export function parseKinds(raw: string | null | undefined): InviteKind[] {
  if (!raw) return [];
  return raw.split(',').map((k) => k.trim()).filter((k): k is InviteKind => VALID_KINDS.has(k as InviteKind));
}

export function serializeKinds(kinds: InviteKind[] | undefined): string {
  if (!kinds || kinds.length === 0) return 'cli,mcp,web';
  const seen = new Set<string>();
  for (const k of kinds) {
    if (VALID_KINDS.has(k)) seen.add(k);
  }
  if (seen.size === 0) return 'cli,mcp,web';
  return Array.from(seen).join(',');
}

export function mintToken(): { plaintext: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  const plaintext = `ant_t_${raw}`;
  const hash = createHash('sha256').update(plaintext).digest('hex');
  return { plaintext, hash };
}

export function hashToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

export interface CreateInviteInput {
  roomId: string;
  label: string;
  password: string;
  kinds?: InviteKind[];
  createdBy?: string | null;
}

export function createInvite(input: CreateInviteInput): InviteRow {
  const id = nanoid();
  const password_hash = hashPassword(input.password);
  const kinds = serializeKinds(input.kinds);
  queries.createRoomInvite({
    id,
    room_id: input.roomId,
    label: input.label,
    password_hash,
    kinds,
    created_by: input.createdBy ?? null,
  });
  const row = queries.getRoomInvite(id);
  if (!row) throw new Error('Failed to create invite');
  return row as InviteRow;
}

export interface ExchangeInput {
  inviteId: string;
  password: string;
  kind: InviteKind;
  handle?: string | null;
  meta?: Record<string, unknown>;
}

export interface ExchangeResult {
  token: string;
  tokenId: string;
  inviteId: string;
  roomId: string;
  kind: InviteKind;
  handle: string | null;
}

export function exchangePassword(input: ExchangeInput): ExchangeResult | null {
  const invite = queries.getRoomInvite(input.inviteId) as InviteRow | undefined;
  if (!invite) return null;
  if (invite.revoked_at) return null;
  const allowed = parseKinds(invite.kinds);
  if (!allowed.includes(input.kind)) return null;
  if (!verifyPassword(input.password, invite.password_hash)) {
    // Failed attempt: bump counter; if we hit the threshold, auto-revoke
    // silently. Caller still sees "invalid password" so a brute-forcer can't
    // detect when they tripped the wall.
    queries.incrementInviteFailures(invite.id);
    const updated = queries.getRoomInvite(invite.id) as InviteRow | undefined;
    if (updated && !updated.revoked_at && updated.failed_attempts >= MAX_FAILED_ATTEMPTS) {
      queries.revokeRoomInvite(invite.id);
    }
    return null;
  }

  // Success: reset the failure counter so the next bad password starts fresh
  if (invite.failed_attempts > 0) {
    queries.resetInviteFailures(invite.id);
  }

  const { plaintext, hash } = mintToken();
  const id = nanoid();
  queries.createRoomToken({
    id,
    invite_id: invite.id,
    room_id: invite.room_id,
    token_hash: hash,
    kind: input.kind,
    handle: input.handle ?? null,
    meta: JSON.stringify(input.meta ?? {}),
  });
  return {
    token: plaintext,
    tokenId: id,
    inviteId: invite.id,
    roomId: invite.room_id,
    kind: input.kind,
    handle: input.handle ?? null,
  };
}

export interface ResolvedToken {
  token: TokenRow;
  invite: InviteRow;
}

export function resolveToken(plaintext: string): ResolvedToken | null {
  if (!plaintext || typeof plaintext !== 'string') return null;
  const hash = hashToken(plaintext);
  const token = queries.getRoomTokenByHash(hash) as TokenRow | undefined;
  if (!token) return null;
  if (token.revoked_at) return null;
  const invite = queries.getRoomInvite(token.invite_id) as InviteRow | undefined;
  if (!invite || invite.revoked_at) return null;
  queries.touchRoomToken(token.id);
  return { token, invite };
}

export function revokeInvite(inviteId: string): boolean {
  const result = queries.revokeRoomInvite(inviteId);
  return Boolean(result?.changes);
}

export function revokeToken(tokenId: string): boolean {
  const result = queries.revokeRoomToken(tokenId);
  return Boolean(result?.changes);
}

export function listInvitesForRoom(roomId: string): InviteRow[] {
  return queries.listRoomInvites(roomId) as InviteRow[];
}

export function listTokensForInvite(inviteId: string): TokenRow[] {
  return queries.listRoomTokens(inviteId) as TokenRow[];
}

// Extract a bearer token from an Authorization header, ?token= query, or
// Sec-WebSocket-Protocol subprotocol (the only auth channel a browser WS gets
// without custom headers). Returns the plaintext token or null.
export function extractTokenFromHeaders(headers: Headers | Record<string, string | undefined> | undefined, url?: URL | string | null): string | null {
  const get = (name: string): string | null => {
    if (!headers) return null;
    if (typeof (headers as Headers).get === 'function') {
      return (headers as Headers).get(name);
    }
    const map = headers as Record<string, string | undefined>;
    const direct = map[name] ?? map[name.toLowerCase()];
    return direct ?? null;
  };
  const auth = get('authorization') || get('Authorization');
  if (auth) {
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (match) return match[1].trim();
  }
  const proto = get('sec-websocket-protocol') || get('Sec-WebSocket-Protocol');
  if (proto) {
    for (const part of proto.split(',')) {
      const trimmed = part.trim();
      if (trimmed.startsWith('ant.token.')) return trimmed.slice('ant.token.'.length);
    }
  }
  if (url) {
    try {
      const u = typeof url === 'string' ? new URL(url) : url;
      const q = u.searchParams.get('token');
      if (q) return q;
    } catch {
      // ignore malformed URL
    }
  }
  return null;
}

export interface AuthResult {
  resolved: ResolvedToken;
  roomId: string;
  kind: InviteKind;
  handle: string | null;
}

// Authenticate a request against a specific room. Returns null if the token is
// missing, malformed, revoked, or scoped to a different room. Callers should
// 401 (missing) vs 403 (wrong room / revoked) at their discretion.
export function authenticateRoomRequest(roomId: string, headers: Headers | Record<string, string | undefined> | undefined, url?: URL | string | null): AuthResult | null {
  const plaintext = extractTokenFromHeaders(headers, url);
  if (!plaintext) return null;
  const resolved = resolveToken(plaintext);
  if (!resolved) return null;
  if (resolved.token.room_id !== roomId) return null;
  return {
    resolved,
    roomId: resolved.token.room_id,
    kind: resolved.token.kind,
    handle: resolved.token.handle,
  };
}

export function buildShareString(opts: { serverUrl: string; roomId: string; inviteId: string; kind: InviteKind }): string {
  const u = new URL(opts.serverUrl);
  if (opts.kind === 'cli') {
    return `ant://${u.host}/r/${opts.roomId}?invite=${opts.inviteId}`;
  }
  if (opts.kind === 'mcp') {
    return `${u.protocol}//${u.host}/mcp/room/${opts.roomId}?invite=${opts.inviteId}`;
  }
  return `${u.protocol}//${u.host}/r/${opts.roomId}?invite=${opts.inviteId}`;
}
