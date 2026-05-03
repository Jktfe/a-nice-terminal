import { queries } from './db.js';

export type PromptBridgeTarget =
  | { kind: 'linked_chat' }
  | { kind: 'chat'; session_id: string }
  | { kind: 'webhook'; url: string };

export interface PromptBridgeConfig {
  enabled: boolean;
  audit: boolean;
  default_targets: PromptBridgeTarget[];
  routes: Record<string, PromptBridgeTarget[]>;
  detect: {
    min_interval_ms: number;
    window_lines: number;
    patterns: string[];
  };
}

export interface PromptDetectedEvent {
  id: string;
  type: 'prompt_detected';
  terminal_id: string;
  session_id: string;
  raw_text: string;
  detector: string;
  ts: number;
  targets: PromptBridgeTarget[];
  delivered_to: string[];
  status: 'pending' | 'responded';
}

export interface PromptBridgeNeedsInput {
  eventClass: 'prompt_bridge';
  summary: string;
  since: string;
  promptId: string;
  detector: string;
  source: 'prompt_bridge';
}

interface PromptBridgeDeps {
  getSession: ((id: string) => any) | null;
  postToChat: ((terminalSessionId: string, chatId: string, content: string, msgType: string) => void) | null;
  writeToTerminal: ((sessionId: string, data: string) => void) | null;
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

interface PromptBridgeSessionState {
  lines: string[];
  lastFingerprint: string | null;
  lastPostedAt: number;
  pending: PromptDetectedEvent | null;
}

interface PromptBridgeRuntime {
  deps: PromptBridgeDeps;
  sessions: Map<string, PromptBridgeSessionState>;
}

const RUNTIME_KEY = '__ant_prompt_bridge__';
const SETTING_KEY = 'prompt_bridge';
const DETECTOR_NAME = 'prompt-bridge/generic-v1';
const MAX_BUFFER_LINES = 40;

const DEFAULT_PATTERNS = [
  String.raw`\b(do you want|would you like|shall i|should i|ok to|okay to|proceed|continue|confirm|approve|allow|permission)\b`,
  String.raw`\b(enter your choice|choose an option|select an option|press enter|yes/no|y/n)\b`,
  String.raw`(?:\[(?:y|n|yes|no)\]|\((?:y|n|yes|no)\))`,
  String.raw`^\s*(?:❯|>|›)?\s*\d+[.)]\s+\S+`,
];

export const DEFAULT_PROMPT_BRIDGE_CONFIG: PromptBridgeConfig = {
  enabled: false,
  audit: true,
  default_targets: [{ kind: 'linked_chat' }],
  routes: {},
  detect: {
    min_interval_ms: 30_000,
    window_lines: 12,
    patterns: DEFAULT_PATTERNS,
  },
};

const runtime: PromptBridgeRuntime = ((globalThis as any)[RUNTIME_KEY] ??= {
  deps: {
    getSession: null,
    postToChat: null,
    writeToTerminal: null,
    broadcastGlobal: null,
    appendRunEvent: null,
  },
  sessions: new Map<string, PromptBridgeSessionState>(),
});

const deps = runtime.deps;
const sessions = runtime.sessions;

export function initPromptBridge(initDeps: {
  getSession: (id: string) => any;
  postToChat: (terminalSessionId: string, chatId: string, content: string, msgType: string) => void;
  writeToTerminal: (sessionId: string, data: string) => void;
  broadcastGlobal?: (msg: any) => void;
  appendRunEvent?: PromptBridgeDeps['appendRunEvent'];
}) {
  deps.getSession = initDeps.getSession;
  deps.postToChat = initDeps.postToChat;
  deps.writeToTerminal = initDeps.writeToTerminal;
  deps.broadcastGlobal = initDeps.broadcastGlobal ?? null;
  deps.appendRunEvent = initDeps.appendRunEvent ?? null;
}

function parseJsonObject(value: unknown): Record<string, any> {
  if (!value) return {};
  if (typeof value === 'object') return value as Record<string, any>;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function promptBridgeDriverForSession(session: any): string | null {
  if (!session || session.type !== 'terminal') return null;
  const meta = parseJsonObject(session.meta);
  const candidates = [
    session.cli_flag,
    meta.agent_driver,
    meta.driver,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return null;
}

export function sessionSupportsPromptBridge(session: any): boolean {
  return !!promptBridgeDriverForSession(session);
}

export function normalisePromptBridgeConfig(value: unknown): PromptBridgeConfig {
  const raw = parseJsonObject(value);
  const detect = parseJsonObject(raw.detect);
  const routes = parseJsonObject(raw.routes);

  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_PROMPT_BRIDGE_CONFIG.enabled,
    audit: typeof raw.audit === 'boolean' ? raw.audit : DEFAULT_PROMPT_BRIDGE_CONFIG.audit,
    default_targets: normaliseTargets(raw.default_targets, DEFAULT_PROMPT_BRIDGE_CONFIG.default_targets),
    routes: Object.fromEntries(
      Object.entries(routes).map(([key, targets]) => [key, normaliseTargets(targets, [])])
    ),
    detect: {
      min_interval_ms: numberOrDefault(detect.min_interval_ms, DEFAULT_PROMPT_BRIDGE_CONFIG.detect.min_interval_ms),
      window_lines: numberOrDefault(detect.window_lines, DEFAULT_PROMPT_BRIDGE_CONFIG.detect.window_lines),
      patterns: Array.isArray(detect.patterns) && detect.patterns.every((p) => typeof p === 'string')
        ? detect.patterns
        : DEFAULT_PROMPT_BRIDGE_CONFIG.detect.patterns,
    },
  };
}

function numberOrDefault(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function normaliseTargets(value: unknown, fallback: PromptBridgeTarget[]): PromptBridgeTarget[] {
  if (!Array.isArray(value)) return fallback;
  return value.flatMap((target): PromptBridgeTarget[] => {
    if (!target || typeof target !== 'object') return [];
    const t = target as Record<string, unknown>;
    if (t.kind === 'linked_chat') return [{ kind: 'linked_chat' } satisfies PromptBridgeTarget];
    if (t.kind === 'chat' && typeof t.session_id === 'string' && t.session_id.trim()) {
      return [{ kind: 'chat', session_id: t.session_id.trim() } satisfies PromptBridgeTarget];
    }
    if (t.kind === 'webhook' && typeof t.url === 'string' && /^https?:\/\//i.test(t.url)) {
      return [{ kind: 'webhook', url: t.url } satisfies PromptBridgeTarget];
    }
    return [];
  });
}

export function parsePromptBridgeTarget(value: string): PromptBridgeTarget {
  const v = value.trim();
  if (!v || v === 'linked' || v === 'linked_chat') return { kind: 'linked_chat' };
  if (v.startsWith('chat:')) return { kind: 'chat', session_id: v.slice(5) };
  if (v.startsWith('webhook:')) return { kind: 'webhook', url: v.slice(8) };
  throw new Error('target must be linked, chat:<session-id>, or webhook:<url>');
}

export function getPromptBridgeConfig(): PromptBridgeConfig {
  return normalisePromptBridgeConfig(queries.getSetting(SETTING_KEY));
}

export function setPromptBridgeConfig(config: PromptBridgeConfig): PromptBridgeConfig {
  const normalised = normalisePromptBridgeConfig(config);
  queries.setSetting(SETTING_KEY, JSON.stringify(normalised));
  return normalised;
}

function getState(sessionId: string): PromptBridgeSessionState {
  let state = sessions.get(sessionId);
  if (!state) {
    state = {
      lines: [],
      lastFingerprint: null,
      lastPostedAt: 0,
      pending: null,
    };
    sessions.set(sessionId, state);
  }
  return state;
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]|\x1b\].*?(?:\x07|\x1b\\)|\x1b[()][0-9A-B]|\r/g, '');
}

