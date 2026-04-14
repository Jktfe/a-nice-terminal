// ANT — Agent Event Bus
//
// Sits in the ptm.onData() pipeline. For sessions with a configured
// agent_driver, feeds raw terminal output through the driver's detect()
// method and posts normalised interactive events to the linked chat.
//
// When the user responds in the chat (via AgentEventCard → agent_response),
// handleResponse() routes the choice back through driver.respond() → PTY.
//
// Zero overhead for sessions without a driver configured.

import type { AgentDriver, RawEvent, RawOutput, UserChoice, NormalisedEvent } from '../../fingerprint/types.js';
import type { SendKeysFn } from '../../drivers/claude-code/driver.js';

// ─── Driver registry ─────────────────────────────────────────────────────────
// Lazy-loaded on first use per agent slug. Add new drivers here.

const DRIVER_FACTORIES: Record<string, () => Promise<AgentDriver>> = {
  'claude-code': async () => {
    const { ClaudeCodeDriver } = await import('../../drivers/claude-code/driver.js');
    return new ClaudeCodeDriver();
  },
  'gemini-cli': async () => {
    const { GeminiCliDriver } = await import('../../drivers/gemini-cli/driver.js');
    return new GeminiCliDriver();
  },
  'codex-cli': async () => {
    const { CodexCliDriver } = await import('../../drivers/codex-cli/driver.js');
    return new CodexCliDriver();
  },
};

// ─── Per-session state ───────────────────────────────────────────────────────

interface SessionState {
  driver: AgentDriver | null;
  driverSlug: string | null;
  buffer: RawEvent[];                       // ring buffer, last 50 lines
  pendingEvents: Map<string, { event: NormalisedEvent; msgId: string; chatId: string }>;
  debounceTimer: ReturnType<typeof setTimeout> | null;
}

const sessions = new Map<string, SessionState>();
const driverCache = new Map<string, AgentDriver>();

const DEBOUNCE_MS = 100;
const BUFFER_SIZE = 50;

// ─── Injected dependencies (set during init) ────────────────────────────────

let _getSession: ((id: string) => any) | null = null;
let _postToChat: ((sessionId: string, chatId: string, content: string, msgType: string) => void) | null = null;
let _writeToTerminal: ((sessionId: string, data: string) => void) | null = null;
let _updateMessageMeta: ((msgId: string, meta: string) => void) | null = null;
let _broadcastToChat: ((chatId: string, msg: any) => void) | null = null;

/** Call once from server.ts after pty manager is connected. */
export function init(deps: {
  getSession: (id: string) => any;
  postToChat: (sessionId: string, chatId: string, content: string, msgType: string) => void;
  writeToTerminal: (sessionId: string, data: string) => void;
  updateMessageMeta: (msgId: string, meta: string) => void;
  broadcastToChat: (chatId: string, msg: any) => void;
}) {
  _getSession = deps.getSession;
  _postToChat = deps.postToChat;
  _writeToTerminal = deps.writeToTerminal;
  _updateMessageMeta = deps.updateMessageMeta;
  _broadcastToChat = deps.broadcastToChat;
}

// ─── Strip ANSI escape codes ─────────────────────────────────────────────────

const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]|\x1b\].*?(?:\x07|\x1b\\)|\x1b[()][0-9A-B]|\r/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

// ─── Core API ────────────────────────────────────────────────────────────────

function getState(sessionId: string): SessionState {
  let s = sessions.get(sessionId);
  if (!s) {
    s = { driver: null, driverSlug: null, buffer: [], pendingEvents: new Map(), debounceTimer: null };
    sessions.set(sessionId, s);
  }
  return s;
}

async function resolveDriver(sessionId: string): Promise<AgentDriver | null> {
  if (!_getSession) return null;
  const session = _getSession(sessionId);
  if (!session) return null;

  let meta: any = {};
  try { meta = typeof session.meta === 'string' ? JSON.parse(session.meta) : (session.meta ?? {}); } catch {}
  const slug = meta.agent_driver as string | undefined;
  if (!slug) return null;

  // Check cache
  if (driverCache.has(slug)) return driverCache.get(slug)!;

  // Load from factory
  const factory = DRIVER_FACTORIES[slug];
  if (!factory) return null;
  const driver = await factory();
  driverCache.set(slug, driver);
  return driver;
}

