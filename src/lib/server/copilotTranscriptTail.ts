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
import { fanoutMessageToLinkedChatRoom } from './transcriptToChatFanout';
import { contextFillFromTokens, numberValue, type ContextFillReading } from './contextFillTelemetry';
import { setAgentContextFill } from './terminalsStore';
import type { ClassifiedKind } from './classifiers/types';
import type { TerminalRunEventTrust } from './terminalRunEventsStore';

const DEFAULT_COPILOT_CONTEXT_WINDOW = 200_000;

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
    modelMetrics?: Record<string, {
      usage?: {
        inputTokens?: number;
        cacheReadTokens?: number;
        cacheWriteTokens?: number;
      };
    }>;
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
  const contextFill = readContextFillFromCopilotMetricsLine(rawLine);
  if (contextFill) {
    try {
      setAgentContextFill(sessionId, contextFill.fill, 'copilot-transcript-metrics');
    } catch {
      // Context telemetry must never block transcript ingestion.
    }
  }

  const events = parseCopilotTranscriptLine(rawLine);
  let nativeId: string | null = null;
  try { nativeId = (JSON.parse(rawLine.trim()) as { id?: string }).id ?? null; } catch { /* hash fallback */ }
  let i = 0;
  for (const ev of events) {
    const tsMs = Date.now();
    const evKey = transcriptEventKey(nativeId, rawLine, i++);
    appendTerminalRunEvent({
      terminalId: sessionId, kind: ev.kind, text: ev.text, trust: ev.trust,
      tsMs, source: 'transcript',
      transcriptEventId: evKey
    });
    try {
      broadcastTerminalEvent(sessionId, {
        kind: ev.kind, text: ev.text, trust: ev.trust,
        ts_ms: tsMs, source: 'transcript'
      });
    } catch { /* best-effort */ }
    fanoutMessageToLinkedChatRoom({
      terminalSessionId: sessionId,
      transcriptEventId: evKey,
      kind: ev.kind,
      text: ev.text
    });
  }
  return events.length;
}

export function readContextFillFromCopilotMetricsLine(rawLine: string): ContextFillReading | null {
  const trimmed = rawLine.trim();
  if (trimmed.length === 0) return null;
  try {
    const o = JSON.parse(trimmed) as CopilotJsonlEvent;
    if (o.type !== 'session.shutdown') return null;
    const metrics = o.data?.modelMetrics;
    if (!metrics) return null;
    let maxInputTokens = 0;
    for (const entry of Object.values(metrics)) {
      const usage = entry?.usage;
      if (!usage) continue;
      const inputTokens =
        numberValue(usage.inputTokens)
        + numberValue(usage.cacheReadTokens)
        + numberValue(usage.cacheWriteTokens);
      if (inputTokens > maxInputTokens) maxInputTokens = inputTokens;
    }
    return contextFillFromTokens(maxInputTokens, DEFAULT_COPILOT_CONTEXT_WINDOW);
  } catch {
    return null;
  }
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
