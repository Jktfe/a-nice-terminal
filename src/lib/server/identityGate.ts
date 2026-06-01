/**
 * identityGate — shared helpers for IDENTITY-GATE-POSTS chain resolution.
 *
 * Lifted from src/routes/api/chat-rooms/[roomId]/messages/+server.ts as part
 * of the room-mode M3.b.4 slice so the mode PUT route can reuse the same
 * pidChain → terminal → room-scoped-handle resolution without duplicating
 * the parsing + lookup logic.
 *
 * parsePidChainFromBody is unchanged from the original messages route:
 * it drops malformed entries silently (no throw on unrecognised shapes).
 *
 * resolveServerSideHandle resolution order (security-sensitive — keep
 * this comment accurate, callers gate 403 on its null/non-null result):
 *   1. Empty chain / no terminal match → null.
 *   2. Room membership for the resolved terminal → that scoped handle
 *      (PRIMARY path, unchanged).
 *   3. FINDING-3 LINKEDCHAT-SELF-HANDLE (2026-05-15): if there is no
 *      membership BUT the resolved terminal's linked_chat_room_id ===
 *      roomId, return its derived handle. A 1:1 linked-chat terminal has
 *      no membership row, so without this it would resolve null and the
 *      messages route would mis-attribute its self-posts to "@you".
 *   4. Otherwise → null.
 * So it NO LONGER returns null in every membership-absent case; the
 * linked-room self-handle in step 3 is the documented exception.
 *
 * Strict 403 enforcement is the CALLER's job — these helpers return null
 * when identity cannot be resolved; the caller chooses to fall back
 * (messages transition mode) or reject with 403 (mode PUT).
 */
import { lookupTerminalByPidChain, type PidChainEntry } from './terminalsStore';
import { getRoomScopedHandle } from './roomMembershipsStore';
import { getTerminalRecord, deriveHandle } from './terminalRecordsStore';
import { resolveByBearer } from './remoteMappingStore';

export type { PidChainEntry } from './terminalsStore';

export function parsePidChainFromBody(rawBody: unknown): PidChainEntry[] {
  if (!rawBody || typeof rawBody !== 'object') return [];
  const chainRaw = (rawBody as { pidChain?: unknown }).pidChain;
  if (!Array.isArray(chainRaw)) return [];
  const chain: PidChainEntry[] = [];
  for (const entry of chainRaw) {
    if (!entry || typeof entry !== 'object') continue;
    const pidValue = (entry as { pid?: unknown }).pid;
    if (typeof pidValue !== 'number' || !Number.isFinite(pidValue) || pidValue <= 0) continue;
    const pidStartValue = (entry as { pid_start?: unknown }).pid_start;
    const pid_start = typeof pidStartValue === 'string' ? pidStartValue : null;
    chain.push({ pid: Math.floor(pidValue), pid_start });
  }
  return chain;
}

export function resolveServerSideHandle(
  roomId: string,
  pidChain: PidChainEntry[]
): string | null {
  if (pidChain.length === 0) return null;
  const terminal = lookupTerminalByPidChain(pidChain);
  if (!terminal) return null;
  const membershipHandle = getRoomScopedHandle(roomId, terminal.id);
  if (membershipHandle) return membershipHandle;
  // FINDING-3 LINKEDCHAT-SELF-HANDLE (2026-05-15): a terminal with a 1:1
  // linked_chat_room_id has NO room_memberships row (linked-chat is a
  // separate concept — see linkedRoomTerminalLookup.ts). Without this
  // branch, that terminal posting into its OWN linked room resolves to
  // null here and the route falls back to the generic "@you". When the
  // resolved terminal's linked room IS this room, self-identify via the
  // terminal's derived handle (same handle the inbound reply-router uses).
  const record = getTerminalRecord(terminal.id);
  if (record && record.linked_chat_room_id === roomId) {
    return deriveHandle(record);
  }
  return null;
}

/**
 * resolveBearerOrPidChain — M4 Q6 admission-BEFORE-identity-gate hook.
 *
 * Routes that accept BOTH local pidChain callers AND remote-bridge callers
 * (Authorization: Bearer rbt_...) call this wrapper instead of
 * resolveServerSideHandle directly. Bearer rbt_... resolves to the
 * synthetic terminal `remote-{mapping_id}`; revoked/expired/unknown
 * bearers fail BEFORE pidChain resolution per contract. Non-rbt bearer
 * or no bearer falls through to the existing pidChain path so admin-
 * bearer routes and pure-pidChain routes are unaffected.
 */
export function resolveBearerOrPidChain(
  roomId: string,
  request: Request,
  rawBody: unknown
): string | null {
  const auth = request.headers.get('authorization') ?? '';
  if (auth.startsWith('Bearer rbt_')) {
    const resolved = resolveByBearer(auth.slice(7));
    if (!resolved) return null;
    return getRoomScopedHandle(roomId, `remote-${resolved.mapping_id}`);
  }
  return resolveServerSideHandle(roomId, parsePidChainFromBody(rawBody));
}
