/**
 * geminiTranscriptTail — TRANSCRIPT-TAIL-GEMINI-v1 per JWPK overnight
 * mission (2026-05-15). Authoritative classifier path for gemini-cli.
 *
 * Path: ~/.gemini/tmp/<lowercase-basename-of-cwd>/chats/session-<TS>-<id>.jsonl
 *
 * Schema:
 *   First line: session_meta {sessionId, projectHash, startTime, kind}
 *   type=info → SKIP (CLI update notices)
 *   type=user content=[{text}] → command
 *   type=gemini content=text + thoughts=[{subject,description}] + tokens
 *     → message (content) + thinking (thoughts joined)
 *   {$set:{lastUpdated}} → SKIP (metadata)
 *
 * v1: pure mapper + ingestor + tests. v2 watcher in companion file.
 */

import { appendTerminalRunEvent } from './terminalRunEventsStore';
import { broadcastTerminalEvent } from './terminalEventBroadcast';
import { transcriptEventKey } from './transcriptEventId';
import type { ClassifiedKind } from './classifiers/types';
import type { TerminalRunEventTrust } from './terminalRunEventsStore';

export type GeminiMappedEvent = {
  kind: ClassifiedKind;
  text: string;
  trust: TerminalRunEventTrust;
};

type GeminiContentItem = { text?: string };
type GeminiThought = { subject?: string; description?: string };
type GeminiJsonlEvent = {
  type?: string;
  sessionId?: string;
  content?: string | GeminiContentItem[];
  thoughts?: GeminiThought[];
  $set?: Record<string, unknown>;
};

function flattenContentText(c: string | GeminiContentItem[] | undefined): string {
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c.map((it) => (typeof it.text === 'string' ? it.text : ''))
    .filter((t) => t.length > 0).join('\n');
}

function flattenThoughts(t: GeminiThought[] | undefined): string {
  if (!Array.isArray(t)) return '';
  return t.map((th) => {
    const subj = (th.subject ?? '').trim();
    const desc = (th.description ?? '').trim();
    if (subj && desc) return `${subj}: ${desc}`;
    return subj || desc;
  }).filter(Boolean).join('\n\n');
}

export function mapGeminiEvent(event: GeminiJsonlEvent): GeminiMappedEvent[] {
  // session_meta line has no `type` but does have `sessionId`.
  if (!event.type) return [];
  // Metadata update lines.
  if (event.$set) return [];
  if (event.type === 'info') return [];
  if (event.type === 'user') {
    const text = flattenContentText(event.content);
    if (text.length === 0) return [];
    return [{ kind: 'command', text, trust: 'high' }];
  }
  if (event.type === 'gemini') {
    const out: GeminiMappedEvent[] = [];
    const thoughts = flattenThoughts(event.thoughts);
    if (thoughts.length > 0) out.push({ kind: 'thinking', text: thoughts, trust: 'high' });
    const body = flattenContentText(event.content);
    if (body.length > 0) out.push({ kind: 'message', text: body, trust: 'high' });
    return out;
  }
  return [];
}

export function parseGeminiTranscriptLine(rawLine: string): GeminiMappedEvent[] {
  const trimmed = rawLine.trim();
  if (trimmed.length === 0) return [];
  let event: GeminiJsonlEvent;
  try { event = JSON.parse(trimmed) as GeminiJsonlEvent; }
  catch { return []; }
  return mapGeminiEvent(event);
}

export function ingestGeminiTranscriptLine(sessionId: string, rawLine: string): number {
  const events = parseGeminiTranscriptLine(rawLine);
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

// gemini stores chats under ~/.gemini/tmp/<lowercase-basename-of-cwd>/chats/
export function geminiProjectDirNameForCwd(cwd: string): string {
  const segs = cwd.split('/').filter(Boolean);
  const last = segs[segs.length - 1] ?? '';
  return last.toLowerCase();
}
