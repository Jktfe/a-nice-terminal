/**
 * piAdapter — translate Pi `--mode rpc` events into cli_hook_events
 * rows (CLI-HOOK-BRIDGE Phase 3, 2026-05-15, JWPK).
 *
 * Per the pi blueprint (2026-05-15 research agent report):
 *   - Pi `--mode rpc` emits LF-delimited JSONL events on stdout.
 *   - Events are server-pushed (no `id` field, distinct from RPC responses
 *     which have `id`).
 *   - Pi's own framer at `packages/coding-agent/src/modes/rpc/jsonl.ts`
 *     uses StringDecoder + indexOf('\n') — replicate that exact pattern,
 *     NEVER use Node `readline` (splits on U+2028/U+2029 too).
 *   - Pi session id is fetched once via the `get_state` RPC command.
 *     Events themselves do NOT carry a session id field (Pi assumes 1:1
 *     between rpc process and session).
 *
 *   - Event vocabulary (selected high-signal subset; full catalogue in
 *     blueprint):
 *       agent_start            → SessionStart equivalent (per-turn? we use it once per process boot)
 *       agent_end              → Stop (turn completed)
 *       turn_start / turn_end  → UserPromptSubmit / Stop
 *       message_start          → AssistantStart
 *       message_end            → AssistantComplete
 *       message_update         → DROP (token-level delta, too noisy)
 *       tool_execution_start   → PreToolUse (with toolName, args)
 *       tool_execution_update  → DROP (cumulative progress, noisy)
 *       tool_execution_end     → PostToolUse (with result, isError)
 *       compaction_start       → PreCompact (with reason: manual|threshold|overflow)
 *       compaction_end         → PostCompact (with result/aborted/willRetry)
 *       auto_retry_*           → boundary chip, persist as-is
 *       queue_update           → DROP (noisy steering queue change)
 *       extension_error        → SystemError
 *       extension_ui_request   → DROP (would need stdin reply; out of scope)
 *
 * This module ships PURE TRANSLATION + the safe JSONL line reader. Spawn
 * orchestration (child_process.spawn, kill discipline, version probe) is
 * a separate slice once we wire it into ANT's terminal-spawn lifecycle.
 */

import { StringDecoder } from 'node:string_decoder';
import {
  insertCliHookEvent,
  type CliHookEventInsert,
  type CliHookEventRow
} from '../cliHookEventsStore';

export type PiRpcEvent = {
  type: string;
  [key: string]: unknown;
};

export type PiAdapterState = {
  /** sessionId fetched via get_state — required for persistence. */
  currentSessionId: string | null;
  /** True if we've persisted a SessionStart for the current sessionId. */
  sessionStartLogged: boolean;
};

export function makePiAdapterState(): PiAdapterState {
  return { currentSessionId: null, sessionStartLogged: false };
}

const DROP_EVENT_TYPES = new Set([
  'message_update',
  'tool_execution_update',
  'queue_update',
  'extension_ui_request'
]);

/**
 * Translate one Pi RPC event into a CliHookEventInsert. Returns null if
 * the event should be dropped (noisy delta) or if currentSessionId is
 * unset (we haven't called get_state yet — drop until known).
 */
export function translatePiEvent(
  event: PiRpcEvent,
  state: PiAdapterState
): CliHookEventInsert | null {
  if (!event || typeof event.type !== 'string') return null;
  if (DROP_EVENT_TYPES.has(event.type)) return null;

  const sessionId = state.currentSessionId;
  if (!sessionId) return null;

  const type = event.type;
  const payload: Record<string, unknown> = { ...event };

  if (type === 'agent_start' || type === 'turn_start') {
    // Map turn_start to UserPromptSubmit; agent_start to SessionStart (once).
    if (type === 'agent_start' && !state.sessionStartLogged) {
      state.sessionStartLogged = true;
      return { sourceCli: 'pi', sessionId, hookEventName: 'SessionStart', payload };
    }
    return { sourceCli: 'pi', sessionId, hookEventName: 'UserPromptSubmit', payload };
  }

  if (type === 'agent_end' || type === 'turn_end') {
    return { sourceCli: 'pi', sessionId, hookEventName: 'Stop', payload };
  }

  if (type === 'message_start') return { sourceCli: 'pi', sessionId, hookEventName: 'AssistantStart', payload };
  if (type === 'message_end') return { sourceCli: 'pi', sessionId, hookEventName: 'AssistantComplete', payload };

  if (type === 'tool_execution_start') {
    const toolName = typeof event.toolName === 'string' ? event.toolName : undefined;
    const toolUseId = typeof event.toolCallId === 'string' ? event.toolCallId : undefined;
    return { sourceCli: 'pi', sessionId, hookEventName: 'PreToolUse', toolName, toolUseId, payload };
  }
  if (type === 'tool_execution_end') {
    const toolName = typeof event.toolName === 'string' ? event.toolName : undefined;
    const toolUseId = typeof event.toolCallId === 'string' ? event.toolCallId : undefined;
    return { sourceCli: 'pi', sessionId, hookEventName: 'PostToolUse', toolName, toolUseId, payload };
  }

  if (type === 'compaction_start') return { sourceCli: 'pi', sessionId, hookEventName: 'PreCompact', payload };
  if (type === 'compaction_end') return { sourceCli: 'pi', sessionId, hookEventName: 'PostCompact', payload };

  if (type === 'auto_retry_start') return { sourceCli: 'pi', sessionId, hookEventName: 'AutoRetryStart', payload };
  if (type === 'auto_retry_end') return { sourceCli: 'pi', sessionId, hookEventName: 'AutoRetryEnd', payload };

  if (type === 'extension_error') return { sourceCli: 'pi', sessionId, hookEventName: 'SystemError', payload };

  // Unknown event type — persist as-is for forensic value.
  return { sourceCli: 'pi', sessionId, hookEventName: `PiEvent:${type}`, payload };
}

