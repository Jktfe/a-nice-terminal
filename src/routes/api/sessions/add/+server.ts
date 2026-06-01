// POST /api/sessions/add — retrospective registration helper.
// Mode A (terminal): { pid, pid_start?, name, ttl_seconds?, source?, meta?,
//   pidChain? }.
// Mode B (membership): { room_id, handle, terminal_name, pidChain? }.
// Idempotent on both shapes (upsertTerminal handles name-collision,
// addMembership UNIQUE).
//
// Auth model (sec-iter6 Fix #1, 2026-05-30): UNAUTHENTICATED for either
// mode WAS the HIGH-severity bug — an attacker could POST `{ room_id,
// handle: '@victim', terminal_name: 'evil' }` and silently rebind any
// existing `(room_id, '@victim')` membership row to their own terminal.
// The fix layers an auth gate before the membership write: admin-bearer
// OR the supplied `handle` MUST match the caller's AUTHORITATIVE
// `terminal_records.handle` resolved via pidChain. Terminal-mode (Mode A)
// gets the same gate — the caller can only register a terminal under
// their own pidChain identity, never as someone else's. Both modes 403
// with a clear `caller_identity_mismatch` message when the gate fails.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { upsertTerminal, getTerminalByName, getTerminalById, updatePaneTarget, lookupTerminalByPidChain } from '$lib/server/terminalsStore';
import { addMembership } from '$lib/server/roomMembershipsStore';
import { isValidClientAgentKind, AGENT_KINDS_CLIENT_INPUT } from '$lib/server/agentKindEnum';
import { classifyIfUnknown } from '$lib/server/agentStatusPoller';
import { tryAdminBearer } from '$lib/server/chatRoomAuthGate';
import { parsePidChainFromBody } from '$lib/server/identityGate';
import { getTerminalRecord } from '$lib/server/terminalRecordsStore';

const VALID_AGENT_KINDS_LIST = Array.from(AGENT_KINDS_CLIENT_INPUT).join(', ');

type SessionsAddBody = {
  pid?: unknown;
  pid_start?: unknown;
  name?: unknown;
  ttl_seconds?: unknown;
  source?: unknown;
  meta?: unknown;
  room_id?: unknown;
  handle?: unknown;
  terminal_name?: unknown;
  pane?: unknown;
  agent_kind?: unknown;
};

function isMembershipMode(body: SessionsAddBody): boolean {
  return typeof body.room_id === 'string'
    && typeof body.handle === 'string'
    && typeof body.terminal_name === 'string';
}

function isTerminalMode(body: SessionsAddBody): boolean {
  return typeof body.pid !== 'undefined' && typeof body.name === 'string';
}

/**
 * Sec-iter6 Fix #1 (2026-05-30) — auth gate primitive.
 *
 * Resolves the caller's AUTHORITATIVE handle from pidChain (via
 * `terminal_records.handle`, which sec-iter1 Fix #2 made UNIQUE per
 * non-superseded row) and returns it if found. Returns `null` when no
 * pidChain or no resolved terminal/handle — caller must then 403.
 *
 * Mirrors `resolveAuthoritativeCallerIdentity` in
 * `permissionCallerIdentity.ts` but kept local (not refactored to share)
 * because this endpoint's contract is "200 happy-path / 400 bad-body /
 * 403 identity-mismatch / 404 missing-terminal" rather than the
 * permission-gate "401 fail-closed" shape. A future Stage B unification
 * pass can extract once both call sites stabilise.
 */
function resolveAuthoritativeCallerHandleFromBody(rawBody: unknown): string | null {
  const pidChain = parsePidChainFromBody(rawBody);
  if (pidChain.length === 0) return null;
  const terminal = lookupTerminalByPidChain(pidChain);
  if (!terminal) return null;
  const record = getTerminalRecord(terminal.id);
  const handle = record?.handle?.trim();
  if (!handle || handle.length === 0) return null;
  return handle;
}

