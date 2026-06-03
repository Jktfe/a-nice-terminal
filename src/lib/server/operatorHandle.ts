/**
 * operatorHandle — the single, configurable source of truth for the human
 * operator's STRUCTURAL identity.
 *
 * Background: the operator was historically the hardcoded `@you` sentinel
 * (`OPERATOR_SENTINEL`). A later cutover started rewriting `@you → @JWPK` but
 * only on SOME paths (session-mint read + message-post), not the membership
 * WRITE path — so the stored handle and the checked handle disagreed and the
 * browser operator could not mint a session. This module makes the operator
 * handle ONE configurable value applied CONSISTENTLY at every structural seam.
 *
 * Source of truth: `ANT_OPERATOR_HANDLE` (set in `~/.ant/secrets.env`).
 * Defaults to the legacy `OPERATOR_SENTINEL` ('@you') when unset, so any
 * deployment that does not set it behaves exactly as before.
 *
 * `getOperatorHandle()` is the ONE place the value is decided. Swapping to a
 * per-user / DB-derived source later (multi-tenant) is a change to this single
 * function — every caller already routes through it.
 */

import { OPERATOR_SENTINEL } from '$lib/operatorSentinel';

/** The configured structural handle of the operator (default: `@you`). */
export function getOperatorHandle(): string {
  const configured = process.env.ANT_OPERATOR_HANDLE?.trim();
  return configured && configured.length > 0 ? configured : OPERATOR_SENTINEL;
}

/** Add a leading `@` and trim; no operator mapping. */
function normalizeHandle(rawHandle: string): string {
  const trimmed = rawHandle.trim();
  if (trimmed.length === 0) return trimmed;
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

/**
 * Map the legacy operator sentinel (`@you`) to the configured operator handle;
 * pass every other handle through (normalised). Apply at every STRUCTURAL seam
 * — membership write, session mint, message post — so the stored handle and
 * the checked handle never disagree (the root cause of the mint failure).
 */
export function canonicaliseOperatorHandle(rawHandle: string): string {
  const normalized = normalizeHandle(rawHandle);
  if (normalized.length === 0) return normalized;
  return normalized === OPERATOR_SENTINEL ? getOperatorHandle() : normalized;
}

/**
 * True when a handle is the operator — whether it arrives as the legacy
 * sentinel (`@you`) or the configured operator handle. Use for human/operator
 * detection that must accept both forms during/after the cutover.
 */
export function isOperatorHandle(rawHandle: string): boolean {
  // Case-insensitive: some legacy call sites matched `@you` after
  // `.toLowerCase()`, and the configured operator handle (e.g. `@JWPK`) is
  // mixed-case. Detection stays lenient; structural canonicalisation
  // (canonicaliseOperatorHandle) stays exact.
  const normalized = normalizeHandle(rawHandle).toLowerCase();
  return normalized === OPERATOR_SENTINEL.toLowerCase()
    || normalized === getOperatorHandle().toLowerCase();
}
