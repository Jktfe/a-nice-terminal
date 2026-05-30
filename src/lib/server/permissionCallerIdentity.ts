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
 * Resolve the caller's AUTHORITATIVE handle for permission gates.
 *
 * Returns:
 *   - `ADMIN_BEARER_HANDLE` when the request carries a valid admin bearer
 *   - the terminal_records.handle for the terminal the caller's
 *     pidChain resolves to
 *
 * Throws:
 *   - 401 when pidChain doesn't resolve to a terminal
 *   - 401 when the resolved terminal has no terminal_records row or
 *     the row's handle is NULL/empty (fail-closed identity assertion)
 *
 * Callers MUST use this helper in any path where the returned handle
 * gates a privileged action. Do NOT fall back to per-room
 * `memberships[i].handle` — that field is attacker-controllable.
 */
export function resolveAuthoritativeCallerHandle(
  request: Request,
  rawBody: unknown
): string {
  if (tryAdminBearer(request)) return ADMIN_BEARER_HANDLE;
  const pidChain = parsePidChainFromBody(rawBody);
  return resolveHandleForPidChainOrThrow(pidChain, /* terminalIdForError */ null);
}

/**
 * GET-side variant — same fail-closed semantics but reads the pidChain
 * from a query string (or any other source) so the caller passes the
 * already-parsed array. Returns `null` (instead of throwing) when the
 * pidChain is empty + no admin bearer is present, so the GET handler
 * can map that to 401 in its own error shape (kept for parity with the
 * existing GET handler ergonomics).
 *
 * When the pidChain DOES resolve to a terminal but that terminal has
 * no declared handle on terminal_records, the function THROWS 401 (we
 * still fail-closed — same as the body variant).
 */
export function resolveAuthoritativeCallerHandleFromPidChain(
  request: Request,
  pidChain: PidChainEntry[]
): string | null {
  if (tryAdminBearer(request)) return ADMIN_BEARER_HANDLE;
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
  return handle;
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
