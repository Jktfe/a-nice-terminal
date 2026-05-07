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
      messages = [...fresh, ...messages];
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
      messages = [...messages, msg];
    }
    return msg;
  }

  function handleStreamChunk(msgId: string, chunk: string) {
    const idx = messages.findIndex(m => m.id === msgId);
    if (idx >= 0) {
      messages[idx] = { ...messages[idx], content: messages[idx].content + chunk, status: 'streaming' };
    } else {
      messages = [...messages, {
        id: msgId, session_id: '', role: 'assistant', content: chunk,
        format: 'text', status: 'streaming', sender_id: null, target: null, reply_to: null, msg_type: 'message',
        created_at: new Date().toISOString(),
      }];
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
