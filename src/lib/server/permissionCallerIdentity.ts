/**
 * permissionCallerIdentity — authoritative caller-handle resolution for
 * permission gates (approve / deny / future grant-side checks).
 *
 * Fix #1 of sec-iter1 (2026-05-30 enterprise security pass). Replaces
 * the pre-existing `memberships[0].handle` approach which trusted
 * whichever per-room handle the caller's terminal happened to have a
 * row for. That surface is exploitable: an attacker registers a
 * terminal T, gets invited into ANY older room as the victim's handle
 * (room-scoped handles are per-(room, handle) so the only check is
 * "room-scoped uniqueness"), and then their `memberships[0].handle` ==
 * victim handle. The approver gate then trusts the attacker as the
 * victim and they can approve/deny the victim's pending requests.
 *
 * The fix: resolve the caller's PROVEN handle via terminal_records (the
 * 1:1 binding between a session_id and its declared identity handle).
 * That binding is now UNIQUE-indexed across terminal_records via the
 * partial index `terminal_records_handle_unique` (Fix #2), so an
 * attacker would need to OWN the terminal_record whose handle is
 * `@<victim>` — structurally impossible after Fix #2.
 *
 * Fail-closed: if the caller's terminal has no terminal_records row OR
 * the row's handle column is NULL/empty, the gate DENIES (401). Better
 * to force an explicit `ant register --handle @<me>` than to fall back
 * to a derived handle that may collide with the victim's slug.
 */

import { error } from '@sveltejs/kit';
import { tryAdminBearer, ADMIN_BEARER_HANDLE } from './chatRoomAuthGate';
import { parsePidChainFromBody } from './identityGate';
import { lookupTerminalByPidChain, type PidChainEntry } from './terminalsStore';
import { getTerminalRecord } from './terminalRecordsStore';

/**
 * Sec-iter2 Fix #3 (2026-05-30): typed admin-bearer discriminator. The
 * pre-Fix#3 API returned a bare string and consumers checked
 * `callerHandle === ADMIN_BEARER_HANDLE` to short-circuit privileged
 * paths. That string-equality made the entire "is the caller admin?"
 * gate spoofable by ANY surface that could land the literal '@admin'
 * into a caller's terminal_records.handle (closed for the known
 * writers by Fix #1 + Fix #2, but the class of bug remains as long as
 * the gate is string-eq).
 *
 * The result now carries an explicit `isAdminBearer` boolean derived
 * SOLELY from `tryAdminBearer` (constant-time `ANT_ADMIN_TOKEN`
 * Bearer match). The handle field is purely a display / audit value
 * — admin-bearer callers get `ADMIN_BEARER_HANDLE` for the audit
 * trail, but consumers must NEVER compare it against the sentinel for
 * authority decisions. Use `result.isAdminBearer` instead.
 */
export type AuthoritativeCallerIdentity = {
  /** Display / audit handle. For admin-bearer this is `ADMIN_BEARER_HANDLE`;
   *  for all other callers it's the AUTHORITATIVE terminal_records.handle. */
  handle: string;
  /** TRUE iff the request carried a valid ANT_ADMIN_TOKEN Bearer header.
   *  This is the ONLY signal consumers should use for admin-grade
   *  short-circuits — string-comparing `handle` to `ADMIN_BEARER_HANDLE`
   *  is the iter2 bypass surface and is now forbidden. */
  isAdminBearer: boolean;
};

/**
 * Resolve the caller's AUTHORITATIVE identity for permission gates.
 *
 * Returns an {@link AuthoritativeCallerIdentity} discriminated by
 * `isAdminBearer`. See the type for why consumers must read
 * `isAdminBearer` instead of comparing `handle` to the admin sentinel.
 *
 * Throws:
 *   - 401 when pidChain doesn't resolve to a terminal
 *   - 401 when the resolved terminal has no terminal_records row or
 *     the row's handle is NULL/empty (fail-closed identity assertion)
 *
 * Callers MUST use this helper in any path where the returned identity
 * gates a privileged action. Do NOT fall back to per-room
 * `memberships[i].handle` — that field is attacker-controllable.
 */
