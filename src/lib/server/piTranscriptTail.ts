/**
 * piTranscriptTail — TRANSCRIPT-TAIL-PI-v1 per JWPK overnight mission
 * (2026-05-15). Authoritative classifier path for pi-cli terminals.
 *
 * Path: ~/.pi/agent/sessions/<encoded-cwd>/<TS>_<sessionId>.jsonl
 *
 * Schema:
 *   type=session      first line; payload includes cwd + id + timestamp
 *   type=model_change | thinking_level_change → SKIP
 *   type=message      payload.message = {role, content: [...]}
 *     content[].type = text     → command (user) / message (assistant)
 *     content[].type = thinking → thinking (assistant)
 *     content[].type = toolCall → tool_call (name + arguments)
 *     content[].type = toolResult → message (result body)
 *
 * v1: pure mapper + ingestor + tests. v2 watcher in companion file.
 */

import { appendTerminalRunEvent } from './terminalRunEventsStore';
import { broadcastTerminalEvent } from './terminalEventBroadcast';
import { transcriptEventKey } from './transcriptEventId';
import type { ClassifiedKind } from './classifiers/types';
import type { TerminalRunEventTrust } from './terminalRunEventsStore';

export type PiMappedEvent = {
  kind: ClassifiedKind;
  text: string;
  trust: TerminalRunEventTrust;
};

type PiContentItem = {
  type?: string;
  text?: string;
  thinking?: string;
  name?: string;
  arguments?: unknown;
  result?: string;
  output?: string;
};

type PiMessage = {
  role?: string;
  content?: PiContentItem[];
};

type PiJsonlEvent = {
  type?: string;
  cwd?: string;
  id?: string;
  message?: PiMessage;
};

export function mapPiContentItem(role: string, item: PiContentItem): PiMappedEvent | null {
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

export function parsePiTranscriptLine(rawLine: string): PiMappedEvent[] {
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
  const out: PiMappedEvent[] = [];
  for (const item of content) {
    const mapped = mapPiContentItem(role, item);
    if (mapped) out.push(mapped);
  }
  return out;
}

export function ingestPiTranscriptLine(sessionId: string, rawLine: string): number {
  const events = parsePiTranscriptLine(rawLine);
  let nativeId: string | null = null;
  try { nativeId = (JSON.parse(rawLine.trim()) as { id?: string }).id ?? null; } catch { /* hash fallback */ }
  let i = 0;
  for (const ev of events) {
    const tsMs = Date.now();
    appendTerminalRunEvent({
      terminalId: sessionId, kind: ev.kind, text: ev.text, trust: ev.trust,
      tsMs, source: 'transcript',
      transcriptEventId: transcriptEventKey(nativeId, rawLine, i++)
    });
    try {
      broadcastTerminalEvent(sessionId, {
        kind: ev.kind, text: ev.text, trust: ev.trust,
        ts_ms: tsMs, source: 'transcript'
      });
    } catch { /* best-effort */ }
  }
  return events.length;
}

export function readCwdFromPiSessionLine(rawLine: string): string | null {
  const trimmed = rawLine.trim();
  if (trimmed.length === 0) return null;
  try {
    const o = JSON.parse(trimmed) as PiJsonlEvent;
    if (o.type !== 'session') return null;
    return typeof o.cwd === 'string' && o.cwd.length > 0 ? o.cwd : null;
  } catch { return null; }
}
