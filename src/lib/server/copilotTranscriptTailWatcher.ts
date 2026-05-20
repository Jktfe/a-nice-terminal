/**
 * copilotTranscriptTailWatcher — TRANSCRIPT-TAIL-COPILOT-v2 (2026-05-15).
 *
 * Discovery model: copilot stores per-sessionId dirs under
 *   ~/.copilot/session-state/<sessionId>/events.jsonl
 * with no cwd in the path. Watcher scans dirs, reads first line of each
 * events.jsonl, parses session.start.data.context.cwd, matches against
 * terminal cwd. Caches sessionId mapping per terminal once resolved.
 */

import { spawnSync } from 'node:child_process';
import { readdirSync, readSync, statSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  ingestCopilotTranscriptLine, readCwdFromCopilotSessionStartLine
} from './copilotTranscriptTail';
import { listTerminalRecords } from './terminalRecordsStore';
import { resolveTailStartOffset } from './transcriptColdBootOffset';
import { resolveTerminalRecordCliSession } from './terminalSessionLink';

const BOOT_KEY = '__antCopilotTranscriptTailBooted';
const POLL_INTERVAL_MS = 2000;
const COPILOT_KINDS = new Set(['copilot', 'copilot-cli']);
const TMUX_BIN = process.env.ANT_TMUX_BIN ?? '/opt/homebrew/bin/tmux';
const TMUX_PROBE_TIMEOUT_MS = 500;
const SESSION_STATE_DIR = join(homedir(), '.copilot', 'session-state');

const FIRST_LINE_CHUNK_BYTES = 16384;
const MAX_FIRST_LINE_BYTES = 131072;

type TailState = { jsonlPath: string; byteOffset: number; lineRemainder: string };
const tailStates = new Map<string, TailState>();

function tmuxPaneCurrentPath(pane: string): string | null {
  if (!pane) return null;
  try {
    const r = spawnSync(TMUX_BIN, ['display-message', '-p', '-t', pane, '#{pane_current_path}'], {
      encoding: 'utf8',
      timeout: TMUX_PROBE_TIMEOUT_MS,
      maxBuffer: 32 * 1024
    });
    if (r.status !== 0) return null;
    const path = (r.stdout ?? '').trim();
    return path.length > 0 ? path : null;
  } catch { return null; }
}

function firstLine(path: string): string | null {
  let fd: number | null = null;
  try {
    fd = openSync(path, 'r');
    let offset = 0;
    let acc = '';
    const chunk = Buffer.alloc(FIRST_LINE_CHUNK_BYTES);
    while (offset < MAX_FIRST_LINE_BYTES) {
      const n = readSync(fd, chunk, 0, chunk.length, offset);
      if (n === 0) break;
      const slice = chunk.subarray(0, n).toString('utf8');
      const idx = slice.indexOf('\n');
      if (idx !== -1) return acc + slice.slice(0, idx);
      acc += slice;
      offset += n;
    }
    return null;
  } catch { return null; }
  finally { if (fd !== null) try { closeSync(fd); } catch {} }
}

function listCandidateSessions(sinceMtimeMs: number): { path: string; mtimeMs: number }[] {
  let entries: string[];
  try { entries = readdirSync(SESSION_STATE_DIR); } catch { return []; }
  const out: { path: string; mtimeMs: number }[] = [];
  for (const name of entries) {
    const full = join(SESSION_STATE_DIR, name, 'events.jsonl');
    let s;
    try { s = statSync(full); } catch { continue; }
    if (s.mtimeMs <= sinceMtimeMs) continue;
    out.push({ path: full, mtimeMs: s.mtimeMs });
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out;
}

function findSessionForCwd(terminalCwd: string, sinceMtimeMs: number): string | null {
  for (const c of listCandidateSessions(sinceMtimeMs)) {
    const line = firstLine(c.path);
    if (!line) continue;
    const cwd = readCwdFromCopilotSessionStartLine(line);
    if (cwd === terminalCwd) return c.path;
  }
  return null;
}

function findSessionForSessionId(sessionId: string, sinceMtimeMs: number): string | null {
  const full = join(SESSION_STATE_DIR, sessionId, 'events.jsonl');
  try {
    const s = statSync(full);
    return s.mtimeMs > sinceMtimeMs ? full : null;
  } catch {
    return null;
  }
}

function readAppendedBytes(filePath: string, fromOffset: number): { text: string; newOffset: number } {
  let fd: number | null = null;
  try {
    const s = statSync(filePath);
    if (s.size <= fromOffset) return { text: '', newOffset: fromOffset };
    fd = openSync(filePath, 'r');
    const remaining = s.size - fromOffset;
    const buf = Buffer.alloc(remaining);
    readSync(fd, buf, 0, remaining, fromOffset);
    return { text: buf.toString('utf8'), newOffset: s.size };
  } catch { return { text: '', newOffset: fromOffset }; }
  finally { if (fd !== null) try { closeSync(fd); } catch {} }
}

export function tailOnceForTerminal(record: {
  session_id: string; agent_kind: string | null;
  tmux_target_pane: string | null; created_at_ms: number;
}): number {
  if (!record.agent_kind || !COPILOT_KINDS.has(record.agent_kind)) return 0;
  const pane = record.tmux_target_pane;
  if (!pane) return 0;
  const cwd = tmuxPaneCurrentPath(pane);
  if (!cwd) return 0;
  const cached = tailStates.get(record.session_id);
  let jsonlPath = cached?.jsonlPath ?? null;
  if (jsonlPath) {
    try { statSync(jsonlPath); }
    catch { jsonlPath = null; }
  }
  if (!jsonlPath) {
    const linked = resolveTerminalRecordCliSession(record, { cwd });
    jsonlPath = linked
      ? findSessionForSessionId(linked.sessionId, record.created_at_ms - 1)
      : null;
    if (!jsonlPath) jsonlPath = findSessionForCwd(cwd, record.created_at_ms - 1);
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
    ingested += ingestCopilotTranscriptLine(record.session_id, line);
  }
  tailStates.set(record.session_id, { jsonlPath, byteOffset: newOffset, lineRemainder });
  return ingested;
}

export function tailAllOnce(): number {
  let total = 0;
  for (const r of listTerminalRecords()) total += tailOnceForTerminal(r);
  return total;
}

export function ensureCopilotTranscriptTailWatcherBooted(): void {
  const g = globalThis as unknown as Record<string, boolean | undefined>;
  if (g[BOOT_KEY]) return;
  g[BOOT_KEY] = true;
  setInterval(() => { try { tailAllOnce(); } catch {} },
    POLL_INTERVAL_MS).unref?.();
}

export function _resetCopilotTranscriptTailStateForTests(): void { tailStates.clear(); }

export const _internals = {
  tmuxPaneCurrentPath, listCandidateSessions, firstLine, findSessionForCwd,
  findSessionForSessionId, readAppendedBytes, tailStates, COPILOT_KINDS, POLL_INTERVAL_MS
};
