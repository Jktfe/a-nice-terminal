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
      return 'working';
    case 'PostToolUse':
    case 'tool_use_stop':
    case 'Stop':
    case 'SubagentStop':
      return 'idle';
    case 'Notification':
    case 'ThinkingStart':
    case 'thinking':
      return 'thinking';
    default:
      return null;
  }
}
