/**
 * helperLeaseStore — antAppHelper lease lifecycle (SPEC §3).
 *
 * A lease is the credential that lets a desktop AI app (Claude Desktop, Codex
 * app, …) join the colony as a first-class handle WITHOUT a babysitting
 * terminal or a tmux pane — the answer to "why does a desktop app have a
 * pane?" (it shouldn't; it holds a lease instead).
 *
 * Contract guarantees encoded here:
 *   - Bound to ONE handle. Revocable. TTL'd (operator-set; default 30 days).
 *   - Carries owners[] with the ≥1-human-owner invariant (mint refuses empty).
 *   - A lease-holder is NEVER a member — the two-identity-class rule. This
 *     store writes NO room_membership / handle_binding row; it only mints a
 *     scoped credential. Authoring, claiming handles, and approving asks are
 *     structurally absent from the scope (see HELPER_LEASE_SCOPE).
 *   - Revoke = instant deafness: one row flip (revoked_at_ms), checked on every
 *     resolve. No fanout, no token to chase.
 *
 * The secret is returned in PLAINTEXT once at mint; only its hash is stored.
 * Schema: helper_leases (see ./db.ts).
 */
import { randomBytes } from 'node:crypto';
import { hashToken } from './chatInviteStore';
import { getIdentityDb } from './db';

/**
 * An attachment's scope is FIXED per ROLE — there are no per-lease knobs (the
 * anti-spaghetti rule). `role` picks one of two profiles and nothing finer.
 */
export type AttachmentRole = 'reader' | 'agent';

export interface AttachmentScope {
  /** subscribe to the bound handle's delivery feed (metadata only — no bodies). */
  subscribeFeed: boolean;
  /** fire operator-configured routes to NON-room sinks (file / human channel / app nudge). */
  fireRoutes: boolean;
  /** post the app's own status (thinking / asking / idle). */
  postStatus: boolean;
  /** author room messages as the handle. */
  authorMessages: boolean;
  /** claim or change handles. */
  claimHandle: boolean;
  /** approve asks / change membership. */
  approveAsks: boolean;
}

export const ATTACHMENT_SCOPES: Record<AttachmentRole, Readonly<AttachmentScope>> = {
  // The HELPER: reads the pipe, fires routes to inert/human sinks, rings bells.
  // NEVER posts (2026-06-11 ruling) — it subscribes ON BEHALF OF a handle and
  // never IS one. A thing that can't post can't be spoofed into posting.
  reader: Object.freeze({
    subscribeFeed: true,
    fireRoutes: true,
    postStatus: false,
    authorMessages: false,
    claimHandle: false,
    approveAsks: false
  }),
  // A paneless ANThandle's status attachment — it can listen, fire routes, and
  // post its own heartbeat, but it does NOT author room messages. Message
  // authoring requires a witnessed pane/session path, not a helper lease.
  agent: Object.freeze({
    subscribeFeed: true,
    fireRoutes: true,
    postStatus: true,
    authorMessages: false,
    claimHandle: false,
    approveAsks: false
  })
};

/** Back-compat alias: the helper's fixed (read-only) scope. */
export const HELPER_LEASE_SCOPE = ATTACHMENT_SCOPES.reader;

export const DEFAULT_LEASE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, operator-overridable

export type StoredLease = {
  id: string;
  handle: string;
  role: AttachmentRole;
  owners: string[];
  paired_host: string | null;
  created_by: string | null;
  created_at_ms: number;
  expires_at_ms: number | null;
  revoked_at_ms: number | null;
  last_seen_at_ms: number | null;
};

export type MintLeaseInput = {
  handle: string;
  /** 'reader' (helper, default) or 'agent' (paneless authoring ANThandle). */
  role?: AttachmentRole;
  /** ≥1 owner handle (the signing human + chain). Empty is refused. */
  owners: string[];
  pairedHost?: string | null;
  createdBy?: string | null;
  /** TTL in ms; defaults to 30 days. Pass null for no expiry (discouraged). */
  ttlMs?: number | null;
  nowMs?: number;
  /** test seam: inject the lease id / secret rather than minting random. */
  leaseId?: string;
  secret?: string;
};

export type MintLeaseResult = {
  leaseId: string;
  /** plaintext lease secret — returned ONCE; only the hash is stored. */
  secret: string;
  lease: StoredLease;
};

function newLeaseId(): string {
  return `lease_${randomBytes(12).toString('hex')}`;
}

function rowToLease(row: Record<string, unknown>): StoredLease {
  let owners: string[] = [];
  try {
    const parsed = JSON.parse((row.owners as string) ?? '[]');
    if (Array.isArray(parsed)) owners = parsed.filter((o): o is string => typeof o === 'string');
  } catch { /* corrupt owners json → empty; resolve still works, callers see no owners */ }
  const roleRaw = (row.role as string | null) ?? 'reader';
  const role: AttachmentRole = roleRaw === 'agent' ? 'agent' : 'reader';
  return {
    id: row.id as string,
    handle: row.handle as string,
    role,
    owners,
    paired_host: (row.paired_host as string | null) ?? null,
    created_by: (row.created_by as string | null) ?? null,
    created_at_ms: row.created_at_ms as number,
    expires_at_ms: (row.expires_at_ms as number | null) ?? null,
    revoked_at_ms: (row.revoked_at_ms as number | null) ?? null,
    last_seen_at_ms: (row.last_seen_at_ms as number | null) ?? null
  };
}

