/**
 * codexTranscriptTailWatcher — TRANSCRIPT-TAIL-CODEX-v2 per JWPK pivot
 * (2026-05-15). Live integration of codex v1 mapper.
 *
 * Every POLL_INTERVAL_MS:
 *   1. List terminal_records with agentKind in ['codex','codex-cli'].
 *   2. For each: resolve cwd via tmux pane_current_path.
 *   3. Scan ~/.codex/archived_sessions/rollout-*.jsonl by mtime > terminal
 *      created_at_ms.
 *   4. For each candidate (newest first), read first line and call
 *      readCwdFromSessionMetaLine — if it matches the terminal cwd, this
 *      is the rollout for that terminal.
 *   5. Track per-terminal byte offset; on poll, read appended bytes,
 *      split lines, ingest via codex v1.
 *
 * Boot-once via globalThis flag.
 */

import { spawnSync } from 'node:child_process';
import { readdirSync, readSync, statSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  ingestCodexTranscriptLine,
  readCwdFromSessionMetaLine
} from './codexTranscriptTail';
import { listTerminalRecords } from './terminalRecordsStore';
import { resolveTailStartOffset } from './transcriptColdBootOffset';
import { resolveTerminalRecordCliSession } from './terminalSessionLink';

const BOOT_KEY = '__antCodexTranscriptTailBooted';
const POLL_INTERVAL_MS = 2000;
const CODEX_KINDS = new Set(['codex', 'codex-cli']);
const TMUX_BIN = process.env.ANT_TMUX_BIN ?? '/opt/homebrew/bin/tmux';
const TMUX_PROBE_TIMEOUT_MS = 500;
// FINDING-2 P0 (2026-05-15): codex writes LIVE rollouts to a date-
// partitioned tree `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`.
// `~/.codex/archived_sessions/` only holds OLD finished sessions (newest
// there was stale by a week). The watcher scanned only the archived dir,
// so codex transcript-tail NEVER engaged for a live terminal → ANT view
// empty for the whole codex CLI class. We now scan BOTH: the live
// date-partitioned tree (recursive, recent days) AND the flat archived
// dir (legacy fallback).
const SESSIONS_DIR = join(homedir(), '.codex', 'sessions');
const ARCHIVED_DIR = join(homedir(), '.codex', 'archived_sessions');

type TailState = {
  rolloutPath: string;
  byteOffset: number;
  lineRemainder: string;
};
const tailStates = new Map<string, TailState>();

function tmuxPaneCurrentPath(pane: string): string | null {
  if (!pane) return null;
  try {
    const r = spawnSync(TMUX_BIN, [
      'display-message', '-p', '-t', pane, '#{pane_current_path}'
    ], { encoding: 'utf8', timeout: TMUX_PROBE_TIMEOUT_MS, maxBuffer: 32 * 1024 });
    if (r.status !== 0) return null;
    const path = (r.stdout ?? '').trim();
    return path.length > 0 ? path : null;
  } catch { return null; }
}

function collectRolloutsFlat(dir: string, sinceMtimeMs: number, out: { path: string; mtimeMs: number }[]): void {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    if (!name.startsWith('rollout-') || !name.endsWith('.jsonl')) continue;
    const full = join(dir, name);
    let s;
    try { s = statSync(full); } catch { continue; }
    if (s.mtimeMs <= sinceMtimeMs) continue;
    out.push({ path: full, mtimeMs: s.mtimeMs });
  }
}

// Walk ~/.codex/sessions/<YYYY>/<MM>/<DD>/ — bounded recursion (depth 3,
// dirs are date components) so we never scan unrelated trees. Only dirs
// whose own mtime could contain a fresh rollout matter, but date dirs
// are cheap; readdir + a name-prefix check keeps this tight.
function collectRolloutsRecursive(root: string, sinceMtimeMs: number, out: { path: string; mtimeMs: number }[], depth = 0): void {
  if (depth > 3) return;
  let entries: string[];
  try { entries = readdirSync(root, { withFileTypes: true }) as unknown as string[]; }
  catch { return; }
  for (const ent of entries as unknown as { name: string; isDirectory: () => boolean; isFile: () => boolean }[]) {
    const full = join(root, ent.name);
    if (ent.isDirectory()) {
      collectRolloutsRecursive(full, sinceMtimeMs, out, depth + 1);
    } else if (ent.isFile() && ent.name.startsWith('rollout-') && ent.name.endsWith('.jsonl')) {
      let s;
      try { s = statSync(full); } catch { continue; }
      if (s.mtimeMs <= sinceMtimeMs) continue;
      out.push({ path: full, mtimeMs: s.mtimeMs });
    }
  }
}

function listCandidateRollouts(sinceMtimeMs: number): { path: string; mtimeMs: number }[] {
  const out: { path: string; mtimeMs: number }[] = [];
  // LIVE: date-partitioned tree (codex's current write path).
  collectRolloutsRecursive(SESSIONS_DIR, sinceMtimeMs, out);
  // LEGACY: flat archived dir (older finished sessions).
  collectRolloutsFlat(ARCHIVED_DIR, sinceMtimeMs, out);
  out.sort((a, b) => b.mtimeMs - a.mtimeMs); // newest first
  return out;
}

// CODEX-v2 delta (2026-05-15): real codex session_meta lines are ~13KB
// (full base_instructions inline). Read in chunks until \n found or
// bounded MAX_FIRST_LINE_BYTES — bounded so a malformed rollout cannot
// OOM the watcher. Returns null when no newline lands in the window
// (caller skips that candidate).
const FIRST_LINE_CHUNK_BYTES = 16384;
const MAX_FIRST_LINE_BYTES = 131072; // 128 KB ceiling

