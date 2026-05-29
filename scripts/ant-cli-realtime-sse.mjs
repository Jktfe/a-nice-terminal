/**
 * ant-cli-realtime-sse.mjs — SSE consumer for /api/realtime/:roomId/events.
 *
 * 0.1.12 (JWPK Tauri room msg_oiu700bmel 2026-05-29): replaces the
 * router's GET-on-a-loop polling with a server-sent-events long-poll
 * so the Mac server's `broadcastToRoom` reaches the Windows / remote
 * router as soon as the message is written, with no per-room poll
 * cadence to tune.
 *
 * Server contract recap (eventBroadcast.ts):
 *   - Connection opens with `: connected\n\n` then
 *     `data: {"type":"connected","latest_seq":N}\n\n`.
 *   - Each broadcast lands as `id: <seq>\ndata: <json>\n\n` where the
 *     JSON is `{ type: 'message_added', message: {...}, seq: N }` (or
 *     other event types we may add later).
 *   - 25 s `: heartbeat\n\n` keeps proxies + browsers happy. We treat
 *     them as keepalive only — no callback fires.
 *
 * Reconnect: the EventSource browser API auto-reconnects on drop and
 * sends `Last-Event-ID` so the server can resume. Node doesn't have
 * a built-in EventSource, so this module rolls one with the same
 * semantics: exponential backoff capped at 30 s, `Last-Event-ID`
 * header set from the last `id:` line we saw.
 *
 * Auth: mirrors fetchRoomJsonWithBrowserSessionFallback — bearer
 * first (from ~/.ant/config.json tokens[roomId]) then the legacy
 * pidChain-in-URL path. The server's requireChatRoomReadAccess gates
 * accept both. No new server-side work needed for this slice.
 */

import { setTimeout as sleep } from 'node:timers/promises';
import { processIdentityChain } from './ant-cli-identity-chain.mjs';

const RECONNECT_INITIAL_MS = 500;
const RECONNECT_MAX_MS = 30_000;

/** Pull a room token from runtime.config.tokens — same dual-shape
 *  walk as ant-cli-browser-session.mjs lookupRoomToken (PR #68). */
function lookupRoomToken(runtime, roomId) {
  if (typeof roomId !== 'string' || roomId.length === 0) return null;
  const tokens = runtime.config?.tokens;
  if (!tokens || typeof tokens !== 'object') return null;
  const entry = tokens[roomId];
  if (!entry || typeof entry !== 'object') return null;
  if (typeof entry.token === 'string' && entry.token.length > 0) return entry.token;
  const byHandle = entry.byHandle;
  if (byHandle && typeof byHandle === 'object') {
    const defaultHandle = typeof entry.default_handle === 'string' ? entry.default_handle : null;
    const candidate = (defaultHandle && byHandle[defaultHandle]) ?? Object.values(byHandle)[0];
    if (candidate && typeof candidate === 'object'
        && typeof candidate.token === 'string'
        && candidate.token.length > 0) {
      return candidate.token;
    }
  }
  return null;
}

function appendPidChainQuery(url) {
  const chain = processIdentityChain();
  const parsed = new URL(url);
  parsed.searchParams.set('pidChain', JSON.stringify(chain));
  return parsed.toString();
}

/** Build the URL + headers for the SSE connection. Bearer-first when a
 *  room token is in config; otherwise pidChain query param. Both paths
 *  are accepted by requireChatRoomReadAccess. */
function buildSseRequest(runtime, roomId, lastEventId) {
  const base = runtime.serverUrl;
  const pathOnly = `${base}/api/realtime/${encodeURIComponent(roomId)}/events`;
  const bearerToken = lookupRoomToken(runtime, roomId);
  const headers = { accept: 'text/event-stream' };
  if (lastEventId !== null && lastEventId !== undefined) {
    headers['last-event-id'] = String(lastEventId);
  }
  if (bearerToken) {
    headers.authorization = `Bearer ${bearerToken}`;
    headers.origin = base;
    return { url: pathOnly, headers };
  }
  return { url: appendPidChainQuery(pathOnly), headers };
}

/**
 * Parse a raw SSE block into { id, eventType, data } where data is the
 * JSON-parsed payload (or null when the payload didn't parse). Returns
 * null when the block is a comment (`:`-prefixed line, e.g. heartbeats)
 * or has no `data:` line.
 *
 * Block shape per the SSE spec: a record is a series of `field: value`
 * lines terminated by a blank line. We treat `id`, `event`, and `data`
 * as the only meaningful fields.
 */
