/**
 * hookEventStatusMapper — translate a CLI hook event into an agent_status
 * transition (asks-as-pill slice 8 JWPK 2026-05-22). Pure function — caller
 * decides whether to write via setAgentStatus.
 *
 * Maps the four canonical Claude Code hook events first; other CLI adapters
 * (codex, pi, gemini) reuse the same names via their translators (Phase 2 of
 * CLI-HOOK-BRIDGE banked memory). Unknown event names map to null so the
 * caller can no-op without surprise transitions.
 *
 * Decision table (JWPK 2026-05-22 lock):
 *   PreToolUse          → working  (tool_start)
 *   PostToolUse         → idle     (tool_stop)
 *   Stop / SubagentStop → idle     (agent's turn ended)
 *   Notification        → thinking (permission prompt / blocking question
 *                                   from agent; pre-asks-as-pill this was
 *                                   the ASK_PATTERN heuristic — now it's
 *                                   a deliberate "agent is mid-decision"
 *                                   signal, NOT response-required, because
 *                                   response-required is asks-only)
 *   UserPromptSubmit    → working  (user gave the agent something to do)
 *   ThinkingStart       → thinking (agent purposefully emits while
 *                                   digesting; cleared by next tool_start
 *                                   or tool_stop)
 *
 * Lifecycle additions (feat/status-cascade 2026-06-10, additive — every new
 * case projects to an ALREADY-EXISTING status):
 *   SessionStart / SessionEnd → idle    (session boundary, no active turn)
 *   SubagentStart             → working (a subagent turn is active work)
 *   PreCompact / PostCompact  → working (compaction = the CLI is busy)
 *
 * Dialect normalisation (same date, spec §5 of ant-cli-status-flows): the
 * Copilot camelCase and Gemini Before*-/After*- event names were persisted
 * raw but projected NO status (default null). The names that map onto existing
 * statuses are translated below; names whose spec target is 'blocked' or
 * 'response-needed' (permissionRequest, errorOccurred, postToolUseFailure,
 * notification…) stay UNMAPPED — those states are gated on the HIGH-RISK
 * enum widening and must not be approximated here.
 *
 * Note: 'response-required' is NEVER emitted by this mapper. That state
 * belongs to the asks-as-pill projection (humans only, derived from
 * open + merged asks). Agents only ever wear idle/thinking/working.
 */
import type { AgentStatus } from './agentStatusStore';

export function mapHookEventToAgentStatus(
  hookEventName: string
): AgentStatus | null {
  switch (hookEventName) {
    case 'PreToolUse':
    case 'tool_use_start':
    case 'UserPromptSubmit':
    case 'SubagentStart':
    case 'PreCompact':
    case 'PostCompact':
      return 'working';
    case 'PostToolUse':
    case 'tool_use_stop':
    case 'Stop':
    case 'SubagentStop':
    case 'SessionStart':
    case 'SessionEnd':
      return 'idle';
    case 'Notification':
    case 'ThinkingStart':
    case 'thinking':
      return 'thinking';
    // Copilot camelCase dialect — existing-status names only.
    case 'preToolUse':
    case 'userPromptSubmitted':
    case 'subagentStart':
    case 'preCompact':
      return 'working';
    case 'postToolUse':
    case 'agentStop':
    case 'subagentStop':
    case 'sessionStart':
    case 'sessionEnd':
      return 'idle';
    // Gemini Before*/After* dialect.
    case 'BeforeAgent':
    case 'BeforeTool':
    case 'PreCompress':
      return 'working';
    case 'AfterAgent':
    case 'AfterTool':
      return 'idle';
    case 'BeforeModel':
    case 'AfterModel':
    case 'BeforeToolSelection':
      return 'thinking';
    default:
      return null;
  }
}
