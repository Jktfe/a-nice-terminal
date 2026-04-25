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
import type { AgentStatus } from '../shared/agent-status.js';

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
  lastPosted: Map<string, number> | null;   // cooldown: "sessionId:class" → timestamp
  lastEventFingerprints: Map<string, number> | null;
  currentStatus: AgentStatus | null;
}

const sessions = new Map<string, SessionState>();
const driverCache = new Map<string, AgentDriver>();

const DEBOUNCE_MS = 100;
const BUFFER_SIZE = 50;
const CLASS_COOLDOWN_MS = 30_000;
const CONTENT_DEDUP_MS = 5 * 60_000;

// ─── Injected dependencies (set during init) ────────────────────────────────

let _getSession: ((id: string) => any) | null = null;
let _postToChat: ((sessionId: string, chatId: string, content: string, msgType: string) => void) | null = null;
let _writeToTerminal: ((sessionId: string, data: string) => void) | null = null;
let _updateMessageMeta: ((msgId: string, meta: string) => void) | null = null;
let _broadcastToChat: ((chatId: string, msg: any) => void) | null = null;
let _broadcastGlobal: ((msg: any) => void) | null = null;

/** Call once from server.ts after pty manager is connected. */
export function init(deps: {
  getSession: (id: string) => any;
  postToChat: (sessionId: string, chatId: string, content: string, msgType: string) => void;
  writeToTerminal: (sessionId: string, data: string) => void;
  updateMessageMeta: (msgId: string, meta: string) => void;
  broadcastToChat: (chatId: string, msg: any) => void;
  broadcastGlobal?: (msg: any) => void;
}) {
  _getSession = deps.getSession;
  _postToChat = deps.postToChat;
  _writeToTerminal = deps.writeToTerminal;
  _updateMessageMeta = deps.updateMessageMeta;
  _broadcastToChat = deps.broadcastToChat;
  _broadcastGlobal = deps.broadcastGlobal ?? null;
}

// ─── Strip ANSI escape codes ─────────────────────────────────────────────────

const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]|\x1b\].*?(?:\x07|\x1b\\)|\x1b[()][0-9A-B]|\r/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

// ─── Summary builder for dashboard badges ────────────────────────────────────

function buildSummary(event: any, eventClass: string): string {
  const payload = event.payload ?? {};
  if (eventClass === 'permission_request') {
    const target = payload.command ?? payload.file ?? payload.tool ?? '';
    return target ? `Approve: ${target.slice(0, 80)}` : 'Permission requested';
  }
  if (eventClass === 'multi_choice') {
    return payload.question?.slice(0, 80) ?? 'Choose an option';
  }
  if (eventClass === 'confirmation') {
    return payload.message?.slice(0, 80) ?? 'Confirmation needed';
  }
  if (eventClass === 'text_input') {
    return payload.prompt?.slice(0, 80) ?? 'Input requested';
  }
  return event.text?.slice(0, 80) ?? `${eventClass.replace(/_/g, ' ')}`;
}

function eventFingerprint(event: any, eventClass: string): string {
  const payload = event.payload ?? {};
  const important =
    payload.question ??
    payload.prompt ??
    payload.message ??
    payload.command ??
    payload.file ??
    payload.tool ??
    event.text ??
    '';

  return `${eventClass}:${String(important)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240)}`;
}

// ─── Waiting-context extraction ──────────────────────────────────────────────
// Regex-based prototype: detects implicit waiting/question patterns in recent
// agent text and extracts a short description of what the agent needs.

const WAITING_PATTERNS = [
  { re: /(?:shall I|should I|want me to|would you like me to)\s+(.{10,80})\??/i, prefix: '' },
  { re: /(?:please confirm|please approve|please review)\s*:?\s*(.{5,80})/i, prefix: 'Confirm: ' },
  { re: /(?:which (?:one|approach|option)|what should|how should)\s+(.{5,80})\??/i, prefix: '' },
  { re: /(?:waiting for|blocked on|need your)\s+(.{5,60})/i, prefix: '' },
  { re: /(?:do you want|would you prefer)\s+(.{5,80})\??/i, prefix: '' },
];

function extractWaitingContext(text: string): string | null {
  for (const { re, prefix } of WAITING_PATTERNS) {
    const match = text.match(re);
    if (match) {
      const clause = match[1].replace(/[.?!,;:]+$/, '').trim();
      return prefix + clause.slice(0, 80);
    }
  }
  return null;
}

// ─── Core API ────────────────────────────────────────────────────────────────

