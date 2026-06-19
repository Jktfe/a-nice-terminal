/**
 * Port audit (2026-06-19): source
 * codex/desk-core-model:src/lib/server/terminalDeskAntView.ts lines 1-131.
 * Verdict: CHANGE. vNext simplification: keep the server-classified block
 * envelope but point it at the deployed /api/desks facade model and include
 * the existing `command_block` run-event kind as a command.
 */

import { getTerminalDesk, TerminalDeskError, type TerminalDesk } from './terminalDeskFacade';
import {
  listLatestTerminalRunEvents,
  listTerminalRunEventsSince,
  searchTerminalRunEvents,
  type TerminalRunEvent,
  type TerminalRunEventTrust
} from './terminalRunEventsStore';

export type TerminalDeskAntViewKind =
  | 'command'
  | 'message'
  | 'thinking'
  | 'tool'
  | 'output'
  | 'status'
  | 'raw'
  | 'other';

export type TerminalDeskAntViewBlock = {
  id: string;
  deskId: string;
  terminalId: string;
  eventId: number;
  tsMs: number;
  source: string;
  trust: TerminalRunEventTrust;
  kind: string;
  viewKind: TerminalDeskAntViewKind;
  text: string;
  payload: Record<string, unknown>;
  rawRef: string | null;
};

export type TerminalDeskAntView = {
  desk: TerminalDesk;
  blocks: TerminalDeskAntViewBlock[];
  mode: 'latest' | 'since' | 'search';
  query: string | null;
  includeRaw: boolean;
  limit: number;
};

function parsePayload(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function viewKindFor(kind: string): TerminalDeskAntViewKind {
  switch (kind) {
    case 'command':
    case 'command_block':
    case 'agent_prompt':
      return 'command';
    case 'message':
    case 'assistant_message':
    case 'user_message':
      return 'message';
    case 'thinking':
    case 'reasoning':
      return 'thinking';
    case 'tool_call':
    case 'tool_result':
    case 'function_call':
    case 'function_call_output':
      return 'tool';
    case 'success':
    case 'status':
    case 'system':
      return 'status';
    case 'raw':
      return 'raw';
    case 'output':
    case 'stderr':
    case 'error':
      return 'output';
    default:
      return 'other';
  }
}

function eventToBlock(deskId: string, event: TerminalRunEvent): TerminalDeskAntViewBlock {
  return {
    id: `${event.terminal_id}:${event.id}`,
    deskId,
    terminalId: event.terminal_id,
    eventId: event.id,
    tsMs: event.ts_ms,
    source: event.source,
    trust: event.trust,
    kind: event.kind,
    viewKind: viewKindFor(event.kind),
    text: event.text,
    payload: parsePayload(event.payload),
    rawRef: event.raw_ref
  };
}

export function getTerminalDeskAntView(input: {
  deskId: string;
  limit?: number;
  sinceMs?: number | null;
  query?: string | null;
  includeRaw?: boolean;
}): TerminalDeskAntView {
  const desk = getTerminalDesk(input.deskId);
  if (!desk) throw new TerminalDeskError(404, 'Desk not found.');
  const limit = Math.max(1, Math.min(1000, input.limit ?? 200));
  const includeRaw = input.includeRaw === true;
  const kinds = includeRaw
    ? undefined
    : [
        'agent_prompt',
        'command',
        'command_block',
        'message',
        'assistant_message',
        'user_message',
        'thinking',
        'reasoning',
        'tool_call',
        'tool_result',
        'function_call',
        'function_call_output',
        'success',
        'status',
        'system',
        'output',
        'stderr',
        'error'
      ];
  const query = input.query?.trim() ?? '';
  const events = query.length > 0
    ? searchTerminalRunEvents(desk.deskId, query, limit, kinds)
    : input.sinceMs !== null && input.sinceMs !== undefined
      ? listTerminalRunEventsSince(desk.deskId, input.sinceMs, limit, kinds)
      : listLatestTerminalRunEvents(desk.deskId, limit, kinds);
  return {
    desk,
    blocks: events.map((event) => eventToBlock(desk.deskId, event)),
    mode: query.length > 0 ? 'search' : input.sinceMs !== null && input.sinceMs !== undefined ? 'since' : 'latest',
    query: query.length > 0 ? query : null,
    includeRaw,
    limit
  };
}