/**
 * Sec-iter6 Fix #1 (2026-05-30) — membership-mode auth gate.
 *
 * The caller must satisfy ONE of:
 *   (a) admin-bearer (`ANT_ADMIN_TOKEN` constant-time match), OR
 *   (b) the `handle` supplied in the body MUST equal the caller's
 *       authoritative `terminal_records.handle` (pidChain-resolved).
 *
 * Pre-iter6 this endpoint was UNAUTHENTICATED — any unauth caller could
 * POST `{ room_id, handle: '@victim', terminal_name: 'evil' }` and the
 * existing `addMembership` UPDATE branch would silently rebind the
 * `(room_id, '@victim')` membership row to the attacker's terminal. The
 * attacker could then forge messages attributed to `@victim` AND have
 * `/api/grants` (pre-Fix #2) resolve their caller identity as `@victim`
 * via the `memberships[0].handle` derivation.
 *
 * Throws 403 with `caller_identity_mismatch` when the gate fails. The
 * downstream `addMembership` choke-point (Fix #3) provides an additional
 * authority-handle filter — but neither layer alone is sufficient: the
 * auth gate also blocks `@victim`-style spoofs where the target handle
 * is NOT on the authority-forbidden list.
 */
function requireMembershipAuth(request: Request, rawBody: unknown, suppliedHandle: string): void {
  if (tryAdminBearer(request)) return;
  const callerHandle = resolveAuthoritativeCallerHandleFromBody(rawBody);
  if (callerHandle === null) {
    throw error(
      403,
      'caller_identity_mismatch: pidChain did not resolve to a registered terminal with a declared handle. Run `ant register --handle @<your-handle>` and supply pidChain in the request body, or use admin-bearer.'
    );
  }
  const normalised = suppliedHandle.trim().startsWith('@')
    ? suppliedHandle.trim()
    : `@${suppliedHandle.trim()}`;
  if (callerHandle !== normalised) {
    throw error(
      403,
      `caller_identity_mismatch: supplied handle '${normalised}' does not match caller's authoritative terminal handle '${callerHandle}'. Callers may only add memberships for their own handle. Use admin-bearer for cross-handle membership writes.`
    );
  }
}

/**
 * Sec-iter6 Fix #1 (2026-05-30) — terminal-mode auth gate.
 *
 * Same shape as the membership-mode gate, but the comparison is against
 * the supplied `name` (terminal name): caller may only register a
 * terminal under their own pidChain identity, never as someone else's.
 * Admin-bearer bypasses for break-glass.
 *
 * The terminal-mode pre-iter6 path was NOT directly exploitable for the
 * iter-5 `@victim` rebind chain (terminal mode doesn't touch
 * `room_memberships`), but it WAS a fresh attack surface: an attacker
 * could mint or rebind ARBITRARY terminals by name (e.g. claim an
 * already-registered terminal's name) and the existing `upsertTerminal`
 * UPDATE branch would silently re-bind name → attacker's pid. Gating
 * here closes that surface in lockstep.
 *
 * Throws 403 with `caller_identity_mismatch` when the gate fails. Same
 * shape as the membership-mode gate so the wire contract is symmetric.
 */
function requireTerminalAuth(request: Request, rawBody: unknown, suppliedName: string): void {
  if (tryAdminBearer(request)) return;
  const pidChain = parsePidChainFromBody(rawBody);
  if (pidChain.length === 0) {
    throw error(
      403,
      'caller_identity_mismatch: terminal-mode requires either admin-bearer or a pidChain in the request body so the caller identity can be proven.'
    );
  }
  const terminal = lookupTerminalByPidChain(pidChain);
  // First-register path: the caller's pidChain may not yet resolve to
  // any terminal row (the WHOLE point of this endpoint is retrospective
  // registration). In that case we accept any name — the upsertTerminal
  // below will mint a fresh row tied to this pid. But if the caller's
  // pidChain DOES resolve to an existing terminal, the name they're
  // claiming must MATCH the resolved terminal's name (otherwise they're
  // rebinding someone else's name to their pid).
  if (terminal === null) return;
  if (terminal.name !== suppliedName) {
    throw error(
      403,
      `caller_identity_mismatch: supplied terminal name '${suppliedName}' does not match caller's pidChain-resolved terminal name '${terminal.name}'. Callers may only re-register their OWN terminal name. Use admin-bearer for cross-terminal renames.`
    );
  }
}

function handleTerminalMode(request: Request, rawBody: unknown, body: SessionsAddBody): Response {
  // Sec-iter6 Fix #1: terminal-mode auth gate runs BEFORE any of the
  // existing body validation so an attacker probing for unauth surfaces
  // gets a clean 403 not a 400 leaking validation surface area.
  const trimmedName = typeof body.name === 'string' ? body.name.trim() : '';
  // Empty-name validation lives below (400) — gate only fires when the
  // name is shaped well enough that an identity comparison is meaningful.
  if (trimmedName.length > 0) requireTerminalAuth(request, rawBody, trimmedName);
  return _handleTerminalModeImpl(body);
}

