/**
 * Shell-prompt + input-echo demotion helpers per coordinator
 * prompt-echo-fidelity polish slice (T2-CHUNK-NORM follow-up
 * 2026-05-14). Lines that look like shell prompts pollute the CHAT
 * view; demoting them to kind='raw' keeps them visible in ANT view
 * for audit while excluded from the message-kind filter Chat consumes.
 */

// Bare prompt symbols on their own line: zsh %, sh/bash $, generic >.
const BARE_PROMPT_RE = /^\s*[%$>#]\s*$/;
// Common compound prompts with user/host/cwd ending in % or $ or #.
//   user@host:~/path$
//   user@host ~/path %
//   path$ (cwd-prompt)
const COMPOUND_PROMPT_RE = /^[\w.\-]+(?:@[\w.\-]+)?[: ]+[\w./~\-]+\s*[%$#>]\s*$/;
// Continuation prompts (heredoc, multi-line shell): `> ` followed by NOTHING
// — distinct from a chat `> reasoning` line per codex classifier (which has
// content after the `>`).
const CONT_PROMPT_RE = /^\s*[>?]\s*$/;
// delta-5 (2026-05-14, JWPK dogfood): compound prompt with INLINED command
// echo back, e.g. `user@host:~/path % echo hello`. The command portion
// is what JWPK actually typed; the prompt prefix is shell echo. Treat the
// whole line as raw since the command will re-appear in the executed
// output. Only match when there's at least one non-prompt char after the
// prompt marker.
const COMPOUND_PROMPT_INLINE_CMD_RE = /^[\w.\-]+(?:@[\w.\-]+)?[: ]+[\w./~\-]+\s*[%$#>]\s+\S+/;
// delta-5b + delta-6: any line starting with `<word>@<word>` is shell-
// prompt territory. JWPK's default zsh prompt is `user@host` space-
// separated (no colon), and cursor-redraw chunks emit it doubled/tripled
// or bare-EOL. Demoting ALL such lines to raw is safer than trying to
// detect every variant — real chat content almost never starts with
// `user@host` at the beginning of a line.
const COMPOUND_PROMPT_USER_HOST_RE = /^[\w.\-]+@[\w.\-]+(?:\s|$)/;
// delta-5: tmux pane status bar lines, e.g. `t_abc123:zsh*    ...padding`.
// Sometimes leaks with a leading `[` (partial CSI residue) — match either
// form. The session prefix `t_<alnum>:` followed by program name + asterisk
// (active marker) is tmux's status-line render leaking into the PTY stream.
const TMUX_STATUS_BAR_RE = /^\[?t_[a-z0-9]+:[a-z]+\*?\s/;

export function isShellPromptLine(line: string): boolean {
  return BARE_PROMPT_RE.test(line)
    || COMPOUND_PROMPT_RE.test(line)
    || CONT_PROMPT_RE.test(line)
    || COMPOUND_PROMPT_INLINE_CMD_RE.test(line)
    || COMPOUND_PROMPT_USER_HOST_RE.test(line)
    || TMUX_STATUS_BAR_RE.test(line);
}