export function detectPromptLike(lines: string[], config: PromptBridgeConfig = DEFAULT_PROMPT_BRIDGE_CONFIG): string | null {
  const windowLines = lines
    .slice(-config.detect.window_lines)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim());
  if (windowLines.length === 0) return null;

  const excerpt = windowLines.join('\n').trim();
  if (excerpt.length < 4) return null;

  for (const pattern of config.detect.patterns) {
    try {
      const re = new RegExp(pattern, 'im');
      if (re.test(excerpt)) return excerpt.slice(-2_000);
    } catch {
      // Ignore bad user-supplied detector regexes. ANT is only carrying events.
    }
  }

  return null;
}

function fingerprint(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim().slice(-500);
}

export function summarizePromptText(rawText: string): string {
  const lines = rawText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const summary = lines.at(-1) || rawText.replace(/\s+/g, ' ').trim() || 'Waiting for input';
  return summary.length > 160 ? `${summary.slice(0, 157)}...` : summary;
}

export function promptNeedsInput(event: PromptDetectedEvent): PromptBridgeNeedsInput {
  return {
    eventClass: 'prompt_bridge',
    summary: summarizePromptText(event.raw_text),
    since: new Date(event.ts).toISOString(),
    promptId: event.id,
    detector: event.detector,
    source: 'prompt_bridge',
  };
}

function routeTargets(sessionId: string, session: any, config: PromptBridgeConfig): PromptBridgeTarget[] {
  return (
    config.routes[sessionId] ??
    (session?.linked_chat_id ? config.routes[session.linked_chat_id] : undefined) ??
    config.default_targets
  );
}