function getState(sessionId: string): SessionState {
  let s = sessions.get(sessionId);
  if (!s) {
    s = {
      driver: null,
      driverSlug: null,
      buffer: [],
      pendingEvents: new Map(),
      debounceTimer: null,
      lastPosted: null,
      lastEventFingerprints: null,
      currentStatus: null,
    };
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

async function ensureDriver(sessionId: string, state: SessionState): Promise<AgentDriver | null> {
  if (state.driver) return state.driver;
  if (!_getSession) return null;
  if (state.driverSlug === 'none') return null;

  state.driver = await resolveDriver(sessionId);
  state.driverSlug = state.driver ? 'loaded' : 'none';
  if (state.driver) console.log(`[event-bus] driver loaded for ${sessionId}: ${state.driverSlug}`);
  return state.driver;
}

/** Called from server.ts ptm.onData() for every chunk of terminal output. */
export async function feed(sessionId: string, rawData: string): Promise<void> {
  const state = getState(sessionId);

  // Lazy-load driver on first call. Don't cache "no driver" until init() has
  // been called — feed() fires before init() completes due to async import race.
  if (!state.driver) {
    if (!_getSession) return; // init() hasn't run yet — skip silently, retry next call
    await ensureDriver(sessionId, state);
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

  // Update hooksActive if driver supports it
  if (state.driver && 'setHooksActive' in state.driver) {
    let meta: any = {};
    try { meta = typeof session.meta === 'string' ? JSON.parse(session.meta) : (session.meta ?? {}); } catch {}
    (state.driver as any).setHooksActive(!!meta.hooks_active);
  }

  // Run detect() on each recent line (not just the last — events can appear mid-burst)
  const lastLine = state.buffer[state.buffer.length - 1];
  if (!lastLine) return;

  // Log buffer state periodically for diagnostics
  if (Math.random() < 0.01) {
    console.log(`[event-bus] ${sessionId} buffer=${state.buffer.length} last="${lastLine.text.slice(0, 60)}"`);
  }

  // Try each of the last 5 lines (events may not be on the very last line)
  let detected: ReturnType<typeof state.driver.detect> = null;
  const recentLines = state.buffer.slice(-5);
  for (const line of recentLines) {
    detected = state.driver!.detect(line);
    if (detected) break;
  }

  // Also try classifyFromWindow if the driver supports it (richer classification)
  let event = detected;
  if (detected && 'classifyFromWindow' in state.driver) {
    const window = state.buffer.slice(-20).map(e => e.text).join('\n');
    const classified = (state.driver as any).classifyFromWindow(window, lastLine.ts);
    if (classified) event = classified;
  }

  // Check for agent status telemetry (model, context, ready/busy state)
  if (state.driver && 'detectStatus' in state.driver) {
    const statusLines = state.buffer.slice(-15).map(e => e.text);
    const status = (state.driver as any).detectStatus(statusLines);
    if (status) {
      // If agent is ready and recent text has a question, extract waiting context
      if (status.state === 'ready') {
        const recentText = statusLines.join('\n');
        const waitingContext = extractWaitingContext(recentText);
        if (waitingContext) {
          status.waitingFor = waitingContext;
        }
      }
      state.currentStatus = status;
      if (_broadcastGlobal) {
        _broadcastGlobal({
          type: 'agent_status_updated',
          sessionId,
          status,
        });
      }
    }
  }

  if (!event) {
    // No new event — check settled state for pending events
    checkSettled(sessionId, state);
    return;
  }

  const eventClass = (event as any).class ?? event.type;
  console.log(`[event-bus] DETECTED ${eventClass} in ${sessionId}`);

  // Dedup: cooldown per event class — don't re-post the same class within 30s.
  // This prevents rapid-fire detection from capture-pane diffs that keep
  // showing the same screen content (spinner moves, same prompt stays).
  const cooldownKey = `${sessionId}:${eventClass}`;
  const now = Date.now();
  const lastPost = state.lastPosted?.get(cooldownKey) ?? 0;
  if (now - lastPost < CLASS_COOLDOWN_MS) return;

  // Dedup: identical content fingerprint over a longer window. This prevents
  // repeated "same question" cards while still allowing different free_text
  // questions after the short class cooldown expires.
  if (!state.lastEventFingerprints) state.lastEventFingerprints = new Map();
  for (const [fingerprint, ts] of state.lastEventFingerprints) {
    if (now - ts > CONTENT_DEDUP_MS) state.lastEventFingerprints.delete(fingerprint);
  }
  const fingerprint = eventFingerprint(event, eventClass);
  const lastFingerprintPost = state.lastEventFingerprints.get(fingerprint) ?? 0;
  if (now - lastFingerprintPost < CONTENT_DEDUP_MS) return;

  // Also skip if same class is already pending (user hasn't responded yet)
  for (const [, pending] of state.pendingEvents) {
    if ((pending.event as any).class === eventClass || pending.event.type === eventClass) return;
  }

  // Post to linked chat
  if (!state.lastPosted) state.lastPosted = new Map();
  state.lastPosted.set(cooldownKey, now);
  state.lastEventFingerprints.set(fingerprint, now);

  const content = JSON.stringify(event);
  _postToChat(sessionId, session.linked_chat_id, content, 'agent_event');
  console.log(`[event-bus] POSTED ${eventClass} to chat ${session.linked_chat_id}`);

  // Broadcast dashboard-level "needs input" badge to all connected clients
  if (_broadcastGlobal) {
    const summary = buildSummary(event, eventClass);
    _broadcastGlobal({
      type: 'session_needs_input',
      sessionId,
      eventClass,
      summary,
    });
  }
}

/** Called from the messages endpoint when msg_type === 'agent_response'. */
export async function handleResponse(
  terminalSessionId: string,
  eventContent: string,
  choice: UserChoice,
  eventMsgId?: string | null,
): Promise<void> {
  const state = getState(terminalSessionId);
  const driver = await ensureDriver(terminalSessionId, state);
  if (!driver) throw new Error(`No agent driver configured for ${terminalSessionId}`);
  if (!_writeToTerminal) throw new Error('Terminal writer is not initialised');

  // Parse the original event from the content
  let event: NormalisedEvent;
  try { event = JSON.parse(eventContent); }
  catch { throw new Error('Invalid agent event payload'); }

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
  await (driver as any).respond(event, choice, sendKeys);

  const session = _getSession?.(terminalSessionId);
  if (eventMsgId && session?.linked_chat_id && _updateMessageMeta && _broadcastToChat) {
    const chosen = choice.type === 'confirm'
      ? (choice.yes ? 'confirm' : 'cancel')
      : choice.type;
    const meta = { status: 'responded', chosen };
    _updateMessageMeta(eventMsgId, JSON.stringify(meta));
    _broadcastToChat(session.linked_chat_id, {
      type: 'message_updated',
      sessionId: session.linked_chat_id,
      msgId: eventMsgId,
      meta,
    });
  }

  // Clear the dashboard badge — response was sent, prompt is resolved.
  // Remove any pending events matching this event class.
  const eventClass = (event as any).class ?? event.type;
  for (const [key, pending] of state.pendingEvents) {
    const pendingClass = (pending.event as any).class ?? pending.event.type;
    if (pendingClass === eventClass) {
      state.pendingEvents.delete(key);
    }
  }
  if (state.pendingEvents.size === 0 && _broadcastGlobal) {
    _broadcastGlobal({ type: 'session_input_resolved', sessionId: terminalSessionId });
  }
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

      // If no more pending events for this session, clear the dashboard badge
      if (state.pendingEvents.size === 0 && _broadcastGlobal) {
        _broadcastGlobal({ type: 'session_input_resolved', sessionId });
      }
    }
  }
}

/** Track a posted event so we can check settled state later. */
export function trackEvent(sessionId: string, msgId: string, chatId: string, event: NormalisedEvent): void {
  const state = getState(sessionId);
  state.pendingEvents.set(msgId, { event, msgId, chatId });
}

/** Check if a line is UI chrome for the given session's driver. */
export function isChrome(sessionId: string, line: string): boolean {
  const state = sessions.get(sessionId);
  if (state?.driver?.isChrome) {
    return state.driver.isChrome(line);
  }
  return false;
}

/** Query the current pending event state for a session (used by status API). */
export function getPendingEvent(sessionId: string): {
  needs_input: boolean;
  event_class?: string;
  summary?: string;
  since?: string;
  agent_status?: AgentStatus;
} {
  const state = sessions.get(sessionId);
  if (!state || state.pendingEvents.size === 0) {
    return {
      needs_input: false,
      ...(state?.currentStatus ? { agent_status: state.currentStatus } : {}),
    };
  }
  // Return the oldest pending event
  const first = state.pendingEvents.values().next().value;
  if (!first) return { needs_input: false };
  const event = first.event;
  const eventClass = (event as any).class ?? event.type;
  return {
    needs_input: true,
    event_class: eventClass,
    summary: buildSummary(event, eventClass),
    since: new Date(event.ts ?? Date.now()).toISOString(),
    ...(state.currentStatus ? { agent_status: state.currentStatus } : {}),
  };
}

/** Clean up when a session is killed/archived. */
export function dispose(sessionId: string): void {
  const state = sessions.get(sessionId);
  if (state?.debounceTimer) clearTimeout(state.debounceTimer);
  sessions.delete(sessionId);
}
