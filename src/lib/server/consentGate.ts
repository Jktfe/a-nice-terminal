/**
 * consentGate — shared predicate for human-handle impersonation.
 *
 * Part of plan_consent_gate_2026_05_20 (JWPK-locked 2026-05-20):
 * "no agent can post as a human without that human's consent".
 *
 * Three chat write surfaces consult this module:
 *   1. POST /api/chat-rooms/:id/browser-session  — mint gate
 *   2. POST /api/chat-rooms/:id/messages         — post gate
 *   3. admin-bearer write attribution            — reject @human-kind
 *
 * The gate keys off OWNERSHIP, not the handle string. A handle is just
 * a label that can be renamed; the load-bearing identity is owner_id
 * (resolved via owner_handles).
 *
 * Two questions this module answers:
 *
 *   1. resolveHumanOwnership(handle) →
 *      • { kind: 'agent' }  — not a human handle, no gate fires
 *      • { kind: 'human', ownerId } — gate must check grant before allow
 *
 *   2. requireHumanImpersonationGrant({ ownerId, callerTerminalId }) →
 *      • null  — caller terminal IS the owner's own terminal (no grant needed)
 *      • { grantId } — found an active grant, may proceed (caller should
 *                      consume one unit on a write surface)
 *      • throws 403 — no active grant, write must be rejected
 *
 * Self-posting carve-out: if the caller is on the owner's OWN terminal
 * (the registered terminal that minted the owner), they don't need a
 * grant — the human IS at the keyboard. Bare web sessions with a
 * legitimate ant_browser_session cookie also fall into this carve-out
 * via the cookie-resolved owner check in the calling surface.
 */
import { error } from '@sveltejs/kit';
import { getIdentityDb } from './db';
import {
  findActiveGrantForOwnerAndTerminal,
  consumeHumanConsentGrant
} from './humanConsentGrantsStore';
import type { HumanConsentGrant } from './humanConsentGrantsStore';

export type OwnershipResolution =
  | { kind: 'agent' }
  | { kind: 'human'; ownerId: string };

/**
 * Resolve whether a handle is human-kind and if so, the stable owner_id.
 *
 * - Special-case '@browser-bs_*' handles → kind 'agent' (browser-session
 *   ephemera, never represents a real human owner).
 * - If the handle is in owner_handles, it's kind 'human' with that owner_id.
 * - Otherwise it's kind 'agent' (or an unclaimed identity — the gate
 *   doesn't fire either way).
 */
export function resolveHumanOwnership(handle: string): OwnershipResolution {
  if (!handle || handle.length === 0) return { kind: 'agent' };
  if (handle.startsWith('@browser-bs_')) return { kind: 'agent' };
  const row = getIdentityDb()
    .prepare(`SELECT owner_id FROM owner_handles WHERE handle = ?`)
    .get(handle) as { owner_id: string } | undefined;
  if (row) return { kind: 'human', ownerId: row.owner_id };
  return { kind: 'agent' };
}

export type ConsentCheckOutcome =
  | { allowed: true; selfPost: true; grant: null }
  | { allowed: true; selfPost: false; grant: HumanConsentGrant }
  | { allowed: false; reason: 'no_grant' | 'expired' | 'exhausted' | 'revoked' };

/**
 * Read-only consent check — caller can decide whether to consume or
 * just authorize a mint. The 'selfPost' case fires when the caller's
 * terminal IS the human's own terminal (we record the owner's first
 * terminal at registration time as the canonical owning terminal in
 * the future; for now any terminal owned by the same owner_id is
 * considered self).
 *
 * Returns:
 *   - { allowed: true, selfPost: true } — owner posting as themselves
 *   - { allowed: true, selfPost: false, grant } — agent has active grant
 *   - { allowed: false, reason } — no path to post
 */
