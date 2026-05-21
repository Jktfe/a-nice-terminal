/**
 * codexAdapter — translate Codex app-server JSON-RPC notifications into
 * cli_hook_events rows (CLI-HOOK-BRIDGE Phase 2, 2026-05-15, JWPK).
 *
 * Per the codex blueprint (2026-05-15 research agent report):
 *   - Codex app-server emits JSON-RPC notifications over stdio/ws/unix
 *   - Six notification methods we care about:
 *       thread/started          → SessionStart (with threadId)
 *       turn/started            → UserPromptSubmit (begin of turn)
 *       turn/completed          → Stop (end of turn, with status)
 *       item/started            → PreToolUse / boundary marker per item kind
 *       item/completed          → PostToolUse / boundary marker per item kind
 *       item/agentMessage/delta → streaming delta (we DROP these; too noisy
 *                                 for the hook-events surface; only the
 *                                 enclosing item/completed is persisted)
 *
 *   - `threadId` is NOT carried on every notification. We track it from
 *     the most recent `thread/started` and inject it on subsequent
 *     turn/item notifications.
 *
 *   - ThreadItem kinds we map to a "tool" name when relevant:
 *       commandExecution → tool_name='Bash'
 *       fileChange       → tool_name='FileChange'
 *       mcpToolCall      → tool_name=`mcp:${name}` (if available in params)
 *       collabToolCall   → tool_name='CollabTool'
 *       webSearch        → tool_name='WebSearch'
 *       userMessage      → not a tool; treat as UserPromptSubmit
 *       agentMessage     → not a tool; treat as AssistantMessage (custom)
 *
 * This module ships PURE TRANSLATION ONLY. The spawn/connect glue
 * (vscode-jsonrpc + NDJSON reader/writer + reconnect) is a separate slice
 * because exercising it end-to-end needs a real codex binary present and
 * is more brittle to unit-test.
 */

import {
  insertCliHookEvent,
  type CliHookEventInsert,
  type CliHookEventRow
} from '../cliHookEventsStore';

export type CodexNotification = {
  method: string;
  params?: Record<string, unknown> | null;
};

export type CodexAdapterState = {
  /** Most recently seen thread id; used to stamp non-thread/* notifications. */
  currentThreadId: string | null;
  /** Most recently observed item id per session for correlation. */
  lastItemIdByThread: Map<string, string>;
};

export function makeCodexAdapterState(): CodexAdapterState {
  return { currentThreadId: null, lastItemIdByThread: new Map() };
}

type ThreadItemKind =
  | 'userMessage' | 'agentMessage' | 'plan' | 'reasoning'
  | 'commandExecution' | 'fileChange' | 'mcpToolCall' | 'collabToolCall'
  | 'webSearch' | 'imageView' | 'enteredReviewMode' | 'exitedReviewMode'
  | 'contextCompaction' | 'compacted';

function itemKindFrom(itemParams: Record<string, unknown> | undefined): ThreadItemKind | undefined {
  if (!itemParams) return undefined;
  const item = itemParams.item;
  if (!item || typeof item !== 'object') return undefined;
  const kind = (item as { type?: string; kind?: string }).type ?? (item as { kind?: string }).kind;
  if (typeof kind === 'string') return kind as ThreadItemKind;
  return undefined;
}

function toolNameForItemKind(kind: ThreadItemKind | undefined, itemParams: Record<string, unknown> | undefined): string | undefined {
  if (!kind) return undefined;
  if (kind === 'commandExecution') return 'Bash';
  if (kind === 'fileChange') return 'FileChange';
  if (kind === 'collabToolCall') return 'CollabTool';
  if (kind === 'webSearch') return 'WebSearch';
  if (kind === 'mcpToolCall') {
    const item = (itemParams?.item as { name?: string } | undefined);
    if (item && typeof item.name === 'string') return `mcp:${item.name}`;
    return 'mcp:unknown';
  }
  return undefined;
}

function itemIdFrom(itemParams: Record<string, unknown> | undefined): string | undefined {
  if (!itemParams) return undefined;
  const item = itemParams.item;
  if (!item || typeof item !== 'object') return undefined;
  const id = (item as { id?: string }).id;
  return typeof id === 'string' ? id : undefined;
}

/**
 * Translate one Codex notification into a CliHookEventInsert (or null if
 * the notification should be dropped — e.g. streaming agentMessage deltas).
 */
