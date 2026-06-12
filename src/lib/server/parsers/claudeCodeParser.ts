/**
 * claudeCodeParser — TranscriptTailParser for claude-code CLI.
 * Extracted from claudeCodeTranscriptTail.ts + claudeCodeTranscriptTailWatcher.ts.
 */

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import type { TranscriptTailParser, MappedEvent } from '../transcriptTailParser';
import type { ContextFillReading } from '../contextFillTelemetry';
import { contextFillFromTokens, numberValue } from '../contextFillTelemetry';
import { resolveTerminalRecordCliSession } from '../terminalSessionLink';

import { TMUX_BIN } from '../tmuxBin';

const DEFAULT_CLAUDE_CONTEXT_WINDOW = 200_000;
const TMUX_PROBE_TIMEOUT_MS = 500;
const PROJECTS_DIR = join(homedir(), '.claude', 'projects');

function encodedCwdSegmentFor(cwd: string): string {
  return cwd.replace(/[\/]/g, '-');
}

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

/* ---------- JSONL parsing (from claudeCodeTranscriptTail.ts) ---------- */

type ClaudeContentItem =
  | { type: 'text'; text?: string }
  | { type: 'thinking'; thinking?: string }
  | { type: 'tool_use'; name?: string; input?: unknown }
  | { type: 'tool_result'; content?: string | unknown[] };

function asTextFromContentString(c: string | unknown[]): string {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c.map((p) => {
      if (typeof p === 'string') return p;
      if (p && typeof p === 'object') {
        const obj = p as Record<string, unknown>;
        if (typeof obj.text === 'string') return obj.text;
      }
      return '';
    }).filter(Boolean).join('\n');
  }
  return '';
}

function mapContentItem(role: string, item: ClaudeContentItem): MappedEvent | null {
  if (role === 'user') {
    if (item.type === 'text') {
      const text = item.text ?? '';
      if (text.length === 0) return null;
      return { kind: 'command', text, trust: 'high' };
    }
    if (item.type === 'tool_result') {
      const text = asTextFromContentString(item.content ?? '');
      if (text.length === 0) return null;
      return { kind: 'message', text, trust: 'high' };
    }
  }
  if (role === 'assistant') {
    if (item.type === 'text') {
      const text = item.text ?? '';
      if (text.length === 0) return null;
      return { kind: 'message', text, trust: 'high' };
    }
    if (item.type === 'thinking') {
      const text = item.thinking ?? '';
      if (text.length === 0) return null;
      return { kind: 'thinking', text, trust: 'high' };
    }
    if (item.type === 'tool_use') {
      const name = item.name ?? '?';
      const input = item.input;
      const inputStr = typeof input === 'string'
        ? input
        : input ? JSON.stringify(input) : '';
      const text = inputStr ? `${name} ${inputStr}` : name;
      return { kind: 'tool_call', text, trust: 'high' };
    }
  }
  return null;
}

/* ---------- Parser implementation ---------- */

export const claudeCodeParser: TranscriptTailParser = {
  name: 'claude-code',
  agentKinds: new Set(['claude', 'claude-code', 'claude_code']),

  findJsonlPath(record, tailState) {
    const pane = record.tmux_target_pane;
    if (!pane) return null;
    const cwd = tmuxPaneCurrentPath(pane);
    if (!cwd) return null;
    const projectDir = join(PROJECTS_DIR, encodedCwdSegmentFor(cwd));

    // Try PID-disambiguated link first.
    const linked = resolveTerminalRecordCliSession(record, { cwd });
    if (linked) {
      const found = findJsonlForSessionId(projectDir, linked.sessionId, record.created_at_ms - 1);
      if (found) return found;
    }

    // Fallback: only tail if exactly one candidate (prevents cross-contamination).
    if (!tailState) {
      const candidates = countJsonlsNewerThan(projectDir, record.created_at_ms - 1);
      if (candidates === 1) {
        return findNewestJsonl(projectDir, record.created_at_ms - 1);
      }
    }

    return null;
  },

  parseLine(rawLine) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0) return [];
    let event: { type?: string; message?: { role?: string; content?: string | ClaudeContentItem[]; usage?: unknown } };
    try { event = JSON.parse(trimmed) as typeof event; }
    catch { return []; }
    if (event.type !== 'user' && event.type !== 'assistant') return [];
    const msg = event.message;
    if (!msg) return [];
    const role = msg.role ?? event.type;
    const content = msg.content;
    if (typeof content === 'string') {
      if (content.length === 0) return [];
      return [{ kind: 'message', text: content, trust: 'high' }];
    }
    if (!Array.isArray(content)) return [];
    const out: MappedEvent[] = [];
    for (const item of content) {
      const mapped = mapContentItem(role, item as ClaudeContentItem);
      if (mapped) out.push(mapped);
    }
    return out;
  },

  nativeIdFromLine(rawLine) {
    try {
      const o = JSON.parse(rawLine.trim()) as { uuid?: string };
      return typeof o.uuid === 'string' ? o.uuid : null;
    } catch { return null; }
  },

  readContextFill(rawLine) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0) return null;
    try {
      const o = JSON.parse(trimmed) as { message?: { usage?: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } } };
      const usage = o.message?.usage;
      if (!usage) return null;
      const inputTokens =
        numberValue(usage.input_tokens)
        + numberValue(usage.cache_read_input_tokens)
        + numberValue(usage.cache_creation_input_tokens);
      return contextFillFromTokens(inputTokens, DEFAULT_CLAUDE_CONTEXT_WINDOW);
    } catch {
      return null;
    }
  }
};
