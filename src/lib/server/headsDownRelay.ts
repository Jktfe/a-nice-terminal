/**
 * headsDownRelay — the responder-relay notifications for heads-down mode.
 *
 * Spec: docs/specs/heads-down-responder-relay-2026-06-03.md (JWPK).
 * In heads-down mode the 🖐️ look / 🤝 work / 👐 pass claims are a relay
 * protocol, not just chips. This module computes the directed notifications a
 * claim transition produces, and hands each (recipientHandle, body) to a sink
 * so the caller (claims endpoint) can deliver it to that responder's terminal.
 *
 * Pure decision logic + an injected sink keeps it unit-testable without the
 * PTY/queue machinery. Delivery (terminal injection) lives in
 * pty-inject-fanout (sendCoordinationRelay).
 */

import { getRoomMode } from './roomModesStore';
import { listActiveClaimsForEntity, type ClaimKind, type EntityKind } from './entityClaimStore';

/** A directed relay: send `body` to `recipientHandle`'s terminal. */
export type RelaySink = (recipientHandle: string, body: string) => void;

export type ClaimTransition = {
  roomId: string;
  entityKind: EntityKind;
  entityId: string;
  claimKind: ClaimKind;
  claimedByHandle: string;
};

// The four relay messages, verbatim from JWPK's spec.
export const HOLD_MESSAGE =
  'Do not mark as taken (you can still mark as pass) — waiting on another agent — please continue the read in preparation.';
export function takenMessage(takerHandle: string): string {
  return `taken by ${takerHandle} — send any notes to ${takerHandle}`;
}
export const AVAILABLE_MESSAGE = 'This is now available to claim.';

/**
 * Given a just-created claim, emit the directed relay notifications it triggers.
 * No-op outside heads-down mode and for non-message entities (the relay is a
 * message-coordination protocol).
 *
 * - 🖐️ looking, while another agent is already looking/working → tell the NEW
 *   reader to hold (don't take, may pass).
 * - 🤝 working (taken) → tell every other current reader it's taken + where to
 *   send notes.
 * - 👐 pass → tell the other current readers it's available to claim.
 */
export function emitClaimRelay(transition: ClaimTransition, send: RelaySink): void {
  if (transition.entityKind !== 'message') return;
  if (getRoomMode(transition.roomId) !== 'heads-down') return;

  const active = listActiveClaimsForEntity(transition.entityKind, transition.entityId);
  const others = active.filter((c) => c.claimed_by_handle !== transition.claimedByHandle);
  const otherReaders = others.filter((c) => c.claim_kind === 'looking');

  switch (transition.claimKind) {
    case 'looking': {
      const someoneElseBusy = others.some((c) => c.claim_kind === 'looking' || c.claim_kind === 'working');
      if (someoneElseBusy) send(transition.claimedByHandle, HOLD_MESSAGE);
      return;
    }
    case 'working': {
      const body = takenMessage(transition.claimedByHandle);
      for (const reader of otherReaders) send(reader.claimed_by_handle, body);
      return;
    }
    case 'pass': {
      for (const reader of otherReaders) send(reader.claimed_by_handle, AVAILABLE_MESSAGE);
      return;
    }
  }
}
