import { randomUUID } from 'node:crypto';
import { getIdentityDb } from './db';

export type RoomHandleLeaseRow = {
  lease_id: string;
  room_id: string;
  session_id: string;
  handle: string;
  active_from_ms: number;
  active_until_ms: number | null;
  retired_suffix: number | null;
  created_from: string | null;
};

export type RoomHandleLease = {
  leaseId: string;
  roomId: string;
  sessionId: string;
  handle: string;
  activeFromMs: number;
  activeUntilMs: number | null;
  retiredSuffix: number | null;
  createdFrom: string | null;
};

export type CreateRoomHandleLeaseInput = {
  roomId: string;
  sessionId: string;
  handle: string;
  activeFromMs?: number;
  createdFrom?: string | null;
};

export type RetireRoomHandleLeaseInput = {
  roomId: string;
  sessionId: string;
  activeUntilMs?: number;
};

export type DeriveAvailableRoomHandleInput = {
  roomId: string;
  preferredHandle?: string | null;
  fallbackSessionId: string;
};

export type AllocateHandleInput = DeriveAvailableRoomHandleInput & {
  sessionId: string;
  activeFromMs?: number;
  createdFrom?: string | null;
};

export type FindRoomHandleOwnerAtTimeInput = {
  roomId: string;
  handle: string;
  atMs: number;
};

export type BackfillRoomHandleLeasesInput = {
  sessionId: string;
  createdFrom?: string | null;
  activeFromMs?: number;
};

export type BackfillRoomHandleLeasesResult = {
  created: number;
  skippedExisting: number;
  skippedConflict: number;
  roomIds: string[];
};

function nowMs(): number {
  return Date.now();
}

