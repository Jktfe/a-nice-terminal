/**
 * claudeCodeTranscriptTail — TRANSCRIPT-TAIL-CLAUDE per JWPK pivot
 * (2026-05-15). Authoritative classifier path for claude-code terminals:
 * read `~/.claude/projects/<encoded-cwd>/<session>.jsonl` instead of
 * regex-classifying noisy PTY chunks. Each appended JSONL line maps to
 * one terminal_run_events row with trust=high.
 *
 * v1 scope (this slice):
 *   - Pure mapping fns: parseTranscriptLine + mapClaudeContentItem
 *     → ClaudeMappedEvent[] (one item per content[] entry)
 *   - encodedCwdSegmentFor(cwd) → segment used in the projects/ path
 *   - ingestTranscriptLine(sessionId, rawLine) public API: parses + maps
 *     + writes terminal_run_events rows. Caller decides when to invoke.
 *   - Synthetic fixture vitest; live fs.watch wiring deferred to v2.
 *
 * Mapping table:
 *   type=user      content[].type=text/string → kind=command, trust=high
 *   type=user      content[].type=tool_result → kind=message, trust=high
 *   type=assistant content[].type=text        → kind=message, trust=high
 *   type=assistant content[].type=thinking    → kind=thinking, trust=high
 *   type=assistant content[].type=tool_use    → kind=tool_call, trust=high
 *   anything else → skip (no event)
 */

import { appendTerminalRunEvent } from './terminalRunEventsStore';
import { broadcastTerminalEvent } from './terminalEventBroadcast';
import { transcriptEventKey } from './transcriptEventId';
import { fanoutMessageToLinkedChatRoom } from './transcriptToChatFanout';
import { contextFillFromTokens, numberValue, type ContextFillReading } from './contextFillTelemetry';
import { setAgentContextFill } from './terminalsStore';
import { recordLocalUsageEvent } from './localUsage/ollamaLedger';
import type { ClassifiedKind } from './classifiers/types';
import type { TerminalRunEventTrust } from './terminalRunEventsStore';

const DEFAULT_CLAUDE_CONTEXT_WINDOW = 200_000;

export type ClaudeMappedEvent = {
  kind: ClassifiedKind;
  text: string;
  trust: TerminalRunEventTrust;
};

type ClaudeContentItem =
  | { type: 'text'; text?: string }
  | { type: 'thinking'; thinking?: string }
  | { type: 'tool_use'; name?: string; input?: unknown }
  | { type: 'tool_result'; content?: string | unknown[] };

type ClaudeMessage = {
  role?: string;
  /** Model id on assistant messages, e.g. "claude-opus-4-8". */
  model?: string;
  content?: string | ClaudeContentItem[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
};

type ClaudeJsonlEvent = {
  type?: string;
  message?: ClaudeMessage;
};

export function encodedCwdSegmentFor(cwd: string): string {
  // claude encodes the cwd by replacing path separators with `-` and
  // prefixing with `-`. e.g. /Users/you/CascadeProjects/ant
  // → -Users-you-CascadeProjects-ant
  return cwd.replace(/[\/]/g, '-');
}

function asTextFromContentString(c: string | unknown[]): string {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c.map((p) => {
      if (typeof p === 'string') return p;
      if (p && typeof p === 'object') {
        const obj = p as Record<string, unknown>;
        if (typeof obj.text === 'string') return obj.text;
      }
      return '';
    }).filter(Boolean).join('\n');
  }
  return '';
}

export function mapClaudeContentItem(
  role: string,
  item: ClaudeContentItem
): ClaudeMappedEvent | null {
  if (role === 'user') {
    if (item.type === 'text') {
      const text = item.text ?? '';
      if (text.length === 0) return null;
      return { kind: 'command', text, trust: 'high' };
    }
    if (item.type === 'tool_result') {
      const text = asTextFromContentString(item.content ?? '');
      if (text.length === 0) return null;
      return { kind: 'message', text, trust: 'high' };
    }
  }
  if (role === 'assistant') {
    if (item.type === 'text') {
      const text = item.text ?? '';
      if (text.length === 0) return null;
      return { kind: 'message', text, trust: 'high' };
    }
    if (item.type === 'thinking') {
      const text = item.thinking ?? '';
      if (text.length === 0) return null;
      return { kind: 'thinking', text, trust: 'high' };
    }
    if (item.type === 'tool_use') {
      const name = item.name ?? '?';
      const input = item.input;
      const inputStr = typeof input === 'string'
        ? input
        : input ? JSON.stringify(input) : '';
      const text = inputStr ? `${name} ${inputStr}` : name;
      return { kind: 'tool_call', text, trust: 'high' };
    }
  }
  return null;
}

