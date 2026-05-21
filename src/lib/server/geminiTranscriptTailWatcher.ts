/**
 * geminiTranscriptTailWatcher — TRANSCRIPT-TAIL-GEMINI-v2 (2026-05-15).
 *
 * 2s poll: agentKind=gemini/gemini-cli terminal_records → tmux
 * pane_current_path → ~/.gemini/tmp/<lowercase-basename-of-cwd>/chats/
 * → newest session-*.jsonl with mtime > terminal.created_at_ms → tail.
 */

import { spawnSync } from 'node:child_process';
import { readdirSync, readSync, statSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  ingestGeminiTranscriptLine, geminiProjectDirNameForCwd
} from './geminiTranscriptTail';
import { listTerminalRecords } from './terminalRecordsStore';
import { resolveTailStartOffset } from './transcriptColdBootOffset';
import { resolveTerminalRecordCliSession } from './terminalSessionLink';

const BOOT_KEY = '__antGeminiTranscriptTailBooted';
const POLL_INTERVAL_MS = 2000;
const GEMINI_KINDS = new Set(['gemini', 'gemini-cli']);
const TMUX_BIN = process.env.ANT_TMUX_BIN ?? '/opt/homebrew/bin/tmux';
const TMUX_PROBE_TIMEOUT_MS = 500;
const TMP_DIR = join(homedir(), '.gemini', 'tmp');

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

function findNewestSessionJsonl(dirPath: string, sinceMtimeMs: number): string | null {
  let entries: string[];
  try { entries = readdirSync(dirPath); } catch { return null; }
  let bestPath: string | null = null;
  let bestMtime = -Infinity;
  for (const name of entries) {
    if (!name.startsWith('session-') || !name.endsWith('.jsonl')) continue;
    const full = join(dirPath, name);
    let s;
    try { s = statSync(full); } catch { continue; }
    if (s.mtimeMs <= sinceMtimeMs) continue;
    if (s.mtimeMs > bestMtime) { bestMtime = s.mtimeMs; bestPath = full; }
  }
  return bestPath;
}

function findSessionJsonlForSessionId(dirPath: string, sessionId: string, sinceMtimeMs: number): string | null {
  let entries: string[];
  try { entries = readdirSync(dirPath); } catch { return null; }
  for (const name of entries) {
    if (name !== `${sessionId}.jsonl` && name !== `session-${sessionId}.jsonl`) continue;
    const full = join(dirPath, name);
    try {
      if (statSync(full).mtimeMs > sinceMtimeMs) return full;
    } catch { /* skip */ }
  }
  return null;
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
  if (!record.agent_kind || !GEMINI_KINDS.has(record.agent_kind)) return 0;
  const pane = record.tmux_target_pane;
  if (!pane) return 0;
  const cwd = tmuxPaneCurrentPath(pane);
  if (!cwd) return 0;
  const projectDir = geminiProjectDirNameForCwd(cwd);
  if (!projectDir) return 0;
  const dir = join(TMP_DIR, projectDir, 'chats');
  const cached = tailStates.get(record.session_id);
  let jsonlPath = cached?.jsonlPath ?? null;
  const linked = resolveTerminalRecordCliSession(record, { cwd });
  const newest = linked
    ? findSessionJsonlForSessionId(dir, linked.sessionId, record.created_at_ms - 1)
    : null;
  const fallbackNewest = newest ?? findNewestSessionJsonl(dir, record.created_at_ms - 1);
  if (fallbackNewest) jsonlPath = fallbackNewest;
  if (!jsonlPath) return 0;
  const fromOffset = resolveTailStartOffset(cached, jsonlPath);
  const { text, newOffset } = readAppendedBytes(jsonlPath, fromOffset);
  const remainder = (cached?.lineRemainder ?? '') + text;
  const lines = remainder.split('\n');
  const lineRemainder = lines.pop() ?? '';
  let ingested = 0;
  for (const line of lines) {
    if (line.length === 0) continue;
    ingested += ingestGeminiTranscriptLine(record.session_id, line);
  }
  tailStates.set(record.session_id, { jsonlPath, byteOffset: newOffset, lineRemainder });
  return ingested;
}

export function tailAllOnce(): number {
  let total = 0;
  for (const r of listTerminalRecords()) total += tailOnceForTerminal(r);
  return total;
}

export function ensureGeminiTranscriptTailWatcherBooted(): void {
  const g = globalThis as unknown as Record<string, boolean | undefined>;
  if (g[BOOT_KEY]) return;
  g[BOOT_KEY] = true;
  setInterval(() => { try { tailAllOnce(); } catch {} },
    POLL_INTERVAL_MS).unref?.();
}

export function _resetGeminiTranscriptTailStateForTests(): void { tailStates.clear(); }

export const _internals = {
  tmuxPaneCurrentPath, findNewestSessionJsonl, findSessionJsonlForSessionId, readAppendedBytes, tailStates,
  GEMINI_KINDS, POLL_INTERVAL_MS
};
