/**
 * qwenParser — TranscriptTailParser for qwen CLI.
 * Extracted from qwenTranscriptTail.ts + qwenTranscriptTailWatcher.ts.
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import type { TranscriptTailParser, MappedEvent } from '../transcriptTailParser';
import type { ContextFillReading } from '../contextFillTelemetry';
import { contextFillFromTokens, numberValue } from '../contextFillTelemetry';
import { resolveTerminalRecordCliSession } from '../terminalSessionLink';
import { tmuxPaneCurrentPath, findNewestJsonl, findJsonlForSessionId } from './_shared';

const DEFAULT_QWEN_CONTEXT_WINDOW = 262_144;
const PROJECTS_DIR = join(homedir(), '.qwen', 'projects');

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

type QwenJsonlEvent = {
  type?: string;
  uuid?: string;
  message?: {
    role?: string;
    parts?: QwenPart[];
    usageMetadata?: {
      promptTokenCount?: number;
      cachedContentTokenCount?: number;
    };
  };
  systemPayload?: {
    uiEvent?: {
      'event.name'?: string;
      input_token_count?: number;
      cached_content_token_count?: number;
    };
  };
};

function mapQwenPart(role: string, part: QwenPart): MappedEvent | null {
  if (part.functionCall) {
    const name = part.functionCall.name ?? '?';
    const args = part.functionCall.args
      ? (typeof part.functionCall.args === 'string' ? part.functionCall.args : JSON.stringify(part.functionCall.args))
      : '';
    const text = args ? `${name} ${args}` : name;
    return { kind: 'tool_call', text, trust: 'high' };
  }
  if (part.functionResponse) {
    const r = part.functionResponse.response;
    let text = '';
    if (typeof r === 'string') text = r;
    else if (r && typeof r === 'object') {
      const obj = r as { output?: unknown };
      if (typeof obj.output === 'string') text = obj.output;
      else text = JSON.stringify(r);
    }
    text = text.trim();
    if (text.length === 0) return null;
    return { kind: 'message', text, trust: 'high' };
  }
  if (typeof part.text === 'string' && part.text.length > 0) {
    if (part.thought === true) return { kind: 'thinking', text: part.text, trust: 'high' };
    if (role === 'user') return { kind: 'command', text: part.text, trust: 'high' };
    return { kind: 'message', text: part.text, trust: 'high' };
  }
  return null;
}

function encodedCwdSegmentForQwen(cwd: string): string {
  return cwd.replace(/\//g, '-');
}

export const qwenParser: TranscriptTailParser = {
  name: 'qwen',
  agentKinds: new Set(['qwen', 'qwen-cli']),

  findJsonlPath(record, _tailState) {
    const pane = record.tmux_target_pane;
    if (!pane) return null;
    const cwd = tmuxPaneCurrentPath(pane);
    if (!cwd) return null;
    const dir = join(PROJECTS_DIR, encodedCwdSegmentForQwen(cwd), 'chats');
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
    let event: QwenJsonlEvent;
    try { event = JSON.parse(trimmed) as QwenJsonlEvent; }
    catch { return []; }
    if (event.type !== 'user' && event.type !== 'assistant' && event.type !== 'tool_result') return [];
    const msg = event.message;
    if (!msg) return [];
    const role = event.type === 'user' ? 'user' : (msg.role ?? 'assistant');
    const parts = msg.parts;
    if (!Array.isArray(parts)) return [];
    const out: MappedEvent[] = [];
    for (const part of parts) {
      const mapped = mapQwenPart(role, part);
      if (mapped) out.push(mapped);
    }
    return out;
  },

  nativeIdFromLine(rawLine) {
    try { return (JSON.parse(rawLine.trim()) as { uuid?: string }).uuid ?? null; }
    catch { return null; }
  },

  readContextFill(rawLine) {
    try {
      const o = JSON.parse(rawLine.trim()) as QwenJsonlEvent;
      const usage = o.message?.usageMetadata;
      if (usage) {
        const inputTokens = numberValue(usage.promptTokenCount) + numberValue(usage.cachedContentTokenCount);
        return contextFillFromTokens(inputTokens, DEFAULT_QWEN_CONTEXT_WINDOW);
      }
      const uiEvent = o.systemPayload?.uiEvent;
      if (uiEvent && uiEvent['event.name'] === 'qwen-code.api_response') {
        const inputTokens = numberValue(uiEvent.input_token_count) + numberValue(uiEvent.cached_content_token_count);
        return contextFillFromTokens(inputTokens, DEFAULT_QWEN_CONTEXT_WINDOW);
      }
      return null;
    } catch { return null; }
  }
};