export function parseTranscriptLine(rawLine: string): ClaudeMappedEvent[] {
  const trimmed = rawLine.trim();
  if (trimmed.length === 0) return [];
  let event: ClaudeJsonlEvent;
  try { event = JSON.parse(trimmed) as ClaudeJsonlEvent; }
  catch { return []; }
  if (event.type !== 'user' && event.type !== 'assistant') return [];
  const msg = event.message;
  if (!msg) return [];
  const role = msg.role ?? event.type;
  const content = msg.content;
  // String-form content (older transcripts) — wrap as single text item.
  if (typeof content === 'string') {
    const item: ClaudeContentItem = { type: 'text', text: content };
    const mapped = mapClaudeContentItem(role, item);
    return mapped ? [mapped] : [];
  }
  if (!Array.isArray(content)) return [];
  const out: ClaudeMappedEvent[] = [];
  for (const item of content) {
    const mapped = mapClaudeContentItem(role, item as ClaudeContentItem);
    if (mapped) out.push(mapped);
  }
  return out;
}

function nativeIdFromLine(rawLine: string): string | null {
  try {
    const o = JSON.parse(rawLine.trim()) as { uuid?: string };
    return typeof o.uuid === 'string' ? o.uuid : null;
  } catch { return null; }
}

export function readContextFillFromClaudeUsageLine(rawLine: string): ContextFillReading | null {
  const trimmed = rawLine.trim();
  if (trimmed.length === 0) return null;
  try {
    const o = JSON.parse(trimmed) as ClaudeJsonlEvent;
    const usage = o.message?.usage;
    if (!usage) return null;
    const inputTokens =
      numberValue(usage.input_tokens)
      + numberValue(usage.cache_read_input_tokens)
      + numberValue(usage.cache_creation_input_tokens);
    return contextFillFromTokens(inputTokens, DEFAULT_CLAUDE_CONTEXT_WINDOW);
  } catch {
    return null;
  }
}

/** Record one ledger event when a Claude transcript line carries usage
 *  tokens (mirrors recordOllamaUsageFromPiLine for the pi feed). Claude's
 *  `usage` already reports FRESH input separately from the two cache classes,
 *  so we map them 1:1 with no folding — preserving the breakdown a cost view
 *  needs to price cache reads (~10% of input) vs cache creation (~125%)
 *  correctly. Source of truth = the transcript JSONL; the Stop hook carries
 *  no token counts. Best-effort: never throws into the caller. */
export function recordClaudeUsageFromLine(rawLine: string): void {
  const trimmed = rawLine.trim();
  if (trimmed.length === 0) return;
  let parsed: ClaudeJsonlEvent;
  try {
    parsed = JSON.parse(trimmed) as ClaudeJsonlEvent;
  } catch {
    return;
  }
  const message = parsed.message;
  const usage = message?.usage;
  if (!usage) return;
  recordLocalUsageEvent({
    provider: 'claude',
    model: message?.model ?? null,
    source: 'claude-transcript',
    inputTokens: numberValue(usage.input_tokens),
    outputTokens: numberValue(usage.output_tokens),
    cacheReadTokens: numberValue(usage.cache_read_input_tokens),
    cacheCreationTokens: numberValue(usage.cache_creation_input_tokens)
  });
}

export function ingestTranscriptLine(sessionId: string, rawLine: string): number {
  const contextFill = readContextFillFromClaudeUsageLine(rawLine);
  if (contextFill) {
    try {
      setAgentContextFill(sessionId, contextFill.fill, 'claude-transcript-usage');
    } catch {
      // Context telemetry must never block transcript ingestion.
    }
  }

  try {
    recordClaudeUsageFromLine(rawLine);
  } catch {
    // Token telemetry must never block transcript ingestion.
  }

  const events = parseTranscriptLine(rawLine);
  const nativeId = nativeIdFromLine(rawLine);
  let i = 0;
  for (const ev of events) {
    const tsMs = Date.now();
    const evKey = transcriptEventKey(nativeId, rawLine, i++);
    appendTerminalRunEvent({
      terminalId: sessionId,
      kind: ev.kind,
      text: ev.text,
      trust: ev.trust,
      tsMs,
      source: 'transcript',
      transcriptEventId: evKey
    });
    try {
      broadcastTerminalEvent(sessionId, {
        kind: ev.kind, text: ev.text, trust: ev.trust,
        ts_ms: tsMs, source: 'transcript'
      });
    } catch { /* broadcast best-effort */ }
    // Closes the Chat-view gap (2026-05-21): clean transcript 'message'
    // events fan out into the linked chat room so agent replies surface
    // in TerminalChatView. fail-silent on bad rooms / dedupe / missing link.
    fanoutMessageToLinkedChatRoom({
      terminalSessionId: sessionId,
      transcriptEventId: evKey,
      kind: ev.kind,
      text: ev.text
    });
  }
  return events.length;
}
