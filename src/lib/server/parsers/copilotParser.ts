/**
 * copilotParser — TranscriptTailParser for copilot CLI.
 * Extracted from copilotTranscriptTail.ts + copilotTranscriptTailWatcher.ts.
 */

import { readdirSync, statSync } from 'node:fs';

import { join } from 'node:path';
import { homedir } from 'node:os';
import type { TranscriptTailParser, MappedEvent } from '../transcriptTailParser';
import type { ContextFillReading } from '../contextFillTelemetry';
import { contextFillFromTokens, numberValue } from '../contextFillTelemetry';
import { resolveTerminalRecordCliSession } from '../terminalSessionLink';
import { tmuxPaneCurrentPath, firstLine } from './_shared';

const DEFAULT_COPILOT_CONTEXT_WINDOW = 200_000;
const SESSION_STATE_DIR = join(homedir(), '.copilot', 'session-state');

type CopilotJsonlEvent = {
  type?: string;
  id?: string;
  data?: {
    content?: string;
    toolRequests?: { toolCallId?: string; name?: string; arguments?: unknown }[];
    result?: { content?: string; detailedContent?: string };
    context?: { cwd?: string };
    modelMetrics?: Record<string, {
      usage?: { inputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number };
    }>;
  };
};

function mapCopilotEvent(event: CopilotJsonlEvent): MappedEvent[] {
  const t = event.type;
  const d = event.data;
  if (!t || !d) return [];
  if (t === 'user.message') {
    const text = (d.content ?? '').trim();
    if (text.length === 0) return [];
    return [{ kind: 'command', text, trust: 'high' }];
  }
  if (t === 'assistant.message') {
    const out: MappedEvent[] = [];
    const body = (d.content ?? '').trim();
    if (body.length > 0) out.push({ kind: 'message', text: body, trust: 'high' });
    const reqs = d.toolRequests;
    if (Array.isArray(reqs)) {
      for (const r of reqs) {
        const name = r.name ?? '?';
        const args = r.arguments
          ? (typeof r.arguments === 'string' ? r.arguments : JSON.stringify(r.arguments))
          : '';
        const text = args ? `${name} ${args}` : name;
        out.push({ kind: 'tool_call', text, trust: 'high' });
      }
    }
    return out;
  }
  if (t === 'tool.execution_complete') {
    const r = d.result;
    if (!r) return [];
    const text = (r.content ?? r.detailedContent ?? '').toString().trim();
    if (text.length === 0) return [];
    return [{ kind: 'message', text, trust: 'high' }];
  }
  return [];
}

function readCwdFromCopilotSessionStartLine(rawLine: string): string | null {
  try {
    const o = JSON.parse(rawLine.trim()) as CopilotJsonlEvent;
    if (o.type !== 'session.start') return null;
    return typeof o.data?.context?.cwd === 'string' && o.data.context.cwd.length > 0 ? o.data.context.cwd : null;
  } catch { return null; }
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
  } catch { return null; }
}

export const copilotParser: TranscriptTailParser = {
  name: 'copilot',
  agentKinds: new Set(['copilot', 'copilot-cli']),

  findJsonlPath(record, _tailState) {
    const pane = record.tmux_target_pane;
    if (!pane) return null;
    const cwd = tmuxPaneCurrentPath(pane);
    if (!cwd) return null;
    const linked = resolveTerminalRecordCliSession(record, { cwd });
    if (linked) {
      const found = findSessionForSessionId(linked.sessionId, record.created_at_ms - 1);
      if (found) return found;
    }
    return findSessionForCwd(cwd, record.created_at_ms - 1);
  },

  parseLine(rawLine) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0) return [];
    let event: CopilotJsonlEvent;
    try { event = JSON.parse(trimmed) as CopilotJsonlEvent; }
    catch { return []; }
    return mapCopilotEvent(event);
  },

  nativeIdFromLine(rawLine) {
    try { return (JSON.parse(rawLine.trim()) as { id?: string }).id ?? null; }
    catch { return null; }
  },

  readContextFill(rawLine) {
    try {
      const o = JSON.parse(rawLine.trim()) as CopilotJsonlEvent;
      if (o.type !== 'session.shutdown') return null;
      const metrics = o.data?.modelMetrics;
      if (!metrics) return null;
      let maxInputTokens = 0;
      for (const entry of Object.values(metrics)) {
        const usage = entry?.usage;
        if (!usage) continue;
        const inputTokens = numberValue(usage.inputTokens) + numberValue(usage.cacheReadTokens) + numberValue(usage.cacheWriteTokens);
        if (inputTokens > maxInputTokens) maxInputTokens = inputTokens;
      }
      return contextFillFromTokens(maxInputTokens, DEFAULT_COPILOT_CONTEXT_WINDOW);
    } catch { return null; }
  }
};
