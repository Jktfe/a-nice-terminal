/**
 * subagentIdentity — C3 identity half (deck slide 11). A subagent is a child
 * session under a parent, with its OWN room handle lease so its messages are
 * independently attributable + routable — without confusing the parent.
 *
 * The session model already supports this (antSessionStore: kind 'subagent' +
 * parent_session_id + childSessions). This wraps it into the two operations a
 * subagent needs, and mints the child handle as `@parent/role` so it reads as
 * "a subagent of the parent" everywhere. Runtime/pid never involved.
 *
 * The ROUTING half (envelope.sender = subagent on delivery) is @fast's lane,
 * built against this + the envelope contract.
 */

import { createSession, getSession, type AntSession } from './antSessionStore';
import { allocateHandle, type RoomHandleLease } from './roomHandleLeaseStore';

/** Mint a child subagent session under `parentSessionId`. Throws if the
 *  parent doesn't exist (createSession enforces this) — a subagent can't be
 *  orphaned by construction. */
export function createSubagentSession(input: { parentSessionId: string; label?: string | null }): AntSession {
  return createSession({
    kind: 'subagent',
    parentSessionId: input.parentSessionId,
    label: input.label ?? null
  });
}

/** Strip a leading '@' for use as a handle stem. */
function handleStem(handle: string): string {
  return handle.replace(/^@+/, '').trim();
}

/**
 * Lease a room handle for a subagent, namespaced to its parent: `parent/role`
 * (e.g. parent @speedy + role "reviewer" -> handle `speedy/reviewer`).
 * Collisions get an integer suffix via @fast's allocateHandle. The lease binds
 * to the SUBAGENT's session id, so resolution/attribution points at the child.
 */
export function mintSubagentLease(input: {
  roomId: string;
  subagentSessionId: string;
  parentHandle: string;
  role: string;
}): RoomHandleLease {
  const preferred = `${handleStem(input.parentHandle)}/${input.role.trim()}`;
  return allocateHandle({
    roomId: input.roomId,
    sessionId: input.subagentSessionId,
    preferredHandle: preferred,
    fallbackSessionId: input.subagentSessionId
  });
}

/** True if `sessionId` is a subagent whose parent is `parentSessionId`. Used
 *  by routing/attribution to fold a child's activity under its parent. */
export function isSubagentOf(sessionId: string, parentSessionId: string): boolean {
  const s = getSession(sessionId);
  return s !== null && s.kind === 'subagent' && s.parent_session_id === parentSessionId;
}