export function translateCodexNotification(
  notification: CodexNotification,
  state: CodexAdapterState
): CliHookEventInsert | null {
  const params = (notification.params ?? {}) as Record<string, unknown>;
  const method = notification.method;

  // Drop the high-frequency streaming notification — it would flood the
  // hook events table. The enclosing item/completed carries the final text.
  if (method === 'item/agentMessage/delta') return null;

  if (method === 'thread/started') {
    const thread = (params.thread as { id?: string } | undefined);
    const threadId = (typeof thread?.id === 'string') ? thread.id : null;
    if (threadId) state.currentThreadId = threadId;
    if (!threadId) return null;
    return {
      sourceCli: 'codex',
      sessionId: threadId,
      hookEventName: 'SessionStart',
      payload: { method, params }
    };
  }

  // For turn/* and item/*, we need a thread id. If absent, drop.
  const sessionId = state.currentThreadId;
  if (!sessionId) return null;

  if (method === 'turn/started') {
    return {
      sourceCli: 'codex',
      sessionId,
      hookEventName: 'UserPromptSubmit',
      payload: { method, params }
    };
  }

  if (method === 'turn/completed') {
    const turn = (params.turn as { status?: string } | undefined);
    return {
      sourceCli: 'codex',
      sessionId,
      hookEventName: 'Stop',
      payload: { method, params, status: turn?.status }
    };
  }

  if (method === 'item/started' || method === 'item/completed') {
    const kind = itemKindFrom(params);
    const toolName = toolNameForItemKind(kind, params);
    const itemId = itemIdFrom(params);
    if (itemId) state.lastItemIdByThread.set(sessionId, itemId);

    // Map item kinds to a hook-event-name flavour that ANT's UI can read:
    let hookEventName: string;
    if (kind === 'userMessage') hookEventName = method === 'item/started' ? 'UserPromptSubmit' : 'UserPromptCompleted';
    else if (kind === 'agentMessage') hookEventName = method === 'item/started' ? 'AssistantStart' : 'AssistantComplete';
    else if (kind === 'contextCompaction') hookEventName = method === 'item/started' ? 'PreCompact' : 'PostCompact';
    else if (toolName) hookEventName = method === 'item/started' ? 'PreToolUse' : 'PostToolUse';
    else hookEventName = method === 'item/started' ? `ItemStart:${kind ?? 'unknown'}` : `ItemEnd:${kind ?? 'unknown'}`;

    return {
      sourceCli: 'codex',
      sessionId,
      hookEventName,
      toolName,
      toolUseId: itemId,
      payload: { method, params, item_kind: kind }
    };
  }

  // Unknown notification: persist as-is for forensic value, but only if
  // we have a session id (we always do at this point).
  return {
    sourceCli: 'codex',
    sessionId,
    hookEventName: `Notification:${method}`,
    payload: { method, params }
  };
}

/**
 * Subscribe to a Codex-like notification source. The source can be
 * anything with `.onNotification(method, handler)` — the real connection
 * is vscode-jsonrpc's MessageConnection in production; tests pass a
 * MockEmitter.
 */
export type CodexNotificationSource = {
  onNotification(method: string, handler: (params: unknown) => void): void;
};

export function attachCodexAdapter(
  source: CodexNotificationSource,
  state: CodexAdapterState = makeCodexAdapterState()
): {
  state: CodexAdapterState;
  persistedCount: number;
  droppedCount: number;
  dispatch(notification: CodexNotification): CliHookEventRow | null;
} {
  let persistedCount = 0;
  let droppedCount = 0;

  function dispatch(notification: CodexNotification): CliHookEventRow | null {
    const insert = translateCodexNotification(notification, state);
    if (!insert) { droppedCount += 1; return null; }
    const row = insertCliHookEvent(insert);
    persistedCount += 1;
    return row;
  }

  const subscribedMethods = [
    'thread/started',
    'turn/started',
    'turn/completed',
    'item/started',
    'item/completed',
    'item/agentMessage/delta'
  ];
  for (const method of subscribedMethods) {
    source.onNotification(method, (params) => {
      dispatch({ method, params: (params ?? {}) as Record<string, unknown> });
    });
  }

  return {
    state,
    get persistedCount() { return persistedCount; },
    get droppedCount() { return droppedCount; },
    dispatch
  };
}
