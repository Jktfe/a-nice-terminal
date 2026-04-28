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

const createCopilotCliDriver = async () => {
  const { CopilotCliDriver } = await import('../../drivers/copilot-cli/driver.js');
  return new CopilotCliDriver();
};

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
  'copilot-cli': createCopilotCliDriver,
  copilot: createCopilotCliDriver,
  'qwen-cli': async () => {
    const { QwenCliDriver } = await import('../../drivers/qwen-cli/driver.js');
    return new QwenCliDriver();
  },
  qwen: async () => {
    const { QwenCliDriver } = await import('../../drivers/qwen-cli/driver.js');
    return new QwenCliDriver();
  },
  pi: async () => {
    const { PiDriver } = await import('../../drivers/pi/driver.js');
    return new PiDriver();
  },
  'kimi-code': async () => {
    const { KimiCodeDriver } = await import('../../drivers/kimi-code/driver.js');
    return new KimiCodeDriver();
  },
  kimi: async () => {
    const { KimiCodeDriver } = await import('../../drivers/kimi-code/driver.js');
    return new KimiCodeDriver();
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
  lastStatusFingerprint: string | null;
  lastStatusBroadcast: number;
}

const initialSessions = new Map<string, SessionState>();
const initialDriverCache = new Map<string, AgentDriver>();

interface AgentEventBusDeps {
  getSession: ((id: string) => any) | null;
  postToChat: ((sessionId: string, chatId: string, content: string, msgType: string) => void) | null;
  writeToTerminal: ((sessionId: string, data: string) => void) | null;
  updateMessageMeta: ((msgId: string, meta: string) => void) | null;
  broadcastToChat: ((chatId: string, msg: any) => void) | null;
  broadcastGlobal: ((msg: any) => void) | null;
  appendRunEvent: ((
    sessionId: string,
    source: 'hook' | 'json' | 'terminal' | 'status' | 'tmux',
    trust: 'high' | 'medium' | 'raw',
    kind: string,
    text: string,
    payload?: Record<string, unknown>,
    rawRef?: string | null,
  ) => void) | null;
}

interface AgentEventBusRuntime {
  sessions: Map<string, SessionState>;
  driverCache: Map<string, AgentDriver>;
  deps: AgentEventBusDeps;
}

export interface DecisionContext {
  responseMsgId?: string | null;
  responderId?: string | null;
  responderName?: string | null;
  justification?: string | null;
  source?: string | null;
}

const EVENT_BUS_KEY = '__ant_agent_event_bus__';
const runtime: AgentEventBusRuntime = ((globalThis as any)[EVENT_BUS_KEY] ??= {
  sessions: initialSessions,
  driverCache: initialDriverCache,
  deps: {
    getSession: null,
    postToChat: null,
    writeToTerminal: null,
    updateMessageMeta: null,
    broadcastToChat: null,
    broadcastGlobal: null,
    appendRunEvent: null,
  },
});

const sessions = runtime.sessions;
const driverCache = runtime.driverCache;
const busDeps = runtime.deps;

const DEBOUNCE_MS = 100;
const BUFFER_SIZE = 50;
const CLASS_COOLDOWN_MS = 30_000;
const CONTENT_DEDUP_MS = 5 * 60_000;
const STATUS_BROADCAST_REFRESH_MS = 10_000;
const ACTIONABLE_EVENT_CLASSES = new Set([
  'permission_request',
  'tool_auth',
  'multi_choice',
  'confirmation',
  'free_text',
  'text_input',
  'error_retry',
]);

// ─── Injected dependencies (set during init) ────────────────────────────────

