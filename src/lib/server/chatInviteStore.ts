/**
 * Chat room invites + tokens — security primitive. Surgical lift of v3
 * room-invites + room-tokens: password-hashed invites mint sha256-hashed
 * bearer tokens; plaintext bearer is returned ONCE on exchange and never
 * stored. Auto-revoke after MAX_FAILED_ATTEMPTS, cascade to derived
 * tokens on invite revoke. Identity hooks (handle + kind) sit on the
 * token, ready for the lane-5 identity-routing layer.
 *
 * Persistence: SQLite-backed via getIdentityDb (JWPK msg_71divtsj8r
 * ratified ask_r0v3b4t — invites were launch-blocking because an
 * operator-minted invite vanished on every launchd kickstart, blocking
 * the share-this-invite-tomorrow workflow). Schema lives in db.ts
 * (chat_invites + chat_invite_tokens tables). Public function names
 * unchanged so every caller — /api/chat-invites, /api/chat-rooms/[id]/
 * operator-invites, /api/chat-invites/[id]/exchange, /r/[inviteId] — keeps
 * its existing call sites.
 */

import { randomBytes } from 'crypto';
import {
  hashPassword,
  hashToken,
  mintTokenSecret,
  verifyPassword
} from './chatInviteCrypto';
import { getIdentityDb } from './db';

export { hashPassword, hashToken, mintTokenSecret, verifyPassword };

export type InviteKind = 'cli' | 'mcp' | 'web';

const ALLOWED_INVITE_KINDS: ReadonlySet<InviteKind> = new Set(['cli', 'mcp', 'web']);

export const MAX_FAILED_ATTEMPTS: number = (() => {
  const raw = process.env.ANT_INVITE_MAX_FAILURES;
  if (!raw) return 5;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 5;
})();

export class ChatInviteRevokedError extends Error {
  constructor(message = 'invite revoked') {
    super(message);
    this.name = 'ChatInviteRevokedError';
  }
}

export class ChatInviteHandleNotAllowedError extends Error {}

type StoredChatInvite = {
  id: string;
  room_id: string;
  label: string;
  password_hash: string;
  kinds: InviteKind[];
  created_by: string | null;
  created_at: string;
  revoked_at: string | null;
  failed_attempts: number;
  last_failed_at: string | null;
  hidden: boolean;
  allowed_handles: string[] | null;
};

type StoredChatToken = {
  id: string;
  invite_id: string;
  room_id: string;
  token_hash: string;
  kind: InviteKind;
  handle: string | null;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
};

type InviteRow = {
  id: string;
  room_id: string;
  label: string;
  password_hash: string;
  kinds_json: string;
  created_by: string | null;
  created_at: string;
  revoked_at: string | null;
  failed_attempts: number;
  last_failed_at: string | null;
  hidden: number;
  allowed_handles_json: string | null;
};

type TokenRow = {
  id: string;
  invite_id: string;
  room_id: string;
  token_hash: string;
  kind: InviteKind;
  handle: string | null;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
};

function rowToInvite(row: InviteRow): StoredChatInvite {
  let kinds: InviteKind[];
  try {
    const parsed = JSON.parse(row.kinds_json);
    kinds = Array.isArray(parsed)
      ? parsed.filter((k): k is InviteKind => typeof k === 'string' && ALLOWED_INVITE_KINDS.has(k as InviteKind))
      : [];
  } catch {
    kinds = [];
  }
  let allowed_handles: string[] | null = null;
  if (row.allowed_handles_json) {
    try {
      const parsed = JSON.parse(row.allowed_handles_json);
      if (Array.isArray(parsed)) {
        allowed_handles = parsed.filter((h): h is string => typeof h === 'string' && h.length > 0);
        if (allowed_handles.length === 0) allowed_handles = null;
      }
    } catch {
      allowed_handles = null;
    }
  }
  return {
    id: row.id,
    room_id: row.room_id,
    label: row.label,
    password_hash: row.password_hash,
    kinds,
    created_by: row.created_by,
    created_at: row.created_at,
    revoked_at: row.revoked_at,
    failed_attempts: row.failed_attempts,
    last_failed_at: row.last_failed_at,
    hidden: row.hidden === 1,
    allowed_handles
  };
}

function rowToToken(row: TokenRow): StoredChatToken {
  return {
    id: row.id,
    invite_id: row.invite_id,
    room_id: row.room_id,
    token_hash: row.token_hash,
    kind: row.kind,
    handle: row.handle,
    created_at: row.created_at,
    last_seen_at: row.last_seen_at,
    revoked_at: row.revoked_at
  };
}

