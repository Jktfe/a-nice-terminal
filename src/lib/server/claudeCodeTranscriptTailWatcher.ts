/**
 * claudeCodeTranscriptTailWatcher — TRANSCRIPT-TAIL-CLAUDE-v2 per JWPK
 * pivot (2026-05-15). Live integration of v1 mapper.
 *
 * Every POLL_INTERVAL_MS:
 *   1. List terminal_records with agentKind in ['claude','claude-code'].
 *   2. For each: resolve cwd via `tmux display-message -p '#{pane_current_path}' -t <pane>`.
 *   3. Build path `~/.claude/projects/<encodedCwd>/`.
 *   4. Find newest *.jsonl whose mtime > terminal.created_at_ms.
 *   5. Track per-terminal byte offset; on poll, read appended bytes, split
 *      lines, call ingestTranscriptLine for each.
 *
 * Boot-once via globalThis flag (banked feedback_globalthis_pattern) so
 * dev HMR / multiple imports don't double-subscribe.
 */

import { spawnSync } from 'node:child_process';
import { readdirSync, readSync, statSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  encodedCwdSegmentFor,
  ingestTranscriptLine
} from './claudeCodeTranscriptTail';
import { listTerminalRecords } from './terminalRecordsStore';
import { resolveTailStartOffset } from './transcriptColdBootOffset';
import { resolveTerminalRecordCliSession } from './terminalSessionLink';

const BOOT_KEY = '__antTranscriptTailBooted';
const POLL_INTERVAL_MS = 2000;
const CLAUDE_KINDS = new Set(['claude', 'claude-code', 'claude_code']);
const TMUX_BIN = process.env.ANT_TMUX_BIN ?? '/opt/homebrew/bin/tmux';
const TMUX_PROBE_TIMEOUT_MS = 500;
const PROJECTS_DIR = join(homedir(), '.claude', 'projects');

type TailState = {
  jsonlPath: string;
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

function countJsonlsNewerThan(dirPath: string, sinceMtimeMs: number): number {
  let entries: string[];
  try { entries = readdirSync(dirPath); } catch { return 0; }
  let count = 0;
  for (const name of entries) {
    if (!name.endsWith('.jsonl')) continue;
    try {
      if (statSync(join(dirPath, name)).mtimeMs > sinceMtimeMs) count += 1;
    } catch { /* skip */ }
  }
  return count;
}

function findNewestJsonl(dirPath: string, sinceMtimeMs: number): string | null {
  let entries: string[];
  try { entries = readdirSync(dirPath); } catch { return null; }
  let bestPath: string | null = null;
  let bestMtime = -Infinity;
  for (const name of entries) {
    if (!name.endsWith('.jsonl')) continue;
    const full = join(dirPath, name);
    let s;
    try { s = statSync(full); } catch { continue; }
    if (s.mtimeMs <= sinceMtimeMs) continue;
    if (s.mtimeMs > bestMtime) {
      bestMtime = s.mtimeMs;
      bestPath = full;
    }
  }
  return bestPath;
}

function findJsonlForSessionId(dirPath: string, sessionId: string, sinceMtimeMs: number): string | null {
  const direct = join(dirPath, `${sessionId}.jsonl`);
  try {
    const s = statSync(direct);
    if (s.mtimeMs > sinceMtimeMs) return direct;
  } catch { /* fall through to scan */ }
  let entries: string[];
  try { entries = readdirSync(dirPath); } catch { return null; }
  for (const name of entries) {
    if (name !== `${sessionId}.jsonl`) continue;
    const full = join(dirPath, name);
    try {
      if (statSync(full).mtimeMs > sinceMtimeMs) return full;
    } catch { /* skip */ }
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
  if (!record.agent_kind || !CLAUDE_KINDS.has(record.agent_kind)) return 0;
  const pane = record.tmux_target_pane;
  if (!pane) return 0;
  const cwd = tmuxPaneCurrentPath(pane);
  if (!cwd) return 0;
  const projectDir = join(PROJECTS_DIR, encodedCwdSegmentFor(cwd));
  const cached = tailStates.get(record.session_id);
  let jsonlPath = cached?.jsonlPath ?? null;
  // Re-resolve via the PID-disambiguated link if we can; only fall back
  // to "newest jsonl in this project dir" when there's exactly ONE
  // candidate jsonl. With multiple jsonls (two claude terminals in the
  // same cwd) the newest-wins fallback misattributes events to whichever
  // terminal happens to be polled — cross-contamination bug 2026-05-21.
  // No data is better than wrong data; the ANT view just stays empty
  // until a PID-state file exists to disambiguate.
  const linked = resolveTerminalRecordCliSession(record, { cwd });
  const linkedJsonl = linked
    ? findJsonlForSessionId(projectDir, linked.sessionId, record.created_at_ms - 1)
    : null;
  if (linkedJsonl) {
    jsonlPath = linkedJsonl;
  } else if (!cached) {
    // First-attach path with no link: only tail if disambiguation is
    // unambiguous (exactly one candidate jsonl in the project dir).
    const candidates = countJsonlsNewerThan(projectDir, record.created_at_ms - 1);
    if (candidates === 1) {
      jsonlPath = findNewestJsonl(projectDir, record.created_at_ms - 1);
    }
  }
  if (!jsonlPath) return 0;
  const fromOffset = resolveTailStartOffset(cached, jsonlPath);
  const { text, newOffset } = readAppendedBytes(jsonlPath, fromOffset);
  const remainder = (cached?.lineRemainder ?? '') + text;
  const lines = remainder.split('\n');
  const lineRemainder = lines.pop() ?? '';
  let ingested = 0;
  for (const line of lines) {
    if (line.length === 0) continue;
    ingested += ingestTranscriptLine(record.session_id, line);
  }
  tailStates.set(record.session_id, { jsonlPath, byteOffset: newOffset, lineRemainder });
  return ingested;
}

export function tailAllOnce(): number {
  let total = 0;
  for (const r of listTerminalRecords()) total += tailOnceForTerminal(r);
  return total;
}

export function ensureTranscriptTailWatcherBooted(): void {
  const g = globalThis as unknown as Record<string, boolean | undefined>;
  if (g[BOOT_KEY]) return;
  g[BOOT_KEY] = true;
  setInterval(() => {
    try { tailAllOnce(); } catch { /* poll best-effort */ }
  }, POLL_INTERVAL_MS).unref?.();
}

export function _resetTranscriptTailStateForTests(): void {
  tailStates.clear();
}

export const _internals = {
  tmuxPaneCurrentPath, findNewestJsonl, findJsonlForSessionId, readAppendedBytes, tailStates,
  CLAUDE_KINDS, POLL_INTERVAL_MS
};
