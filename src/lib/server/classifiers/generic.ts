/**
 * Generic classifier — fallback for unknown agent_kind. Splits buffer on
 * newline; each complete line becomes one kind='message' (or kind='raw'
 * if the line still contains control bytes after the boot-level
 * stripAnsi pass). Trailing partial line stays in `remaining` until
 * more data arrives. Per terminals-output-classifier-design Q1+Q2 +
 * delta-3 defense-in-depth (JWPK ANT-view-rubbish dogfood feedback).
 */

import type { Classifier, ClassifiedEvent, ClassifiedKind } from './types';
import { isShellPromptLine } from './promptEchoFilter';

const RESIDUAL_CONTROL_RE = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/;

function classifyLine(line: string): ClassifiedKind {
  if (isShellPromptLine(line)) return 'raw';
  if (RESIDUAL_CONTROL_RE.test(line)) return 'raw';
  return 'message';
}

export const classifyGeneric: Classifier = (buffer) => {
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
