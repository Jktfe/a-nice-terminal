/**
 * genericTranscriptTailWatcher — replaces 6× duplicate transcript tail
 * watchers with one generic core + per-CLI parser plugins.
 *
 * Every POLL_INTERVAL_MS:
 *   1. List terminal_records.
 *   2. Filter to those with an agent_kind that has a registered parser.
 *   3. For each: call parser.findJsonlPath() to discover the JSONL.
 *   4. Read appended bytes from the last known offset.
 *   5. Split lines and call parser.parseLine() + parser.nativeIdFromLine().
 *   6. Write events to terminal_run_events, broadcast, fanout to chat.
 *   7. Update per-terminal tail state (offset + line remainder).
 *
 * Boot-once via globalThis flag so dev HMR / multiple imports don't
 * double-subscribe.
 */

import { readSync, statSync, openSync, closeSync } from 'node:fs';
import { appendTerminalRunEvent } from './terminalRunEventsStore';
import { broadcastTerminalEvent } from './terminalEventBroadcast';
import { transcriptEventKey } from './transcriptEventId';
import { fanoutMessageToLinkedChatRoom } from './transcriptToChatFanout';
import { setAgentContextFill } from './terminalsStore';
import { listTerminalRecords } from './terminalRecordsStore';
import { resolveTailStartOffset } from './transcriptColdBootOffset';
import { getTranscriptTailParser } from './transcriptTailParser';

const BOOT_KEY = '__antGenericTranscriptTailBooted';
export const POLL_INTERVAL_MS = 2000;

type TailState = {
  jsonlPath: string;
  byteOffset: number;
  lineRemainder: string;
};

const tailStates = new Map<string, TailState>();

function readAppendedBytes(filePath: string, fromOffset: number): {
  text: string;
  newOffset: number;
} {
  let fd: number | null = null;
  try {
    const s = statSync(filePath);
    if (s.size <= fromOffset) return { text: '', newOffset: fromOffset };
    fd = openSync(filePath, 'r');
    const remaining = s.size - fromOffset;
    const buf = Buffer.alloc(remaining);
    readSync(fd, buf, 0, remaining, fromOffset);
    return { text: buf.toString('utf8'), newOffset: s.size };
  } catch {
    return { text: '', newOffset: fromOffset };
  } finally {
    if (fd !== null) try { closeSync(fd); } catch { /* ignore */ }
  }
}

export function tailOnceForTerminal(record: {
  session_id: string;
  agent_kind: string | null;
  tmux_target_pane: string | null;
  created_at_ms: number;
}): number {
  const parser = getTranscriptTailParser(record.agent_kind);
  if (!parser) return 0;

  const cached = tailStates.get(record.session_id);
  const jsonlPath = parser.findJsonlPath(record, cached ?? null);
  if (!jsonlPath) return 0;

  const fromOffset = resolveTailStartOffset(cached, jsonlPath);
  const { text, newOffset } = readAppendedBytes(jsonlPath, fromOffset);
  const remainder = (cached?.lineRemainder ?? '') + text;
  const lines = remainder.split('\n');
  const lineRemainder = lines.pop() ?? '';

  let ingested = 0;
  for (const line of lines) {
    if (line.length === 0) continue;

    // Context-fill telemetry (best-effort, never blocks ingestion).
    const contextFill = parser.readContextFill(line);
    if (contextFill) {
      try {
        setAgentContextFill(record.session_id, contextFill.fill, `${parser.name}-transcript-usage`);
      } catch { /* telemetry must never block */ }
    }

    const events = parser.parseLine(line);
    const nativeId = parser.nativeIdFromLine(line);
    const tsMs = Date.now();
    let i = 0;
    for (const ev of events) {
      const evKey = transcriptEventKey(nativeId, line, i++);
      appendTerminalRunEvent({
        terminalId: record.session_id,
        kind: ev.kind,
        text: ev.text,
        trust: ev.trust,
        tsMs,
        source: 'transcript',
        transcriptEventId: evKey
      });
      try {
        broadcastTerminalEvent(record.session_id, {
          kind: ev.kind, text: ev.text, trust: ev.trust,
          ts_ms: tsMs, source: 'transcript'
        });
      } catch { /* broadcast best-effort */ }
      fanoutMessageToLinkedChatRoom({
        terminalSessionId: record.session_id,
        transcriptEventId: evKey,
        kind: ev.kind,
        text: ev.text
      });
      ingested += 1;
    }
  }

  tailStates.set(record.session_id, { jsonlPath, byteOffset: newOffset, lineRemainder });
  return ingested;
}

export function tailAllOnce(): number {
  let total = 0;
  for (const r of listTerminalRecords()) {
    total += tailOnceForTerminal(r);
  }
  return total;
}

export function ensureGenericTranscriptTailWatcherBooted(): void {
  const g = globalThis as unknown as Record<string, boolean | undefined>;
  if (g[BOOT_KEY]) return;
  g[BOOT_KEY] = true;
  setInterval(() => {
    try { tailAllOnce(); } catch { /* poll best-effort */ }
  }, POLL_INTERVAL_MS).unref?.();
}

export function _resetGenericTranscriptTailStateForTests(): void {
  tailStates.clear();
}

export const _internals = {
  readAppendedBytes,
  tailStates,
  POLL_INTERVAL_MS
};