function getInviteById(inviteId: string): StoredChatInvite | null {
  const db = getIdentityDb();
  const row = db.prepare(`SELECT * FROM chat_invites WHERE id = ?`).get(inviteId) as InviteRow | undefined;
  return row ? rowToInvite(row) : null;
}

export type PublicInviteSummary = {
  id: string;
  room_id: string;
  label: string;
  kinds: InviteKind[];
  created_by: string | null;
  created_at: string;
};

export type PublicInviteRedemption = {
  kind: InviteKind;
  handle: string | null;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
};

export type PublicInviteWithUsage = PublicInviteSummary & {
  redemptions: PublicInviteRedemption[];
  redeemed_count: number;
  active_token_count: number;
  last_redeemed_at: string | null;
  last_seen_at: string | null;
};

export type TokenIdentity = {
  tokenId: string;
  inviteId: string;
  room_id: string;
  kind: InviteKind;
  handle: string | null;
};

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  const random = randomBytes(8).toString('hex');
  return `${prefix}_${random}`;
}

function parseKinds(kinds: InviteKind[]): InviteKind[] {
  if (kinds.length === 0) throw new Error('At least one kind is required');
  for (const kind of kinds) {
    if (!ALLOWED_INVITE_KINDS.has(kind)) {
      throw new Error(`Unknown invite kind: ${kind}`);
    }
  }
  return [...new Set(kinds)];
}

function toPublicSummary(invite: StoredChatInvite): PublicInviteSummary {
  // Defensive copy of kinds — without this a caller could mutate the
  // returned array and widen the stored invite's allowed kinds.
  return {
    id: invite.id,
    room_id: invite.room_id,
    label: invite.label,
    kinds: [...invite.kinds],
    created_by: invite.created_by,
    created_at: invite.created_at
  };
}

export type CreateInviteInput = {
  roomId: string;
  label: string;
  password: string;
  kinds: InviteKind[];
  createdBy?: string | null;
  hidden?: boolean;
  // B2-1: inviter-consented handle allowlist. Omitted/empty → open.
  allowedHandles?: string[] | null;
};

function normalizeAllowedHandles(raw: string[] | null | undefined): string[] | null {
  if (!raw) return null;
  const cleaned = raw
    .filter((h): h is string => typeof h === 'string')
    .map((h) => h.trim())
    .filter((h) => h.length > 0);
  return cleaned.length > 0 ? [...new Set(cleaned)] : null;
}

export function createInvite(input: CreateInviteInput): PublicInviteSummary {
  if (input.roomId.trim().length === 0) throw new Error('roomId is required');
  if (input.label.trim().length === 0) throw new Error('label is required');
  const kinds = parseKinds(input.kinds);
  const passwordHash = hashPassword(input.password);
  const allowedHandles = normalizeAllowedHandles(input.allowedHandles);
  const record: StoredChatInvite = {
    id: newId('inv'),
    room_id: input.roomId,
    label: input.label,
    password_hash: passwordHash,
    kinds,
    created_by: input.createdBy ?? null,
    created_at: nowIso(),
    revoked_at: null,
    failed_attempts: 0,
    last_failed_at: null,
    hidden: input.hidden === true,
    allowed_handles: allowedHandles
  };
  const db = getIdentityDb();
  db.prepare(
    `INSERT INTO chat_invites
       (id, room_id, label, password_hash, kinds_json, created_by, created_at,
        revoked_at, failed_attempts, last_failed_at, hidden, allowed_handles_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, NULL, ?, ?)`
  ).run(
    record.id,
    record.room_id,
    record.label,
    record.password_hash,
    JSON.stringify(record.kinds),
    record.created_by,
    record.created_at,
    record.hidden ? 1 : 0,
    allowedHandles ? JSON.stringify(allowedHandles) : null
  );
  return toPublicSummary(record);
}

function cascadeRevokeTokensForInvite(inviteId: string, nowAt: string): void {
  const db = getIdentityDb();
  db.prepare(
    `UPDATE chat_invite_tokens SET revoked_at = ? WHERE invite_id = ? AND revoked_at IS NULL`
  ).run(nowAt, inviteId);
}

export type ExchangeInput = {
  inviteId: string;
  password: string;
  kind: InviteKind;
  handle?: string | null;
};

export type ExchangeOutput = {
  tokenId: string;
  tokenSecret: string;
};

