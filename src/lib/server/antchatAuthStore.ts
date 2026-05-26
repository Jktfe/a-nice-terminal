/**
 * antchatAuthStore — in-memory token store for the Mac antchat app login.
 *
 * Pairs with:
 *   - ~/.ant/dev-users.json — email + bcrypt password_hash list
 *   - ~/.ant/dev-licences.json — DEV-tier allowlist (entitlement)
 *
 * Tokens live in memory only, lost on server restart — fine for the
 * demo. When codex extends this, swap to SQLite-backed tokens table
 * with TTL + last_seen tracking.
 *
 * Endpoints that consume this store:
 *   POST /api/auth/login        — issue token
 *   GET  /api/auth/me           — verify token
 *   POST /api/auth/logout       — revoke token
 *
 * Spec: ObsidiANT/contracts/antchat-api-2026-05-19.md + audit doc §D/§E.
 * Authority: JWPK msg_m23v9tltxi (demo-pressure pickup).
 */

import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import { getIdentityDb } from './db';

function usersFilePath(): string {
  return process.env.ANTCHAT_DEV_USERS_PATH || join(homedir(), '.ant', 'dev-users.json');
}

function licencesFilePath(): string {
  return process.env.ANTCHAT_DEV_LICENCES_PATH || join(homedir(), '.ant', 'dev-licences.json');
}

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days — matches JWPK's 'week or so' policy

export type AntchatUser = {
  id: string;
  email: string;
  displayName: string;
  handle: string;
};

export type LicensedAntchatUser = AntchatUser & {
  role: 'owner' | 'admin' | 'member';
  tier?: string;
};

type StoredUser = {
  email: string;
  password_hash: string;
  role?: string;
  tier?: string;
  must_change_password?: boolean;
  /** Optional override of the auto-derived handle (default = `@<local-part>`).
   *  Use for users whose canonical v4 room handle differs from their email
   *  local-part — e.g. james@newmodel.vc → `@you` per demo-login convention. */
  handle?: string;
};

type UsersFile = {
  users: StoredUser[];
};

type LicencesFile = {
  allowedEmails: string[];
  tier: string;
  features: string[];
};

type SessionRecord = {
  email: string;
  issuedAtMs: number;
  expiresAtMs: number;
};

// O1 SQLite projection (was globalThis.__antchatTokenMap). Tokens now
// survive launchd kickstart so signed-in Mac clients don't 401 + re-login
// every time the service restarts. Mirrors the plan_events /
// message_reactions / chat_invite_tokens projection pattern.

type TokenRow = {
  token: string;
  email: string;
  issued_at_ms: number;
  expires_at_ms: number;
};

function rowToSession(row: TokenRow): SessionRecord {
  return {
    email: row.email,
    issuedAtMs: row.issued_at_ms,
    expiresAtMs: row.expires_at_ms
  };
}

function readUsers(): UsersFile {
  return JSON.parse(readFileSync(usersFilePath(), 'utf-8')) as UsersFile;
}

function readLicences(): LicencesFile {
  return JSON.parse(readFileSync(licencesFilePath(), 'utf-8')) as LicencesFile;
}

export function normalizeAntchatEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function findStoredUser(email: string): StoredUser | null {
  const target = normalizeAntchatEmail(email);
  const users = readUsers().users;
  return users.find((u) => normalizeAntchatEmail(u.email) === target) ?? null;
}

function normalizeStoredRole(role: string | undefined): 'owner' | 'admin' | 'member' {
  if (role === 'owner' || role === 'admin' || role === 'member') return role;
  return 'member';
}

export function listLicensedAntchatUsers(): LicensedAntchatUser[] {
  const users = readUsers().users;
  const licences = readLicences();
  return users
    .filter((user) => emailAllowedByLicence(user.email))
    .map((user) => ({
      ...userShapeForEmail(user.email),
      role: normalizeStoredRole(user.role),
      tier: user.tier ?? licences.tier
    }));
}

export function emailAllowedByLicence(email: string): boolean {
  const target = normalizeAntchatEmail(email);
  const allowed = readLicences().allowedEmails;
  return allowed.some((e) => normalizeAntchatEmail(e) === target);
}

/**
 * Validate the literal `NEW-MODEL-ANT-DEV-<email>` licence-code shape.
 * Returns the email parsed out (lowercased) if the format matches AND
 * the email is allowlisted, else null.
 */
export function parseAndValidateLicenceKey(licenseKey: string): string | null {
  const prefix = 'NEW-MODEL-ANT-DEV-';
  if (!licenseKey.toUpperCase().startsWith(prefix)) return null;
  const email = licenseKey.slice(prefix.length).trim();
  if (email.length === 0) return null;
  if (!emailAllowedByLicence(email)) return null;
  return normalizeAntchatEmail(email);
}

export function issueToken(email: string): { token: string; expiresAtMs: number } {
  const token = randomBytes(32).toString('base64url');
  const issuedAtMs = Date.now();
  const expiresAtMs = issuedAtMs + SESSION_TTL_MS;
  getIdentityDb()
    .prepare(
      `INSERT INTO antchat_auth_tokens (token, email, issued_at_ms, expires_at_ms)
       VALUES (?, ?, ?, ?)`
    )
    .run(token, normalizeAntchatEmail(email), issuedAtMs, expiresAtMs);
  return { token, expiresAtMs };
}

