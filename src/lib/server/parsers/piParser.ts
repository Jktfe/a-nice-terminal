/**
 * piParser — TranscriptTailParser for pi CLI.
 * Extracted from piTranscriptTail.ts + piTranscriptTailWatcher.ts.
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import type { TranscriptTailParser, MappedEvent } from '../transcriptTailParser';
import type { ContextFillReading } from '../contextFillTelemetry';
import { contextFillFromTokens, numberValue } from '../contextFillTelemetry';
import { resolveTerminalRecordCliSession } from '../terminalSessionLink';
import { tmuxPaneCurrentPath, findNewestJsonl, findJsonlForSessionId } from './_shared';

const DEFAULT_PI_CONTEXT_WINDOW = 128_000;
const SESSIONS_DIR = join(homedir(), '.pi', 'agent', 'sessions');

type PiContentItem = {
  type?: string;
  text?: string;
  thinking?: string;
  name?: string;
  arguments?: unknown;
  result?: string;
  output?: string;
};

type PiJsonlEvent = {
  type?: string;
  cwd?: string;
  id?: string;
  message?: {
    role?: string;
    content?: PiContentItem[];
    usage?: { input?: number; cacheRead?: number; cacheWrite?: number };
  };
};

function mapPiContentItem(role: string, item: PiContentItem): MappedEvent | null {
  const t = item.type;
  if (t === 'text') {
    const text = item.text ?? '';
    if (text.length === 0) return null;
    if (role === 'user') return { kind: 'command', text, trust: 'high' };
    if (role === 'assistant') return { kind: 'message', text, trust: 'high' };
    return null;
  }
  if (t === 'thinking') {
    const text = item.thinking ?? '';
    if (text.length === 0) return null;
    return { kind: 'thinking', text, trust: 'high' };
  }
  if (t === 'toolCall') {
    const name = item.name ?? '?';
    const args = typeof item.arguments === 'string'
      ? item.arguments
      : item.arguments ? JSON.stringify(item.arguments) : '';
    const text = args ? `${name} ${args}` : name;
    return { kind: 'tool_call', text, trust: 'high' };
  }
  if (t === 'toolResult') {
    const text = (item.result ?? item.output ?? '').toString().trim();
    if (text.length === 0) return null;
    return { kind: 'message', text, trust: 'high' };
  }
  return null;
}

function encodedCwdSegmentForPi(cwd: string): string {
  return `--${cwd.replace(/^\//, '').replace(/\//g, '-')}--`;
}

export const piParser: TranscriptTailParser = {
  name: 'pi',
  agentKinds: new Set(['pi']),

  findJsonlPath(record, _tailState) {
    const pane = record.tmux_target_pane;
    if (!pane) return null;
    const cwd = tmuxPaneCurrentPath(pane);
    if (!cwd) return null;
    const dir = join(SESSIONS_DIR, encodedCwdSegmentForPi(cwd));
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
    let event: PiJsonlEvent;
    try { event = JSON.parse(trimmed) as PiJsonlEvent; }
    catch { return []; }
    if (event.type !== 'message') return [];
    const msg = event.message;
    if (!msg) return [];
    const role = msg.role ?? 'assistant';
    const content = msg.content;
    if (!Array.isArray(content)) return [];
    const out: MappedEvent[] = [];
    for (const item of content) {
      const mapped = mapPiContentItem(role, item);
      if (mapped) out.push(mapped);
    }
    return out;
  },

  nativeIdFromLine(rawLine) {
    try { return (JSON.parse(rawLine.trim()) as { id?: string }).id ?? null; }
    catch { return null; }
  },

  readContextFill(rawLine) {
    try {
      const o = JSON.parse(rawLine.trim()) as PiJsonlEvent;
      const usage = o.message?.usage;
      if (!usage) return null;
      const inputTokens = numberValue(usage.input) + numberValue(usage.cacheRead) + numberValue(usage.cacheWrite);
      return contextFillFromTokens(inputTokens, DEFAULT_PI_CONTEXT_WINDOW);
    } catch { return null; }
  }
};
