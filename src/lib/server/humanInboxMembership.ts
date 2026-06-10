/**
 * Human inbox membership hooks.
 *
 * Hidden per-human inbox rooms were retired on 2026-06-03. The exports remain
 * so room-membership callers do not need churn, but the hooks are intentionally
 * inert and do not write legacy or v0.2 membership tables.
 */

import { inboxRoomIdFor } from './humanInboxRoomStore';

export function recomputeInboxEdge(_humanHandle: string, _agentHandle: string): void {
  // Retired feature: no-op.
}

export function recomputeInboxEdgesForRoomMembershipChange(
  _roomId: string,
  _changedHandle: string
): void {
  // Retired feature: no-op.
}

export function recomputeInboxEdgesForTerminalOwnershipChange(_input: {
  agentHandle: string;
  previousOwnerHandle?: string | null;
  newOwnerHandle?: string | null;
}): void {
  // Retired feature: no-op.
}

export { inboxRoomIdFor };
