import type { AgentStatus, AgentStatusSource } from './agentStatusStore';

const FINGERPRINT_STALE_MS = 30_000;
const HOOK_STALE_MS = 30_000;
const ANT_ACTIVITY_STALE_MS = 60_000;
const PID_CPU_STALE_MS = 60_000;

export type RawAgentStatusProjection = {
  agent_status: AgentStatus | null;
  agent_status_source: AgentStatusSource | null;
  agent_status_at_ms: number | null;
};

export type EffectiveAgentStatusProjection = {
  agent_status: AgentStatus;
  agent_status_source: AgentStatusSource;
  agent_status_at_ms: number;
};

function staleMsForSource(source: AgentStatusSource): number | null {
  if (source === 'fingerprint') return FINGERPRINT_STALE_MS;
  if (source === 'hook') return HOOK_STALE_MS;
  if (source === 'ant-activity') return ANT_ACTIVITY_STALE_MS;
  if (source === 'pid-cpu') return PID_CPU_STALE_MS;
  return null;
}

function isVolatileActiveStatus(status: AgentStatus): boolean {
  return status === 'working' || status === 'thinking';
}

export function projectEffectiveAgentStatus(
  row: RawAgentStatusProjection | null | undefined,
  nowMs: number = Date.now()
): EffectiveAgentStatusProjection {
  const status = row?.agent_status ?? 'idle';
  const source = row?.agent_status_source ?? 'default';
  const atMs = row?.agent_status_at_ms ?? 0;

  if (!isVolatileActiveStatus(status)) {
    return { agent_status: status, agent_status_source: source, agent_status_at_ms: atMs };
  }

  const maxAgeMs = staleMsForSource(source);
  if (maxAgeMs !== null && atMs > 0 && nowMs - atMs > maxAgeMs) {
    return { agent_status: 'idle', agent_status_source: 'default', agent_status_at_ms: 0 };
  }

  return { agent_status: status, agent_status_source: source, agent_status_at_ms: atMs };
}
