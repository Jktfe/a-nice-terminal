<script lang="ts">
  import { onMount } from 'svelte';
  import MessageBubble from './MessageBubble.svelte';

  let { sessionId }: { sessionId: string } = $props();

  interface Message {
    id: string;
    role: string;
    content: string;
    format: string;
    status: string;
    sender_id?: string;
    handle?: string;
    sender_type?: string;
    created_at: string;
    meta?: string;
  }

  let messages = $state<Message[]>([]);
  let inputText = $state('');
  let atBottom = $state(true);
  let scrollEl = $state<HTMLElement | null>(null);
  let streamingId = $state<string | null>(null);

  function scrollToBottom() {
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
  }

  function onScroll() {
    if (!scrollEl) return;
    const threshold = 60;
    atBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < threshold;
  }

  $effect(() => {
    // Auto-scroll when messages change if user is near the bottom
    messages;
    streamingId;
    if (atBottom) setTimeout(scrollToBottom, 0);
  });

  async function sendMessage() {
    const text = inputText.trim();
    if (!text) return;
    inputText = '';
    await fetch(`/api/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user', content: text, format: 'text' }),
    });
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  onMount(() => {
    let ws: WebSocket | null = null;
    let destroyed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    // Load initial messages
    fetch(`/api/sessions/${sessionId}/messages?limit=50`)
      .then(r => r.json())
      .then(data => {
        messages = Array.isArray(data) ? data : (data.messages ?? []);
        setTimeout(scrollToBottom, 0);
      })
      .catch(() => {});

    function connect() {
      if (destroyed) return;
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${protocol}//${location.host}/ws`);

      ws.onopen = () => {
        ws!.send(JSON.stringify({ type: 'join_session', sessionId }));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.sessionId && data.sessionId !== sessionId) return;

          switch (data.type) {
            case 'message_created':
              if (!messages.find(m => m.id === data.id)) {
                messages = [...messages, data];
              }
              break;
            case 'message_updated':
              if (data.status === 'complete' || data.status === 'incomplete') {
                streamingId = null;
              }
              messages = messages.map(m =>
                m.id === data.msgId ? { ...m, meta: JSON.stringify(data.meta), status: data.status ?? m.status } : m
              );
              break;
            case 'message_deleted':
              messages = messages.filter(m => m.id !== data.msgId);
              if (streamingId === data.msgId) streamingId = null;
              break;
            case 'stream_chunk': {
              const { messageId, content } = data;
              const existing = messages.find(m => m.id === messageId);
              if (existing) {
                messages = messages.map(m =>
                  m.id === messageId ? { ...m, content: m.content + content, status: 'streaming' } : m
                );
              } else {
                messages = [...messages, {
                  id: messageId,
                  role: 'assistant',
                  content,
                  format: 'text',
                  status: 'streaming',
                  created_at: new Date().toISOString(),
                }];
              }
              streamingId = messageId;
              break;
            }
          }
        } catch {}
      };

      ws.onclose = () => {
        if (!destroyed) reconnectTimer = setTimeout(connect, 2000);
      };
    }

    connect();

    return () => {
      destroyed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  });
</script>

<div class="flex flex-col h-full min-h-0 overflow-hidden">
  <!-- Message feed -->
  <div
    bind:this={scrollEl}
    onscroll={onScroll}
    class="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-1"
    style="background: var(--bg);"
  >
    {#if messages.length === 0}
      <div class="flex items-center justify-center h-full">
        <p class="text-xs" style="color: var(--text-faint);">No messages yet</p>
      </div>
    {:else}
      {#each messages as msg (msg.id)}
        <MessageBubble message={msg} {sessionId} />
      {/each}
    {/if}
  </div>

  <!-- Compact input -->
  <div class="flex items-center gap-1 px-2 py-1.5 border-t flex-shrink-0" style="border-color: var(--border-light); background: var(--bg-surface);">
    <textarea
      bind:value={inputText}
      onkeydown={handleKeydown}
      placeholder="Message…"
      rows="1"
      class="flex-1 resize-none rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#6366F1]"
      style="background: var(--bg-input); color: var(--text); max-height: 80px;"
    ></textarea>
    <button
      onclick={sendMessage}
      disabled={!inputText.trim()}
      class="px-2 py-1 rounded text-xs font-medium transition-colors disabled:opacity-40"
      style="background: #6366F1; color: #fff;"
      title="Send (Enter)"
    >▶</button>
  </div>
</div>
