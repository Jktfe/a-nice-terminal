/**
 * terminalSessionLink — B-HARDEN-sessionid-pk S2 (gated decision-doc
 * docs/b-harden-sessionid-pk-design-2026-05-15.md, RQO32 PASS; builds on
 * the RQO32-green S1 schema where the per-CLI emitter writes `pid`).
 *
 * Resolves a terminal → its CLI sessionId for the genuine edge cases the
 * cwd-join is fragile in (git-worktree, internal `cd`, detached panes,
 * >1 session sharing a cwd).
 *
 * D-MATCH (ratified): a state file matches a terminal when the state
 * file's recorded `pid` is in that terminal's PROCESS SUBTREE — i.e.
 * walking ppid UP from the state-file pid reaches the terminal's pid. We
 * REUSE fingerprintDetector's test-injectable `PsRunner` for the ps
 * lookup (the comm-only ProcessTreeFn there discards pids, so a small
 * pid-keeping ancestry walker is the only new primitive).
 *
 * D-COLLISION (ratified): if >1 state file matches, newest mtime wins.
 *
 * Fallback (ratified): no pid match → the existing cwd + newest-mtime
 * join (agentStateReader.findStateForCwd). pid stays OPTIONAL — a CLI
 * whose emitter does not (yet) write pid simply has no pid match and
 * degrades to the cwd fallback. Zero regression to the normal path.
 */

import { defaultPsRunner, type PsRunner } from './fingerprintDetector';
import {
  listSnapshots,
  findStateForCwd,
  findStateForSessionId,
  type AgentCli,
  type AgentStateSnapshot
} from './agentStateReader';
import { getTerminalById } from './terminalsStore';

const MAX_ANCESTRY_DEPTH = 32;

/**
 * Walk ppid UP from `pid`, returning [pid, ppid, ppid², …]. Cycle-safe
 * (seen-set) and depth-bounded, mirroring fingerprintDetector's walker
 * semantics; stops at pid ≤ 1.
 */
export function resolvePidAncestry(
  pid: number,
  psRunner: PsRunner = defaultPsRunner
): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  let current = pid;
  for (let depth = 0; depth < MAX_ANCESTRY_DEPTH; depth += 1) {
    if (current <= 1 || seen.has(current)) break;
    seen.add(current);
    out.push(current);
    const r = psRunner(current);
    if (!r || r.ppid <= 1) break;
    current = r.ppid;
  }
  return out;
}

export type TerminalSessionMatch = {
  sessionId: string;
  via: 'record-session' | 'pid-subtree' | 'cwd-fallback';
  snapshot: AgentStateSnapshot;
};

export type ResolveOpts = {
  /** Injected for tests; defaults to the real ps-backed walker. */
  psRunner?: PsRunner;
  /**
   * Resolved cwd for the cwd-fallback (e.g. tmux pane_current_path).
   * Omit to disable the fallback (pid-match-only).
   */
  cwd?: string;
};

/**
 * Resolve `cli`'s sessionId for a terminal identified by `terminalPid`.
 *
 * 1. pid-subtree: among state files that recorded a numeric pid, keep
 *    those whose pid-ancestry contains `terminalPid`. >1 → newest mtime
 *    (D-COLLISION). Returns via:'pid-subtree'.
 * 2. else, if opts.cwd given: cwd + newest-mtime join. via:'cwd-fallback'.
 * 3. else null.
 */
export function resolveTerminalSessionId(
  cli: AgentCli,
  terminalPid: number,
  opts: ResolveOpts = {}
): TerminalSessionMatch | null {
  const psRunner = opts.psRunner ?? defaultPsRunner;

  const pidMatches: AgentStateSnapshot[] = [];
  for (const snap of listSnapshots(cli)) {
    if (typeof snap.pid !== 'number') continue;
    const ancestry = resolvePidAncestry(snap.pid, psRunner);
    if (ancestry.includes(terminalPid)) pidMatches.push(snap);
  }
  if (pidMatches.length > 0) {
    pidMatches.sort((a, b) => b.mtimeMs - a.mtimeMs); // D-COLLISION
    const best = pidMatches[0];
    return { sessionId: best.sessionId, via: 'pid-subtree', snapshot: best };
  }

  if (typeof opts.cwd === 'string' && opts.cwd.length > 0) {
    const snap = findStateForCwd(cli, opts.cwd);
    if (snap) {
      return { sessionId: snap.sessionId, via: 'cwd-fallback', snapshot: snap };
    }
  }
  return null;
}

export function agentKindToCli(agentKind: string | null | undefined): AgentCli | null {
  switch (agentKind) {
    case 'claude':
    case 'claude-code':
    case 'claude_code':
      return 'claude-code';
    case 'codex':
    case 'codex-cli':
      return 'codex-cli';
    case 'gemini':
    case 'gemini-cli':
      return 'gemini-cli';
    case 'qwen':
    case 'qwen-cli':
      return 'qwen-cli';
    case 'pi':
      return 'pi';
    case 'copilot':
    case 'copilot-cli':
      return 'copilot-cli';
    default:
      return null;
  }
}

export function resolveTerminalRecordCliSession(
  record: { session_id: string; agent_kind: string | null },
  opts: ResolveOpts = {}
): TerminalSessionMatch | null {
  const cli = agentKindToCli(record.agent_kind);
  if (!cli) return null;

  const direct = findStateForSessionId(cli, record.session_id);
  if (direct) return { sessionId: direct.sessionId, via: 'record-session', snapshot: direct };

  const terminal = getTerminalById(record.session_id);
  if (terminal) {
    const match = resolveTerminalSessionId(cli, terminal.pid, opts);
    if (match) return match;
  }

  if (typeof opts.cwd === 'string' && opts.cwd.length > 0) {
    const snap = findStateForCwd(cli, opts.cwd);
    if (snap) return { sessionId: snap.sessionId, via: 'cwd-fallback', snapshot: snap };
  }
  return null;
}
