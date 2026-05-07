// Cross-CLI reader for the per-session state files written by the
// hook-based status-line systems documented in `docs/LESSONS.md` § 1.12
// and `docs/agent-setup/state-schema.json`.
//
// Each Tier-1 CLI writes a small JSON file per session to one of:
//   ~/.ant/state/<cli>/<session_id>.json     (unified, preferred)
//   ~/.claude/state/<session_id>.json        (legacy Claude Code path)
//
// The driver's `detectStatus(recentLines)` is synchronous and doesn't carry
// pane/session context. We resolve a state file by matching the parsed
// `cwd` basename from the status-line scrape against the `cwd` field in
// each known state file, taking the most recently modified match.
//
// Files are tiny (~300 bytes) so we read on demand with an mtime cache.
// fs.watch is intentionally NOT used in v1 — it's a future optimisation
// once we measure call rate.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type {
  AgentMenuKind,
  AgentStateLabel,
  AgentStatus,
} from '../lib/shared/agent-status.js';
import { legacyStateFromLabel } from '../lib/shared/agent-status.js';

export type AgentCli =
  | 'claude-code'
  | 'codex-cli'
  | 'gemini-cli'
  | 'qwen-cli'
  | 'pi'
  | 'copilot-cli';

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
  raw: Record<string, unknown>;
  mtimeMs: number;
  filePath: string;
}

// Candidate directories per CLI. Order matters: unified first, legacy second.
function candidateDirs(cli: AgentCli): string[] {
  const home = homedir();
  const unified = join(home, '.ant', 'state', cli);
  switch (cli) {
    case 'claude-code':
      return [unified, join(home, '.claude', 'state')];
    case 'codex-cli':
      return [unified, join(home, '.codex', 'state')];
    case 'gemini-cli':
      return [unified, join(home, '.gemini', 'state')];
    case 'qwen-cli':
      return [unified, join(home, '.qwen', 'state')];
    case 'pi':
      return [unified, join(home, '.pi', 'state')];
    case 'copilot-cli':
      return [unified, join(home, '.copilot', 'state')];
  }
}

// Cache: filePath → { snap, mtimeMs }. Re-reads only when mtime advances.
const fileCache = new Map<string, { snap: AgentStateSnapshot; mtimeMs: number }>();

function parseIso(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

function readSnapshot(
  filePath: string,
  cli: AgentCli
): AgentStateSnapshot | null {
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
    sessionId,
    cli,
    stateLabel,
    menuKind,
    timestamps: {
      sentAt: parseIso(raw.last_user_ts),
      respAt: parseIso(raw.last_resp_ts),
      editAt: parseIso(raw.last_edit_ts),
    },
    sessionStartedAt: parseIso(raw.session_start),
    cwd: typeof raw.cwd === 'string' ? raw.cwd : undefined,
    projectDir:
      typeof raw.project_dir === 'string' && raw.project_dir.length > 0
        ? raw.project_dir
        : undefined,
    permissionMode:
      typeof raw.permission_mode === 'string' ? raw.permission_mode : undefined,
    remoteControlActive:
      typeof raw.remote_control_active === 'boolean'
        ? raw.remote_control_active
        : undefined,
    raw,
    mtimeMs,
    filePath,
  };

  fileCache.set(filePath, { snap, mtimeMs });
  return snap;
}

function listSnapshots(cli: AgentCli): AgentStateSnapshot[] {
  const out: AgentStateSnapshot[] = [];
  for (const dir of candidateDirs(cli)) {
    if (!existsSync(dir)) continue;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!name.endsWith('.json')) continue;
      const snap = readSnapshot(join(dir, name), cli);
      if (snap) out.push(snap);
    }
  }
  return out;
}

export function findStateForSessionId(
  cli: AgentCli,
  sessionId: string
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

// Match by basename of the cwd. Disambiguates by most recent mtime when
// multiple sessions share a basename (e.g. two Claude Code sessions in the
// same project root).
export function findStateForCwdBasename(
  cli: AgentCli,
  cwdBasename: string
): AgentStateSnapshot | null {
  const matches = listSnapshots(cli).filter(
    (s) => s.cwd && basename(s.cwd) === cwdBasename
  );
  if (matches.length === 0) return null;
  matches.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return matches[0];
}

// Match by full cwd. Preferred when the driver knows the absolute path.
export function findStateForCwd(
  cli: AgentCli,
  cwd: string
): AgentStateSnapshot | null {
  const matches = listSnapshots(cli).filter((s) => s.cwd === cwd);
  if (matches.length === 0) return null;
  matches.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return matches[0];
}

// Merge a state-file snapshot onto a base AgentStatus. State-file fields
// take precedence on overlap because the file is authoritative; the base
// supplies model/context fallbacks from the live screen scrape.
export function applyStateToStatus(
  base: AgentStatus,
  snap: AgentStateSnapshot
): AgentStatus {
  const merged: AgentStatus = { ...base };
  if (snap.stateLabel) {
    merged.stateLabel = snap.stateLabel;
    merged.state = legacyStateFromLabel(snap.stateLabel);
  }
  if (snap.menuKind !== undefined) merged.menuKind = snap.menuKind;
  if (snap.cwd) merged.cwd = snap.cwd;
  if (snap.permissionMode !== undefined)
    merged.permissionMode = snap.permissionMode;
  if (snap.remoteControlActive !== undefined)
    merged.remoteControlActive = snap.remoteControlActive;
  if (snap.timestamps) {
    merged.timestamps = { ...(merged.timestamps ?? {}), ...snap.timestamps };
  }
  if (snap.sessionStartedAt !== undefined) {
    merged.sessionStartedAt = snap.sessionStartedAt;
    merged.sessionDurationMs = Date.now() - snap.sessionStartedAt;
  }
  return merged;
}

// Driver-facing one-shot: resolve the most relevant snapshot for `cli`
// using whichever identifier the driver could derive, then merge it onto
// `base`. Lookup precedence: sessionId → cwd → cwdBasename. Returns
// `base` unchanged when nothing is found, so call sites collapse to a
// single line that's safe to run on every detectStatus tick.
export function readMergedAgentState(
  cli: AgentCli,
  identifier: { sessionId?: string; cwd?: string; cwdBasename?: string },
  base: AgentStatus
): AgentStatus {
  let snap: AgentStateSnapshot | null = null;
  if (identifier.sessionId) {
    snap = findStateForSessionId(cli, identifier.sessionId);
  }
  if (!snap && identifier.cwd) {
    snap = findStateForCwd(cli, identifier.cwd);
  }
  if (!snap && identifier.cwdBasename) {
    snap = findStateForCwdBasename(cli, identifier.cwdBasename);
  }
  return snap ? applyStateToStatus(base, snap) : base;
}

// Test/diagnostic helper to clear the mtime cache.
export function _clearStateReaderCache(): void {
  fileCache.clear();
}
