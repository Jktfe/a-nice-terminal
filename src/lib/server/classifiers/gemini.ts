/**
 * Gemini-CLI classifier — Phase 2 per-CLI parser per JWPK MANDATORY
 * scope (2026-05-14). Mirrors claudeCode shape: TUI chrome demote
 * (box-drawing, hotkey footers, spinner, status badges, separators)
 * + gemini-specific patterns where they diverge:
 *   - `gemini>` prompt scaffolding
 *   - `[<model>]` header tags
 *   - "thinking..." / "Using <tool>" lines
 *
 * Plain text → kind=message. Lines beginning with `[thinking]` or
 * `[reasoning]` map to kind=thinking; `[tool]`/`[tool_use]` to
 * kind=tool_call (matches v2 conventions even if gemini-cli emits
 * differently — additive when more samples land).
 */

import type { Classifier, ClassifiedEvent, ClassifiedKind } from './types';
import { isShellPromptLine } from './promptEchoFilter';

const PREFIX_RULES: { test: (l: string) => boolean; kind: ClassifiedKind }[] = [
  { test: (l) => /^\s*\[thinking\]/i.test(l), kind: 'thinking' },
  { test: (l) => /^\s*\[reasoning\]/i.test(l), kind: 'thinking' },
  { test: (l) => /^\s*\[tool(_use|_call)?\]/i.test(l), kind: 'tool_call' },
  { test: (l) => /^\s*using\s+\S+\.\.\.?\s*$/i.test(l), kind: 'tool_call' }
];

const RESIDUAL_CONTROL_RE = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/;

// Shared TUI chrome patterns — most CLIs emit similar shapes for
// box-drawing panels, hotkey footers, spinner frames, separators, status
// badges. Gemini-specific additions: `gemini>` prompt + `[model:gemini-*]`
// header tags.
const TUI_BOX_DRAWING_RE = /^[\s│─├└┌┐┘┤┬┴┼qmwlkjnxv─-╿]+$/;
const TUI_HOTKEY_FOOTER_RE = /\b(esc|ctrl\+\w+|shift\+\w+|opt\+\w+|alt\+\w+|⌘\w*)\b.*\bto\b/i;
const TUI_SPINNER_RE = /^[\s⠀-⣿⠁-⠿◐◓◑◒◴◷◶◵|\\\/-]*\s*(working|thinking|loading|processing|generating)\.{0,3}\s*$/i;
const TUI_UNDERSCORE_CURSOR_RE = /^\s*_{2,}\s*$/;
const TUI_STATUS_BADGE_RE = /^\s*(Done|Working|Generating|Thinking)\s*$/;
const TUI_SEPARATOR_RE = /^[\s\-=*_]{4,}$/;
// Gemini prompt scaffolding: bare `gemini>` or `gemini>` followed by user
// echo. The shell echoes the typed cmd; treat the prompt portion as raw.
const GEMINI_PROMPT_RE = /^\s*gemini\s*>\s*/i;
// Gemini model-tag headers: `[model: gemini-1.5-pro]` or `[gemini-cli vX]`.
const GEMINI_MODEL_TAG_RE = /^\s*\[(model:\s*)?gemini[\w.\-]*[^\]]*\]\s*$/i;

function isGeminiTuiChrome(line: string): boolean {
  if (TUI_BOX_DRAWING_RE.test(line)) return true;
  if (TUI_HOTKEY_FOOTER_RE.test(line)) return true;
  if (TUI_SPINNER_RE.test(line)) return true;
  if (TUI_UNDERSCORE_CURSOR_RE.test(line)) return true;
  if (TUI_STATUS_BADGE_RE.test(line)) return true;
  if (TUI_SEPARATOR_RE.test(line)) return true;
  if (GEMINI_PROMPT_RE.test(line) && line.trim().toLowerCase() === 'gemini>') return true;
  if (GEMINI_MODEL_TAG_RE.test(line)) return true;
  return false;
}

function classifyLine(line: string): ClassifiedKind {
  if (isShellPromptLine(line)) return 'raw';
  if (RESIDUAL_CONTROL_RE.test(line)) return 'raw';
  if (isGeminiTuiChrome(line)) return 'raw';
  for (const rule of PREFIX_RULES) {
    if (rule.test(line)) return rule.kind;
  }
  return 'message';
}

export const classifyGemini: Classifier = (buffer) => {
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
