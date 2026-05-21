/**
 * transcriptTailParser — generic parser plugin interface for transcript-tail
 * watchers. Each CLI kind implements a parser that knows:
 *   - which agent_kinds it matches
 *   - where to find JSONL files for a given terminal record
 *   - how to parse a JSONL line into mapped events
 *   - how to extract context-fill telemetry from a line
 *   - how to extract a native id for idempotency
 *
 * The genericTranscriptTailWatcher imports all parsers and dispatches
 * per-terminal based on agent_kind. New CLIs = new parser file + registry
 * entry, no watcher duplication.
 */

import type { ClassifiedKind } from './classifiers/types';
import type { TerminalRunEventTrust } from './terminalRunEventsStore';
import type { ContextFillReading } from './contextFillTelemetry';

export type MappedEvent = {
  kind: ClassifiedKind;
  text: string;
  trust: TerminalRunEventTrust;
};

export type TranscriptTailParser = {
  /** Short name for logging. */
  name: string;

  /** Which agent_kind values this parser handles. */
  agentKinds: Set<string>;

  /**
   * Find the JSONL file to tail for this terminal.
   * @param record — terminal record from terminalRecordsStore
   * @param tailState — current tail state (may be null on first attach)
   * @returns absolute path to JSONL, or null if not found / not ready
   */
  findJsonlPath(record: {
    session_id: string;
    agent_kind: string | null;
    tmux_target_pane: string | null;
    created_at_ms: number;
  }, tailState: { jsonlPath: string } | null): string | null;

  /**
   * Parse a raw JSONL line into 0+ mapped events.
   */
  parseLine(rawLine: string): MappedEvent[];

  /**
   * Extract a native per-line id for idempotency, or null if unavailable.
   */
  nativeIdFromLine(rawLine: string): string | null;

  /**
   * Extract context-fill telemetry from a line, or null.
   */
  readContextFill(rawLine: string): ContextFillReading | null;
};

const PARSERS = new Map<string, TranscriptTailParser>();

export function registerTranscriptTailParser(parser: TranscriptTailParser): void {
  for (const kind of parser.agentKinds) {
    PARSERS.set(kind, parser);
  }
}

export function getTranscriptTailParser(agentKind: string | null): TranscriptTailParser | null {
  if (!agentKind) return null;
  return PARSERS.get(agentKind) ?? null;
}

export function listRegisteredTranscriptTailParsers(): string[] {
  return Array.from(new Set(PARSERS.values()).values()).map((p) => p.name);
}

export function resetTranscriptTailParsersForTests(): void {
  PARSERS.clear();
}
