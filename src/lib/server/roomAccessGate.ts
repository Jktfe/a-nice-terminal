/**
 * roomAccessGate — the read/join/post decision logic (Simplify & Harden,
 * lane A, the absorbed C-logic gate).
 *
 * Pure decisions over the two-axis room policy + the caller's identity facts.
 * Everything is decided against IDENTITY (membership = holds an active handle
 * lease; entitlement; invitation) — never the pid/runtime. The membership
 * fact is INJECTED so the policy logic is testable in isolation and the
 * lease-store lookup (@fast's primitive) wires in at the call site.
 *
 * Auto-join-on-post (JWPK msg_qf1r6vbljb): posting to an OPEN room by a
 * non-member IS the join — decidePost returns 'auto-join', and the post path
 * mints a handle lease via @fast's allocateHandle (which applies the
 * @name/@name2 suffix). Non-open rooms reject a non-member's post.
 */

import type { RoomPolicy, RoomPolicyState } from './roomPolicyStore';

/** Identity facts the gate decides over — all derived from durable identity,
 *  none from pid/runtime. */
export type IdentityFacts = {
  /** Holds an active handle lease in the room (i.e. already a member). */
  isMember: boolean;
  /** On the room's allowlist / has the required role. */
  isEntitled: boolean;
  /** Has an outstanding invite to the room. */
  isInvited: boolean;
};

function allowedByState(state: RoomPolicyState, f: IdentityFacts): boolean {
  switch (state) {
    case 'open':
      return true;
    case 'allowed':
      return f.isMember || f.isEntitled;
    case 'invite':
      return f.isMember || f.isInvited;
    case 'closed':
      return f.isMember; // members only; no new
  }
}

/** May this identity READ the room (see it + its history)? */
export function decideRead(policy: RoomPolicy, f: IdentityFacts): boolean {
  return allowedByState(policy.readPolicy, f);
}

/** May this identity JOIN (take a handle lease + post)? */
export function decideJoin(policy: RoomPolicy, f: IdentityFacts): boolean {
  return allowedByState(policy.joinPolicy, f);
}

export type PostDecision = 'allow' | 'auto-join' | 'reject';

/**
 * Decide what happens when a session POSTS to a room.
 *   - already a member        -> 'allow'      (idempotent; post under their handle)
 *   - non-member, join=open    -> 'auto-join'  (post IS the join; mint a lease)
 *   - non-member, join!=open   -> 'reject'     (can't post; needs invite/entitlement)
 *
 * Note: a non-member who is entitled/invited under allowed/invite policy is
 * NOT silently auto-joined here — only OPEN turns a post into a join, per the
 * rule. Entitled/invited agents join via the explicit join path.
 */
export function decidePost(joinPolicy: RoomPolicyState, isMember: boolean): PostDecision {
  if (isMember) return 'allow';
  if (joinPolicy === 'open') return 'auto-join';
  return 'reject';
}