export function exchangePasswordForToken(input: ExchangeInput): ExchangeOutput {
  const db = getIdentityDb();
  const invite = getInviteById(input.inviteId);
  if (!invite) throw new ChatInviteRevokedError('invite not found');
  if (invite.revoked_at !== null) throw new ChatInviteRevokedError('invite revoked');
  if (!invite.kinds.includes(input.kind)) {
    throw new Error(`Invite does not permit kind ${input.kind}`);
  }
  if (!verifyPassword(input.password, invite.password_hash)) {
    const failedAttempts = invite.failed_attempts + 1;
    const failedAt = nowIso();
    if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
      // Auto-revoke + cascade in one transaction so concurrent calls
      // don't observe an inconsistent state.
      db.transaction(() => {
        db.prepare(
          `UPDATE chat_invites SET failed_attempts = ?, last_failed_at = ?, revoked_at = ? WHERE id = ?`
        ).run(failedAttempts, failedAt, failedAt, invite.id);
        cascadeRevokeTokensForInvite(invite.id, failedAt);
      })();
    } else {
      db.prepare(
        `UPDATE chat_invites SET failed_attempts = ?, last_failed_at = ? WHERE id = ?`
      ).run(failedAttempts, failedAt, invite.id);
    }
    throw new ChatInviteRevokedError('wrong password');
  }
  // B2-1 consent gate: when the inviter set an allowlist, only those
  // handles may redeem. Password-correct but unlisted handle → reject
  // WITHOUT incrementing failed_attempts (it's a consent denial, not a
  // brute-force attempt — must not auto-revoke the invite).
  if (invite.allowed_handles && invite.allowed_handles.length > 0) {
    if (!input.handle || !invite.allowed_handles.includes(input.handle)) {
      throw new ChatInviteHandleNotAllowedError(
        'handle is not on this invite allowlist'
      );
    }
  }
  // Password OK + allowed handle (or open) — reset the failure counter
  // and mint the bearer token in one transaction so neither half can
  // half-commit.
  const secret = mintTokenSecret();
  const tokenId = newId('tok');
  const tokenCreatedAt = nowIso();
  db.transaction(() => {
    if (invite.failed_attempts > 0) {
      db.prepare(
        `UPDATE chat_invites SET failed_attempts = 0, last_failed_at = NULL WHERE id = ?`
      ).run(invite.id);
    }
    db.prepare(
      `INSERT INTO chat_invite_tokens
         (id, invite_id, room_id, token_hash, kind, handle, created_at, last_seen_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)`
    ).run(
      tokenId,
      invite.id,
      invite.room_id,
      hashToken(secret),
      input.kind,
      input.handle ?? null,
      tokenCreatedAt
    );
  })();
  return { tokenId, tokenSecret: secret };
}

export function verifyToken(tokenSecret: string, roomId: string): TokenIdentity | null {
  const db = getIdentityDb();
  const hash = hashToken(tokenSecret);
  const tokenRow = db
    .prepare(`SELECT * FROM chat_invite_tokens WHERE token_hash = ?`)
    .get(hash) as TokenRow | undefined;
  if (!tokenRow) return null;
  const token = rowToToken(tokenRow);
  if (token.room_id !== roomId) return null;
  if (token.revoked_at !== null) return null;
  const invite = getInviteById(token.invite_id);
  if (!invite || invite.revoked_at !== null) return null;
  // Best-effort last-seen touch — failures don't affect verification.
  try {
    db.prepare(`UPDATE chat_invite_tokens SET last_seen_at = ? WHERE id = ?`).run(nowIso(), token.id);
  } catch {
    /* ignore */
  }
  return {
    tokenId: token.id,
    inviteId: token.invite_id,
    room_id: token.room_id,
    kind: token.kind,
    handle: token.handle
  };
}

export function revokeToken(tokenId: string): boolean {
  const db = getIdentityDb();
  const row = db
    .prepare(`SELECT revoked_at FROM chat_invite_tokens WHERE id = ?`)
    .get(tokenId) as { revoked_at: string | null } | undefined;
  if (!row) return false;
  if (row.revoked_at !== null) return true;
  db.prepare(`UPDATE chat_invite_tokens SET revoked_at = ? WHERE id = ?`).run(nowIso(), tokenId);
  return true;
}

export function revokeInvite(inviteId: string): boolean {
  const db = getIdentityDb();
  const invite = getInviteById(inviteId);
  if (!invite) return false;
  const at = nowIso();
  db.transaction(() => {
    if (invite.revoked_at === null) {
      db.prepare(`UPDATE chat_invites SET revoked_at = ? WHERE id = ?`).run(at, inviteId);
    }
    cascadeRevokeTokensForInvite(inviteId, at);
  })();
  return true;
}

