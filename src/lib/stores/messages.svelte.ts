interface Message {
  id: string;
  session_id: string;
  role: string;
  content: string;
  format: string;
  status: string;
  created_at: string;
}

let messages = $state<Message[]>([]);
let streamingId = $state<string | null>(null);

export function useMessageStore() {
  async function load(sessionId: string) {
    const res = await fetch(`/api/sessions/${sessionId}/messages`);
    const data = await res.json();
    messages = data.messages || [];
  }

  async function send(sessionId: string, content: string) {
    const res = await fetch(`/api/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user', content, format: 'text' }),
    });
    const msg = await res.json();
    messages = [...messages, msg];
    return msg;
  }

  function handleStreamChunk(msgId: string, chunk: string) {
    const idx = messages.findIndex(m => m.id === msgId);
    if (idx >= 0) {
      messages[idx] = {
        ...messages[idx],
        content: messages[idx].content + chunk,
        status: 'streaming',
      };
    } else {
      messages = [
        ...messages,
        {
          id: msgId,
          session_id: '',
          role: 'assistant',
          content: chunk,
          format: 'text',
          status: 'streaming',
          created_at: new Date().toISOString(),
        },
      ];
    }
    streamingId = msgId;
  }

  function handleStreamEnd(msgId: string) {
    const idx = messages.findIndex(m => m.id === msgId);
    if (idx >= 0) {
      messages[idx] = { ...messages[idx], status: 'complete' };
    }
    streamingId = null;
  }

  return {
    get messages() {
      return messages;
    },
    get streamingId() {
      return streamingId;
    },
    load,
    send,
    handleStreamChunk,
    handleStreamEnd,
  };
}
