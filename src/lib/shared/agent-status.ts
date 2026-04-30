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
