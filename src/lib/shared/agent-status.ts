// ANT — Normalised agent telemetry from CLI status lines.
// Parsed at the driver boundary, broadcast via WS, consumed by ActivityRail.

// Rich state label written by the per-CLI hook system at
// `~/.<cli>/state/<session_id>.json` (or `~/.ant/state/<cli>/<id>.json`).
// Kept distinct from the legacy `state` field so old consumers keep working.
export type AgentStateLabel =
  | 'Available'
  | 'Working'
  | 'Menu'
  | 'Permission'
  | 'Response needed'
  | 'Waiting';

export type AgentMenuKind = 'AskUserQuestion' | 'ExitPlanMode';

// Structured menu surfaced to the UI when the agent is parked on a
// `tool_use` for AskUserQuestion / ExitPlanMode. Populated server-side
// by `claude-code-menu-extractor.ts`, broadcast as part of AgentStatus,
// rendered by `AgentMenuPrompt.svelte`.
export type AskUserQuestionMenu = {
  kind: 'AskUserQuestion';
  question: string;
  header: string;
  options: { label: string; description: string; preview?: string }[];
  multiSelect: boolean;
  toolUseId: string;
  sessionId: string;
};

export type ExitPlanModeMenu = {
  kind: 'ExitPlanMode';
  plan: string;
  toolUseId: string;
  sessionId: string;
};

export type AgentMenu = AskUserQuestionMenu | ExitPlanModeMenu;

// Mapping from rich label → legacy state value. Drivers that emit the new
// `stateLabel` should also populate `state` via this map so any consumer
// that still checks the old union (and there are many) still gets a
// sensible value.
export function legacyStateFromLabel(
  label: AgentStateLabel
): AgentStatus['state'] {
  switch (label) {
    case 'Working':
      return 'busy';
    case 'Available':
    case 'Waiting':
      return 'idle';
    case 'Menu':
    case 'Permission':
    case 'Response needed':
      return 'thinking';
  }
}

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
  // Hook-driven fields (added 2026-05-07 — see docs/LESSONS.md § 1.12).
  // Populated by drivers that consume the per-CLI hook state file.
  timestamps?: {
    sentAt?: number; // last user message epoch ms
    respAt?: number; // last assistant reply epoch ms
    editAt?: number; // last tool invocation epoch ms
  };
  sessionStartedAt?: number;
  sessionDurationMs?: number;
  permissionMode?: string; // e.g. 'bypass permissions on'
  remoteControlActive?: boolean;
  /** Absolute working directory of the session, when known. Used by the
   *  menu extractor to locate the transcript jsonl. */
  cwd?: string;
  menuKind?: AgentMenuKind | null;
  /** Structured menu data when stateLabel === 'Menu'. Populated by the
   *  per-CLI extractor (claude-code-menu-extractor for Claude Code) and
   *  consumed by AgentMenuPrompt.svelte. */
  menu?: AgentMenu | null;
  stateLabel?: AgentStateLabel;
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
    // Prefer the rich label when the driver provides it.
    if (status.stateLabel) {
      switch (status.stateLabel) {
        case 'Working':
          return 'active';
        case 'Menu':
        case 'Permission':
        case 'Response needed':
          return 'thinking';
        case 'Waiting':
        case 'Available':
          return 'idle';
      }
    }
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
