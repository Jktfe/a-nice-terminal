<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const room = $derived(data.room);

  type Message = {
    id: string;
    role?: string | null;
    content: string;
    sender_id?: string | null;
    handle?: string | null;
    msg_type?: string;
    created_at?: string;
    meta?: any;
  };

  let messages = $state<Message[]>([]);
  let composeText = $state('');
  let connecting = $state(true);
  let connectedAt = $state<string | null>(null);
  let lastError = $state<string | null>(null);
  let sending = $state(false);
  let listEl: HTMLDivElement | null = $state(null);

  let evt: EventSource | null = null;

  function scrollToBottom() {
    if (!listEl) return;
    requestAnimationFrame(() => {
      if (listEl) listEl.scrollTop = listEl.scrollHeight;
    });
  }

  function upsertMessage(m: Message) {
    const idx = messages.findIndex((x) => x.id === m.id);
    if (idx === -1) {
      messages = [...messages, m];
    } else {
      messages[idx] = { ...messages[idx], ...m };
      messages = [...messages];
    }
    scrollToBottom();
  }

  function removeMessage(id: string) {
    messages = messages.filter((x) => x.id !== id);
  }

  async function loadInitialMessages() {
    try {
      const res = await fetch(`/api/remote-rooms/${room.room_id}/messages?limit=50`);
      if (!res.ok) {
        lastError = `Initial fetch failed: HTTP ${res.status}`;
        return;
      }
      const body = await res.json();
      messages = body.messages || [];
      scrollToBottom();
    } catch (err: any) {
      lastError = `Initial fetch error: ${err?.message || err}`;
    }
  }

  function openStream() {
    evt = new EventSource(`/api/remote-rooms/${room.room_id}/stream`);

    evt.addEventListener('ready', () => {
      connecting = false;
      connectedAt = new Date().toISOString();
      lastError = null;
    });

    evt.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'message_added' && data.message) {
          upsertMessage(data.message);
        } else if (data.type === 'message_updated' && data.msgId) {
          const existing = messages.find((m) => m.id === data.msgId);
          if (existing) upsertMessage({ ...existing, meta: data.meta });
        } else if (data.type === 'message_deleted' && data.msgId) {
          removeMessage(data.msgId);
        } else if (data.room_id) {
          // ready handshake frame (also arrives on 'message' if the EventSource doesn't catch the named event)
          connecting = false;
          if (!connectedAt) connectedAt = new Date().toISOString();
        }
      } catch {
        /* ignore non-JSON frames (heartbeat comments arrive as undefined) */
      }
    };

    evt.onerror = () => {
      connecting = false;
      lastError = 'Stream connection lost — browser EventSource will retry automatically.';
    };
  }

  async function sendMessage() {
    const text = composeText.trim();
    if (!text || sending) return;
    sending = true;
    try {
      const res = await fetch(`/api/remote-rooms/${room.room_id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: 'user',
          content: text,
          format: 'text',
          msg_type: 'message',
        }),
      });
      if (!res.ok) {
        const errBody = await res.text();
        lastError = `Send failed: HTTP ${res.status} — ${errBody.slice(0, 200)}`;
        return;
      }
      composeText = '';
      lastError = null;
      // Don't optimistically insert — the SSE stream will deliver it back to us.
    } catch (err: any) {
      lastError = `Send error: ${err?.message || err}`;
    } finally {
      sending = false;
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      sendMessage();
    }
  }

  onMount(async () => {
    await loadInitialMessages();
    openStream();
  });

  onDestroy(() => {
    if (evt) {
      evt.close();
      evt = null;
    }
  });

  function senderLabel(m: Message): string {
    return m.handle || m.sender_id || (m.role === 'assistant' ? 'assistant' : 'user');
  }

  function fmtTime(s: string | undefined): string {
    if (!s) return '';
    try {
      const d = new Date(s);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }
</script>

<svelte:head>
  <title>{room.label || room.room_id} — Remote Room</title>
</svelte:head>

<div class="page">
  <header class="bar">
    <div class="title">
      <span class="badge">REMOTE</span>
      <strong>{room.label || room.room_id}</strong>
      <span class="meta">on {new URL(room.server_url).host}</span>
    </div>
    <div class="status">
      <span class="dot" class:ok={!connecting && !lastError} class:warn={connecting} class:err={!!lastError}></span>
      {#if connecting}connecting…{:else if lastError}error{:else}live as {room.handle || '(no handle)'}{/if}
    </div>
  </header>

  <div class="messages" bind:this={listEl}>
    {#if messages.length === 0 && !connecting}
      <div class="empty">No messages yet.</div>
    {/if}
    {#each messages as m (m.id)}
      <div class="msg" class:me={m.handle === room.handle}>
        <div class="msg-head">
          <span class="who">{senderLabel(m)}</span>
          <span class="when">{fmtTime(m.created_at)}</span>
        </div>
        <div class="msg-body">{m.content}</div>
      </div>
    {/each}
  </div>

  {#if lastError}
    <div class="err-banner">{lastError}</div>
  {/if}

  <form class="compose" onsubmit={(e) => { e.preventDefault(); sendMessage(); }}>
    <textarea
      bind:value={composeText}
      onkeydown={onKeydown}
      placeholder="Type a message — ⌘+Enter to send"
      rows="2"
    ></textarea>
    <button type="submit" disabled={sending || !composeText.trim()}>
      {sending ? 'Sending…' : 'Send'}
    </button>
  </form>
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100vw;
    background: #fafafa;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #1a1a1a;
  }
  .bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 16px;
    background: #1F2D5C;
    color: #fff;
    border-bottom: 2px solid #C9A55B;
  }
  .title { display: flex; align-items: center; gap: 10px; }
  .badge {
    background: #C9A55B; color: #1F2D5C; font-size: 10px; font-weight: 700;
    padding: 2px 6px; border-radius: 3px; letter-spacing: 0.5px;
  }
  .title strong { font-size: 15px; }
  .meta { color: #C9A55B; font-size: 12px; }
  .status { display: flex; align-items: center; gap: 6px; font-size: 12px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #888; }
  .dot.ok { background: #4caf50; }
  .dot.warn { background: #ffb300; }
  .dot.err { background: #e53935; }
  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .empty { color: #888; font-style: italic; text-align: center; padding: 40px; }
  .msg {
    background: #fff;
    border: 1px solid #eee;
    border-radius: 6px;
    padding: 8px 12px;
    max-width: 70%;
  }
  .msg.me { align-self: flex-end; background: #e8f1ff; border-color: #c8dcff; }
  .msg-head { display: flex; gap: 8px; font-size: 11px; color: #666; margin-bottom: 4px; }
  .who { font-weight: 600; color: #1F2D5C; }
  .msg-body { white-space: pre-wrap; word-wrap: break-word; font-size: 14px; line-height: 1.4; }
  .err-banner {
    background: #fee; color: #b71c1c; padding: 6px 16px; font-size: 12px;
    border-top: 1px solid #fbb;
  }
  .compose {
    display: flex;
    gap: 8px;
    padding: 12px 16px;
    background: #fff;
    border-top: 1px solid #ddd;
  }
  .compose textarea {
    flex: 1;
    resize: vertical;
    padding: 8px;
    border: 1px solid #ccc;
    border-radius: 4px;
    font-family: inherit;
    font-size: 14px;
  }
  .compose button {
    padding: 8px 16px;
    background: #1F2D5C;
    color: #fff;
    border: none;
    border-radius: 4px;
    font-weight: 600;
    cursor: pointer;
  }
  .compose button:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
