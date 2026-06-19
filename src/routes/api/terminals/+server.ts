/**
 * /api/terminals
 *   POST { sessionId?, name?, cwd?, cols?, rows?, autoForwardRoomId? }
 *     → 201 { sessionId, name, autoForwardRoomId, autoForwardChat, alive }
 *     Spawns a terminal via the v3 pty-daemon (tmux new-session -A) AND
 *     creates a terminal_records row with auto-default name if absent.
 *   GET → 200 { terminals: TerminalRecord[] (with alive flag inferred) }
 *
 * Per terminals-backend-design-contract 2026-05-14 + T2d JWPK Q1 lock.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getIdentityDb } from '$lib/server/db';
import { spawnTerminal, listTerminals } from '$lib/server/ptyClient';
import {
  createTerminalRecord,
  listTerminalRecords,
  getTerminalRecord,
  updateTerminalRecord,
  parseAllowlist,
  deriveHandle
} from '$lib/server/terminalRecordsStore';
import { validateHandleForRegistration } from '$lib/server/handleValidation';
import { createChatRoom, findChatRoomById, softDeleteChatRoom } from '$lib/server/chatRoomStore';
import { getOperatorHandle, isOperatorHandle } from '$lib/server/operatorHandle';
import { resolveTerminalCallerHandle } from '$lib/server/authGate';
import {
  autoRegisterTerminalForSpawnedSession,
  listTerminalClassByIds,
  listTerminalRowsByIds,
  upsertTerminal
} from '$lib/server/terminalsStore';
import { bindHandle, ensureHandleOwnedBy } from '$lib/server/handleBindingsStore';
import {
  socketBackedTerminalAlive,
  terminalSocketBindingFromMeta
} from '$lib/server/terminalSocketMetadata';
import { isTerminalDeliveryTargetMode } from '$lib/server/terminalDeliveryMode';

function makeSessionId(): string {
  return 't_' + Math.random().toString(36).slice(2, 12);
}

function requireOperatorForOperatorHandle(request: Request, handle: string | undefined): void {
  if (handle === undefined || !isOperatorHandle(handle)) return;
  const callerHandle = resolveTerminalCallerHandle(request);
  if (!callerHandle || !isOperatorHandle(callerHandle)) {
    throw error(403, `${getOperatorHandle()} is the server handle and can only be assigned by the operator.`);
  }
}

export const GET: RequestHandler = async () => {
  const aliveSessionIds = await listTerminals();
  const aliveSet = new Set(aliveSessionIds);
  const rawRecords = listTerminalRecords();
  const terminalRowsById = listTerminalRowsByIds(rawRecords.map((r) => r.session_id));
  // Batched lookup of the per-terminal model flag (JWPK msg_fespxsi2lu
  // antV4 2026-05-28). Fold null/missing into null so the UI can render
  // an "unspecified" subgroup cleanly.
  const classById = listTerminalClassByIds(rawRecords.map((r) => r.session_id));
  // Terminals-page v2 (JWPK sketch 2026-06-11): the desk chip carries a
  // status bubble + room count. agent_status lives on `terminals` (keyed by
  // id = session_id); room membership count comes from room_memberships.
  // Both batched here so the page stays one fetch — no N+1 per chip.
  const db = getIdentityDb();
  const statusById = new Map<string, string>();
  const roomCountById = new Map<string, number>();
  try {
    for (const row of db.prepare(
      `SELECT id, agent_status FROM terminals WHERE status = 'live'`
    ).all() as { id: string; agent_status: string | null }[]) {
      if (row.agent_status) statusById.set(row.id, row.agent_status);
    }
    for (const row of db.prepare(
      `SELECT terminal_id, COUNT(DISTINCT room_id) AS n FROM room_memberships
        WHERE revoked_at_ms IS NULL GROUP BY terminal_id`
    ).all() as { terminal_id: string; n: number }[]) {
      roomCountById.set(row.terminal_id, row.n);
    }
  } catch { /* status/room enrichment is best-effort; chips degrade gracefully */ }
  const records = rawRecords.map((r) => {
    const terminalRow = terminalRowsById.get(r.session_id);
    const socketBinding = terminalSocketBindingFromMeta(terminalRow?.meta);
    const socketAlive = socketBinding
      ? socketBackedTerminalAlive(terminalRow?.meta, r.tmux_target_pane)
      : false;
    return {
      sessionId: r.session_id,
      name: r.name,
      autoForwardRoomId: r.auto_forward_room_id,
      autoForwardChat: r.auto_forward_chat,
      agentKind: terminalRow?.agent_kind ?? r.agent_kind,
      tmuxTargetPane: r.tmux_target_pane,
      tmuxSocketPath: socketBinding?.tmuxSocketPath ?? null,
      tmuxSessionName: socketBinding?.tmuxSessionName ?? null,
      linkedChatRoomId: r.linked_chat_room_id,
      createdBy: r.created_by,
      allowlist: parseAllowlist(r.allowlist),
      handle: r.handle,
      derivedHandle: deriveHandle(r),
      bootCommand: r.boot_command,
      agentStatus: statusById.get(r.session_id) ?? null,
      roomCount: roomCountById.get(r.session_id) ?? 0,
      accountType: classById.get(r.session_id)?.accountType ?? null,
      modelFamily: classById.get(r.session_id)?.modelFamily ?? null,
      createdAtMs: r.created_at_ms,
      updatedAtMs: r.updated_at_ms,
      alive: aliveSet.has(r.session_id) || socketAlive
    };
  });
  // JWPK two-tier dogfood spec (2026-05-14): split daemon-active sessions
  // into bare-tmux-panes (no terminal_records row) vs ANT-attached
  // terminals (with row). Frontend renders top tier "Attach existing tmux"
  // + bottom tier "ANT terminals (handle-bearing, invitable)".
  const recordedSet = new Set(records.map((r) => r.sessionId));
  const tmuxSessions = aliveSessionIds
    .filter((sid) => !recordedSet.has(sid))
    .map((sid) => ({ sessionId: sid }));
  // Back-compat: T1 /terminal route consumes `sessions: string[]`. Keep
  // alongside until all consumers migrate to terminals[]/tmuxSessions[].
  return json({ sessions: aliveSessionIds, tmuxSessions, terminals: records });
};

