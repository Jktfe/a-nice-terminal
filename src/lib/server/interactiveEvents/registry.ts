/**
 * Interactive-event registry — agent_kind → Detector dispatch (Layer A
 * T2b). T2b-impl-1 ships only claude-code; codex/gemini/aider/etc per-CLI
 * detectors land in T2b-impl-2. Unknown agent_kind = no-op (returns
 * empty events) — Layer B output classifier still runs and provides
 * useful kind=message rows.
 */

import type { Detector, DetectedInteractiveEvent } from './types';
import { detectClaudeCode } from './claudeCodeDetect';

const REGISTRY: Record<string, Detector> = {
  'claude-code': detectClaudeCode
};

export type DispatchInput = {
  sessionId: string;
  buffer: string;
  agentKindHint?: string | null;
};

export type DispatchResult = {
  events: DetectedInteractiveEvent[];
  consumedBytes: number;
};

export function dispatchInteractiveDetect(input: DispatchInput): DispatchResult {
  const detector = (input.agentKindHint && REGISTRY[input.agentKindHint]) || null;
  if (!detector) return { events: [], consumedBytes: 0 };
  return detector(input.buffer);
}
