/**
 * Structured-event JSON markers — agents emit
 *   `[ANT-EV]{"kind":"thinking","text":"..."}[/ANT-EV]`
 * inline anywhere in their output. The marker pre-processor extracts
 * those payloads as HIGH-TRUST classified events and returns the buffer
 * with markers stripped, ready for downstream per-CLI heuristic
 * classification (T2c-impl-3 per terminals-output-classifier-design Q4).
 *
 * Marker shape kept simple for v1: brackets + JSON + brackets. Multi-line
 * JSON payloads are unsupported — agents must serialise payload onto a
 * single line per emit.
 */

import type { ClassifiedEvent, ClassifiedKind } from './types';

const MARKER_RE = /\[ANT-EV\](\{[^\n]*?\})\[\/ANT-EV\]/g;
const ALLOWED_KINDS: ReadonlySet<string> =
  new Set(['raw', 'message', 'thinking', 'tool_call', 'command', 'agent_prompt']);

export type StructuredExtractResult = {
  events: ClassifiedEvent[];
  cleaned: string;
};

export function extractStructuredEvents(buffer: string): StructuredExtractResult {
  const events: ClassifiedEvent[] = [];
  if (buffer.length === 0) return { events, cleaned: '' };
  let cleaned = '';
  let cursor = 0;
  for (const match of buffer.matchAll(MARKER_RE)) {
    const idx = match.index ?? 0;
    cleaned += buffer.slice(cursor, idx);
    cursor = idx + match[0].length;
    try {
      const parsed = JSON.parse(match[1]) as { kind?: unknown; text?: unknown };
      if (typeof parsed.kind === 'string' && ALLOWED_KINDS.has(parsed.kind)) {
        events.push({
          kind: parsed.kind as ClassifiedKind,
          text: typeof parsed.text === 'string' ? parsed.text : '',
          trust: 'high'
        });
      }
    } catch { /* malformed JSON in marker → drop the marker */ }
  }
  cleaned += buffer.slice(cursor);
  return { events, cleaned };
}
