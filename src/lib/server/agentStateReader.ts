/**
 * agentStateReader — LIFT from v3 src/fingerprint/agent-state-reader.ts
 * (2026-05-15 AGENT-STATE-READER slice). Reads per-session state files
 * written by hook-based status-line systems for each Tier-1 CLI.
 *
 * State file layout: ~/.ant/state/<cli>/<sessionId>.json
 *
 * Scope of this lift (minimal v1):
 *   - AgentStateSnapshot type (inline; not coupled to claude2's
 *     V3-LIFT-2 agent-status.ts AgentStatus shape).
 *   - listSnapshots(cli) — list all state files for a CLI.
 *   - findStateForSessionId(cli, sessionId) — direct file lookup.
 *   - findStateForCwd(cli, cwd) — match by exact cwd.
 *   - findStateForCwdBasename(cli, basename) — match by cwd basename.
 *   - mtime cache so repeat reads of unchanged files are free.
 *
 * Deferred (V3-LIFT-2/3 owns AgentStatus shape):
 *   - applyStateToStatus / readMergedAgentState — depend on the full
 *     AgentStatus type which claude2 will extend in agent-status.ts.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

export type AgentCli =
  | 'claude-code'
  | 'codex-cli'
  | 'gemini-cli'
  | 'qwen-cli'
  | 'pi'
  | 'copilot-cli';

export type AgentStateLabel = string;
export type AgentMenuKind = string;

export interface AgentStateSnapshot {
  sessionId: string;
  cli: AgentCli;
  stateLabel?: AgentStateLabel;
  menuKind?: AgentMenuKind | null;
  timestamps: { sentAt?: number; respAt?: number; editAt?: number };
  sessionStartedAt?: number;
  cwd?: string;
  projectDir?: string;
  permissionMode?: string;
  remoteControlActive?: boolean;
  /**
   * B-HARDEN-sessionid-pk S1 (D-SCHEMA, RQO32-ratified): optional pid the
   * emitter records so the terminal→sessionId resolver (S2) can match a
   * state file to a terminal via the ppid subtree. OPTIONAL/back-compat —
   * undefined for any CLI/emitter that does not (yet) write it.
   */
  pid?: number;
  raw: Record<string, unknown>;
  mtimeMs: number;
  filePath: string;
}

function candidateDirs(cli: AgentCli): string[] {
  const home = process.env.HOME || homedir();
  const dirs = [join(home, '.ant', 'state', cli)];
  // CLI-native state dirs (where the CLI's own hooks/daemons write).
  // ANT reads these as a fallback so we don't depend on a separate hook
  // bridge always being wired up — works out-of-the-box for new CLIs and
  // for fresh installs where ~/.ant/state/<cli>/ hasn't been seeded yet.
  // The shape varies per CLI but readSnapshot is tolerant; only the keys
  // we recognise (state, cwd, project_dir, pid, last_*_ts, session_start)
  // are surfaced — the rest stays in `raw` for callers that want it.
  switch (cli) {
    case 'claude-code':
      dirs.push(join(home, '.claude', 'state'));
      break;
  }
  return dirs;
}

const fileCache = new Map<string, { snap: AgentStateSnapshot; mtimeMs: number }>();

function parseIso(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

function readSnapshot(filePath: string, cli: AgentCli): AgentStateSnapshot | null {
  let mtimeMs = 0;
  try {
    mtimeMs = statSync(filePath).mtimeMs;
  } catch {
    fileCache.delete(filePath);
    return null;
  }
  const cached = fileCache.get(filePath);
  if (cached && cached.mtimeMs === mtimeMs) return cached.snap;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
  const sessionId = basename(filePath, '.json');
  const stateLabel = (raw.state as AgentStateLabel | undefined) ?? undefined;
  const menuKind = (raw.menu_kind as AgentMenuKind | null | undefined) ?? null;
  const snap: AgentStateSnapshot = {
    sessionId, cli, stateLabel, menuKind,
    timestamps: {
      sentAt: parseIso(raw.last_user_ts),
      respAt: parseIso(raw.last_resp_ts),
      editAt: parseIso(raw.last_edit_ts)
    },
    sessionStartedAt: parseIso(raw.session_start),
    cwd: typeof raw.cwd === 'string' ? raw.cwd : undefined,
    projectDir:
      typeof raw.project_dir === 'string' && raw.project_dir.length > 0
        ? raw.project_dir : undefined,
    permissionMode:
      typeof raw.permission_mode === 'string' ? raw.permission_mode : undefined,
    remoteControlActive:
      typeof raw.remote_control_active === 'boolean'
        ? raw.remote_control_active : undefined,
    pid:
      typeof raw.pid === 'number' && Number.isFinite(raw.pid)
        ? raw.pid : undefined,
    raw, mtimeMs, filePath
  };
  fileCache.set(filePath, { snap, mtimeMs });
  return snap;
}

export function listSnapshots(cli: AgentCli): AgentStateSnapshot[] {
  const out: AgentStateSnapshot[] = [];
  for (const dir of candidateDirs(cli)) {
    if (!existsSync(dir)) continue;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { continue; }
    for (const name of entries) {
      if (!name.endsWith('.json')) continue;
      const snap = readSnapshot(join(dir, name), cli);
      if (snap) out.push(snap);
    }
  }
  return out;
}

export function findStateForSessionId(
  cli: AgentCli, sessionId: string
): AgentStateSnapshot | null {
  for (const dir of candidateDirs(cli)) {
    const filePath = join(dir, `${sessionId}.json`);
    if (existsSync(filePath)) {
      const snap = readSnapshot(filePath, cli);
      if (snap) return snap;
    }
  }
  return null;
}

export function findStateForCwd(cli: AgentCli, cwd: string): AgentStateSnapshot | null {
  const matches = listSnapshots(cli).filter((s) => s.cwd === cwd);
  if (matches.length === 0) return null;
  matches.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return matches[0];
}

export function findStateForCwdBasename(
  cli: AgentCli, cwdBasename: string
): AgentStateSnapshot | null {
  const matches = listSnapshots(cli).filter(
    (s) => s.cwd && basename(s.cwd) === cwdBasename
  );
  if (matches.length === 0) return null;
  matches.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return matches[0];
}

export function _clearStateReaderCache(): void {
  fileCache.clear();
}

export {
  STATE_FRESHNESS_LIVE_MS,
  classifyStateFreshness,
  type StateFreshness
} from '../shared/state-freshness';
