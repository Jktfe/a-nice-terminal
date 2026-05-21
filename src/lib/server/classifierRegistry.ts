/**
 * classifierRegistry — per-terminal buffer + agent_kind → classifier
 * dispatch per terminals-output-classifier-design Q1+Q2. Per-CLI lookup
 * is wired off agentKindHint (caller supplies; full agent_kind autodetect
 * via existing fingerprintDetector lands in T2c-impl-2). Buffers > 8KB
 * without classification flush as kind='raw' fallback per Q4.
 */

import type { Classifier, ClassifiedEvent } from './classifiers/types';
import { classifyGeneric } from './classifiers/generic';
import { classifyClaudeCode } from './classifiers/claudeCode';
import { classifyCodex } from './classifiers/codex';
import { classifyGemini } from './classifiers/gemini';
import { classifyPi } from './classifiers/pi';
import { classifyQwen } from './classifiers/qwen';
import { extractStructuredEvents } from './classifiers/structuredMarkers';

const OVERFLOW_BYTES = 8192;

const REGISTRY: Record<string, Classifier> = {
  'claude-code': classifyClaudeCode,
  'claude': classifyClaudeCode,    // T-AGENT-LIST-SETTINGS (2026-05-14): JWPK short label
  'codex': classifyCodex,
  'codex-cli': classifyCodex,
  // Below: short labels accepted by JWPK's configurable agent-kind list.
  // Phase 2 per-CLI parsers land one-by-one; remaining ones alias to
  // generic until their classifier ships.
  'gemini': classifyGemini,         // Phase 2 priority #2 (2026-05-14)
  'gemini-cli': classifyGemini,     // Phase 2 priority #2 (2026-05-14)
  'aider': classifyGeneric,
  'kimi': classifyGeneric,
  'qwen': classifyQwen,             // Phase 2 priority #4 (2026-05-15)
  'copilot': classifyGeneric,
  'perspective': classifyGeneric,
  'pi': classifyPi                  // Phase 2 priority #3 (2026-05-14)
};

const buffers = new Map<string, string>();

function pickClassifier(agentKindHint: string | null): Classifier {
  if (agentKindHint && REGISTRY[agentKindHint]) return REGISTRY[agentKindHint];
  return classifyGeneric;
}

export type DispatchInput = {
  sessionId: string;
  chunk: string;
  agentKindHint?: string | null;
};

export function dispatchClassify(input: DispatchInput): ClassifiedEvent[] {
  const prior = buffers.get(input.sessionId) ?? '';
  const merged = prior + input.chunk;
  // T2c-impl-3: structured-marker pre-pass extracts high-trust events
  // BEFORE per-CLI heuristic classification, so trustworthy agent emits
  // beat fuzzy line-prefix matches.
  const { events: structured, cleaned } = extractStructuredEvents(merged);
  const { events: heuristic, remaining } = pickClassifier(input.agentKindHint ?? null)(cleaned);
  const events: ClassifiedEvent[] = [...structured, ...heuristic];
  if (remaining.length > OVERFLOW_BYTES) {
    events.push({ kind: 'raw', text: remaining, trust: 'raw' });
    buffers.set(input.sessionId, '');
  } else {
    buffers.set(input.sessionId, remaining);
  }
  return events;
}

export function resetClassifierBuffersForTests(): void {
  buffers.clear();
}