export function parseSseBlock(blockText) {
  if (typeof blockText !== 'string' || blockText.length === 0) return null;
  let id = null;
  let eventType = 'message';
  const dataLines = [];
  let sawData = false;
  for (const line of blockText.split('\n')) {
    if (line.length === 0) continue;
    if (line.startsWith(':')) continue; // comment / heartbeat
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;
    const field = line.slice(0, colonIndex);
    // Per spec, a single space after the colon is stripped if present.
    const rawValue = line.slice(colonIndex + 1);
    const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;
    if (field === 'id') id = value;
    else if (field === 'event') eventType = value;
    else if (field === 'data') { dataLines.push(value); sawData = true; }
  }
  if (!sawData) return null;
  const joined = dataLines.join('\n');
  let data = null;
  try { data = JSON.parse(joined); } catch { /* malformed — caller skips */ }
  return { id, eventType, data };
}

/**
 * Read SSE blocks from a Response body and dispatch them. Blocks are
 * delimited by `\n\n` per the spec. Heartbeats (`: heartbeat`) and
 * comment-only blocks return null from parseSseBlock and are skipped.
 *
 * Returns the last seen `id` so the caller can pass it as
 * `Last-Event-ID` on reconnect.
 */
async function drainEventStream(response, onEvent, getLastEventId, setLastEventId) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('SSE response has no body');
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE block separator is `\n\n`. Keep the unterminated tail for
    // the next chunk.
    let separatorIndex = buffer.indexOf('\n\n');
    while (separatorIndex !== -1) {
      const block = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      const parsed = parseSseBlock(block);
      if (parsed) {
        if (parsed.id !== null) setLastEventId(parsed.id);
        try { onEvent(parsed); }
        catch { /* consumer error MUST NOT kill the stream */ }
      }
      separatorIndex = buffer.indexOf('\n\n');
    }
  }
  return getLastEventId();
}

/**
 * Open the SSE connection. Returns a controller with `.stop()` to
 * close cleanly. Reconnects with exponential backoff on disconnect
 * until `.stop()` is called.
 *
 * @param {object} options
 * @param {object} options.runtime    — CLI runtime (config + serverUrl + fetchImpl)
 * @param {string} options.roomId
 * @param {(event: {id: string|null, eventType: string, data: unknown}) => void} options.onEvent
 * @param {(error: Error, attempt: number) => void=} options.onError
 * @param {(latestSeq: unknown) => void=} options.onConnected
 * @param {object=} options.sleepImpl — injected for tests
 * @returns {{ stop: () => void }}
 */
export function startSseSubscriber(options) {
  const { runtime, roomId, onEvent, onError, onConnected } = options;
  const sleepImpl = options.sleepImpl ?? sleep;
  const fetchImpl = runtime.fetchImpl ?? globalThis.fetch;
  let running = true;
  let lastEventId = null;
  let attempt = 0;
  let abortController = null;

  const loop = async () => {
    while (running) {
      const { url, headers } = buildSseRequest(runtime, roomId, lastEventId);
      abortController = new AbortController();
      try {
        const response = await fetchImpl(url, {
          method: 'GET',
          headers,
          signal: abortController.signal
        });
        if (!response.ok) {
          throw new Error(`SSE returned HTTP ${response.status}`);
        }
        attempt = 0;
        if (typeof onConnected === 'function') {
          // First event is `connected` with latest_seq — surface it
          // via the same onEvent dispatch; the caller can pick it
          // up from there too. onConnected is convenience for the
          // immediate-readiness case.
          onConnected(null);
        }
        await drainEventStream(
          response,
          onEvent,
          () => lastEventId,
          (id) => { lastEventId = id; }
        );
        // Stream ended cleanly (server closed). Loop reconnects.
        if (!running) return;
      } catch (cause) {
        if (!running) return;
        attempt += 1;
        if (typeof onError === 'function') {
          onError(cause instanceof Error ? cause : new Error(String(cause)), attempt);
        }
      }
      if (!running) return;
      const delay = Math.min(RECONNECT_INITIAL_MS * 2 ** Math.max(0, attempt - 1), RECONNECT_MAX_MS);
      await sleepImpl(delay);
    }
  };
  void loop();

  return {
    stop: () => {
      running = false;
      if (abortController) {
        try { abortController.abort(); } catch { /* already aborted */ }
      }
    }
  };
}
