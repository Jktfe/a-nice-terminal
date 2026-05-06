// ANT v3 — pinned asks helpers
// Pure functions consumed by PinnedAsksPanel.svelte. Kept logic-only so
// tests (no Svelte component runtime in this repo) can cover them.

export interface AskMessage {
  id: string;
  sender_id?: string | null;
  handle?: string | null;
  meta?: string | Record<string, unknown> | null;
}

export interface AskMeta {
  asks: string[];
  inferred_asks: string[];
  asks_resolved: number[];
}

export interface OpenAsk {
  /** Source message id (use this for the "Jump" button target). */
  messageId: string;
  /** Index into the COMBINED list `[...asks, ...inferred_asks]`. */
  index: number;
  /** The ask text. */
  text: string;
  /** True when this ask came from `meta.inferred_asks`. */
  inferred: boolean;
  /** Sender display string (handle, sender_id, or empty). */
  sender: string;
}

const EMPTY_META: AskMeta = { asks: [], inferred_asks: [], asks_resolved: [] };

export function parseAskMeta(meta: AskMessage['meta']): AskMeta {
  if (!meta) return EMPTY_META;
  let raw: unknown = meta;
  if (typeof meta === 'string') {
    try {
      raw = JSON.parse(meta);
    } catch {
      return EMPTY_META;
    }
  }
  if (!raw || typeof raw !== 'object') return EMPTY_META;
  const obj = raw as Record<string, unknown>;
  const asks = sanitiseStringList(obj.asks);
  const inferred_asks = sanitiseStringList(obj.inferred_asks);
  const asks_resolved = sanitiseNumberList(obj.asks_resolved);
  return { asks, inferred_asks, asks_resolved };
}

function sanitiseStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function sanitiseNumberList(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is number => typeof item === 'number' && Number.isFinite(item))
    .map((n) => Math.trunc(n));
}

export function senderLabel(
  msg: AskMessage,
  resolver?: (sender_id: string) => string,
): string {
  const id = typeof msg.sender_id === 'string' ? msg.sender_id : '';
  if (id && resolver) {
    const resolved = resolver(id);
    if (resolved && resolved.trim().length > 0) return resolved;
  }
  if (typeof msg.handle === 'string' && msg.handle.length > 0) return msg.handle;
  return id;
}

export function aggregateOpenAsks(
  messages: AskMessage[],
  resolver?: (sender_id: string) => string,
): OpenAsk[] {
  const out: OpenAsk[] = [];
  for (const msg of messages) {
    if (!msg?.id) continue;
    const meta = parseAskMeta(msg.meta);
    const combined = [...meta.asks, ...meta.inferred_asks];
    if (combined.length === 0) continue;
    const resolved = new Set(meta.asks_resolved);
    const sender = senderLabel(msg, resolver);
    for (let i = 0; i < combined.length; i++) {
      if (resolved.has(i)) continue;
      out.push({
        messageId: msg.id,
        index: i,
        text: combined[i],
        inferred: i >= meta.asks.length,
        sender,
      });
    }
  }
  return out;
}

/** First non-empty ask text on a message, used for toast bodies. */
export function firstAskText(meta: AskMessage['meta']): string | null {
  const parsed = parseAskMeta(meta);
  const combined = [...parsed.asks, ...parsed.inferred_asks];
  return combined.length > 0 ? combined[0] : null;
}

/**
 * Optimistic update helper: produce the new resolved-index list for a
 * message after toggling a single index.
 */
export function toggleResolvedIndex(current: number[], index: number): number[] {
  const set = new Set(current);
  if (set.has(index)) set.delete(index);
  else set.add(index);
  return Array.from(set).sort((a, b) => a - b);
}
