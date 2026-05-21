/**
 * Claude Code classifier — prefix-line heuristic per terminals-output-
 * classifier-design Locked Assumption 1 (v1; structured-event JSON
 * markers land in T2c-impl-3). Lines beginning with [thinking] map to
 * kind='thinking'; [tool] / [tool_use] map to kind='tool_call';
 * everything else maps to kind='message'. trust='medium' for all
 * heuristic matches per Q4 enum.
 */

import type { Classifier, ClassifiedEvent, ClassifiedKind } from './types';
import { isShellPromptLine } from './promptEchoFilter';

const PREFIX_RULES: { prefix: string; kind: ClassifiedKind }[] = [
  { prefix: '[thinking]', kind: 'thinking' },
  { prefix: '[tool]', kind: 'tool_call' },
  { prefix: '[tool_use]', kind: 'tool_call' }
];

const RESIDUAL_CONTROL_RE = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/;

// claudeCode Phase 2 upgrade (2026-05-14, JWPK MANDATORY): demote claude-
// code TUI chrome so it never shows up in Chat as agent reply text. Each
// pattern targets a specific Terminal 23:22 leak shape coordinator
// surfaced. Order doesn't matter — match-any short-circuits.
//   - box-drawing-only lines (TUI panels) including 4+ q runs that are
//     the post-strip horizontal separator
//   - hotkey footer / status bar lines (esc to interrupt, shift+tab to ...)
//   - spinner / "Working..." lines redrawn each frame
//   - explicit footer phrases: "bypass permissions", "on ? for shortcuts"
//   - hook-emit timing footers: "sent:12 resp:5 edit:0 ..." with timings
//   - underscore-only cursor indicators: 2+ underscores alone
//   - standalone status badges: "Remote Control", "Done"
const TUI_BOX_DRAWING_RE = /^[\s│─├└┌┐┘┤┬┴┼qmwlkjnxv─-╿]+$/;
const TUI_HOTKEY_FOOTER_RE = /\b(esc|ctrl\+\w+|shift\+\w+|opt\+\w+|alt\+\w+|⌘\w*)\b.*\bto\b/i;
const TUI_SPINNER_RE =
  /^[\s⠀-⣿⠁-⠿◐◓◑◒◴◷◶◵|\\\/-]*\s*(working|thinking|loading|processing|streaming|generating|running|twisting|compounting|compounding|noodling|musing|simmering|stewing|brewing|cogitating|reasoning|analyzing|computing)\.{0,3}\s*$/i;
const TUI_BYPASS_PERMS_RE = /\bbypass\s+permissions\b/i;
const TUI_SHORTCUT_HINT_RE = /\bon\s+\?\s+for\s+shortcuts\b/i;
const TUI_HOOK_TIMING_RE = /\bsent\s*[:=]\s*\d+.*\bresp\s*[:=]\s*\d+.*\bedit\s*[:=]\s*\d+/i;
const TUI_UNDERSCORE_CURSOR_RE = /^\s*_{2,}\s*$/;
const TUI_STATUS_BADGE_RE = /^\s*(Remote Control|Done|Working)\s*$/;
// claudeCode delta-3 fragment-tolerant patterns (2026-05-15, JWPK Terminal
// 23:52 inspection): PTY chunks split mid-pattern, leaving partial TUI
// strings that our exact-line regexes miss. These match anywhere in the
// line, not just at boundaries.
//   - 10+ q or _ chars in a row (post-strip horizontal/cursor frags)
//   - Common fragment starts: ift+tab, bypasspermissions, __bypass etc
//   - Use /permissions tip-line and similar startup hints
//   - Full claudeCode status-line shape: model + cwd + percent + Working
//     + RemoteControl etc — entirely demote until a state-reader lifts
//     it into a structured surface
const TUI_LONG_RUN_RE = /[q_]{10,}/;
const TUI_FRAGMENT_RE = /^(ift\+tab\b|bypasspermissions\b|__bypass\b|__bypasspermissions\b|tab\s+to\s+\w+)/i;
const TUI_USE_PERMISSIONS_TIP_RE = /\bUse\s+\/permissions\b/i;
// Status line example from JWPK Terminal 23:52:
//   "sent:23:56:06 resp:... a-nice-terminal Opus 4.7 2m:7% Working RemoteControl active"
// Heuristic: a single line containing AT LEAST 3 of these signals is the
// claude status footer — model name + percent + Working/RemoteControl.
const TUI_STATUSLINE_SIGNALS: RegExp[] = [
  /\b(Opus|Sonnet|Haiku)\s+\d/i,
  /\b\d+%/,
  /\bWorking\b/,
  /\bRemoteControl\b/i,
  /\bsent\s*:\s*\d/i,
  /\bresp\s*:\s*\d/i
];
function isClaudeStatusLine(line: string): boolean {
  let hits = 0;
  for (const sig of TUI_STATUSLINE_SIGNALS) if (sig.test(line)) hits++;
  return hits >= 3;
}

export function isClaudeTuiChrome(line: string): boolean {
  if (TUI_BOX_DRAWING_RE.test(line)) return true;
  if (TUI_HOTKEY_FOOTER_RE.test(line)) return true;
  if (TUI_SPINNER_RE.test(line)) return true;
  if (TUI_BYPASS_PERMS_RE.test(line)) return true;
  if (TUI_SHORTCUT_HINT_RE.test(line)) return true;
  if (TUI_HOOK_TIMING_RE.test(line)) return true;
  if (TUI_UNDERSCORE_CURSOR_RE.test(line)) return true;
  if (TUI_STATUS_BADGE_RE.test(line)) return true;
  if (TUI_LONG_RUN_RE.test(line)) return true;
  if (TUI_FRAGMENT_RE.test(line)) return true;
  if (TUI_USE_PERMISSIONS_TIP_RE.test(line)) return true;
  if (isClaudeStatusLine(line)) return true;
  return false;
}

function classifyLine(line: string): ClassifiedKind {
  if (isShellPromptLine(line)) return 'raw';
  if (RESIDUAL_CONTROL_RE.test(line)) return 'raw';
  if (isClaudeTuiChrome(line)) return 'raw';
  const trimmed = line.trimStart().toLowerCase();
  for (const rule of PREFIX_RULES) {
    if (trimmed.startsWith(rule.prefix)) return rule.kind;
  }
  return 'message';
}

export const classifyClaudeCode: Classifier = (buffer) => {
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
