// Reactive store of live AgentStatus per sessionId.
// Populated by ws.svelte.ts on every `agent_status_updated` message.
// Components can read from this shared source so live dots do not each invent
// their own status cache.

import type { AgentStatus, AgentDotState } from '$lib/shared/agent-status';
import { agentDotStateFromStatus } from '$lib/shared/agent-status';

const statuses = $state<Record<string, AgentStatus>>({});

export function setAgentStatus(sessionId: string, status: AgentStatus): void {
  statuses[sessionId] = status;
}

export function clearAgentStatus(sessionId: string): void {
  delete statuses[sessionId];
}

export function getAgentStatus(sessionId: string | null | undefined): AgentStatus | undefined {
  return sessionId ? statuses[sessionId] : undefined;
}

export function getAgentDotState(
  sessionId: string | null | undefined,
  context?: Parameters<typeof agentDotStateFromStatus>[1],
): AgentDotState {
  return agentDotStateFromStatus(getAgentStatus(sessionId), context);
}

// Exported for components that want to subscribe to the whole map (rare —
// most consumers should call getAgentStatus / getAgentDotState).
export const agentStatusStore = {
  get all() {
    return statuses;
  },
};