/** Call once from server.ts after pty manager is connected. */
export function init(initDeps: {
  getSession: (id: string) => any;
  postToChat: (sessionId: string, chatId: string, content: string, msgType: string) => void;
  writeToTerminal: (sessionId: string, data: string) => void;
  updateMessageMeta: (msgId: string, meta: string) => void;
  broadcastToChat: (chatId: string, msg: any) => void;
  broadcastGlobal?: (msg: any) => void;
  appendRunEvent?: (
    sessionId: string,
    source: 'hook' | 'json' | 'terminal' | 'status' | 'tmux',
    trust: 'high' | 'medium' | 'raw',
    kind: string,
    text: string,
    payload?: Record<string, unknown>,
    rawRef?: string | null,
  ) => void;
}) {
  busDeps.getSession = initDeps.getSession;
  busDeps.postToChat = initDeps.postToChat;
  busDeps.writeToTerminal = initDeps.writeToTerminal;
  busDeps.updateMessageMeta = initDeps.updateMessageMeta;
  busDeps.broadcastToChat = initDeps.broadcastToChat;
  busDeps.broadcastGlobal = initDeps.broadcastGlobal ?? null;
  busDeps.appendRunEvent = initDeps.appendRunEvent ?? null;
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
  return `${eventClass}:${normaliseEventText(eventImportantText(event)).slice(0, 240)}`;
}

function eventImportantText(event: any): string {
  const payload = event.payload ?? {};
  return String(
    payload.question ??
    payload.prompt ??
    payload.message ??
    payload.command ??
    payload.file ??
    payload.tool ??
    event.text ??
    '',
  );
}

function normaliseEventText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function isActionableEventClass(eventClass: string): boolean {
  return ACTIONABLE_EVENT_CLASSES.has(eventClass);
}

function isEventStillVisible(event: NormalisedEvent, output: RawOutput): boolean {
  const important = normaliseEventText(eventImportantText(event));
  if (important.length < 8) return false;
  const visible = normaliseEventText(output.lines.map(line => line.text).join('\n'));
  return visible.includes(important.slice(0, 160));
}

function choiceLabel(choice: UserChoice): string {
  if (choice.type === 'confirm') return choice.yes ? 'confirm' : 'cancel';
  if (choice.type === 'select') {
    const selected = (choice as any).selected;
    return typeof selected === 'string' && selected ? selected : `option ${choice.index + 1}`;
  }
  return choice.type;
}

function eventDecisionText(event: NormalisedEvent, eventClass: string, chosen: string, context?: DecisionContext): string {
  const actor = context?.responderName || context?.responderId || 'user';
  const reason = context?.justification?.trim();
  const target = buildSummary(event, eventClass);
  return `${actor} chose ${chosen} for ${target}${reason ? ` — ${reason}` : ''}`;
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
      lastStatusFingerprint: null,
      lastStatusBroadcast: 0,
    };
    sessions.set(sessionId, s);
  }
  return s;
}

async function resolveDriver(sessionId: string): Promise<AgentDriver | null> {
  if (!busDeps.getSession) return null;
  const session = busDeps.getSession(sessionId);
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
  if (!busDeps.getSession) return null;
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
    if (!busDeps.getSession) return; // init() hasn't run yet — skip silently, retry next call
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

/** Called from server.ts with an unstripped bottom-of-pane sample for telemetry. */
export async function feedStatus(sessionId: string, rawData: string): Promise<void> {
  const state = getState(sessionId);
  if (!state.driver) {
    if (!busDeps.getSession) return;
    await ensureDriver(sessionId, state);
  }
  if (!state.driver) return;

  const lines = stripAnsi(rawData)
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line.trim());

  updateStatusFromLines(sessionId, state, lines);
}

