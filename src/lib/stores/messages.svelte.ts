interface Message {
  id: string;
  session_id: string;
  role: string;
  content: string;
  format: string;
  status: string;
  sender_id: string | null;
  target: string | null;
  reply_to: string | null;
  msg_type: string;
  created_at: string;
  meta?: string | null;
}

// Page size for the bounded initial fetch + scroll-up loadOlder pagination.
// Mirrors ChatPane.svelte:22 so the two views stay in lockstep.
const PAGE_SIZE = 50;

// Hard cap on the in-memory messages array. loadOlder appends without
// natural bound, which means a power-user scrolling weeks back through a
// long-running room can accumulate many MB of message rows + reactive
// overhead. When loadOlder would push past the cap, we drop the newest
// tail (since the user is scrolling UP — they care about older context;
// they can re-fetch the bottom by jumping back if they scroll down).
//
// 1000 messages × ~1KB avg = ~1MB raw + reactive overhead. Generous for
// realistic browsing while preventing the unbounded-grow failure mode
// flagged in docs/perf/audit-chat-room-load-2026-05-09.md M1.
const MAX_MESSAGES_IN_MEMORY = 1000;

function appendNewestBounded(rows: Message[], incoming: Message): Message[] {
  const next = [...rows, incoming];
  return next.length > MAX_MESSAGES_IN_MEMORY ? next.slice(-MAX_MESSAGES_IN_MEMORY) : next;
}

let messages = $state<Message[]>([]);
let streamingId = $state<string | null>(null);
let hasMoreMessages = $state(false);
let loadingOlder = $state(false);

export function useMessageStore() {
  async function load(sessionId: string, limit: number = PAGE_SIZE) {
    // Bounded initial fetch — pulls only the most recent `limit` messages.
    // Older history is fetched on demand via loadOlder() when the user scrolls
    // up. Critical for mobile-browser refresh performance: a session with
    // hundreds of messages used to scale linearly; now it's constant-time.
    const res = await fetch(`/api/sessions/${sessionId}/messages?limit=${limit}`);
    const data = await res.json();
    const rows: Message[] = data.messages || [];
    messages = rows;
    // If the server returned a full page, more history is likely available.
    // If less, we've reached the start of the conversation.
    hasMoreMessages = rows.length >= limit;
  }

  async function loadOlder(sessionId: string, limit: number = PAGE_SIZE): Promise<number> {
    // Returns the number of messages prepended so the caller can decide
    // whether to anchor scroll-position or skip the dom op. Idempotent on
    // concurrent calls — guarded by `loadingOlder`.
    if (loadingOlder || !hasMoreMessages) return 0;
    const oldest = messages[0];
    if (!oldest) return 0;
    loadingOlder = true;
    try {
      const before = encodeURIComponent(oldest.created_at);
      const res = await fetch(
        `/api/sessions/${sessionId}/messages?before=${before}&limit=${limit}`,
      );
      const data = await res.json();
      const older: Message[] = data.messages || [];
      if (older.length === 0) {
        hasMoreMessages = false;
        return 0;
      }
      // Dedupe by id in case a streaming chunk landed an early copy.
      const seen = new Set(messages.map((m) => m.id));
      const fresh = older.filter((m) => !seen.has(m.id));
      let next = [...fresh, ...messages];
      // Cap memory: if we've grown past the hard limit, drop the
      // newest tail. We just scrolled up to fetch older context, so
      // dropping the tail preserves what the user is currently looking
      // at. hasMoreMessages stays true so older fetches keep working.
      if (next.length > MAX_MESSAGES_IN_MEMORY) {
        next = next.slice(0, MAX_MESSAGES_IN_MEMORY);
      }
      messages = next;
      hasMoreMessages = older.length >= limit;
      return fresh.length;
    } finally {
      loadingOlder = false;
    }
  }

  async function send(
    sessionId: string,
    content: string,
    opts?: { sender_id?: string; target?: string; reply_to?: string | null; meta?: Record<string, unknown> }
  ) {
    const res = await fetch(`/api/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'user',
        content,
        format: 'text',
        sender_id: opts?.sender_id ?? null,
        target: opts?.target ?? null,
        reply_to: opts?.reply_to ?? null,
        msg_type: 'message',
        meta: opts?.meta ?? {},
      }),
    });
    const msg = await res.json();
    // Optimistic add — WS event deduplicates
    if (!messages.find(m => m.id === msg.id)) {
      messages = appendNewestBounded(messages, msg);
    }
    return msg;
  }

  function handleStreamChunk(msgId: string, chunk: string) {
    const idx = messages.findIndex(m => m.id === msgId);
    if (idx >= 0) {
      messages[idx] = { ...messages[idx], content: messages[idx].content + chunk, status: 'streaming' };
    } else {
      messages = appendNewestBounded(messages, {
        id: msgId, session_id: '', role: 'assistant', content: chunk,
        format: 'text', status: 'streaming', sender_id: null, target: null, reply_to: null, msg_type: 'message',
        created_at: new Date().toISOString(),
      });
    }
    streamingId = msgId;
  }

  function handleStreamEnd(msgId: string) {
    const idx = messages.findIndex(m => m.id === msgId);
    if (idx >= 0) messages[idx] = { ...messages[idx], status: 'complete' };
    streamingId = null;
  }

  return {
    get messages() { return messages; },
    set messages(v: Message[]) { messages = v; },
    get streamingId() { return streamingId; },
    get hasMoreMessages() { return hasMoreMessages; },
    get loadingOlder() { return loadingOlder; },
    load,
    loadOlder,
    send,
    handleStreamChunk,
    handleStreamEnd,
  };
}
