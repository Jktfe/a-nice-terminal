/**
 * stripAnsi — ANSI / control-char scrubber for live PTY screen chunks.
 * Runs in terminalRunEventsBoot before BOTH Layer A and Layer B dispatch
 * per coordinator T2c-impl-2-codex delta-3+4 live-path finding (2026-05-14).
 *
 * Covers (delta-5 broader sweep):
 *  - CSI sequences (ESC [ params letter) AND 8-bit C1 (\x9b … letter)
 *  - OSC strings (ESC ] … BEL/ST) AND 8-bit (\x9d … BEL)
 *  - Charset/keypad/region single-char ESC (broad catch-all)
 *  - C0 controls except `\n`/`\t`
 *  - Standalone CR (PTY line ending)
 *  - 8-bit C1 controls 0x80–0x9f
 */

const CSI_RE = /(?:\x1b\[|\x9b)[0-9;?]*[A-Za-z]/g;
const OSC_RE = /(?:\x1b\]|\x9d)[^\x07\x1b]*(?:\x07|\x1b\\)/g;
const DCS_RE = /(?:\x1bP|\x90)[\s\S]*?(?:\x1b\\|\x9c)/g;
// Charset designator: ESC ( | ) | * | + followed by one final byte.
const CHARSET_RE = /\x1b[\(\)\*\+][\x20-\x7e]/g;
// Catch-all single-byte ESC + 1 byte. Runs AFTER all multi-byte sequence
// extractors (CSI/OSC/DCS/CHARSET) so by this point any remaining ESC
// must be a stray single-byte sequence. Permissive on the second byte
// since this is the final ESC sweep — false positives are preferable to
// leaving control bytes through to the classifier.
const SINGLE_RE = /\x1b[\x20-\x7e]/g;
// Lone ESC at end-of-chunk (multi-byte sequence split across chunks); drop.
const LONE_ESC_RE = /\x1b/g;
const CONTROLS_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g;
// zsh emits a reverse-video % at end of an unterminated last line.
const ZSH_PERCENT_RE = /%\s*$/;

export function stripAnsi(input: string): string {
  if (input.length === 0) return input;
  return input
    .replace(DCS_RE, '')
    .replace(OSC_RE, '')
    .replace(CSI_RE, '')
    .replace(CHARSET_RE, '')
    .replace(SINGLE_RE, '')
    .replace(LONE_ESC_RE, '')
    .replace(CONTROLS_RE, '')
    .replace(/\r/g, '');
}

/** Boot-subscriber chunk normaliser per coordinator T2c-impl-2-codex
 *  delta-3 finding: strip ANSI + zsh-% marker + trailing screen-clear
 *  whitespace before BOTH Layer A and Layer B dispatch see the buffer. */
export function normalizeForClassifier(input: string): string {
  if (input.length === 0) return input;
  return stripAnsi(input).replace(ZSH_PERCENT_RE, '').replace(/\s+$/, (tail) =>
    // preserve a SINGLE trailing newline if there was one, drop padding/spaces.
    tail.includes('\n') ? '\n' : ''
  );
}