async function onDebounce(sessionId: string, state: SessionState): Promise<void> {
  state.debounceTimer = null;
  if (!state.driver || !busDeps.postToChat || !busDeps.getSession) return;

  const session = busDeps.getSession(sessionId);
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

  // Fallback status telemetry from the cleaned stream. The primary path is
  // feedStatus(), which receives an unstripped bottom-of-pane sample before
  // chrome/footer lines are removed from chat/event detection. Only use this
  // fallback when we do not already have a fresh status sample.
  if (!state.currentStatus || Date.now() - state.currentStatus.detectedAt > STATUS_BROADCAST_REFRESH_MS) {
    updateStatusFromLines(sessionId, state, state.buffer.slice(-15).map(e => e.text));
  }

  if (!event) {
    // No new event — check settled state for pending events
    checkSettled(sessionId, state);
    return;
  }

  const eventClass = (event as any).class ?? event.type;
  console.log(`[event-bus] DETECTED ${eventClass} in ${sessionId}`);

  if (!isActionableEventClass(eventClass)) {
    discardPendingEvents(sessionId, state, 'agent_moved_on');
  }

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
  busDeps.postToChat(sessionId, session.linked_chat_id, content, 'agent_event');
  console.log(`[event-bus] POSTED ${eventClass} to chat ${session.linked_chat_id}`);

  // Broadcast dashboard-level "needs input" badge to all connected clients
  if (isActionableEventClass(eventClass) && busDeps.broadcastGlobal) {
    const summary = buildSummary(event, eventClass);
    busDeps.broadcastGlobal({
      type: 'session_needs_input',
      sessionId,
      eventClass,
      summary,
    });
  }
}

function statusFingerprint(status: AgentStatus): string {
  return JSON.stringify({
    state: status.state,
    activity: status.activity ?? null,
    model: status.model ?? null,
    contextUsedPct: status.contextUsedPct ?? null,
    contextRemainingPct: status.contextRemainingPct ?? null,
    rateLimitPct: status.rateLimitPct ?? null,
    rateLimitWindow: status.rateLimitWindow ?? null,
    workspace: status.workspace ?? null,
    branch: status.branch ?? null,
    waitingFor: status.waitingFor ?? null,
  });
}

function statusSummary(status: AgentStatus): string {
  const parts: string[] = [status.state];
  if (status.activity) parts.push(status.activity);
  if (status.model) parts.push(status.model);
  if (typeof status.contextRemainingPct === 'number') parts.push(`${status.contextRemainingPct}% context left`);
  if (typeof status.contextUsedPct === 'number') parts.push(`${status.contextUsedPct}% context used`);
  if (status.waitingFor) parts.push(`waiting: ${status.waitingFor}`);
  return parts.join(' · ');
}

function updateStatusFromLines(sessionId: string, state: SessionState, statusLines: string[]): void {
  if (!state.driver || !('detectStatus' in state.driver) || statusLines.length === 0) return;

  const status = (state.driver as any).detectStatus(statusLines);
  if (!status) return;

  // If agent is ready and recent text has a question, extract waiting context.
  if (status.state === 'ready') {
    const waitingContext = extractWaitingContext(statusLines.join('\n'));
    if (waitingContext) status.waitingFor = waitingContext;
  }

  state.currentStatus = status;

  const now = Date.now();
  const fingerprint = statusFingerprint(status);
  const shouldBroadcast =
    fingerprint !== state.lastStatusFingerprint ||
    now - state.lastStatusBroadcast >= STATUS_BROADCAST_REFRESH_MS;

  if (shouldBroadcast && busDeps.broadcastGlobal) {
    state.lastStatusFingerprint = fingerprint;
    state.lastStatusBroadcast = now;
    busDeps.appendRunEvent?.(
      sessionId,
      'status',
      'medium',
      'status',
      statusSummary(status),
      status as unknown as Record<string, unknown>,
      null,
    );
    busDeps.broadcastGlobal({
      type: 'agent_status_updated',
      sessionId,
      status,
    });
  }
}

