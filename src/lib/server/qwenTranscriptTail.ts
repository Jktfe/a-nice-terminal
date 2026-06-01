/**
 * qwenTranscriptTail — TRANSCRIPT-TAIL-QWEN-v1 per JWPK overnight
 * mission (2026-05-15). Authoritative classifier path for qwen-cli.
 *
 * Path: ~/.qwen/projects/<encoded-cwd>/chats/<sessionUuid>.jsonl
 *
 * Schema (mirrors claude-style with role=model + parts shape):
 *   uuid/parentUuid/sessionId/cwd/gitBranch/type/message
 *   type=user      message.parts=[{text}]                → command
 *   type=assistant role=model parts=[
 *     {text, thought:true}                                → thinking
 *     {text}                                              → message
 *     {functionCall:{id,name,args}}                       → tool_call
 *     {functionResponse:{...}}                            → message
 *   ]
 *   type=system → SKIP (telemetry)
 *
 * cwd is in every event — convenient for attribution.
 */

import { appendTerminalRunEvent } from './terminalRunEventsStore';
import { broadcastTerminalEvent } from './terminalEventBroadcast';
import { transcriptEventKey } from './transcriptEventId';
import { fanoutMessageToLinkedChatRoom } from './transcriptToChatFanout';
import { contextFillFromTokens, numberValue, type ContextFillReading } from './contextFillTelemetry';
import { setAgentContextFill } from './terminalsStore';
import type { ClassifiedKind } from './classifiers/types';
import type { TerminalRunEventTrust } from './terminalRunEventsStore';

const DEFAULT_QWEN_CONTEXT_WINDOW = 262_144;

export type QwenMappedEvent = {
  kind: ClassifiedKind;
  text: string;
  trust: TerminalRunEventTrust;
};

type QwenPart = {
  text?: string;
  thought?: boolean;
  functionCall?: { id?: string; name?: string; args?: unknown };
  functionResponse?: {
    id?: string;
    name?: string;
    response?: { output?: string } | string | unknown;
  };
};

type QwenMessage = {
  role?: string;
  parts?: QwenPart[];
  usageMetadata?: {
    promptTokenCount?: number;
    cachedContentTokenCount?: number;
  };
};

type QwenJsonlEvent = {
  type?: string;
  subtype?: string;
  cwd?: string;
  message?: QwenMessage;
  systemPayload?: {
    uiEvent?: {
      'event.name'?: string;
      input_token_count?: number;
      cached_content_token_count?: number;
    };
  };
};

export function mapQwenPart(role: string, part: QwenPart): QwenMappedEvent | null {
  if (part.functionCall) {
    const name = part.functionCall.name ?? '?';
    const args = part.functionCall.args
      ? (typeof part.functionCall.args === 'string'
          ? part.functionCall.args
          : JSON.stringify(part.functionCall.args))
      : '';
    const text = args ? `${name} ${args}` : name;
    return { kind: 'tool_call', text, trust: 'high' };
  }
  if (part.functionResponse) {
    // Real qwen tool_result rows put body text under response.output; older
    // shapes may have a string. Prefer .output when present.
    const r = part.functionResponse.response;
    let text = '';
    if (typeof r === 'string') {
      text = r;
    } else if (r && typeof r === 'object') {
      const obj = r as { output?: unknown };
      if (typeof obj.output === 'string') text = obj.output;
      else text = JSON.stringify(r);
    }
    text = text.trim();
    if (text.length === 0) return null;
    return { kind: 'message', text, trust: 'high' };
  }
  if (typeof part.text === 'string' && part.text.length > 0) {
    if (part.thought === true) {
      return { kind: 'thinking', text: part.text, trust: 'high' };
    }
    if (role === 'user') return { kind: 'command', text: part.text, trust: 'high' };
    // assistant role label is 'model' in qwen but anything non-user is treated as assistant text.
    return { kind: 'message', text: part.text, trust: 'high' };
  }
  return null;
}

export function parseQwenTranscriptLine(rawLine: string): QwenMappedEvent[] {
  const trimmed = rawLine.trim();
  if (trimmed.length === 0) return [];
  let event: QwenJsonlEvent;
  try { event = JSON.parse(trimmed) as QwenJsonlEvent; }
  catch { return []; }
  // QWEN delta-1 (2026-05-15): real qwen JSONL tops out at user/assistant/
  // tool_result/system. tool_result is role=user with parts[]
  // .functionResponse — fix-the-gate is the whole patch.
  if (event.type !== 'user' && event.type !== 'assistant' && event.type !== 'tool_result') return [];
  const msg = event.message;
  if (!msg) return [];
  // For tool_result, role is 'user' upstream but we treat parts as
  // assistant-side so functionResponse maps to message kind.
  const role = event.type === 'user' ? 'user' : (msg.role ?? 'assistant');
  const parts = msg.parts;
  if (!Array.isArray(parts)) return [];
  const out: QwenMappedEvent[] = [];
  for (const part of parts) {
    const mapped = mapQwenPart(role, part);
    if (mapped) out.push(mapped);
  }
  return out;
}

export function ingestQwenTranscriptLine(sessionId: string, rawLine: string): number {
  const contextFill = readContextFillFromQwenUsageLine(rawLine);
  if (contextFill) {
    try {
      setAgentContextFill(sessionId, contextFill.fill, 'qwen-transcript-usage');
    } catch {
      // Context telemetry must never block transcript ingestion.
    }
  }

  const events = parseQwenTranscriptLine(rawLine);
  let nativeId: string | null = null;
  try { nativeId = (JSON.parse(rawLine.trim()) as { uuid?: string }).uuid ?? null; } catch { /* hash fallback */ }
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

export function readContextFillFromQwenUsageLine(rawLine: string): ContextFillReading | null {
  const trimmed = rawLine.trim();
  if (trimmed.length === 0) return null;
  try {
    const o = JSON.parse(trimmed) as QwenJsonlEvent;
    const usage = o.message?.usageMetadata;
    if (usage) {
      const inputTokens =
        numberValue(usage.promptTokenCount)
        + numberValue(usage.cachedContentTokenCount);
      return contextFillFromTokens(inputTokens, DEFAULT_QWEN_CONTEXT_WINDOW);
    }

    const uiEvent = o.systemPayload?.uiEvent;
    if (uiEvent && uiEvent['event.name'] === 'qwen-code.api_response') {
      const inputTokens =
        numberValue(uiEvent.input_token_count)
        + numberValue(uiEvent.cached_content_token_count);
      return contextFillFromTokens(inputTokens, DEFAULT_QWEN_CONTEXT_WINDOW);
    }
    return null;
  } catch {
    return null;
  }
}

export function readCwdFromQwenLine(rawLine: string): string | null {
  const trimmed = rawLine.trim();
  if (trimmed.length === 0) return null;
  try {
    const o = JSON.parse(trimmed) as QwenJsonlEvent;
    return typeof o.cwd === 'string' && o.cwd.length > 0 ? o.cwd : null;
  } catch { return null; }
}

export function encodedCwdSegmentForQwen(cwd: string): string {
  // qwen format: leading slash becomes leading dash, internal slashes too.
  // e.g. /Users/you/CascadeProjects/a-nice-terminal
  //      → -Users-you-CascadeProjects-a-nice-terminal
  return cwd.replace(/\//g, '-');
}