export function checkHumanImpersonationConsent(input: {
  ownerId: string;
  callerTerminalId: string;
  nowMs?: number;
}): ConsentCheckOutcome {
  // Self-post carve-out: caller's terminal is registered to this owner's
  // own primary handle. The lookup is via room_memberships where the
  // owner's primary handle maps to this terminal_id — a quick proxy for
  // "this terminal IS this human's own terminal".
  const ownerHandleRow = getIdentityDb()
    .prepare(`SELECT primary_handle FROM owners WHERE id = ?`)
    .get(input.ownerId) as { primary_handle: string } | undefined;
  if (ownerHandleRow) {
    const isOwnTerminal = getIdentityDb()
      .prepare(
        `SELECT 1 FROM room_memberships
         WHERE handle = ? AND terminal_id = ? AND revoked_at_ms IS NULL
         LIMIT 1`
      )
      .get(ownerHandleRow.primary_handle, input.callerTerminalId);
    if (isOwnTerminal) return { allowed: true, selfPost: true, grant: null };
  }

  const grant = findActiveGrantForOwnerAndTerminal({
    ownerId: input.ownerId,
    grantedToTerminalId: input.callerTerminalId,
    nowMs: input.nowMs
  });
  if (grant) return { allowed: true, selfPost: false, grant };

  // No active grant — surface the most-recent terminal-state grant for
  // this pair so the caller sees 'exhausted' or 'revoked' instead of a
  // generic 'no_grant' when context exists. Distinct from history-less
  // no_grant which means no grant has ever been issued.
  const recent = getIdentityDb()
    .prepare(
      `SELECT status FROM human_consent_grants
       WHERE owner_id = ? AND granted_to_terminal_id = ?
       ORDER BY updated_at_ms DESC LIMIT 1`
    )
    .get(input.ownerId, input.callerTerminalId) as { status: string } | undefined;
  if (recent?.status === 'expired') return { allowed: false, reason: 'expired' };
  if (recent?.status === 'exhausted') return { allowed: false, reason: 'exhausted' };
  if (recent?.status === 'revoked') return { allowed: false, reason: 'revoked' };
  return { allowed: false, reason: 'no_grant' };
}

/**
 * SvelteKit-throwing variant. Throws a 403 with a structured reason if
 * the caller can't post; returns the consent outcome on success. Used
 * by mint + post + admin-bearer routes that want a single line guard.
 */
export function requireHumanImpersonationConsent(input: {
  ownerId: string;
  callerTerminalId: string;
  nowMs?: number;
}): ConsentCheckOutcome & { allowed: true } {
  const outcome = checkHumanImpersonationConsent(input);
  if (outcome.allowed) return outcome;
  throw error(403, `human_impersonation_${outcome.reason}`);
}

/**
 * Combined check + consume. Used by the post-side surface where the
 * write succeeds only if a grant unit was actually deducted. Self-posts
 * never consume a unit. Throws 403 on absent/expired/exhausted grants.
 *
 * Returns the consuming grant_id on grant-based writes (for audit
 * recording on the message row), null on self-posts.
 */
export function gateAndConsumeForWrite(input: {
  ownerId: string;
  callerTerminalId: string;
  callerHandle: string;
  messageId: string;
  nowMs?: number;
}): { grantId: string | null } {
  const outcome = requireHumanImpersonationConsent({
    ownerId: input.ownerId,
    callerTerminalId: input.callerTerminalId,
    nowMs: input.nowMs
  });
  if (outcome.selfPost) return { grantId: null };
  const consume = consumeHumanConsentGrant({
    grantId: outcome.grant.id,
    messageId: input.messageId,
    actorHandle: input.callerHandle,
    actorTerminalId: input.callerTerminalId,
    nowMs: input.nowMs
  });
  if (consume !== 'ok') {
    // Race: grant flipped to terminal state between check and consume.
    throw error(403, `human_impersonation_${consume}`);
  }
  return { grantId: outcome.grant.id };
}