function normaliseHandle(rawHandle: string): string {
  const trimmed = rawHandle.trim();
  if (trimmed.length === 0) return trimmed;
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

function handleBase(rawHandle: string): string {
  const withoutAt = rawHandle.trim().replace(/^@+/, '');
  return withoutAt
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function rowToLease(row: RoomHandleLeaseRow): RoomHandleLease {
  return {
    leaseId: row.lease_id,
    roomId: row.room_id,
    sessionId: row.session_id,
    handle: row.handle,
    activeFromMs: row.active_from_ms,
    activeUntilMs: row.active_until_ms,
    retiredSuffix: row.retired_suffix,
    createdFrom: row.created_from
  };
}

function getLeaseById(leaseId: string): RoomHandleLease | null {
  const row = getIdentityDb()
    .prepare(`SELECT * FROM room_handle_leases WHERE lease_id = ?`)
    .get(leaseId) as RoomHandleLeaseRow | undefined;
  return row ? rowToLease(row) : null;
}

export function createRoomHandleLease(input: CreateRoomHandleLeaseInput): RoomHandleLease {
  const db = getIdentityDb();
  const leaseId = randomUUID();
  const handle = normaliseHandle(input.handle);
  const activeForSession = db
    .prepare(
      `SELECT 1 FROM room_handle_leases
        WHERE room_id = ? AND session_id = ? AND active_until_ms IS NULL
        LIMIT 1`
    )
    .get(input.roomId, input.sessionId);
  if (activeForSession) {
    throw new Error(`Session already has an active room handle in room ${input.roomId}.`);
  }
  try {
    db.prepare(
      `INSERT INTO room_handle_leases
         (lease_id, room_id, session_id, handle, active_from_ms,
          active_until_ms, retired_suffix, created_from)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)`
    ).run(
      leaseId,
      input.roomId,
      input.sessionId,
      handle,
      input.activeFromMs ?? nowMs(),
      input.createdFrom ?? null
    );
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (message.includes('uq_room_handle_leases_active_handle') || message.includes('UNIQUE')) {
      throw new Error(`An active room handle lease already owns ${handle} in room ${input.roomId}.`);
    }
    throw cause;
  }
  return getLeaseById(leaseId) as RoomHandleLease;
}

function activeHandleExists(roomId: string, handle: string): boolean {
  const row = getIdentityDb()
    .prepare(
      `SELECT 1 FROM room_handle_leases
        WHERE room_id = ? AND handle = ? AND active_until_ms IS NULL
        LIMIT 1`
    )
    .get(roomId, handle) as { 1: number } | undefined;
  return Boolean(row);
}

export function deriveAvailableRoomHandle(input: DeriveAvailableRoomHandleInput): string {
  const preferredBase = handleBase(input.preferredHandle ?? '');
  const fallbackBase = handleBase(input.fallbackSessionId);
  const base = preferredBase.length > 0 ? preferredBase : fallbackBase;
  if (base.length === 0) throw new Error('A room handle needs a preferred handle or fallback session id.');

  for (let suffix = 1; suffix <= 999; suffix += 1) {
    const handle = suffix === 1 ? normaliseHandle(base) : normaliseHandle(`${base}${suffix}`);
    if (!activeHandleExists(input.roomId, handle)) return handle;
  }

  throw new Error(`No available room handle found for ${normaliseHandle(base)} in room ${input.roomId}.`);
}

export function allocateHandle(input: AllocateHandleInput): RoomHandleLease {
  return createRoomHandleLease({
    roomId: input.roomId,
    sessionId: input.sessionId,
    handle: deriveAvailableRoomHandle(input),
    activeFromMs: input.activeFromMs,
    createdFrom: input.createdFrom
  });
}

export function backfillActiveLeasesFromRoomMemberships(
  input: BackfillRoomHandleLeasesInput
): BackfillRoomHandleLeasesResult {
  const db = getIdentityDb();
  const rows = db
    .prepare(
      `SELECT room_id, handle
         FROM room_memberships
        WHERE terminal_id = ?
          AND revoked_at_ms IS NULL
        ORDER BY room_id, handle`
    )
    .all(input.sessionId) as Array<{ room_id: string; handle: string }>;

  const result: BackfillRoomHandleLeasesResult = {
    created: 0,
    skippedExisting: 0,
    skippedConflict: 0,
    roomIds: []
  };

  for (const row of rows) {
    const activeForSession = db
      .prepare(
        `SELECT 1
           FROM room_handle_leases
          WHERE room_id = ?
            AND session_id = ?
            AND active_until_ms IS NULL
          LIMIT 1`
      )
      .get(row.room_id, input.sessionId);
    if (activeForSession) {
      result.skippedExisting += 1;
      continue;
    }

    if (activeHandleExists(row.room_id, row.handle)) {
      result.skippedConflict += 1;
      continue;
    }

    try {
      createRoomHandleLease({
        roomId: row.room_id,
        sessionId: input.sessionId,
        handle: row.handle,
        activeFromMs: input.activeFromMs,
        createdFrom: input.createdFrom ?? 'register-existing-membership-backfill'
      });
      result.created += 1;
      result.roomIds.push(row.room_id);
    } catch {
      result.skippedConflict += 1;
    }
  }

  return result;
}

export function findRoomHandleOwnerAtTime(input: FindRoomHandleOwnerAtTimeInput): RoomHandleLease | null {
  const handle = normaliseHandle(input.handle);
  const row = getIdentityDb()
    .prepare(
      `SELECT * FROM room_handle_leases
        WHERE room_id = ?
          AND handle = ?
          AND active_from_ms <= ?
          AND (active_until_ms IS NULL OR active_until_ms > ?)
        ORDER BY active_from_ms DESC
        LIMIT 1`
    )
    .get(input.roomId, handle, input.atMs, input.atMs) as RoomHandleLeaseRow | undefined;
  return row ? rowToLease(row) : null;
}

export function findActiveRoomHandleForSession(roomId: string, sessionId: string): RoomHandleLease | null {
  const row = getIdentityDb()
    .prepare(
      `SELECT * FROM room_handle_leases
        WHERE room_id = ?
          AND session_id = ?
          AND active_until_ms IS NULL
        ORDER BY active_from_ms DESC
        LIMIT 1`
    )
    .get(roomId, sessionId) as RoomHandleLeaseRow | undefined;
  return row ? rowToLease(row) : null;
}

function nextRetiredSuffix(roomId: string, handle: string): number {
  const row = getIdentityDb()
    .prepare(
      `SELECT COALESCE(MAX(retired_suffix), 0) + 1 AS next
         FROM room_handle_leases
        WHERE room_id = ? AND handle = ?`
    )
    .get(roomId, handle) as { next: number } | undefined;
  return row?.next ?? 1;
}

export function retireRoomHandleLease(input: RetireRoomHandleLeaseInput): RoomHandleLease | null {
  const db = getIdentityDb();
  const active = db
    .prepare(
      `SELECT * FROM room_handle_leases
        WHERE room_id = ? AND session_id = ? AND active_until_ms IS NULL
        LIMIT 1`
    )
    .get(input.roomId, input.sessionId) as RoomHandleLeaseRow | undefined;
  if (!active) return null;
  const suffix = nextRetiredSuffix(active.room_id, active.handle);
  db.prepare(
    `UPDATE room_handle_leases
        SET active_until_ms = ?, retired_suffix = ?
      WHERE lease_id = ?`
  ).run(input.activeUntilMs ?? nowMs(), suffix, active.lease_id);
  return getLeaseById(active.lease_id);
}

export function renderRoomHandleSnapshot(lease: RoomHandleLease | null): string {
  if (!lease) return '';
  if (lease.activeUntilMs === null) return lease.handle;
  if (lease.retiredSuffix === null) return lease.handle;
  return `${lease.handle}#${lease.retiredSuffix}`;
}