/** Active = not revoked AND not past its expiry (null expiry never expires). */
export function isLeaseActive(lease: StoredLease, nowMs: number): boolean {
  if (lease.revoked_at_ms !== null) return false;
  if (lease.expires_at_ms !== null && lease.expires_at_ms <= nowMs) return false;
  return true;
}

export function mintLease(input: MintLeaseInput): MintLeaseResult {
  const handle = input.handle.trim();
  if (handle.length === 0) throw new Error('mintLease: handle is required');
  const owners = input.owners.map((o) => o.trim()).filter((o) => o.length > 0);
  // Contract invariant: a lease must have at least one (human) owner — no
  // orphan credentials that no-one can revoke or is accountable for.
  if (owners.length === 0) throw new Error('mintLease: at least one owner is required (>=1-human-owner invariant)');

  const db = getIdentityDb();
  const role: AttachmentRole = input.role === 'agent' ? 'agent' : 'reader';
  const nowMs = input.nowMs ?? Date.now();
  const ttlMs = input.ttlMs === undefined ? DEFAULT_LEASE_TTL_MS : input.ttlMs;
  const expiresAtMs = ttlMs === null ? null : nowMs + ttlMs;
  const leaseId = input.leaseId ?? newLeaseId();
  const secret = input.secret ?? `lease_sk_${randomBytes(24).toString('hex')}`;
  const secretHash = hashToken(secret);

  db.prepare(
    `INSERT INTO helper_leases
       (id, handle, role, owners, secret_hash, paired_host, created_by, created_at_ms, expires_at_ms, revoked_at_ms, last_seen_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`
  ).run(
    leaseId, handle, role, JSON.stringify(owners), secretHash,
    input.pairedHost ?? null, input.createdBy ?? null, nowMs, expiresAtMs
  );

  return {
    leaseId,
    secret,
    lease: {
      id: leaseId, handle, role, owners, paired_host: input.pairedHost ?? null,
      created_by: input.createdBy ?? null, created_at_ms: nowMs,
      expires_at_ms: expiresAtMs, revoked_at_ms: null, last_seen_at_ms: null
    }
  };
}

/** Resolve a lease from its plaintext secret. Returns null when absent OR not
 *  active (revoked / expired) — revoke is instant deafness by construction. */
export function resolveLeaseBySecret(secret: string, nowMs = Date.now()): StoredLease | null {
  const trimmed = secret.trim();
  if (trimmed.length === 0) return null;
  const db = getIdentityDb();
  const row = db.prepare(`SELECT * FROM helper_leases WHERE secret_hash = ?`).get(hashToken(trimmed)) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  const lease = rowToLease(row);
  return isLeaseActive(lease, nowMs) ? lease : null;
}

export function getLeaseById(leaseId: string): StoredLease | null {
  const db = getIdentityDb();
  const row = db.prepare(`SELECT * FROM helper_leases WHERE id = ?`).get(leaseId) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToLease(row) : null;
}

/** Revoke = instant deafness. Returns true if a live lease was revoked. */
export function revokeLease(leaseId: string, nowMs = Date.now()): boolean {
  const db = getIdentityDb();
  const result = db
    .prepare(`UPDATE helper_leases SET revoked_at_ms = ? WHERE id = ? AND revoked_at_ms IS NULL`)
    .run(nowMs, leaseId);
  return result.changes > 0;
}

export function listActiveLeasesForHandle(handle: string, nowMs = Date.now()): StoredLease[] {
  const db = getIdentityDb();
  const rows = db
    .prepare(`SELECT * FROM helper_leases WHERE handle = ? ORDER BY created_at_ms DESC`)
    .all(handle.trim()) as Record<string, unknown>[];
  return rows.map(rowToLease).filter((lease) => isLeaseActive(lease, nowMs));
}

/** All active leases, newest first — the operator's "paired apps" view. */
export function listActiveLeases(nowMs = Date.now()): StoredLease[] {
  const db = getIdentityDb();
  const rows = db
    .prepare(`SELECT * FROM helper_leases ORDER BY created_at_ms DESC`)
    .all() as Record<string, unknown>[];
  return rows.map(rowToLease).filter((lease) => isLeaseActive(lease, nowMs));
}

export function touchLease(leaseId: string, nowMs = Date.now()): void {
  const db = getIdentityDb();
  db.prepare(`UPDATE helper_leases SET last_seen_at_ms = ? WHERE id = ?`).run(nowMs, leaseId);
}