/**
 * Safe LF-only JSONL line splitter for Pi's stdout. Matches Pi's own
 * `packages/coding-agent/src/modes/rpc/jsonl.ts` semantics:
 *   - Split on LF (0x0A) ONLY — never the regex `\r?\n` (would split
 *     on U+2028/U+2029 too if used naively).
 *   - Strip a trailing `\r` per LF-strict, CR-tolerant.
 *   - Skip empty lines.
 *
 * Returns a function `feed(chunk)` that appends bytes and invokes
 * `onLine` for each completed line, plus `end()` to flush any final
 * line without a trailing LF.
 */
export function makePiJsonlLineReader(
  onLine: (line: string) => void,
  onError: (error: Error) => void = () => {}
): {
  feed(chunk: Buffer | string): void;
  end(): void;
} {
  const decoder = new StringDecoder('utf8');
  let buffer = '';

  function feed(chunk: Buffer | string): void {
    try {
      buffer += typeof chunk === 'string' ? chunk : decoder.write(chunk);
      while (true) {
        const lfIndex = buffer.indexOf('\n');
        if (lfIndex === -1) break;
        let line = buffer.slice(0, lfIndex);
        buffer = buffer.slice(lfIndex + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        if (line.length === 0) continue;
        onLine(line);
      }
    } catch (cause) {
      onError(cause instanceof Error ? cause : new Error(String(cause)));
    }
  }

  function end(): void {
    buffer += decoder.end();
    if (buffer.length === 0) return;
    let tail = buffer;
    if (tail.endsWith('\r')) tail = tail.slice(0, -1);
    buffer = '';
    if (tail.length > 0) onLine(tail);
  }

  return { feed, end };
}

/**
 * Build a stdout consumer that parses LF-JSONL, translates Pi events,
 * and persists them. Returns the dispatch helpers so the spawn glue
 * (when it lands) can wire feed/end to a child process's stdout stream.
 */
export function attachPiAdapter(state: PiAdapterState = makePiAdapterState()): {
  state: PiAdapterState;
  feedStdout(chunk: Buffer | string): void;
  endStdout(): void;
  dispatchEvent(event: PiRpcEvent): CliHookEventRow | null;
  persistedCount: number;
  droppedCount: number;
  malformedCount: number;
} {
  let persistedCount = 0;
  let droppedCount = 0;
  let malformedCount = 0;

  function dispatchEvent(event: PiRpcEvent): CliHookEventRow | null {
    const insert = translatePiEvent(event, state);
    if (!insert) { droppedCount += 1; return null; }
    const row = insertCliHookEvent(insert);
    persistedCount += 1;
    return row;
  }

  const reader = makePiJsonlLineReader(
    (line) => {
      try {
        const parsed = JSON.parse(line);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          // RPC responses have an `id` field; events do not. Skip responses.
          if ('id' in parsed) return;
          dispatchEvent(parsed as PiRpcEvent);
        }
      } catch {
        malformedCount += 1;
      }
    }
  );

  return {
    state,
    feedStdout: reader.feed,
    endStdout: reader.end,
    dispatchEvent,
    get persistedCount() { return persistedCount; },
    get droppedCount() { return droppedCount; },
    get malformedCount() { return malformedCount; }
  };
}
