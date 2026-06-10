/**
 * renameOnFirstCall — type `/rename <terminal handle>` into a CLI's own
 * pane the first time a fresh CLI session calls home.
 *
 * JWPK (Research Colony msg_6ed667svyn): "ALL the cli's use /rename" — every
 * agent CLI accepts a /rename slash command at its prompt. Driving it from
 * the server names the CLI's OWN session after the ANT terminal handle, so:
 *   - each CLI's session list reads as handles, not UUID soup, and
 *   - resume-by-name works everywhere, layered on the exact-uuid resume
 *     (terminal_records.cli_session_id) captured by the same hook event.
 *
 * Trigger: the cli-hook ingest calls this on a SessionStart whose session
 * UUID is a FIRST capture for the terminal (a fresh CLI session, not a
 * mid-session drift rewrite). One injection per CLI session by construction.
 *
 * Guards (every skip is silent — this is best-effort, like all capture):
 *   - auto-generated terminal names (`auto:<sessionId>`) are never injected;
 *     renaming a session to an auto tag is noise, not signal.
 *   - no tmux pane, or the pane isn't verified prompt-ready → skip. For
 *     claude_code, verifyPaneTargetState requires the prompt indicator and
 *     not-streaming, so a slow TUI boot skips cleanly and the NEXT
 *     SessionStart (next launch) retries.
 *   - the name is flattened to one line and capped — it's typed into a live
 *     prompt verbatim.
 */

import { deriveHandle } from './terminalRecordsStore';
import { baseName } from './terminalNameTag';
import { getTerminalById, type TerminalRow } from './terminalsStore';
import { twoCallSubmit, verifyPaneTargetState } from './pty-inject-bridge';

export type RenameInjectOutcome =
  | 'injected'
  | 'skipped-auto-name'
  | 'skipped-no-pane'
  | 'skipped-not-ready'
  | 'skipped-inject-failed';

export type RenameInjectDeps = {
  getTerminal: (terminalId: string) => TerminalRow | null | undefined;
  verifyPane: (terminal: TerminalRow) => 'verified' | 'stale' | 'unknown';
  submit: (pane: string, text: string, agentKind: string | null) => void;
};

const DEFAULT_DEPS: RenameInjectDeps = {
  getTerminal: (terminalId) => getTerminalById(terminalId),
  verifyPane: (terminal) => verifyPaneTargetState(terminal),
  submit: (pane, text, agentKind) => twoCallSubmit(pane, text, agentKind, () => {})
};

/** Flatten to a single prompt-safe line; cap so a pathological handle can't flood the prompt. */
export function renameCommandFor(recordName: string, recordHandle?: string | null): string | null {
  const name = baseName(recordName).replace(/[\r\n\t]+/g, ' ').trim();
  if (!recordHandle && (recordName.startsWith('auto:') || name.length === 0)) return null;
  const handle = deriveHandle({ name, handle: recordHandle ?? null });
  const flat = handle.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 80).trim();
  if (flat.length === 0) return null;
  return `/rename ${flat}`;
}

export function maybeInjectRenameOnFirstCall(
  terminalId: string,
  recordName: string,
  recordHandle?: string | null,
  deps: RenameInjectDeps = DEFAULT_DEPS
): RenameInjectOutcome {
  const command = renameCommandFor(recordName, recordHandle);
  if (!command) return 'skipped-auto-name';
  const terminal = deps.getTerminal(terminalId);
  if (!terminal?.tmux_target_pane) return 'skipped-no-pane';
  if (deps.verifyPane(terminal) !== 'verified') return 'skipped-not-ready';
  try {
    deps.submit(terminal.tmux_target_pane, command, terminal.agent_kind);
    return 'injected';
  } catch {
    return 'skipped-inject-failed';
  }
}
