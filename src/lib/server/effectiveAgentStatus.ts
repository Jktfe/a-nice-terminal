import type { AgentStatus, AgentStatusSource } from './agentStatusStore';

const VOLATILE_ACTIVE_STALE_MS = 5 * 60_000;
const PTY_OUTPUT_FRESH_MS = 30_000;

const FINGERPRINT_STALE_MS = VOLATILE_ACTIVE_STALE_MS;
const HOOK_STALE_MS = VOLATILE_ACTIVE_STALE_MS;
const ANT_ACTIVITY_STALE_MS = VOLATILE_ACTIVE_STALE_MS;
const PID_CPU_STALE_MS = VOLATILE_ACTIVE_STALE_MS;

export type RawAgentStatusProjection = {
  agent_status: AgentStatus | null;
  agent_status_source: AgentStatusSource | null;
  agent_status_at_ms: number | null;
  last_pty_byte_at_ms?: number | null;
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

function hasFreshPtyOutput(row: RawAgentStatusProjection | null | undefined, nowMs: number): boolean {
  const atMs = row?.last_pty_byte_at_ms ?? null;
  return typeof atMs === 'number' && atMs > 0 && nowMs - atMs <= PTY_OUTPUT_FRESH_MS;
}

export function projectEffectiveAgentStatus(
  row: RawAgentStatusProjection | null | undefined,
  nowMs: number = Date.now()
): EffectiveAgentStatusProjection {
  const status = row?.agent_status ?? 'idle';
  const source = row?.agent_status_source ?? 'default';
  const atMs = row?.agent_status_at_ms ?? 0;

  if (status !== 'response-required' && hasFreshPtyOutput(row, nowMs)) {
    if (!isVolatileActiveStatus(status)) {
      return {
        agent_status: 'working',
        agent_status_source: 'ant-activity',
        agent_status_at_ms: row?.last_pty_byte_at_ms ?? nowMs
      };
    }
  }

  if (!isVolatileActiveStatus(status)) {
    return { agent_status: status, agent_status_source: source, agent_status_at_ms: atMs };
  }

  const maxAgeMs = staleMsForSource(source);
  if (maxAgeMs !== null && atMs > 0 && nowMs - atMs > maxAgeMs) {
    if (hasFreshPtyOutput(row, nowMs)) {
      return {
        agent_status: 'working',
        agent_status_source: 'ant-activity',
        agent_status_at_ms: row?.last_pty_byte_at_ms ?? nowMs
      };
    }
    return { agent_status: 'idle', agent_status_source: 'default', agent_status_at_ms: 0 };
  }

  return { agent_status: status, agent_status_source: source, agent_status_at_ms: atMs };
}
