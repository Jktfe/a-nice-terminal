// ANT — Normalised agent telemetry from CLI status lines.
// Parsed at the driver boundary, broadcast via WS, consumed by ActivityRail.

export interface AgentStatus {
  model?: string;
  contextUsedPct?: number;
  contextRemainingPct?: number;
  rateLimitPct?: number;
  rateLimitWindow?: string;
  state: 'ready' | 'busy' | 'thinking' | 'focus' | 'error' | 'idle' | 'unknown';
  activity?: string;
  workspace?: string;
  branch?: string;
  waitingFor?: string;
  focus?: {
    roomId: string;
    roomName?: string | null;
    reason?: string | null;
    expiresAt?: number | null;
    queueCount?: number | null;
  };
  detectedAt: number;
}

export type AgentDotState = 'active' | 'thinking' | 'idle' | 'offline';

export function agentDotStateFromStatus(
  status: AgentStatus | null | undefined,
  context: {
    needsInput?: boolean;
    sessionStatus?: string | null;
    focus?: boolean;
    staleMs?: number;
  } = {}
): AgentDotState {
  if (context.needsInput) return 'thinking';
  if (context.focus) return 'active';

  const staleMs = context.staleMs ?? 120_000;
  const statusIsFresh = !!status && (
    !Number.isFinite(status.detectedAt) ||
    Date.now() - status.detectedAt <= staleMs
  );

  if (statusIsFresh) {
    switch (status.state) {
      case 'thinking':
        return 'thinking';
      case 'ready':
      case 'busy':
      case 'focus':
        return 'active';
      case 'error':
      case 'idle':
      case 'unknown':
        break;
    }
  }

  switch (context.sessionStatus) {
    case 'active':
    case 'working':
    case 'running':
      return 'active';
    case 'thinking':
      return 'thinking';
    case 'offline':
    case 'archived':
    case 'deleted':
      return 'offline';
    default:
      return 'idle';
  }
}