export const POST: RequestHandler = async ({ request }) => {
  // SPAWN-LOCALITY-GATE (2026-05-15, JWPK Slice B item 1): linked-chat
  // threat model — the raw-PTY path executes arbitrary code, the chat
  // path is CLI-gated. Block remote-bridge bearer tokens (Bearer rbt_*)
  // from reaching the raw-PTY spawn. The user's browser path and local
  // pidChain path are unaffected (neither sends rbt_ bearers). Future
  // slices may add a positive "must be local" check; this gate ships the
  // material threat-surface reduction without obtrusive UI changes.
  const authHeader = request.headers.get('authorization') ?? '';
  if (authHeader.startsWith('Bearer rbt_')) {
    throw error(403, 'Remote-bridge bearer tokens cannot spawn terminals. Spawn from the local machine.');
  }
  const raw = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const sessionId = typeof raw?.sessionId === 'string' && raw.sessionId.length > 0 ? (raw.sessionId as string) : makeSessionId();
  const cwd = typeof raw?.cwd === 'string' ? (raw.cwd as string) : undefined;
  const cols = typeof raw?.cols === 'number' && Number.isFinite(raw.cols) ? (raw.cols as number) : undefined;
  const rows = typeof raw?.rows === 'number' && Number.isFinite(raw.rows) ? (raw.rows as number) : undefined;
  const name = typeof raw?.name === 'string' ? (raw.name as string) : undefined;
  const autoForwardRoomId = typeof raw?.autoForwardRoomId === 'string' ? (raw.autoForwardRoomId as string) : undefined;
  const agentKind = typeof raw?.agentKind === 'string' && (raw.agentKind as string).length > 0
    ? (raw.agentKind as string)
    : undefined;
  // T2-IDENTITY-REGISTER-S2 (2026-05-14, Option C): user (handle) binds the
  // claim to a creator; allowlist (string[]) names handles allowed to invite/
  // mention/launch against this terminal beyond creator + operator. JWPK
  // newterminal/attach spec: same body; sessionId-present → attach via tmux
  // new-session -A; sessionId-absent → fresh spawn.
  const user = typeof raw?.user === 'string' && (raw.user as string).length > 0
    ? (raw.user as string)
    : undefined;
  const allowlistRaw = (raw?.allowlist as unknown);
  let allowlist: string[] | undefined = undefined;
  if (Array.isArray(allowlistRaw)) {
    allowlist = allowlistRaw.filter((h): h is string => typeof h === 'string' && h.length > 0);
  }
  // S7 (2026-05-14): optional handle binds the terminal to a routable
  // identifier (@x). Used by the JWPK allowed-posters picker.
  const requestedHandle = typeof raw?.handle === 'string' && (raw.handle as string).trim().length > 0
    ? (raw.handle as string).trim()
    : undefined;
  const deliveryTargetMode = isTerminalDeliveryTargetMode(raw?.deliveryTargetMode)
    ? raw.deliveryTargetMode
    : undefined;
  let handle: string | undefined;
  // Session recovery: the exact CLI line that launches the agent in this pane.
  // Stored so `POST /api/terminals/recover` can re-run it after a reboot. Custom
  // agents (Kimi/Minimax model flags) round-trip verbatim.
  const bootCommand = typeof raw?.bootCommand === 'string' && (raw.bootCommand as string).trim().length > 0
    ? (raw.bootCommand as string).trim()
    : undefined;
  // Sec-iter2 Fix #2 (2026-05-30): validate the handle BEFORE any side
  // effect (spawn / DB write). Closes the bypass where an attacker
  // posted { handle: '@admin' } and got a terminal_records row that
  // the approver gate would later trust. The store-layer choke-point
  // (Fix #1) catches this even if we forget here; the API-layer
  // validation is the UX layer — operators get a precise 400 with the
  // validator's `reason` string rather than a 500 from the store throw.
  if (requestedHandle !== undefined) {
    const validation = validateHandleForRegistration(requestedHandle);
    if (!validation.ok) {
      throw error(400, validation.message);
    }
    requireOperatorForOperatorHandle(request, validation.canonicalHandle);
    handle = validation.canonicalHandle;
  }

  const result = await spawnTerminal(sessionId, { cwd, cols, rows });
  if (!result.alive) throw error(500, `daemon failed to spawn ${sessionId}`);

  let record = getTerminalRecord(sessionId) ?? createTerminalRecord({
    sessionId, name,
    autoForwardRoomId: autoForwardRoomId ?? null,
    agentKind: agentKind ?? null,
    createdBy: user ?? null,
    allowlist: allowlist ?? null,
    handle: handle ?? null,
    bootCommand: bootCommand ?? null
  });
  // S2 + S7: if record predates a slice, allow user/allowlist/handle to be
  // filled in on attach. Don't overwrite an existing creator/handle.
  if ((record.created_by === null && user) || (record.allowlist === null && allowlist) || (record.handle === null && handle)) {
    const updated = updateTerminalRecord(sessionId, {
      ...(record.created_by === null && user ? { createdBy: user } : {}),
      ...(record.allowlist === null && allowlist ? { allowlist } : {}),
      ...(record.handle === null && handle ? { handle } : {})
    });
    if (updated) record = updated;
  }

  // T2-LINKED-CHAT-T1b (2026-05-14): every terminal_record gets a 1:1 linked
  // chat room. JWPK semantic correction — Chat IS the linked room, not a
  // kind=message filter on terminal_run_events. Idempotent: skip if already
  // linked OR if the linked room has been deleted (rare; reuse existing id).
  if (!record.linked_chat_room_id) {
    const linkedRoom = createChatRoom({
      name: `Terminal: ${record.name}`,
      whoCreatedIt: getOperatorHandle()
    });
    let updated = null;
    try {
      updated = updateTerminalRecord(sessionId, { linkedChatRoomId: linkedRoom.id });
    } catch (cause) {
      softDeleteChatRoom(linkedRoom.id);
      throw cause;
    }
    if (!updated) {
      softDeleteChatRoom(linkedRoom.id);
      throw error(500, 'Could not link terminal chat room.');
    }
    record = updated;
  } else if (!findChatRoomById(record.linked_chat_room_id)) {
    // Linked room was deleted out from under us — recreate + relink.
    const linkedRoom = createChatRoom({
      name: `Terminal: ${record.name}`,
      whoCreatedIt: getOperatorHandle()
    });
    let updated = null;
    try {
      updated = updateTerminalRecord(sessionId, { linkedChatRoomId: linkedRoom.id });
    } catch (cause) {
      softDeleteChatRoom(linkedRoom.id);
      throw cause;
    }
    if (!updated) {
      softDeleteChatRoom(linkedRoom.id);
      throw error(500, 'Could not relink terminal chat room.');
    }
    record = updated;
  }

  // AUTO-REGISTER-AT-SPAWN (2026-05-16, JWPK T1 fix): without this, a
  // terminal ANT spawned itself cannot post to its own linked chat
  // because lookupTerminalByPidChain finds no row matching the shell's
  // PID. Best-effort — if tmux query fails (rare), the terminal can
  // still self-register via `ant register` from inside.
  const registeredTerminal = record.tmux_target_pane
    ? autoRegisterTerminalForSpawnedSession({
      sessionId,
      tmuxTargetPane: record.tmux_target_pane,
      agentKind: record.agent_kind
    })
    : null;
  if (deliveryTargetMode && registeredTerminal) {
    const existingMeta = (() => {
      try {
        const parsed = JSON.parse(registeredTerminal.meta ?? '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? parsed as Record<string, unknown>
          : {};
      } catch {
        return {};
      }
    })();
    upsertTerminal({
      pid: registeredTerminal.pid,
      pid_start: registeredTerminal.pid_start ?? '',
      name: registeredTerminal.name,
      source: registeredTerminal.source,
      ttlSeconds: 30 * 24 * 60 * 60,
      meta: { ...existingMeta, deliveryTargetMode }
    });
  }

  // Clean identity witness: a user-chosen ANThandle on terminal creation is a
  // real claim, not just display text. Mirror local adoption's contract by
  // binding the handle to the spawned pane and stamping the creator as owner.
  if (handle && record.tmux_target_pane && registeredTerminal) {
    const owner = user ?? getOperatorHandle();
    bindHandle({
      handle,
      pane: record.tmux_target_pane,
      pid: registeredTerminal.pid,
      pidStart: registeredTerminal.pid_start,
      spawnedBy: owner,
      terminalId: sessionId
    });
    ensureHandleOwnedBy(handle, owner, {
      actor: owner,
      reason: 'terminal-create'
    });
  }

  return json({
    sessionId, name: record.name,
    autoForwardRoomId: record.auto_forward_room_id,
    autoForwardChat: record.auto_forward_chat,
    agentKind: record.agent_kind,
    tmuxTargetPane: record.tmux_target_pane,
    linkedChatRoomId: record.linked_chat_room_id,
    createdBy: record.created_by,
    allowlist: parseAllowlist(record.allowlist),
    handle: record.handle,
    derivedHandle: deriveHandle(record),
    bootCommand: record.boot_command,
    alive: true
  }, { status: 201 });
};
