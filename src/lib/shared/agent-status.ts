/**
 * agent-status.ts — types-only stub per V3-LIFT-1 design 2026-05-15.
 * Extracted from v3 a-nice-terminal/src/lib/shared/agent-status.* —
 * canonical shape preserved so V3-LIFT-2 (CommandBlock) and V3-LIFT-3
 * (AgentEventCard) can extend this stub with their payload types.
 *
 * No runtime store ported yet — components default to inert state.
 */

export type AgentDotState = 'active' | 'thinking' | 'idle' | 'offline';