/** Called from the messages endpoint when msg_type === 'agent_response'. */
export async function handleResponse(
  terminalSessionId: string,
  eventContent: string,
  choice: UserChoice,
  eventMsgId?: string | null,
  decisionContext?: DecisionContext,
): Promise<void> {
  const state = getState(terminalSessionId);
  const driver = await ensureDriver(terminalSessionId, state);
  if (!driver) throw new Error(`No agent driver configured for ${terminalSessionId}`);
  if (!busDeps.writeToTerminal) throw new Error('Terminal writer is not initialised');

  // Parse the original event from the content
  let event: NormalisedEvent;
  try { event = JSON.parse(eventContent); }
  catch { throw new Error('Invalid agent event payload'); }

  // Build the sendKeys callback
  const sendKeys: SendKeysFn = async (keys: string[]) => {
    for (const key of keys) {
      if (key === 'Enter') busDeps.writeToTerminal!(terminalSessionId, '\r');
      else if (key === 'Escape') busDeps.writeToTerminal!(terminalSessionId, '\x1b');
      else if (key === 'Tab') busDeps.writeToTerminal!(terminalSessionId, '\t');
      else busDeps.writeToTerminal!(terminalSessionId, key);
      // Small delay between keys for TUI processing
      await new Promise(r => setTimeout(r, 50));
    }
  };

  // AgentDriver interface declares respond(event, choice) but concrete drivers
  // accept an optional sendKeys callback as the 3rd arg for PTY key injection.
  // Cast through any to pass it — the driver throws if sendKeys is required but missing.
  await (driver as any).respond(event, choice, sendKeys);

  const session = busDeps.getSession?.(terminalSessionId);
  if (eventMsgId && session?.linked_chat_id && busDeps.updateMessageMeta && busDeps.broadcastToChat) {
    const chosen = choiceLabel(choice);
    const decision = decisionContext
      ? {
          by: decisionContext.responderName || decisionContext.responderId || 'unknown',
          responder_id: decisionContext.responderId ?? null,
          response_msg_id: decisionContext.responseMsgId ?? null,
          source: decisionContext.source ?? 'linked_chat',
          justification: decisionContext.justification?.trim() || null,
          decided_at: new Date().toISOString(),
        }
      : undefined;
    const meta = decision
      ? { status: 'responded', chosen, decision }
      : { status: 'responded', chosen };
    busDeps.updateMessageMeta(eventMsgId, JSON.stringify(meta));
    busDeps.broadcastToChat(session.linked_chat_id, {
      type: 'message_updated',
      sessionId: session.linked_chat_id,
      msgId: eventMsgId,
      meta,
    });
  }

  // Clear the dashboard badge — response was sent, prompt is resolved.
  // Remove any pending events matching this event class.
  const eventClass = (event as any).class ?? event.type;
  const chosen = choiceLabel(choice);
  busDeps.appendRunEvent?.(
    terminalSessionId,
    'json',
    'high',
    'approval_decision',
    eventDecisionText(event, eventClass, chosen, decisionContext),
    {
      event,
      event_id: eventMsgId ?? null,
      choice,
      chosen,
      decision: decisionContext
        ? {
            by: decisionContext.responderName || decisionContext.responderId || 'unknown',
            responder_id: decisionContext.responderId ?? null,
            response_msg_id: decisionContext.responseMsgId ?? null,
            source: decisionContext.source ?? 'linked_chat',
            justification: decisionContext.justification?.trim() || null,
          }
        : null,
    },
    eventMsgId ?? null,
  );

  for (const [key, pending] of state.pendingEvents) {
    const pendingClass = (pending.event as any).class ?? pending.event.type;
    if (pendingClass === eventClass) {
      state.pendingEvents.delete(key);
    }
  }
  if (state.pendingEvents.size === 0 && busDeps.broadcastGlobal) {
    busDeps.broadcastGlobal({ type: 'session_input_resolved', sessionId: terminalSessionId });
  }
}

