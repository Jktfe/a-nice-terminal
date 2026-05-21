import { findTerminalRecordByHandle } from './terminalRecordsStore';
import { addMembership, getTerminalIdByHandle } from './roomMembershipsStore';
import {
  adoptExternalProcessForTerminal,
  autoRegisterTerminalForSpawnedSession,
  getTerminalById
} from './terminalsStore';

function normalizeHandle(rawHandle: string): string {
  const trimmed = rawHandle.trim();
  if (trimmed.length === 0) return trimmed;
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

export function bindRoomHandleToLiveTerminal(roomId: string, rawHandle: string): string | null {
  const handle = normalizeHandle(rawHandle);
  if (roomId.trim().length === 0 || handle.length === 0) return null;

  const existingTerminalId = getTerminalIdByHandle(roomId, handle);
  const existingTerminal = existingTerminalId ? getTerminalById(existingTerminalId) : null;
  if (existingTerminal && !existingTerminal.source.startsWith('browser')) {
    return existingTerminal.id;
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
