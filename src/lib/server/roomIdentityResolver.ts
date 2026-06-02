/**
 * roomIdentityResolver — A2 of the Simplify & Harden model.
 *
 * The single resolution primitive that joining, posting, routing and
 * historical authorship all ride on:
 *
 *     @handle  --(lease active at time T)-->  session ID  -->  identity
 *
 * It composes @fast's room-handle lease store (who holds @handle in a room,
 * at a point in time) with the durable session store (the identity behind a
 * session ID). Because both halves are durable + time-aware, the SAME call
 * answers two questions with one code path:
 *   - "who is @speedy in this room right NOW?"  (atMs = now)
 *   - "who WAS @speedy when this old post was written?"  (atMs = post time)
 * — which is exactly what the @name#1 historical-authorship render needs,
 * with no separate history machinery.
 *
 * Runtime/pid never appears here: resolution is lease -> durable session, so
 * a drifted pid can't mis-resolve or lock anyone out.
 */

import { getSession, type AntSession } from './antSessionStore';
import { findRoomHandleOwnerAtTime, type RoomHandleLease } from './roomHandleLeaseStore';

export type ResolvedRoomIdentity = {
  /** The durable identity behind the handle's lease at the queried time. */
  session: AntSession;
  /** The lease that bound the handle to that session. */
  lease: RoomHandleLease;
};

/**
 * Resolve who holds `handle` in `roomId` at time `atMs` (default: now), all
 * the way to the durable session identity.
 *
 * Returns null when the handle had no owner at that time. Returns null (not a
 * throw) on the defensive orphan case where a lease points at a session that
 * no longer exists — callers treat "no resolvable identity" uniformly.
 */
export function resolveHandleToSession(
  roomId: string,
  handle: string,
  atMs: number = Date.now()
): ResolvedRoomIdentity | null {
  const lease = findRoomHandleOwnerAtTime({ roomId, handle, atMs });
  if (!lease) return null;
  const session = getSession(lease.sessionId);
  if (!session) return null; // orphaned lease — defensive, never mis-attributes
  return { session, lease };
}

/** Current owner only (sugar over resolveHandleToSession at now). The
 *  join/post/route hot path. */
export function resolveCurrentOwner(roomId: string, handle: string): ResolvedRoomIdentity | null {
  return resolveHandleToSession(roomId, handle, Date.now());
}

/**
 * Is `sessionId` the CURRENT owner of `handle` in `roomId`? Used by the
 * post gate: a session may only post under a handle it actively holds. The
 * runtime/pid is irrelevant — only the durable session + the active lease.
 */
export function isCurrentOwner(roomId: string, handle: string, sessionId: string): boolean {
  const resolved = resolveCurrentOwner(roomId, handle);
  return resolved !== null && resolved.session.id === sessionId;
}