function checkSettled(sessionId: string, state: SessionState): void {
  if (!state.driver || !busDeps.updateMessageMeta || !busDeps.broadcastToChat) return;

  const output: RawOutput = {
    lines: state.buffer.slice(-20),
    last_ts: state.buffer[state.buffer.length - 1]?.ts ?? Date.now(),
  };

  for (const [key, pending] of state.pendingEvents) {
    if (state.driver.isSettled(pending.event, output) && !isEventStillVisible(pending.event, output)) {
      const eventClass = (pending.event as any).class ?? pending.event.type;
      const meta = isActionableEventClass(eventClass)
        ? {
            status: 'discarded',
            chosen: 'moved_on',
            discard_reason: 'agent_moved_on',
            discarded_at: new Date().toISOString(),
          }
        : { status: 'settled' };
      busDeps.updateMessageMeta(pending.msgId, JSON.stringify(meta));
      busDeps.broadcastToChat(pending.chatId, {
        type: 'message_updated',
        sessionId: pending.chatId,
        msgId: pending.msgId,
        meta,
      });
      state.pendingEvents.delete(key);

      // If no more pending events for this session, clear the dashboard badge
      if (state.pendingEvents.size === 0 && busDeps.broadcastGlobal) {
        busDeps.broadcastGlobal({ type: 'session_input_resolved', sessionId });
      }
    }
  }
}

/** Track a posted event so we can check settled state later. */
export function trackEvent(sessionId: string, msgId: string, chatId: string, event: NormalisedEvent): void {
  const eventClass = (event as any).class ?? event.type;
  if (!isActionableEventClass(eventClass)) return;

  const state = getState(sessionId);
  state.pendingEvents.set(msgId, { event, msgId, chatId });
}

function discardPendingEvents(sessionId: string, state: SessionState, reason: string): void {
  if (state.pendingEvents.size === 0 || !busDeps.updateMessageMeta || !busDeps.broadcastToChat) return;

  for (const [key, pending] of state.pendingEvents) {
    const eventClass = (pending.event as any).class ?? pending.event.type;
    if (!isActionableEventClass(eventClass)) continue;

    const meta = {
      status: 'discarded',
      chosen: 'moved_on',
      discard_reason: reason,
      discarded_at: new Date().toISOString(),
    };
    busDeps.updateMessageMeta(pending.msgId, JSON.stringify(meta));
    busDeps.broadcastToChat(pending.chatId, {
      type: 'message_updated',
      sessionId: pending.chatId,
      msgId: pending.msgId,
      meta,
    });
    state.pendingEvents.delete(key);
  }

  if (state.pendingEvents.size === 0) {
    busDeps.broadcastGlobal?.({ type: 'session_input_resolved', sessionId });
  }
}

/** Discard a pending event that was answered somewhere else. */
export function discardEvent(sessionId: string, msgId: string): void {
  const state = sessions.get(sessionId);
  if (!state) {
    busDeps.broadcastGlobal?.({ type: 'session_input_resolved', sessionId });
    return;
  }

  state.pendingEvents.delete(msgId);
  if (state.pendingEvents.size === 0) {
    busDeps.broadcastGlobal?.({ type: 'session_input_resolved', sessionId });
  }
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
  event_id?: string;
  event_chat_id?: string;
  event_class?: string;
  event?: NormalisedEvent;
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
    event_id: first.msgId,
    event_chat_id: first.chatId,
    event_class: eventClass,
    event,
    summary: buildSummary(event, eventClass),
    since: new Date(event.ts ?? Date.now()).toISOString(),
    ...(state.currentStatus ? { agent_status: state.currentStatus } : {}),
  };
}

/** Query the latest status detected for a terminal session. */
export function getAgentStatus(sessionId: string): AgentStatus | null {
  return sessions.get(sessionId)?.currentStatus ?? null;
}

/** Refresh status telemetry from the current rendered pane without posting events. */
export async function refreshStatusFromCapture(sessionId: string): Promise<AgentStatus | null> {
  const state = getState(sessionId);
  if (!state.driver) {
    if (!busDeps.getSession) return null;
    await ensureDriver(sessionId, state);
  }
  if (!state.driver) return null;

  try {
    const { ptyClient } = await import('./pty-client.js');
    const text = await ptyClient.capture(sessionId, 50);
    if (text) await feedStatus(sessionId, text);
  } catch {}

  return state.currentStatus;
}

/** Clean up when a session is killed/archived. */
export function dispose(sessionId: string): void {
  const state = sessions.get(sessionId);
  if (state?.debounceTimer) clearTimeout(state.debounceTimer);
  sessions.delete(sessionId);
}
