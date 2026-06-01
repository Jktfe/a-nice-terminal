import { basename } from 'node:path';
import { classifyStateFreshness, findStateForCwdBasename, type AgentStateSnapshot } from './agentStateReader';
import { agentKindToCli, resolveTerminalRecordCliSession } from './terminalSessionLink';
import type { AgentStatus } from './agentStatusStore';

/**
 * Map the freeform state label written by CLI status-line emitters into the
 * canonical room pill enum stored in terminals.agent_status.
 */
export function projectStateLabelToAgentStatus(label: string | undefined): AgentStatus {
  if (!label) return 'idle';
  const key = label.trim().toLowerCase();
  if (key === 'working') return 'working';
  if (key === 'thinking') return 'thinking';
  if (key === 'response-required' || key === 'response needed') return 'response-required';
  if (key.startsWith('menu')) return 'response-required';
  if (key === 'available' || key === 'idle' || key === 'waiting') return 'idle';
  return 'idle';
}

export function isLiveAgentStateSnapshot(snapshot: AgentStateSnapshot, nowMs: number = Date.now()): boolean {
  return classifyStateFreshness(snapshot.mtimeMs, nowMs) === 'live';
}

export function resolveAgentStateSnapshotForTerminal(
  terminal: { id?: string; session_id?: string; agent_kind: string | null; tmux_target_pane?: string | null },
  cwd?: string | null
): AgentStateSnapshot | null {
  const terminalId = terminal.id ?? terminal.session_id;
  if (!terminalId) return null;
  const linked = resolveTerminalRecordCliSession(
    { session_id: terminalId, agent_kind: terminal.agent_kind },
    cwd ? { cwd } : {}
  );
  if (linked?.snapshot) return linked.snapshot;

  const cli = agentKindToCli(terminal.agent_kind);
  if (!cli || !cwd) return null;
  return findStateForCwdBasename(cli, basename(cwd));
}

export function projectLiveAgentStateSnapshotToStatus(
  snapshot: AgentStateSnapshot | null,
  nowMs: number = Date.now()
): AgentStatus | null {
  if (!snapshot || !isLiveAgentStateSnapshot(snapshot, nowMs)) return null;
  return projectStateLabelToAgentStatus(snapshot.stateLabel);
}
