/**
 * POST /api/terminals/[id]/kill
 *   Body: { mode?: 'archive' | 'delete' | 'just-kill' }
 *     mode defaults to 'archive' (back-compat with the original endpoint)
 *   →
 *   Canonical kill endpoint for BOTH ANT-managed terminals (terminal_record
 *   present) AND bare tmux panes (no record). Per coordinator KILL/STOP
 *   delta-1 HOLD-fix: ONE endpoint handles both tiers.
 *
 *   Identity (CVE FIX B 2026-05-20 — closes security-audit-2026-05-19.md
 *   Finding #2): server-resolved via resolveTerminalCallerHandle
 *   (cookie / antchat Bearer / admin Bearer → @you). The previous
 *   body-supplied `callerHandle` field is IGNORED — accepting it let any
 *   caller spoof `@you` and bypass the allowlist. 401 when no identity
 *   can be resolved.
 *
 *   1. If terminal_record exists → canCallerActOnTerminal (S4 helper) gates,
 *      with an explicit operator-bypass so a server-resolved @you can act on
 *      ANT terminals on the operator's own box; 403 if caller not allowed.
 *   2. If no terminal_record (bare tmux pane) → operator-only auth (raw
 *      panes run on the operator's machine).
 *   3. ptyClient.killTerminal(sessionId) — daemon issues `tmux kill-session`.
 *   4. mode='archive' (default): archive the linked chat + keep terminal
 *      record as a hide-mapping tombstone (non-destructive, recoverable).
 *      mode='delete': soft-delete the linked chat + delete the terminal
 *      record + the terminal entity. Row disappears from /terminals.
 *      mode='just-kill': process dies but the terminal record + linked chat
 *      stay live so the operator can re-attach later (JWPK msg_t42mq5ma6u
 *      2026-05-19). Fail-safe: a delete request without a safely-identifiable
 *      linked chat is downgraded to 'archive' so we never orphan history.
 *   5. broadcastTerminalEvent(sessionId, kind=raw text='[killed]') so any
 *      open SSE subscriber sees the close.
 *   →
 *   Returns { sessionId, killed: true, recordBacked, mode }.
 *
 * Per JWPK kill/stop spec + KILL/STOP design delta-1 + S6 delta-3 (2026-05-14).
 * mode extension per JWPK msg_kjyh3lmypd + msg_u47cdohnoy (2026-05-18).
 * 'just-kill' added per JWPK msg_t42mq5ma6u (2026-05-19).
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTerminalRecord } from '$lib/server/terminalRecordsStore';
import { canCallerActOnTerminal, OPERATOR_HANDLE } from '$lib/server/allowlistGuard';
import { resolveTerminalCallerHandle } from '$lib/server/authGate';
import { killTerminal } from '$lib/server/ptyClient';
import { broadcastTerminalEvent } from '$lib/server/terminalEventBroadcast';
import { archiveChatRoom, softDeleteChatRoom } from '$lib/server/chatRoomStore';
import { deleteTerminalById } from '$lib/server/terminalsStore';

type KillMode = 'archive' | 'delete' | 'just-kill';

function parseMode(raw: unknown): KillMode {
  if (raw === 'delete') return 'delete';
  if (raw === 'just-kill') return 'just-kill';
  return 'archive';
}

export const POST: RequestHandler = async ({ params, request }) => {
  const sessionId = params.id ?? '';
  if (sessionId.length === 0) throw error(400, 'sessionId required.');
  // Identity FIRST so unauthenticated callers are rejected before we read
  // the body. Any body-supplied `callerHandle` is now IGNORED — see CVE
  // FIX B in the route docstring above.
  const callerHandle = resolveTerminalCallerHandle(request);
  if (!callerHandle) {
    throw error(401, 'browser-session or admin-bearer required');
  }
  const raw = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  let mode: KillMode = parseMode(raw?.mode);

  const record = getTerminalRecord(sessionId);
  const recordBacked = record !== null;
  if (recordBacked) {
    // Operator-bypass: with the @you shortcut removed from allowlistGuard
    // (CVE FIX B), the route still trusts the *server-resolved* operator
    // identity for any ANT terminal on the operator's own host.
    const operatorBypass = callerHandle === OPERATOR_HANDLE;
    if (!operatorBypass && !canCallerActOnTerminal(callerHandle, record)) {
      throw error(403, 'caller is not allowed to act on this terminal');
    }
  } else {
    // Per coordinator product decision (2026-05-14): bare tmux panes run on
    // the operator's machine — only the operator may kill them. Unowned-by-
    // ANT does not mean unowned-by-anyone.
    if (callerHandle !== OPERATOR_HANDLE) {
      throw error(403, 'bare tmux panes can only be killed by the operator');
    }
  }

  killTerminal(sessionId);

  // Fail-safe per JWPK constraint (2026-05-19): the destructive 'delete'
  // branch must NOT cascade if we can't safely identify what to delete.
  // If we're asked to delete but have no terminal_record OR no linked chat
  // to soft-delete, downgrade to 'archive' (which is a no-op for bare panes
  // and a non-destructive tombstone for ANT terminals).
  if (mode === 'delete' && (!recordBacked || !record?.linked_chat_room_id)) {
    mode = 'archive';
  }

  if (mode === 'delete') {
    // Destructive path: soft-delete the linked chat (preserves history in
    // deleted_at_ms-filtered queries but hides from all surfaces), drop
    // the terminal_record entirely (no hide-mapping needed since the chat
    // is also gone), and remove the terminals row so /terminals doesn't
    // render a stale entry.
    if (record?.linked_chat_room_id) {
      softDeleteChatRoom(record.linked_chat_room_id);
    }
    // (record deletion is handled atomically inside deleteTerminalById below)
    deleteTerminalById(sessionId);
  } else if (mode === 'just-kill') {
    // Non-destructive: tmux session is gone but the operator may re-attach
    // by spawning a new pane against the same terminal_record. We DO NOT
    // archive the linked chat — it stays in the rooms list — and the
    // terminal_record + terminals row stay so the entry remains visible.
    // Intentionally a no-op below the killTerminal call.
  } else {
    // #93a (2026-05-16): linked chats are hidden from /rooms by the inverse
    // terminal_records.linked_chat_room_id mapping. Deleting the record would
    // orphan/expose the former linked room, so kill keeps the record as a
    // tombstone mapping and archives the linked chat non-destructively.
    if (recordBacked && record?.linked_chat_room_id) {
      archiveChatRoom(record.linked_chat_room_id);
    }
  }

  try {
    broadcastTerminalEvent(sessionId, {
      kind: 'raw', text: '[killed]', trust: 'raw',
      ts_ms: Date.now(), source: 'kill'
    });
  } catch { /* broadcast best-effort */ }

  return json({ sessionId, killed: true, recordBacked, mode });
};