/** Called from server.ts ptm.onData() for every chunk of terminal output. */
export async function feed(sessionId: string, rawData: string): Promise<void> {
  const state = getState(sessionId);

  // Lazy-load driver on first call. Don't cache "no driver" until init() has
  // been called — feed() fires before init() completes due to async import race.
  if (!state.driver) {
    if (!_getSession) return; // init() hasn't run yet — skip silently, retry next call
    if (state.driverSlug === 'none') return; // already confirmed no driver configured
    state.driver = await resolveDriver(sessionId);
    state.driverSlug = state.driver ? 'loaded' : 'none';
  }
  if (!state.driver) return;

  // Append stripped lines to ring buffer
  const stripped = stripAnsi(rawData);
  const lines = stripped.split('\n').filter(l => l.trim());
  const now = Date.now();
  for (const line of lines) {
    const event: RawEvent = { source: 'tmux_output', ts: now, text: line, raw: rawData };
    state.buffer.push(event);
  }
  // Trim buffer to BUFFER_SIZE
  if (state.buffer.length > BUFFER_SIZE) {
    state.buffer = state.buffer.slice(-BUFFER_SIZE);
  }

  // Restart debounce timer
  if (state.debounceTimer) clearTimeout(state.debounceTimer);
  state.debounceTimer = setTimeout(() => onDebounce(sessionId, state), DEBOUNCE_MS);
}

async function onDebounce(sessionId: string, state: SessionState): Promise<void> {
  state.debounceTimer = null;
  if (!state.driver || !_postToChat || !_getSession) return;

  const session = _getSession(sessionId);
  if (!session?.linked_chat_id) return;

  // Run detect() on the most recent line
  const lastLine = state.buffer[state.buffer.length - 1];
  if (!lastLine) return;

  const detected = state.driver.detect(lastLine);

  // Also try classifyFromWindow if the driver supports it (richer classification)
  let event = detected;
  if (detected && 'classifyFromWindow' in state.driver) {
    const window = state.buffer.slice(-20).map(e => e.text).join('\n');
    const classified = (state.driver as any).classifyFromWindow(window, lastLine.ts);
    if (classified) event = classified;
  }

  if (!event) {
    // No new event — check settled state for pending events
    checkSettled(sessionId, state);
    return;
  }

  // Dedup: don't re-post if the same event class is already pending
  const eventClass = (event as any).class ?? event.type;
  for (const [, pending] of state.pendingEvents) {
    if ((pending.event as any).class === eventClass || pending.event.type === eventClass) return;
  }

  // Post to linked chat
  const content = JSON.stringify(event);
  _postToChat(sessionId, session.linked_chat_id, content, 'agent_event');

  // We need the message ID that was just created — derive it the same way
  // postToLinkedChat does (random ID). For now, use event.ts as a lookup key.
  // The actual integration will pass the msgId back.
}

/** Called from the messages endpoint when msg_type === 'agent_response'. */
export async function handleResponse(
  terminalSessionId: string,
  eventContent: string,
  choice: UserChoice,
): Promise<void> {
  const state = getState(terminalSessionId);
  if (!state.driver || !_writeToTerminal) return;

  // Parse the original event from the content
  let event: NormalisedEvent;
  try { event = JSON.parse(eventContent); } catch { return; }

  // Build the sendKeys callback
  const sendKeys: SendKeysFn = async (keys: string[]) => {
    for (const key of keys) {
      if (key === 'Enter') _writeToTerminal!(terminalSessionId, '\r');
      else if (key === 'Escape') _writeToTerminal!(terminalSessionId, '\x1b');
      else if (key === 'Tab') _writeToTerminal!(terminalSessionId, '\t');
      else _writeToTerminal!(terminalSessionId, key);
      // Small delay between keys for TUI processing
      await new Promise(r => setTimeout(r, 50));
    }
  };

  // AgentDriver interface declares respond(event, choice) but concrete drivers
  // accept an optional sendKeys callback as the 3rd arg for PTY key injection.
  // Cast through any to pass it — the driver throws if sendKeys is required but missing.
  await (state.driver as any).respond(event, choice, sendKeys);
}

function checkSettled(sessionId: string, state: SessionState): void {
  if (!state.driver || !_updateMessageMeta || !_broadcastToChat) return;

  const output: RawOutput = {
    lines: state.buffer.slice(-20),
    last_ts: state.buffer[state.buffer.length - 1]?.ts ?? Date.now(),
  };

  for (const [key, pending] of state.pendingEvents) {
    if (state.driver.isSettled(pending.event, output)) {
      _updateMessageMeta(pending.msgId, JSON.stringify({ status: 'settled' }));
      _broadcastToChat(pending.chatId, {
        type: 'message_updated',
        sessionId: pending.chatId,
        msgId: pending.msgId,
        meta: { status: 'settled' },
      });
      state.pendingEvents.delete(key);
    }
  }
}

/** Track a posted event so we can check settled state later. */
export function trackEvent(sessionId: string, msgId: string, chatId: string, event: NormalisedEvent): void {
  const state = getState(sessionId);
  state.pendingEvents.set(msgId, { event, msgId, chatId });
}

/** Clean up when a session is killed/archived. */
export function dispose(sessionId: string): void {
  const state = sessions.get(sessionId);
  if (state?.debounceTimer) clearTimeout(state.debounceTimer);
  sessions.delete(sessionId);
}
