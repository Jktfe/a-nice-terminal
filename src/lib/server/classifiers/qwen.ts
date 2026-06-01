/**
 * Qwen (mlx_lm-mediated) classifier — Phase 2 priority #4 per JWPK
 * MANDATORY scope (2026-05-15). Qwen runs locally via mlx_lm (Apple
 * Silicon-optimised inference); the TTY shape is dominated by mlx_lm
 * REPL chrome:
 *
 *   - `User: ` / `Assistant: ` role markers (mlx_lm chat REPL default)
 *   - `>>>` prompt (when invoked as `mlx_lm.generate`)
 *   - "Loading model from <path>" / "Fetching N files" status lines
 *   - "Tokens generated: N (T tok/s)" timing footers
 *   - "Peak memory: X GB" footer
 *
 * Plus shared TUI chrome (box-drawing, hotkey footers, spinners, status
 * badges, separators). Plain text → kind=message.
 */

import type { Classifier, ClassifiedEvent, ClassifiedKind } from './types';
import { isShellPromptLine } from './promptEchoFilter';

const PREFIX_RULES: { test: (l: string) => boolean; kind: ClassifiedKind }[] = [
  { test: (l) => /^\s*\[thinking\]/i.test(l), kind: 'thinking' },
  { test: (l) => /^\s*<think>/i.test(l), kind: 'thinking' },     // qwen3 emits <think>...</think>
  { test: (l) => /^\s*\[reasoning\]/i.test(l), kind: 'thinking' },
  { test: (l) => /^\s*\[tool(_use|_call)?\]/i.test(l), kind: 'tool_call' }
];

const RESIDUAL_CONTROL_RE = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/;

// Shared TUI chrome.
const TUI_BOX_DRAWING_RE = /^[\s│─├└┌┐┘┤┬┴┼qmwlkjnxv─-╿]+$/;
const TUI_HOTKEY_FOOTER_RE = /\b(esc|ctrl\+\w+|shift\+\w+|opt\+\w+|alt\+\w+|⌘\w*)\b.*\bto\b/i;
const TUI_SPINNER_RE = /^[\s⠀-⣿⠁-⠿◐◓◑◒◴◷◶◵|\\\/-]*\s*(working|thinking|loading|processing|generating|streaming)\.{0,3}\s*$/i;
const TUI_UNDERSCORE_CURSOR_RE = /^\s*_{2,}\s*$/;
const TUI_STATUS_BADGE_RE = /^\s*(Done|Working|Generating|Thinking|Streaming)\s*$/;
const TUI_SEPARATOR_RE = /^[\s\-=*_]{4,}$/;
const TUI_LONG_RUN_RE = /[q_]{10,}/;

// Qwen / mlx_lm-specific.
const QWEN_REPL_PROMPT_RE = /^\s*>>>\s*$/;
const QWEN_ROLE_MARKER_RE = /^\s*(User|Assistant|System)\s*:\s*$/;
const QWEN_LOAD_STATUS_RE =
  /^\s*(Loading\s+model\s+from|Fetching\s+\d+\s+files?|Loaded\s+\w+|Quantizing|Saved\s+config|cache\s+hit|cache\s+miss)\b/i;
const QWEN_TIMING_RE =
  /^\s*(Tokens?\s+generated\s*[:=]\s*\d+|Peak\s+memory\s*[:=]\s*[\d.]+\s*GB|Generation\s+took\s*[\d.]+s|\d+(?:\.\d+)?\s*tok\/s)\b/i;

function isQwenTuiChrome(line: string): boolean {
  if (TUI_BOX_DRAWING_RE.test(line)) return true;
  if (TUI_HOTKEY_FOOTER_RE.test(line)) return true;
  if (TUI_SPINNER_RE.test(line)) return true;
  if (TUI_UNDERSCORE_CURSOR_RE.test(line)) return true;
  if (TUI_STATUS_BADGE_RE.test(line)) return true;
  if (TUI_SEPARATOR_RE.test(line)) return true;
  if (TUI_LONG_RUN_RE.test(line)) return true;
  if (QWEN_REPL_PROMPT_RE.test(line)) return true;
  if (QWEN_ROLE_MARKER_RE.test(line)) return true;
  if (QWEN_LOAD_STATUS_RE.test(line)) return true;
  if (QWEN_TIMING_RE.test(line)) return true;
  return false;
}

function classifyLine(line: string): ClassifiedKind {
  if (isShellPromptLine(line)) return 'raw';
  if (RESIDUAL_CONTROL_RE.test(line)) return 'raw';
  if (isQwenTuiChrome(line)) return 'raw';
  for (const rule of PREFIX_RULES) {
    if (rule.test(line)) return rule.kind;
  }
  return 'message';
}

export const classifyQwen: Classifier = (buffer) => {
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
