import { findTerminalRecordByHandle } from './terminalRecordsStore';
import { addMembership, getTerminalIdByHandle } from './roomMembershipsStore';
import {
  adoptExternalProcessForTerminal,
  autoRegisterTerminalForSpawnedSession,
  getTerminalById,
  lookupTerminalByPidChain,
  type PidChainEntry,
  type TerminalRow
} from './terminalsStore';

function normalizeHandle(rawHandle: string): string {
  const trimmed = rawHandle.trim();
  if (trimmed.length === 0) return trimmed;
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

// 0.1.8 slice B (Xeno windows-cli-auth-wedge follow-up 2026-05-22):
// liveness check on the existing binding. Without this, a broken-walker
// register (pre-0.1.6 Windows or any POSIX ps failure) leaves a terminal
// row with pid_start: null bound to the room_memberships entry; any
// subsequent register with a working walker silently no-ops on the
// early-return, leaving the user wedged. Yesterday's xenocc-windows
// row from 0.1.5 was exactly this shape — needed manual `ant add
// membership` to re-bind.
function isExistingTerminalStillLive(terminal: TerminalRow): boolean {
  // Broken-walker registrations leave pid_start: null (POSIX `ps` failed,
  // or pre-0.1.6 Windows walker without CIM support). Treat as dead so
  // a re-register with a working walker can supersede the binding.
  if (terminal.pid_start === null) return false;
  // Expired by TTL: caller is expected to re-register past expires_at.
  // Don't pin a stale binding against fresh identity claims.
  // expires_at is stored in UNIX SECONDS (see upsertTerminal +
  // currentUnixSeconds), so compare against seconds, not Date.now() ms.
  if (terminal.expires_at !== null && terminal.expires_at * 1000 < Date.now()) return false;
  return true;
}

export function bindRoomHandleToLiveTerminal(
  roomId: string,
  rawHandle: string,
  callerPidChain: PidChainEntry[] = []
): string | null {
  const handle = normalizeHandle(rawHandle);
  if (roomId.trim().length === 0 || handle.length === 0) return null;

  const existingTerminalId = getTerminalIdByHandle(roomId, handle);
  const existingTerminal = existingTerminalId ? getTerminalById(existingTerminalId) : null;
  if (
    existingTerminal &&
    !existingTerminal.source.startsWith('browser') &&
    isExistingTerminalStillLive(existingTerminal)
  ) {
    return existingTerminal.id;
  }

  // Point 2 fix (Xeno windows-cli-auth-wedge follow-up #2, 2026-05-28):
  // when the existing binding fails liveness, prefer the caller's actual
  // pidChain-resolved terminal over the legacy handle→record lookup.
  // findTerminalRecordByHandle picks the FIRST record matching the
  // handle, which is often the SAME stale row that just failed liveness
  // — leaving the user wedged even after a fresh `ant register` cycle.
  // lookupTerminalByPidChain walks the caller's own process tree to find
  // the genuinely-live terminal_records row that THIS shell registered.
  if (callerPidChain.length > 0) {
    const liveTerminal = lookupTerminalByPidChain(callerPidChain);
    if (liveTerminal && isExistingTerminalStillLive(liveTerminal)) {
      addMembership({ room_id: roomId, handle, terminal_id: liveTerminal.id });
      return liveTerminal.id;
    }
  }

  const record = findTerminalRecordByHandle(handle);
  if (!record) return null;

  let terminal = getTerminalById(record.session_id);
  if (!terminal && record.tmux_target_pane) {
    terminal = autoRegisterTerminalForSpawnedSession({
      sessionId: record.session_id,
      tmuxTargetPane: record.tmux_target_pane,
      agentKind: record.agent_kind
    });
  }

  if (!terminal && record.tmux_target_pane) {
    const match = /^(\d+):/.exec(record.tmux_target_pane);
    if (match) {
      terminal = adoptExternalProcessForTerminal({
        record,
        pid: Number(match[1]),
        pidStart: null,
        ttlSeconds: 30 * 24 * 60 * 60,
        reason: 'room-handle-live-terminal-binding'
      });
    }
  }

  if (!terminal) return null;
  addMembership({ room_id: roomId, handle, terminal_id: terminal.id });
  return terminal.id;
}