function promptMessage(event: PromptDetectedEvent, session: any): string {
  const name = session?.display_name || session?.name || event.terminal_id;
  return [
    '[prompt_detected]',
    `Terminal: ${name} (${event.terminal_id})`,
    '',
    '```text',
    event.raw_text,
    '```',
    '',
    `Respond: ant prompt respond ${event.terminal_id} --text "..."`,
  ].join('\n');
}

async function deliverTarget(event: PromptDetectedEvent, target: PromptBridgeTarget, content: string, session: any): Promise<string | null> {
  if (target.kind === 'linked_chat') {
    const chatId = session?.linked_chat_id;
    if (!chatId || !deps.postToChat) return null;
    deps.postToChat(event.terminal_id, chatId, content, 'prompt_detected');
    return chatId;
  }

  if (target.kind === 'chat') {
    if (!deps.postToChat) return null;
    deps.postToChat(event.terminal_id, target.session_id, content, 'prompt_detected');
    return target.session_id;
  }

  if (target.kind === 'webhook') {
    await fetch(target.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    }).catch(() => {});
  }

  return null;
}

export async function feedPromptBridge(sessionId: string, text: string): Promise<void> {
  const config = getPromptBridgeConfig();
  if (!config.enabled || !deps.getSession) return;

  const session = deps.getSession(sessionId);
  if (!session || session.type !== 'terminal') return;
  if (!sessionSupportsPromptBridge(session)) return;

  const state = getState(sessionId);
  const stripped = stripAnsi(text);
  const lines = stripped.split('\n').filter((line) => line.trim());
  state.lines.push(...lines);
  if (state.lines.length > MAX_BUFFER_LINES) state.lines = state.lines.slice(-MAX_BUFFER_LINES);

  const rawText = detectPromptLike(state.lines, config);
  if (!rawText) return;

  const fp = fingerprint(rawText);
  const now = Date.now();
  if (state.lastFingerprint === fp && now - state.lastPostedAt < config.detect.min_interval_ms) return;

  const targets = routeTargets(sessionId, session, config);
  if (targets.length === 0) return;

  const event: PromptDetectedEvent = {
    id: `prompt_${now}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'prompt_detected',
    terminal_id: sessionId,
    session_id: sessionId,
    raw_text: rawText,
    detector: DETECTOR_NAME,
    ts: now,
    targets,
    delivered_to: [],
    status: 'pending',
  };

  const content = promptMessage(event, session);
  for (const target of targets) {
    const deliveredTo = await deliverTarget(event, target, content, session);
    if (deliveredTo) event.delivered_to.push(deliveredTo);
  }

  state.lastFingerprint = fp;
  state.lastPostedAt = now;
  state.pending = event;

  deps.appendRunEvent?.(sessionId, 'terminal', 'medium', 'prompt', rawText, { prompt_bridge: event }, null);
  const needsInput = promptNeedsInput(event);
  deps.broadcastGlobal?.({
    type: 'prompt_detected',
    sessionId,
    prompt: {
      id: event.id,
      terminal_id: event.terminal_id,
      raw_text: event.raw_text,
      ts: event.ts,
      summary: needsInput.summary,
    },
  });
  deps.broadcastGlobal?.({
    type: 'session_needs_input',
    sessionId,
    eventClass: needsInput.eventClass,
    summary: needsInput.summary,
    source: needsInput.source,
    promptId: needsInput.promptId,
    detector: needsInput.detector,
    since: needsInput.since,
  });
}

export function getPendingPrompt(sessionId: string): PromptDetectedEvent | null {
  return sessions.get(sessionId)?.pending ?? null;
}

export async function respondToPrompt(sessionId: string, response: string, options: { enter?: boolean } = {}): Promise<PromptDetectedEvent | null> {
  if (!response || typeof response !== 'string') throw new Error('response must be a non-empty string');
  if (!deps.writeToTerminal) throw new Error('Terminal writer is not initialised');

  const enter = options.enter !== false;
  deps.writeToTerminal(sessionId, response);
  if (enter && !/[\r\n]$/.test(response)) {
    setTimeout(() => deps.writeToTerminal?.(sessionId, '\r'), 150);
  }

  const state = getState(sessionId);
  const pending = state.pending;
  if (pending) {
    pending.status = 'responded';
    state.pending = null;
  }

  deps.appendRunEvent?.(sessionId, 'json', 'high', 'prompt_response', 'Prompt bridge response injected', {
    prompt_id: pending?.id ?? null,
    terminal_id: sessionId,
    entered: enter,
  }, null);
  deps.broadcastGlobal?.({ type: 'prompt_bridge_resolved', sessionId, promptId: pending?.id ?? null });
  if (pending) {
    deps.broadcastGlobal?.({
      type: 'session_input_resolved',
      sessionId,
      source: 'prompt_bridge',
      promptId: pending.id,
    });
  }

  return pending;
}

export function disposePromptBridge(sessionId: string): void {
  sessions.delete(sessionId);
}
