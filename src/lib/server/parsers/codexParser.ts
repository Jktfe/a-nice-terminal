/**
 * codexParser — TranscriptTailParser for codex CLI.
 * Extracted from codexTranscriptTail.ts + codexTranscriptTailWatcher.ts.
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import type { TranscriptTailParser, MappedEvent } from '../transcriptTailParser';
import type { ContextFillReading } from '../contextFillTelemetry';
import { contextFillFromTokens } from '../contextFillTelemetry';
import { resolveTerminalRecordCliSession } from '../terminalSessionLink';
import {
  tmuxPaneCurrentPath,
  firstLine,
  collectRolloutsFlat,
  collectRolloutsRecursive
} from './_shared';

const DEFAULT_CODEX_CONTEXT_WINDOW = 200_000;
const SESSIONS_DIR = join(homedir(), '.codex', 'sessions');
const ARCHIVED_DIR = join(homedir(), '.codex', 'archived_sessions');

type CodexPayload = {
  type?: string;
  role?: string;
  content?: { type?: string; text?: string }[];
  summary?: { type?: string; text?: string }[];
  name?: string;
  arguments?: string | unknown;
  output?: string;
  cwd?: string;
  info?: {
    last_token_usage?: { input_tokens?: number };
    model_context_window?: number;
  };
};
type CodexJsonlEvent = { type?: string; payload?: CodexPayload };

function flattenContentText(items: { type?: string; text?: string }[] | undefined, accept: string): string {
  if (!Array.isArray(items)) return '';
  return items
    .filter((it) => it && it.type === accept && typeof it.text === 'string')
    .map((it) => it.text as string)
    .filter((t) => t.length > 0)
    .join('\n');
}

function flattenReasoningText(items: { type?: string; text?: string }[] | undefined): string {
  if (!Array.isArray(items)) return '';
  return items
    .filter((it) => it && typeof it.text === 'string')
    .map((it) => it.text as string)
    .filter((t) => t.length > 0)
    .join('\n');
}

function mapCodexEvent(event: CodexJsonlEvent): MappedEvent[] {
  const top = event.type;
  const p = event.payload;
  if (!p || typeof p !== 'object') return [];
  if (top !== 'response_item') return [];
  const ptype = p.type;
  if (ptype === 'message') {
    const role = p.role;
    if (role === 'user') {
      const text = flattenContentText(p.content, 'input_text');
      if (text.length === 0) return [];
      return [{ kind: 'command', text, trust: 'high' }];
    }
    if (role === 'assistant') {
      const text = flattenContentText(p.content, 'output_text');
      if (text.length === 0) return [];
      return [{ kind: 'message', text, trust: 'high' }];
    }
    return [];
  }
  if (ptype === 'reasoning') {
    const text = flattenReasoningText(p.summary);
    if (text.length === 0) return [];
    return [{ kind: 'thinking', text, trust: 'high' }];
  }
  if (ptype === 'function_call') {
    const name = p.name ?? '?';
    const args = typeof p.arguments === 'string'
      ? p.arguments
      : p.arguments ? JSON.stringify(p.arguments) : '';
    const text = args ? `${name} ${args}` : name;
    return [{ kind: 'tool_call', text, trust: 'high' }];
  }
  if (ptype === 'function_call_output') {
    const text = (p.output ?? '').trim();
    if (text.length === 0) return [];
    return [{ kind: 'message', text, trust: 'high' }];
  }
  return [];
}

function readCwdFromSessionMetaLine(rawLine: string): string | null {
  try {
    const o = JSON.parse(rawLine.trim()) as CodexJsonlEvent;
    if (o.type !== 'session_meta') return null;
    return typeof o.payload?.cwd === 'string' && o.payload.cwd.length > 0 ? o.payload.cwd : null;
  } catch { return null; }
}

function listCandidateRollouts(sinceMtimeMs: number): { path: string; mtimeMs: number }[] {
  const out: { path: string; mtimeMs: number }[] = [];
  collectRolloutsRecursive(SESSIONS_DIR, sinceMtimeMs, out);
  collectRolloutsFlat(ARCHIVED_DIR, sinceMtimeMs, out);
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out;
}

function rolloutBasenameMatchesSessionId(filePath: string, sessionId: string): boolean {
  const name = filePath.split('/').pop() ?? '';
  return name === `${sessionId}.jsonl` || name === `rollout-${sessionId}.jsonl` || name === `session-${sessionId}.jsonl`;
}

function findRolloutForSessionId(sessionId: string, sinceMtimeMs: number): string | null {
  for (const c of listCandidateRollouts(sinceMtimeMs)) {
    if (rolloutBasenameMatchesSessionId(c.path, sessionId)) return c.path;
  }
  return null;
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

export const codexParser: TranscriptTailParser = {
  name: 'codex',
  agentKinds: new Set(['codex', 'codex-cli']),

  findJsonlPath(record, tailState) {
    const pane = record.tmux_target_pane;
    if (!pane) return null;
    const cwd = tmuxPaneCurrentPath(pane);
    if (!cwd) return null;
    const linked = resolveTerminalRecordCliSession(record, { cwd });
    if (linked) {
      const found = findRolloutForSessionId(linked.sessionId, record.created_at_ms - 1);
      if (found) return found;
    }
    return findRolloutForCwd(cwd, record.created_at_ms - 1);
  },

  parseLine(rawLine) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0) return [];
    let event: CodexJsonlEvent;
    try { event = JSON.parse(trimmed) as CodexJsonlEvent; }
    catch { return []; }
    return mapCodexEvent(event);
  },

  nativeIdFromLine(_rawLine) {
    // Codex rollout lines carry NO native per-line id.
    return null;
  },

  readContextFill(rawLine) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0) return null;
    try {
      const o = JSON.parse(trimmed) as CodexJsonlEvent;
      if (o.type !== 'event_msg' || o.payload?.type !== 'token_count') return null;
      const inputTokens = Number(o.payload.info?.last_token_usage?.input_tokens);
      const contextWindow = Number(o.payload.info?.model_context_window);
      return contextFillFromTokens(inputTokens, contextWindow) ?? contextFillFromTokens(inputTokens, DEFAULT_CODEX_CONTEXT_WINDOW);
    } catch {
      return null;
    }
  }
};
