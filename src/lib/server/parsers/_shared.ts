/**
 * _shared.ts — Common helpers for transcript-tail parser plugins.
 * Extracted from 6× duplicate watchers to keep each parser under 150 lines.
 */

import { readdirSync, readSync, statSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { TMUX_BIN } from '../tmuxBin';

export { TMUX_BIN };
export const TMUX_PROBE_TIMEOUT_MS = 500;
export const FIRST_LINE_CHUNK_BYTES = 16384;
export const MAX_FIRST_LINE_BYTES = 131072; // 128 KB ceiling

export function tmuxPaneCurrentPath(pane: string): string | null {
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

export function firstLine(path: string): string | null {
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
  finally { if (fd !== null) try { closeSync(fd); } catch { /* ignore */ } }
}

export function countJsonlsNewerThan(dirPath: string, sinceMtimeMs: number): number {
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

export function findNewestJsonl(dirPath: string, sinceMtimeMs: number): string | null {
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
    if (s.mtimeMs > bestMtime) { bestMtime = s.mtimeMs; bestPath = full; }
  }
  return bestPath;
}

export function findJsonlForSessionId(dirPath: string, sessionId: string, sinceMtimeMs: number): string | null {
  let entries: string[];
  try { entries = readdirSync(dirPath); } catch { return null; }
  for (const name of entries) {
    if (name !== `${sessionId}.jsonl` && name !== `session-${sessionId}.jsonl` && !name.endsWith(`_${sessionId}.jsonl`)) continue;
    const full = join(dirPath, name);
    try {
      if (statSync(full).mtimeMs > sinceMtimeMs) return full;
    } catch { /* skip */ }
  }
  return null;
}

export function collectRolloutsFlat(dir: string, sinceMtimeMs: number, out: { path: string; mtimeMs: number }[]): void {
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

export function collectRolloutsRecursive(root: string, sinceMtimeMs: number, out: { path: string; mtimeMs: number }[], depth = 0): void {
  if (depth > 3) return;
  let entries: { name: string; isDirectory: () => boolean; isFile: () => boolean }[];
  try { entries = readdirSync(root, { withFileTypes: true }) as unknown as typeof entries; } catch { return; }
  for (const ent of entries) {
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

export function readAppendedBytes(filePath: string, fromOffset: number): {
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

export function findNewestSessionJsonl(dirPath: string, sinceMtimeMs: number): string | null {
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