/**
 * Cache a bearer token that was minted externally (e.g. by accounts.antonline.dev's
 * /api/auth/login) so subsequent SYNC bearer-resolution paths can resolve it
 * without round-tripping back to accounts on every call.
 *
 * Why: `chatRoomReadGate.tryAccountsBearer` does async introspection against
 * accounts/api/auth/me to validate unknown bearers — works for read paths
 * (which are async). The WRITE-side gate `authGate.resolveAntchatBearer` is
 * synchronous and only looks at this local table, so without caching the
 * token here, every write from a Mac app authenticated through accounts
 * fails with a 403 'Server-resolved identity required' even though the
 * read gate just accepted the same bearer 200ms earlier.
 *
 * Idempotent: if the token already exists for the same email, it's a no-op.
 * If the token exists with a stale email or expiry, the row is replaced.
 * If the token doesn't exist, it's inserted.
 *
 * Caller supplies the expiresAtMs from the upstream payload (accounts' /api/auth/me
 * returns its session.expiresAt) so the local cache evicts at the same moment
 * the upstream session expires. Falls back to SESSION_TTL_MS from now if the
 * caller doesn't have a value to pass.
 */
export function cacheExternalToken(input: {
  token: string;
  email: string;
  expiresAtMs?: number;
}): void {
  const normalizedEmail = normalizeAntchatEmail(input.email);
  if (normalizedEmail.length === 0) return;
  const issuedAtMs = Date.now();
  const expiresAtMs =
    typeof input.expiresAtMs === 'number' && input.expiresAtMs > issuedAtMs
      ? input.expiresAtMs
      : issuedAtMs + SESSION_TTL_MS;
  getIdentityDb()
    .prepare(
      `INSERT INTO antchat_auth_tokens (token, email, issued_at_ms, expires_at_ms)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(token) DO UPDATE SET
         email = excluded.email,
         issued_at_ms = excluded.issued_at_ms,
         expires_at_ms = excluded.expires_at_ms`
    )
    .run(input.token, normalizedEmail, issuedAtMs, expiresAtMs);
}

export function resolveToken(token: string): SessionRecord | null {
  const db = getIdentityDb();
  const row = db
    .prepare(`SELECT token, email, issued_at_ms, expires_at_ms FROM antchat_auth_tokens WHERE token = ?`)
    .get(token) as TokenRow | undefined;
  if (!row) return null;
  if (row.expires_at_ms < Date.now()) {
    db.prepare(`DELETE FROM antchat_auth_tokens WHERE token = ?`).run(token);
    return null;
  }
  return rowToSession(row);
}

export function revokeToken(token: string): boolean {
  const info = getIdentityDb()
    .prepare(`DELETE FROM antchat_auth_tokens WHERE token = ?`)
    .run(token);
  return info.changes > 0;
}

export function resetAntchatAuthTokensForTests(): void {
  getIdentityDb().prepare(`DELETE FROM antchat_auth_tokens`).run();
}

export function bearerTokenFromHeader(header: string | null): string | null {
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

/** Hash a new password + persist to dev-users.json. Used by rotate-password. */
export function setUserPassword(email: string, newPassword: string): void {
  const file = readUsers();
  const target = normalizeAntchatEmail(email);
  for (const u of file.users) {
    if (normalizeAntchatEmail(u.email) === target) {
      u.password_hash = bcrypt.hashSync(newPassword, 12);
      u.must_change_password = false;
    }
  }
  writeFileSync(usersFilePath(), JSON.stringify(file, null, 2), { mode: 0o600 });
}

/**
 * Build the user shape the antchat client expects.
 * Derives display name + handle from the email local-part.
 */
export function userShapeForEmail(email: string): AntchatUser {
  const normalised = normalizeAntchatEmail(email);
  const local = normalised.split('@')[0];
  // 'j.stephenson' → 'J Stephenson', 'james' → 'James'
  const displayName = local
    .split(/[._-]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
  // Honour stored handle override (e.g. james@newmodel.vc → @you per v4
  // demo-login convention) if the user record has one, else derive from
  // the email local-part.
  const stored = findStoredUser(normalised);
  const handle = stored?.handle ?? `@${local.replace(/[^a-z0-9]/g, '')}`;
  return {
    id: normalised, // email as stable id for now
    email: normalised,
    displayName,
    handle
  };
}

/**
 * Return the licence shape the antchat client expects.
 * Server-side tier 'dev' maps to client-side 'paid' (full features) —
 * the Swift enum only ships 'free' | 'paid'; dev-tier team users get
 * paid-equivalent UX without any billing path.
 */
export function licenceShapeForEmail(email: string): {
  valid: boolean;
  tier: 'free' | 'paid';
  expiresAt: number | null;
  features: string[];
  stripeCustomerId: string | null;
  upgradeUrl: string | null;
} {
  const allowed = emailAllowedByLicence(email);
  if (!allowed) {
    return {
      valid: false,
      tier: 'free',
      expiresAt: null,
      features: [],
      stripeCustomerId: null,
      upgradeUrl: null
    };
  }
  const lic = readLicences();
  return {
    valid: true,
    tier: 'paid', // dev → paid mapping (see Swift enum docstring)
    expiresAt: null,
    features: lic.features ?? ['all'],
    stripeCustomerId: null,
    upgradeUrl: null
  };
}
