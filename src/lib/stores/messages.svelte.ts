interface Message {
  id: string;
  session_id: string;
  role: string;
  content: string;
  format: string;
  status: string;
  sender_id: string | null;
  target: string | null;
  msg_type: string;
  created_at: string;
  meta?: string | null;
}

let messages = $state<Message[]>([]);
let streamingId = $state<string | null>(null);

export function useMessageStore() {
  async function load(sessionId: string) {
    const res = await fetch(`/api/sessions/${sessionId}/messages`);
    const data = await res.json();
    messages = data.messages || [];
  }

  async function send(sessionId: string, content: string, opts?: { sender_id?: string; target?: string }) {
    const res = await fetch(`/api/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'user',
        content,
        format: 'text',
        sender_id: opts?.sender_id ?? null,
        target: opts?.target ?? null,
        msg_type: 'message',
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
        format: 'text', status: 'streaming', sender_id: null, target: null, msg_type: 'message',
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
    load,
    send,
    handleStreamChunk,
    handleStreamEnd,
  };
}
