/**
 * copilotTranscriptTail — TRANSCRIPT-TAIL-COPILOT-v1 per JWPK overnight
 * mission (2026-05-15). Authoritative classifier path for copilot-cli.
 *
 * Path: ~/.copilot/session-state/<sessionId>/events.jsonl
 *
 * Schema:
 *   session.start data.context.cwd                 → SKIP (used for cwd discovery)
 *   user.message data.content                      → command
 *   assistant.message data.content + .toolRequests → message + tool_call per request
 *   tool.execution_complete data.result.content    → message (tool result)
 *   system.message / model_change / shutdown / etc → SKIP
 */

import { appendTerminalRunEvent } from './terminalRunEventsStore';
import { broadcastTerminalEvent } from './terminalEventBroadcast';
import { transcriptEventKey } from './transcriptEventId';
import type { ClassifiedKind } from './classifiers/types';
import type { TerminalRunEventTrust } from './terminalRunEventsStore';

export type CopilotMappedEvent = {
  kind: ClassifiedKind;
  text: string;
  trust: TerminalRunEventTrust;
};

type CopilotToolRequest = { toolCallId?: string; name?: string; arguments?: unknown };
type CopilotJsonlEvent = {
  type?: string;
  data?: {
    content?: string;
    toolRequests?: CopilotToolRequest[];
    result?: { content?: string; detailedContent?: string };
    context?: { cwd?: string };
  };
};

export function mapCopilotEvent(event: CopilotJsonlEvent): CopilotMappedEvent[] {
  const t = event.type;
  const d = event.data;
  if (!t || !d) return [];
  if (t === 'user.message') {
    const text = (d.content ?? '').trim();
    if (text.length === 0) return [];
    return [{ kind: 'command', text, trust: 'high' }];
  }
  if (t === 'assistant.message') {
    const out: CopilotMappedEvent[] = [];
    const body = (d.content ?? '').trim();
    if (body.length > 0) {
      out.push({ kind: 'message', text: body, trust: 'high' });
    }
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

export function parseCopilotTranscriptLine(rawLine: string): CopilotMappedEvent[] {
  const trimmed = rawLine.trim();
  if (trimmed.length === 0) return [];
  let event: CopilotJsonlEvent;
  try { event = JSON.parse(trimmed) as CopilotJsonlEvent; }
  catch { return []; }
  return mapCopilotEvent(event);
}

export function ingestCopilotTranscriptLine(sessionId: string, rawLine: string): number {
  const events = parseCopilotTranscriptLine(rawLine);
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

export function readCwdFromCopilotSessionStartLine(rawLine: string): string | null {
  const trimmed = rawLine.trim();
  if (trimmed.length === 0) return null;
  try {
    const o = JSON.parse(trimmed) as CopilotJsonlEvent;
    if (o.type !== 'session.start') return null;
    const cwd = o.data?.context?.cwd;
    return typeof cwd === 'string' && cwd.length > 0 ? cwd : null;
  } catch { return null; }
}
