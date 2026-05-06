import { queries } from './db.js';
import { broadcast } from './ws-broadcast.js';

type PromptCaptureOptions = {
  captureSource: 'terminal_input' | 'api_terminal_input' | 'chat_injection' | 'prompt_bridge';
  transport?: string;
  trust?: 'high' | 'medium' | 'raw';
  messageId?: string | null;
  roomId?: string | null;
  target?: string | null;
  rawRef?: string | null;
  tsMs?: number;
};

const MAX_PROMPT_TEXT = 12_000;
const DEDUPE_WINDOW_MS = 1_500;

const G = globalThis as typeof globalThis & {
  __antPromptCaptureRecent?: Map<string, number>;
};
const recent = G.__antPromptCaptureRecent ?? new Map<string, number>();
G.__antPromptCaptureRecent = recent;

function stripAnsi(input: string): string {
  return input
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[@-Z\\-_]/g, '');
}

function pruneRecent(now: number): void {
  if (recent.size < 500) return;
  for (const [key, ts] of recent.entries()) {
    if (now - ts > DEDUPE_WINDOW_MS) recent.delete(key);
  }
}

export function normalisePromptInput(data: string): string | null {
  if (!data || typeof data !== 'string') return null;
  if (/^[\r\n\t\x00-\x1f\x7f]+$/.test(data)) return null;

  const text = stripAnsi(data)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\x00/g, '')
    .trim();

  if (!text) return null;
  if (text.length === 1) return null;
  if (!/[A-Za-z0-9@/]/.test(text)) return null;

  return text.slice(0, MAX_PROMPT_TEXT);
}

function toRunEvent(row: any): Record<string, unknown> | null {
  if (!row) return null;
  let payload: unknown = {};
  try { payload = row.payload ? JSON.parse(row.payload) : {}; }
  catch { payload = {}; }
  return {
    id: row.id,
    session_id: row.session_id,
    ts: row.ts_ms,
    ts_ms: row.ts_ms,
    source: row.source,
    trust: row.trust,
    kind: row.kind,
    text: row.text ?? '',
    payload,
    raw_ref: row.raw_ref ?? null,
    created_at: row.created_at,
  };
}

export function capturePromptInput(
  sessionId: string,
  data: string,
  options: PromptCaptureOptions,
): Record<string, unknown> | null {
  const prompt = normalisePromptInput(data);
  if (!prompt) return null;

  const now = options.tsMs ?? Date.now();
  const dedupeKey = `${sessionId}\0${options.captureSource}\0${prompt}`;
  const previous = recent.get(dedupeKey);
  if (previous && now - previous < DEDUPE_WINDOW_MS) return null;
  recent.set(dedupeKey, now);
  pruneRecent(now);

  try {
    const payload = {
      prompt,
      capture_source: options.captureSource,
      transport: options.transport ?? null,
      message_id: options.messageId ?? null,
      room_id: options.roomId ?? null,
      target: options.target ?? null,
    };
    const row = queries.appendRunEvent(
      sessionId,
      now,
      'terminal',
      options.trust ?? 'medium',
      'prompt',
      prompt,
      JSON.stringify(payload),
      options.rawRef ?? null,
    );
    const event = toRunEvent(row);
    if (event) {
      broadcast(sessionId, { type: 'run_event_created', sessionId, event });
    }
    return event;
  } catch {
    return null;
  }
}
