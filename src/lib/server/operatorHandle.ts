/**
 * operatorHandle — the single, configurable source of truth for the human
 * operator's STRUCTURAL identity.
 *
 * Background: the operator was historically the hardcoded `@you` sentinel.
 * The clean model makes `@JWPK` structural everywhere, while still accepting
 * legacy incoming `@you` values at ingress and immediately canonicalising
 * them. This module makes that rule ONE configurable value applied
 * CONSISTENTLY at every structural seam.
 *
 * Source of truth: `ANT_OPERATOR_HANDLE` (set in `~/.ant/secrets.env`).
 * Defaults to `OPERATOR_SENTINEL` (`@JWPK`) when unset.
 *
 * `getOperatorHandle()` is the ONE place the value is decided. Swapping to a
 * per-user / DB-derived source later (multi-tenant) is a change to this single
 * function — every caller already routes through it.
 */

import { OPERATOR_SENTINEL } from '$lib/operatorSentinel';

/** The configured structural handle of the operator (default: `@JWPK`). */
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
 * Map legacy operator aliases (`@you`) to the configured operator handle; pass
 * every other handle through (normalised). Apply at every STRUCTURAL seam so
 * stale browser/config inputs cannot write new `@you` rows.
 */
export function canonicaliseOperatorHandle(rawHandle: string): string {
  const normalized = normalizeHandle(rawHandle);
  if (normalized.length === 0) return normalized;
  const lower = normalized.toLowerCase();
  if (lower === '@you' || lower === OPERATOR_SENTINEL.toLowerCase()) {
    return getOperatorHandle();
  }
  return normalized;
}

/**
 * True when a handle is the operator — whether it arrives as the legacy
 * alias (`@you`) or the configured operator handle. Use for human/operator
 * detection that must accept both forms during/after the cutover.
 */
export function isOperatorHandle(rawHandle: string): boolean {
  const normalized = normalizeHandle(rawHandle).toLowerCase();
  return normalized === '@you'
    || normalized === OPERATOR_SENTINEL.toLowerCase()
    || normalized === getOperatorHandle().toLowerCase();
}
