/**
 * codexTranscriptTail — TRANSCRIPT-TAIL-CODEX-v1 per JWPK pivot
 * (2026-05-15). Authoritative classifier path for codex-cli terminals:
 * read codex's rollout JSONL at
 *   ~/.codex/archived_sessions/rollout-<TIMESTAMP>-<SESSIONUUID>.jsonl
 * instead of regex-classifying noisy PTY chunks. Mirrors the claude
 * pattern (claudeCodeTranscriptTail) but for codex's
 * `type+payload` shape.
 *
 * v1 scope: pure mapper + ingestor + tests. Live fs.watch wiring lands
 * in TRANSCRIPT-TAIL-CODEX-v2 (mirrors claudeCodeTranscriptTailWatcher
 * but with session_meta.cwd preferred over tmux pane discovery).
 *
 * Mapping table — codex events:
 *   response_item    msg user   content[].type=input_text   → command
 *   response_item    msg asst   content[].type=output_text  → message
 *   response_item    msg dev/sys                            → SKIP (system prompts)
 *   response_item    reasoning  summary[].text              → thinking
 *   response_item    function_call (name + arguments)       → tool_call
 *   response_item    function_call_output (output text)     → message (tool result)
 *   event_msg        user_message / agent_message / etc     → SKIP (duplicates)
 *   session_meta / turn_context / event_msg/*               → SKIP
 */

import { appendTerminalRunEvent } from './terminalRunEventsStore';
import { broadcastTerminalEvent } from './terminalEventBroadcast';
import { transcriptEventKey } from './transcriptEventId';
import { setAgentContextFill } from './terminalsStore';
import type { ClassifiedKind } from './classifiers/types';
import type { TerminalRunEventTrust } from './terminalRunEventsStore';

export type CodexMappedEvent = {
  kind: ClassifiedKind;
  text: string;
  trust: TerminalRunEventTrust;
};

type CodexContentItem = { type?: string; text?: string };
type CodexReasoningSummaryItem = { type?: string; text?: string };
type CodexPayload = {
  type?: string;
  role?: string;
  content?: CodexContentItem[];
  summary?: CodexReasoningSummaryItem[];
  name?: string;
  arguments?: string | unknown;
  output?: string;
  cwd?: string;
  info?: {
    last_token_usage?: { input_tokens?: number };
    model_context_window?: number;
  };
};
type CodexJsonlEvent = {
  type?: string;
  payload?: CodexPayload;
};

function flattenContentText(items: CodexContentItem[] | undefined, accept: string): string {
  if (!Array.isArray(items)) return '';
  return items
    .filter((it) => it && it.type === accept && typeof it.text === 'string')
    .map((it) => it.text as string)
    .filter((t) => t.length > 0)
    .join('\n');
}

function flattenReasoningText(items: CodexReasoningSummaryItem[] | undefined): string {
  if (!Array.isArray(items)) return '';
  return items
    .filter((it) => it && typeof it.text === 'string')
    .map((it) => it.text as string)
    .filter((t) => t.length > 0)
    .join('\n');
}

export function mapCodexEvent(event: CodexJsonlEvent): CodexMappedEvent[] {
  const top = event.type;
  const p = event.payload;
  if (!p || typeof p !== 'object') return [];

  if (top === 'response_item') {
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
      return []; // developer/system → skip
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
  }
  // session_meta / turn_context / event_msg are skipped here — session_meta
  // is consumed by the v2 watcher for cwd discovery; event_msg duplicates
  // response_item content and would double-up.
  return [];
}

export function parseCodexTranscriptLine(rawLine: string): CodexMappedEvent[] {
  const trimmed = rawLine.trim();
  if (trimmed.length === 0) return [];
  let event: CodexJsonlEvent;
  try { event = JSON.parse(trimmed) as CodexJsonlEvent; }
  catch { return []; }
  return mapCodexEvent(event);
}

export function ingestCodexTranscriptLine(sessionId: string, rawLine: string): number {
  const contextFill = readContextFillFromCodexTokenCountLine(rawLine);
  if (contextFill) {
    try {
      setAgentContextFill(sessionId, contextFill.fill, 'codex-transcript-token-count');
    } catch {
      // Context telemetry must never block transcript ingestion.
    }
  }

  const events = parseCodexTranscriptLine(rawLine);
  // Codex rollout lines carry NO native per-line id — transcriptEventKey
  // falls back to a stable content hash of rawLine.
  let i = 0;
  for (const ev of events) {
    const tsMs = Date.now();
    appendTerminalRunEvent({
      terminalId: sessionId,
      kind: ev.kind,
      text: ev.text,
      trust: ev.trust,
      tsMs,
      source: 'transcript',
      transcriptEventId: transcriptEventKey(null, rawLine, i++)
    });
    try {
      broadcastTerminalEvent(sessionId, {
        kind: ev.kind, text: ev.text, trust: ev.trust,
        ts_ms: tsMs, source: 'transcript'
      });
    } catch { /* broadcast best-effort */ }
  }
  return events.length;
}

// Helper for the v2 watcher: extract cwd from a session_meta line.
export function readCwdFromSessionMetaLine(rawLine: string): string | null {
  const trimmed = rawLine.trim();
  if (trimmed.length === 0) return null;
  try {
    const o = JSON.parse(trimmed) as CodexJsonlEvent;
    if (o.type !== 'session_meta') return null;
    const cwd = o.payload?.cwd;
    return typeof cwd === 'string' && cwd.length > 0 ? cwd : null;
  } catch { return null; }
}

export function readContextFillFromCodexTokenCountLine(rawLine: string): {
  fill: number;
  inputTokens: number;
  contextWindow: number;
} | null {
  const trimmed = rawLine.trim();
  if (trimmed.length === 0) return null;
  try {
    const o = JSON.parse(trimmed) as CodexJsonlEvent;
    if (o.type !== 'event_msg' || o.payload?.type !== 'token_count') return null;
    const inputTokens = Number(o.payload.info?.last_token_usage?.input_tokens);
    const contextWindow = Number(o.payload.info?.model_context_window);
    if (!Number.isFinite(inputTokens) || inputTokens < 0) return null;
    if (!Number.isFinite(contextWindow) || contextWindow <= 0) return null;
    return {
      fill: Math.min(1, inputTokens / contextWindow),
      inputTokens,
      contextWindow
    };
  } catch {
    return null;
  }
}
