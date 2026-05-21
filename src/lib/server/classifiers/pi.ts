/**
 * Pi (Inflection / Ollama-mediated) classifier — Phase 2 priority #3 per
 * JWPK MANDATORY scope (2026-05-14). Pi runs locally via Ollama, so the
 * TTY shape is dominated by the Ollama REPL chrome:
 *
 *   - `>>> ` prompt (Ollama default)
 *   - `Loading model "pi-..."` / `Pulled X bytes` status lines
 *   - `Use Ctrl+D or /bye to exit.` startup hint
 *   - `Sending request...` / `... done in Xs` timing footers
 *
 * Plus shared TUI chrome (box-drawing, hotkey footers, spinners, status
 * badges, separators). Plain text → kind=message.
 */

import type { Classifier, ClassifiedEvent, ClassifiedKind } from './types';
import { isShellPromptLine } from './promptEchoFilter';

const PREFIX_RULES: { test: (l: string) => boolean; kind: ClassifiedKind }[] = [
  { test: (l) => /^\s*\[thinking\]/i.test(l), kind: 'thinking' },
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

// Pi/Ollama-specific: bare `>>> ` REPL prompt; demote when alone, NOT when
// followed by user input — that's a different surface.
const OLLAMA_PROMPT_RE = /^\s*>>>\s*$/;
// Ollama startup banner: "Use Ctrl+D or /bye to exit." or similar.
const OLLAMA_STARTUP_HINT_RE = /\b(\/bye|ctrl\+d)\b.*\bto\s+exit\b/i;
// Ollama model-loading status: "Loading model 'pi-...'" / "pulling manifest"
// / "verifying sha256 digest" / "downloading X MB".
const OLLAMA_MODEL_STATUS_RE =
  /^\s*(loading\s+model|pulling\s+\w+|verifying\s+sha256|downloading\s+\d|writing\s+manifest|success)\b/i;
// Send/receive timing footer: "Sending request..." / "... done in 2.3s"
const OLLAMA_TIMING_RE = /^\s*(sending\s+request|received\s+\d+\s+bytes|.*\bdone\s+in\s+[\d.]+s).*$/i;

function isPiTuiChrome(line: string): boolean {
  if (TUI_BOX_DRAWING_RE.test(line)) return true;
  if (TUI_HOTKEY_FOOTER_RE.test(line)) return true;
  if (TUI_SPINNER_RE.test(line)) return true;
  if (TUI_UNDERSCORE_CURSOR_RE.test(line)) return true;
  if (TUI_STATUS_BADGE_RE.test(line)) return true;
  if (TUI_SEPARATOR_RE.test(line)) return true;
  if (OLLAMA_PROMPT_RE.test(line)) return true;
  if (OLLAMA_STARTUP_HINT_RE.test(line)) return true;
  if (OLLAMA_MODEL_STATUS_RE.test(line)) return true;
  if (OLLAMA_TIMING_RE.test(line)) return true;
  return false;
}

function classifyLine(line: string): ClassifiedKind {
  if (isShellPromptLine(line)) return 'raw';
  if (RESIDUAL_CONTROL_RE.test(line)) return 'raw';
  if (isPiTuiChrome(line)) return 'raw';
  for (const rule of PREFIX_RULES) {
    if (rule.test(line)) return rule.kind;
  }
  return 'message';
}

export const classifyPi: Classifier = (buffer) => {
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