export function resolveAuthoritativeCallerIdentity(
  request: Request,
  rawBody: unknown
): AuthoritativeCallerIdentity {
  if (tryAdminBearer(request)) {
    return { handle: ADMIN_BEARER_HANDLE, isAdminBearer: true };
  }
  const pidChain = parsePidChainFromBody(rawBody);
  const handle = resolveHandleForPidChainOrThrow(pidChain, /* terminalIdForError */ null);
  return { handle, isAdminBearer: false };
}

/**
 * Legacy bare-string variant. Kept for compat with consumers that only
 * needed the audit/display handle. NEW CODE MUST USE
 * {@link resolveAuthoritativeCallerIdentity} so the `isAdminBearer`
 * discriminator threads through cleanly.
 *
 * @deprecated Sec-iter2 Fix #3 — call `resolveAuthoritativeCallerIdentity`
 *   and read `result.isAdminBearer`. String-comparing the returned handle
 *   to `ADMIN_BEARER_HANDLE` is the iter2 bypass surface.
 */
export function resolveAuthoritativeCallerHandle(
  request: Request,
  rawBody: unknown
): string {
  return resolveAuthoritativeCallerIdentity(request, rawBody).handle;
}

/**
 * GET-side variant — same fail-closed semantics but reads the pidChain
 * from a query string (or any other source) so the caller passes the
 * already-parsed array. Returns `null` (instead of throwing) when the
 * pidChain is empty + no admin bearer is present, so the GET handler
 * can map that to 401 in its own error shape.
 *
 * When the pidChain DOES resolve to a terminal but that terminal has
 * no declared handle on terminal_records, the function THROWS 401 (we
 * still fail-closed — same as the body variant).
 *
 * Returns the typed identity for the same reason as the body variant:
 * GET-side consumers (the parent permission_requests listing + the
 * singular GET) also check admin-bearer status and historically used
 * string-equality to ADMIN_BEARER_HANDLE. Sec-iter2 Fix #3 routes them
 * through `isAdminBearer`.
 */
export function resolveAuthoritativeCallerIdentityFromPidChain(
  request: Request,
  pidChain: PidChainEntry[]
): AuthoritativeCallerIdentity | null {
  if (tryAdminBearer(request)) {
    return { handle: ADMIN_BEARER_HANDLE, isAdminBearer: true };
  }
  if (pidChain.length === 0) return null;
  const terminal = lookupTerminalByPidChain(pidChain);
  if (!terminal) return null;
  const record = getTerminalRecord(terminal.id);
  const handle = record?.handle?.trim();
  if (!handle || handle.length === 0) {
    throw error(
      401,
      `Terminal ${terminal.id} has no registered handle on its terminal_records row; cannot exercise a permission gate. Run \`ant register --handle @<your-handle>\` first.`
    );
  }
  return { handle, isAdminBearer: false };
}

/**
 * Legacy bare-string variant of the pidChain-from-query helper.
 *
 * @deprecated Sec-iter2 Fix #3 — call
 *   `resolveAuthoritativeCallerIdentityFromPidChain` and read
 *   `result.isAdminBearer` instead of string-comparing the handle.
 */
export function resolveAuthoritativeCallerHandleFromPidChain(
  request: Request,
  pidChain: PidChainEntry[]
): string | null {
  return resolveAuthoritativeCallerIdentityFromPidChain(request, pidChain)?.handle ?? null;
}

function resolveHandleForPidChainOrThrow(
  pidChain: PidChainEntry[],
  _terminalIdForError: string | null
): string {
  const terminal = lookupTerminalByPidChain(pidChain);
  if (!terminal) throw error(401, 'Authentication required.');
  const record = getTerminalRecord(terminal.id);
  const handle = record?.handle?.trim();
  if (!handle || handle.length === 0) {
    throw error(
      401,
      `Terminal ${terminal.id} has no registered handle on its terminal_records row; cannot exercise a permission gate. Run \`ant register --handle @<your-handle>\` first.`
    );
  }
  return handle;
}
