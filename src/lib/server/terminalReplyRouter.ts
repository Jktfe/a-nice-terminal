/**
 * terminalReplyRouter — bidirectional half of T2-LINKED-CHAT.
 *
 * Outbound (T1b/T1c, shipped earlier): user → agent-launch → fanout →
 *   PTY paste. Working.
 * Inbound (THIS): agent stdout → kind=message run_events → debounce →
 *   noise-filter → postMessage to terminal_record.linked_chat_room_id
 *   as kind=agent + authorHandle=deriveHandle(record).
 *
 * Per JWPK gap diagnosed 2026-05-14: claude TUI replies show up in the
 * ANT view but never reach the linked chat room — Chat shows just the
 * user's question and nothing back. This subscriber closes the loop.
 *
 * Scope guard: only fires for agent-backed terminals (agentKind != null).
 * Bare shell output stays in ANT view only — would be noise in chat.
 */

import { getTerminalRecord, deriveHandle } from './terminalRecordsStore';
import { findChatRoomById } from './chatRoomStore';
import { postMessage } from './chatMessageStore';
import { broadcastToRoom } from './eventBroadcast';
import { isClaudeTuiChrome } from './classifiers/claudeCode';

// delta-1 (2026-05-15, JWPK Terminal 23:52): old DEBOUNCE_MS=500 split
// claude's reply across 5 fragment messages. Bump to 2500ms idle window so
// the full reply lands as ONE chat message.
const DEBOUNCE_MS = 2500;
// delta-1: bump min length to 30 (was 20) per JWPK content-quality bar.
const MIN_TEXT_LEN = 30;
// delta-1: identical content within DEDUPE_WINDOW_MS collapses (claude's
// re-render echoes the same reply 5x before idle).
const DEDUPE_WINDOW_MS = 5000;
const lastFlushed = new Map<string, { text: string; ts: number }>();
// Noise patterns we never want to surface as agent replies, even if the
// classifier marked them as kind=message. Each is matched against the
// CONCATENATED debounce window before posting.
const NOISE_PATTERNS: RegExp[] = [
  /bypass\s+permissions/i,
  /Remote\s+Control/i,
  /^\s*sent:.*resp:.*edit:/i,
  /^[\s│─├└┌┐┘┤┬┴┼qmwlk]+$/,    // box-drawing only
  /^[_=\-*\s]+$/,                 // separator-only
  /^\[ANT room/i,                 // pty-inject envelope echoed back
  /\[ant-ev\]/i                   // structured marker
];

// Per-terminal pending state: timer + accumulated lines.
type Pending = {
  timer: ReturnType<typeof setTimeout>;
  lines: string[];
};
const pending = new Map<string, Pending>();

function hasWordChars(text: string): boolean {
  return /[A-Za-z]{3,}/.test(text);
}

// delta-1: content-quality filter — text where less than half the chars
// are word-chars is almost certainly TUI residue or punctuation noise.
function isMostlyWordChars(text: string): boolean {
  const wordChars = (text.match(/[A-Za-z0-9]/g) ?? []).length;
  return wordChars * 2 >= text.length; // ≥50% word chars
}

function isNoise(text: string): boolean {
  return NOISE_PATTERNS.some((re) => re.test(text));
}

function flush(sessionId: string): void {
  const p = pending.get(sessionId);
  if (!p) return;
  pending.delete(sessionId);
  const text = p.lines.join('\n').trim();
  if (text.length < MIN_TEXT_LEN) return;
  if (!hasWordChars(text)) return;
  if (isNoise(text)) return;
  // delta-1: content-quality + defense-in-depth chrome filter at routing
  // boundary. Catches TUI residue that slipped through classifier.
  if (!isMostlyWordChars(text)) return;
  if (isClaudeTuiChrome(text)) return;
  // delta-1: dedupe identical content within 5s (claude re-renders).
  const last = lastFlushed.get(sessionId);
  const now = Date.now();
  if (last && last.text === text && (now - last.ts) < DEDUPE_WINDOW_MS) return;

  const record = getTerminalRecord(sessionId);
  if (!record) return;
  if (!record.agent_kind) return;
  const roomId = record.linked_chat_room_id;
  if (!roomId) return;
  if (!findChatRoomById(roomId)) return;

  const authorHandle = deriveHandle(record);
  try {
    const newMessage = postMessage({
      roomId, authorHandle, body: text, kind: 'agent'
    });
    lastFlushed.set(sessionId, { text, ts: now });
    try {
      broadcastToRoom(roomId, { type: 'message_added', message: newMessage });
    } catch { /* broadcast best-effort */ }
  } catch { /* postMessage best-effort */ }
}

export function routeTerminalEventToLinkedRoom(
  sessionId: string,
  kind: string,
  text: string
): void {
  if (kind !== 'message') return;
  if (!text || text.length === 0) return;
  // Quick reject for obvious-noise lines before debounce — avoids growing
  // the pending buffer with junk we'd drop anyway.
  if (isNoise(text)) return;

  const existing = pending.get(sessionId);
  if (existing) {
    existing.lines.push(text);
    clearTimeout(existing.timer);
    existing.timer = setTimeout(() => flush(sessionId), DEBOUNCE_MS);
  } else {
    pending.set(sessionId, {
      lines: [text],
      timer: setTimeout(() => flush(sessionId), DEBOUNCE_MS)
    });
  }
}

export function _resetTerminalReplyRouterForTests(): void {
  for (const p of pending.values()) clearTimeout(p.timer);
  pending.clear();
  lastFlushed.clear();
}

export const _internals = {
  isNoise, hasWordChars, isMostlyWordChars, NOISE_PATTERNS,
  MIN_TEXT_LEN, DEBOUNCE_MS, DEDUPE_WINDOW_MS
};
