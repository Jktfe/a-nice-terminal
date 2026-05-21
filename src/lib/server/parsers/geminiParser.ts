/**
 * geminiParser — TranscriptTailParser for gemini CLI.
 * Extracted from geminiTranscriptTail.ts + geminiTranscriptTailWatcher.ts.
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import type { TranscriptTailParser, MappedEvent } from '../transcriptTailParser';
import type { ContextFillReading } from '../contextFillTelemetry';
import { contextFillFromTokens, numberValue } from '../contextFillTelemetry';
import { resolveTerminalRecordCliSession } from '../terminalSessionLink';
import { tmuxPaneCurrentPath, findNewestJsonl, findJsonlForSessionId } from './_shared';

const DEFAULT_GEMINI_CONTEXT_WINDOW = 1_000_000;
const TMP_DIR = join(homedir(), '.gemini', 'tmp');

type GeminiJsonlEvent = {
  type?: string;
  id?: string;
  content?: string | { text?: string }[];
  thoughts?: { subject?: string; description?: string }[];
  tokens?: { input?: number; cached?: number; tool?: number };
  $set?: Record<string, unknown>;
};

function flattenContentText(c: string | { text?: string }[] | undefined): string {
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c.map((it) => (typeof it.text === 'string' ? it.text : ''))
    .filter((t) => t.length > 0).join('\n');
}

function flattenThoughts(t: { subject?: string; description?: string }[] | undefined): string {
  if (!Array.isArray(t)) return '';
  return t.map((th) => {
    const subj = (th.subject ?? '').trim();
    const desc = (th.description ?? '').trim();
    if (subj && desc) return `${subj}: ${desc}`;
    return subj || desc;
  }).filter(Boolean).join('\n\n');
}

function mapGeminiEvent(event: GeminiJsonlEvent): MappedEvent[] {
  if (!event.type || event.$set) return [];
  if (event.type === 'info') return [];
  if (event.type === 'user') {
    const text = flattenContentText(event.content);
    if (text.length === 0) return [];
    return [{ kind: 'command', text, trust: 'high' }];
  }
  if (event.type === 'gemini') {
    const out: MappedEvent[] = [];
    const thoughts = flattenThoughts(event.thoughts);
    if (thoughts.length > 0) out.push({ kind: 'thinking', text: thoughts, trust: 'high' });
    const body = flattenContentText(event.content);
    if (body.length > 0) out.push({ kind: 'message', text: body, trust: 'high' });
    return out;
  }
  return [];
}

function geminiProjectDirNameForCwd(cwd: string): string {
  const segs = cwd.split('/').filter(Boolean);
  return (segs[segs.length - 1] ?? '').toLowerCase();
}

export const geminiParser: TranscriptTailParser = {
  name: 'gemini',
  agentKinds: new Set(['gemini', 'gemini-cli']),

  findJsonlPath(record, _tailState) {
    const pane = record.tmux_target_pane;
    if (!pane) return null;
    const cwd = tmuxPaneCurrentPath(pane);
    if (!cwd) return null;
    const projectDir = geminiProjectDirNameForCwd(cwd);
    if (!projectDir) return null;
    const dir = join(TMP_DIR, projectDir, 'chats');
    const linked = resolveTerminalRecordCliSession(record, { cwd });
    if (linked) {
      const found = findJsonlForSessionId(dir, linked.sessionId, record.created_at_ms - 1);
      if (found) return found;
    }
    return findNewestJsonl(dir, record.created_at_ms - 1);
  },

  parseLine(rawLine) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0) return [];
    let event: GeminiJsonlEvent;
    try { event = JSON.parse(trimmed) as GeminiJsonlEvent; }
    catch { return []; }
    return mapGeminiEvent(event);
  },

  nativeIdFromLine(rawLine) {
    try { return (JSON.parse(rawLine.trim()) as { id?: string }).id ?? null; }
    catch { return null; }
  },

  readContextFill(rawLine) {
    try {
      const o = JSON.parse(rawLine.trim()) as GeminiJsonlEvent;
      const tokens = o.tokens;
      if (!tokens) return null;
      const inputTokens = numberValue(tokens.input) + numberValue(tokens.cached) + numberValue(tokens.tool);
      return contextFillFromTokens(inputTokens, DEFAULT_GEMINI_CONTEXT_WINDOW);
    } catch { return null; }
  }
};