function _handleTerminalModeImpl(body: SessionsAddBody): Response {
  const pidNumber = Number(body.pid);
  if (!Number.isFinite(pidNumber) || pidNumber <= 0) throw error(400, 'pid must be a positive number.');
  const pidStart = typeof body.pid_start === 'string' ? body.pid_start : null;
  const name = (body.name as string).trim();
  if (name.length === 0) throw error(400, 'name cannot be empty.');
  const ttlRaw = body.ttl_seconds;
  const ttlSeconds = typeof ttlRaw === 'number' && Number.isFinite(ttlRaw) ? ttlRaw : undefined;
  const sourceRaw = body.source;
  const source = typeof sourceRaw === 'string' && sourceRaw.length > 0 ? sourceRaw : 'cli-add-session';
  const metaRaw = body.meta;
  const meta = metaRaw && typeof metaRaw === 'object' ? (metaRaw as Record<string, unknown>) : undefined;
  const paneRaw = body.pane;
  const agentKindRaw = body.agent_kind;
  const paneValue = typeof paneRaw === 'string' && paneRaw.trim().length > 0 ? paneRaw.trim() : null;
  // M3.2d B1: validate client agent_kind before any write.
  let agentKindValue: string | null = null;
  if (typeof agentKindRaw === 'string' && agentKindRaw.length > 0) {
    if (!isValidClientAgentKind(agentKindRaw)) throw error(400, `agent_kind must be one of: ${VALID_AGENT_KINDS_LIST}`);
    agentKindValue = agentKindRaw;
  }
  // M3.2b: pre-read for INSERT-new probe + path-B kind preservation on re-register.
  const existing = getTerminalByName(name);
  const existed = existing !== null;
  const terminal = upsertTerminal({ pid: pidNumber, pid_start: pidStart, name, ttlSeconds, source, meta });
  const updateKindValue = agentKindValue !== null
    ? agentKindValue : (existed ? (existing?.agent_kind ?? null) : null);
  if (paneValue) updatePaneTarget(terminal.id, paneValue, updateKindValue);
  // Response kind starts at updateKindValue so re-register with omitted kind
  // returns the preserved existing kind, not null (delta-5 residual 2 fix).
  let classifiedAgentKind: string | null = updateKindValue;
  if (!existed && agentKindValue === null && paneValue !== null) {
    try {
      const fresh = getTerminalById(terminal.id);
      if (fresh) {
        classifyIfUnknown(fresh);
        const reread = getTerminalById(terminal.id);
        if (reread) classifiedAgentKind = reread.agent_kind ?? null;
      }
    } catch { /* best-effort: classify failure never blocks 201 */ }
  }
  return json({ terminal_id: terminal.id, name: terminal.name, tmux_target_pane: paneValue, agent_kind: classifiedAgentKind }, { status: 201 });
}

function handleMembershipMode(request: Request, rawBody: unknown, body: SessionsAddBody): Response {
  const roomId = (body.room_id as string).trim();
  const handle = (body.handle as string).trim();
  const terminalName = (body.terminal_name as string).trim();
  if (!roomId || !handle || !terminalName) {
    throw error(400, 'room_id, handle, and terminal_name must all be non-empty.');
  }
  // Sec-iter6 Fix #1: membership-mode auth gate. Caller may only add
  // memberships for their OWN handle (or via admin-bearer break-glass).
  // Closes the iter-5 HIGH where any unauth caller could POST a victim
  // handle and silently rebind their membership row via the
  // `addMembership` UPDATE branch.
  requireMembershipAuth(request, rawBody, handle);
  const terminal = getTerminalByName(terminalName);
  if (!terminal) {
    throw error(404, `No terminal registered with name "${terminalName}".`);
  }
  const membership = addMembership({ room_id: roomId, handle, terminal_id: terminal.id });
  return json({
    membership_id: membership.id,
    room_id: membership.room_id,
    handle: membership.handle,
    terminal_id: membership.terminal_id
  }, { status: 201 });
}

export const POST: RequestHandler = async ({ request }) => {
  const rawBody = (await request.json().catch(() => null)) as SessionsAddBody | null;
  if (!rawBody || typeof rawBody !== 'object') {
    throw error(400, 'Send a JSON body with either {pid, name} or {room_id, handle, terminal_name}.');
  }

  if (isMembershipMode(rawBody)) return handleMembershipMode(request, rawBody, rawBody);
  if (isTerminalMode(rawBody)) return handleTerminalMode(request, rawBody, rawBody);

  throw error(400, 'Body must match either terminal-add mode (pid, name) or membership-add mode (room_id, handle, terminal_name).');
};