function firstLine(path: string): string | null {
  let fd: number | null = null;
  try {
    fd = openSync(path, 'r');
    let offset = 0;
    let acc = '';
    const chunk = Buffer.alloc(FIRST_LINE_CHUNK_BYTES);
    while (offset < MAX_FIRST_LINE_BYTES) {
      const n = readSync(fd, chunk, 0, chunk.length, offset);
      if (n === 0) break; // EOF before newline
      const slice = chunk.subarray(0, n).toString('utf8');
      const idx = slice.indexOf('\n');
      if (idx !== -1) return acc + slice.slice(0, idx);
      acc += slice;
      offset += n;
    }
    return null;
  } catch { return null; }
  finally { if (fd !== null) try { closeSync(fd); } catch { /* ignore */ } }
}

function findRolloutForCwd(terminalCwd: string, sinceMtimeMs: number): string | null {
  for (const c of listCandidateRollouts(sinceMtimeMs)) {
    const line = firstLine(c.path);
    if (!line) continue;
    const cwd = readCwdFromSessionMetaLine(line);
    if (cwd === terminalCwd) return c.path;
  }
  return null;
}

function rolloutBasenameMatchesSessionId(filePath: string, sessionId: string): boolean {
  const name = filePath.split('/').pop() ?? '';
  return name === `${sessionId}.jsonl`
    || name === `rollout-${sessionId}.jsonl`
    || name === `session-${sessionId}.jsonl`;
}

function findRolloutForSessionId(sessionId: string, sinceMtimeMs: number): string | null {
  for (const c of listCandidateRollouts(sinceMtimeMs)) {
    if (rolloutBasenameMatchesSessionId(c.path, sessionId)) return c.path;
  }
  return null;
}

function readAppendedBytes(filePath: string, fromOffset: number): {
  text: string;
  newOffset: number;
} {
  let fd: number | null = null;
  try {
    const s = statSync(filePath);
    if (s.size <= fromOffset) return { text: '', newOffset: fromOffset };
    fd = openSync(filePath, 'r');
    const remaining = s.size - fromOffset;
    const buf = Buffer.alloc(remaining);
    readSync(fd, buf, 0, remaining, fromOffset);
    return { text: buf.toString('utf8'), newOffset: s.size };
  } catch {
    return { text: '', newOffset: fromOffset };
  } finally {
    if (fd !== null) try { closeSync(fd); } catch { /* ignore */ }
  }
}

export function tailOnceForTerminal(record: {
  session_id: string;
  agent_kind: string | null;
  tmux_target_pane: string | null;
  created_at_ms: number;
}): number {
  if (!record.agent_kind || !CODEX_KINDS.has(record.agent_kind)) return 0;
  const pane = record.tmux_target_pane;
  if (!pane) return 0;
  const cwd = tmuxPaneCurrentPath(pane);
  if (!cwd) return 0;
  const cached = tailStates.get(record.session_id);
  let rolloutPath = cached?.rolloutPath ?? null;
  // Re-resolve when no cache OR file no longer exists. Codex sessions are
  // append-only so once we lock onto a rollout, we don't need to switch.
  if (rolloutPath) {
    try { statSync(rolloutPath); }
    catch { rolloutPath = null; }
  }
  if (!rolloutPath) {
    const linked = resolveTerminalRecordCliSession(record, { cwd });
    rolloutPath = linked
      ? findRolloutForSessionId(linked.sessionId, record.created_at_ms - 1)
      : null;
    if (!rolloutPath) rolloutPath = findRolloutForCwd(cwd, record.created_at_ms - 1);
  }
  if (!rolloutPath) return 0;
  const fromOffset = resolveTailStartOffset(
    cached ? { jsonlPath: cached.rolloutPath, byteOffset: cached.byteOffset } : undefined,
    rolloutPath
  );
  const { text, newOffset } = readAppendedBytes(rolloutPath, fromOffset);
  const remainder = (cached?.lineRemainder ?? '') + text;
  const lines = remainder.split('\n');
  const lineRemainder = lines.pop() ?? '';
  let ingested = 0;
  for (const line of lines) {
    if (line.length === 0) continue;
    ingested += ingestCodexTranscriptLine(record.session_id, line);
  }
  tailStates.set(record.session_id, { rolloutPath, byteOffset: newOffset, lineRemainder });
  return ingested;
}

export function tailAllOnce(): number {
  let total = 0;
  for (const r of listTerminalRecords()) total += tailOnceForTerminal(r);
  return total;
}

export function ensureCodexTranscriptTailWatcherBooted(): void {
  const g = globalThis as unknown as Record<string, boolean | undefined>;
  if (g[BOOT_KEY]) return;
  g[BOOT_KEY] = true;
  setInterval(() => {
    try { tailAllOnce(); } catch { /* poll best-effort */ }
  }, POLL_INTERVAL_MS).unref?.();
}

export function _resetCodexTranscriptTailStateForTests(): void {
  tailStates.clear();
}

export const _internals = {
  tmuxPaneCurrentPath, listCandidateRollouts, firstLine, findRolloutForCwd,
  findRolloutForSessionId, rolloutBasenameMatchesSessionId,
  readAppendedBytes, tailStates, CODEX_KINDS, POLL_INTERVAL_MS
};
