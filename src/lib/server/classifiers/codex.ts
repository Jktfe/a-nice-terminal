/**
 * Codex CLI classifier — per-line heuristic for the codex-cli output
 * shape. T2c-impl-2-codex per terminals-output-classifier-design Q2
 * (per-CLI dispatch); structured ANT-EV markers in the same buffer are
 * handled by the shared structuredMarkers pre-pass in classifierRegistry
 * so this file only sees buffer remainder.
 *
 * Heuristics (case-insensitive on the prefix):
 *   `>` line, `▶` line, `[thinking]` prefix → kind='thinking'
 *   `$ <cmd>` or `> $ <cmd>` shell-shape → kind='command'
 *   `[tool]` / `[tool_use]` / `[tool_call]` prefix → kind='tool_call'
 *   anything else (non-empty) → kind='message'
 * trust='medium' for all heuristic matches per design Q4.
 */

import type { Classifier, ClassifiedEvent, ClassifiedKind } from './types';
import { isShellPromptLine } from './promptEchoFilter';

// Order matters — chained command `> $ ls` must beat generic thinking `> `.
const PREFIX_RULES: { test: (line: string) => boolean; kind: ClassifiedKind }[] = [
  { test: (l) => /^\s*>\s+\$\s+\S/.test(l), kind: 'command' },
  { test: (l) => /^\s*\$\s+\S/.test(l), kind: 'command' },
  { test: (l) => /^\s*[>▶]\s/.test(l), kind: 'thinking' },
  { test: (l) => /^\s*\[thinking\]/i.test(l), kind: 'thinking' },
  { test: (l) => /^\s*\[tool(_use|_call)?\]/i.test(l), kind: 'tool_call' }
];

// Cheap heuristic: a "looks like clean prose / output" line that's safe to
// classify as message. Lines containing residual screen-control bytes that
// the strip layer didn't catch get demoted to kind='raw' so they don't
// pollute the chat-view filter (per RQO T2c-impl-2-codex delta-3 finding).
function looksLikeCleanText(line: string): boolean {
  return !/[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(line);
}

function classifyLine(line: string): ClassifiedKind {
  // Demote shell prompts (zsh %, sh $, bash user@host:cwd$, etc) to raw so
  // they stay visible in ANT view but don't pollute the CHAT view filter.
  if (isShellPromptLine(line)) return 'raw';
  for (const rule of PREFIX_RULES) {
    if (rule.test(line)) return rule.kind;
  }
  return looksLikeCleanText(line) ? 'message' : 'raw';
}

export const classifyCodex: Classifier = (buffer) => {
  const events: ClassifiedEvent[] = [];
  if (buffer.length === 0) return { events, remaining: '' };
  const lines = buffer.split('\n');
  const remaining = lines.pop() ?? '';
  for (const line of lines) {
    if (line.length === 0) continue;
    const kind = classifyLine(line);
    events.push({ kind, text: line, trust: kind === 'raw' ? 'raw' : 'medium' });
  }
  return { events, remaining };
};