/**
 * Every ANThandle that has ACCEPTED an invite — a live (non-revoked) invite
 * token carries a handle (JWPK + fClaude 2026-06-12: an invite went OUT and was
 * ACCEPTED). These are the real cli/mcp/api agents the colony onboarded, and
 * (filtered to the operator's owned set) the pairable list for the helper.
 * Colony-wide and de-duplicated; ordered for stable display.
 */
export function listAcceptedInviteHandles(): {
  handle: string;
  kind: InviteKind;
  invitedBy: string | null;
}[] {
  const db = getIdentityDb();
  // The invite's creator OWNS the accepted handle (owner chain ends at a human —
  // the inviter). We carry created_by so callers scope to the operator's own
  // invitees without depending on the (patchily-populated) handles.owners table.
  const rows = db
    .prepare(
      `SELECT t.handle AS handle, t.kind AS kind, ci.created_by AS invited_by
         FROM chat_invite_tokens t
         JOIN chat_invites ci ON ci.id = t.invite_id
        WHERE t.revoked_at IS NULL AND t.handle IS NOT NULL AND t.handle != ''
        GROUP BY t.handle, t.kind, ci.created_by
        ORDER BY t.handle ASC`
    )
    .all() as { handle: string; kind: InviteKind; invited_by: string | null }[];
  return rows.map((r) => ({ handle: r.handle, kind: r.kind, invitedBy: r.invited_by }));
}

export function listActiveInvitesForRoom(roomId: string): PublicInviteSummary[] {
  const db = getIdentityDb();
  const rows = db
    .prepare(
      `SELECT * FROM chat_invites
       WHERE room_id = ? AND revoked_at IS NULL AND hidden = 0
       ORDER BY created_at ASC`
    )
    .all(roomId) as InviteRow[];
  return rows.map((row) => toPublicSummary(rowToInvite(row)));
}

type InviteUsageTokenRow = {
  invite_id: string;
  kind: InviteKind;
  handle: string | null;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
};

export function listActiveInvitesWithUsageForRoom(roomId: string): PublicInviteWithUsage[] {
  const invites = listActiveInvitesForRoom(roomId);
  if (invites.length === 0) return [];

  const db = getIdentityDb();
  const tokenRows = db
    .prepare(
      `SELECT invite_id, kind, handle, created_at, last_seen_at, revoked_at
       FROM chat_invite_tokens
       WHERE room_id = ?
       ORDER BY created_at ASC`
    )
    .all(roomId) as InviteUsageTokenRow[];

  const tokensByInvite = new Map<string, PublicInviteRedemption[]>();
  for (const token of tokenRows) {
    const redemptions = tokensByInvite.get(token.invite_id) ?? [];
    redemptions.push({
      kind: token.kind,
      handle: token.handle,
      created_at: token.created_at,
      last_seen_at: token.last_seen_at,
      revoked_at: token.revoked_at
    });
    tokensByInvite.set(token.invite_id, redemptions);
  }

  return invites.map((invite) => {
    const redemptions = tokensByInvite.get(invite.id) ?? [];
    const seenAtValues = redemptions
      .map((token) => token.last_seen_at)
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .sort();
    return {
      ...invite,
      redemptions,
      redeemed_count: redemptions.length,
      active_token_count: redemptions.filter((token) => token.revoked_at === null).length,
      last_redeemed_at: redemptions.length > 0 ? redemptions[redemptions.length - 1].created_at : null,
      last_seen_at: seenAtValues.length > 0 ? seenAtValues[seenAtValues.length - 1] : null
    };
  });
}

// B2-2-summary (2026-05-15): public, no-admin-auth invite preview. The
// invite-id IS the capability — a colleague holding the link can see the
// room label + permitted kinds + revoked state BEFORE entering a
// password. NEVER exposes password_hash / failed_attempts / token data.
// Returns null when the invite id is unknown (caller → 404).
export type PublicInvitePreview = {
  inviteId: string;
  roomId: string;
  label: string;
  kindsAllowed: InviteKind[];
  revoked: boolean;
};

export function getInvitePreview(inviteId: string): PublicInvitePreview | null {
  const invite = getInviteById(inviteId);
  if (!invite) return null;
  return {
    inviteId: invite.id,
    roomId: invite.room_id,
    label: invite.label,
    kindsAllowed: [...invite.kinds],
    revoked: invite.revoked_at !== null
  };
}

export function resetChatInviteStoreForTests(): void {
  // Wipe both tables. Tests rely on a clean slate per the per-worker DB
  // pattern (VITEST_WORKER_ID-scoped tmpdir) the rest of the persisted
  // stores use.
  const db = getIdentityDb();
  db.transaction(() => {
    db.prepare(`DELETE FROM chat_invite_tokens`).run();
    db.prepare(`DELETE FROM chat_invites`).run();
  })();
}
