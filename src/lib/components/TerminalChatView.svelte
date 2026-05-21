<!--
  TerminalChatView.svelte — refactored per FRONT-3v2-5 + T2-LINKED-CHAT-T1b
  canonical PASS (2026-05-14). PATH A locked: terminal chat IS the
  terminal-scoped chat-room dialogue, NOT a kind=message filter over run-events.

  Data sources:
    GET /api/chat-rooms/[linkedChatRoomId]/messages   → history seed
    GET /api/realtime/[linkedChatRoomId]/events       → SSE live tail
    POST /api/terminals/[terminalId]/agent-launch     → composer send

  Composer follows JWPK spec: in Chat view the textarea routes through
  agent-launch → terminal chat → PTY fanout. Direct PTY input via
  SpecialKeys or Raw xterm bypasses Chat — only ANT + RAW see those.
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { browser } from '$app/environment';

  type Props = {
    terminalId: string;
    linkedChatRoomId: string | null;
    agentKind?: string | null;
  };
  let { terminalId, linkedChatRoomId, agentKind = null }: Props = $props();

  type ChatMessage = {
    id: string;
    roomId: string;
    authorHandle: string;
    authorDisplayName?: string;
    kind: string;
    body: string;
    postedAt: string;
    postOrder?: number;
  };

  let messages = $state<ChatMessage[]>([]);
  let composer = $state('');
  let sending = $state(false);
  let lastError = $state('');
  let scrollEl: HTMLDivElement | undefined = $state();
  let eventSource: EventSource | null = null;

  function scrollToBottom(): void {
    if (!scrollEl) return;
    queueMicrotask(() => {
      if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
    });
  }

  function formatTime(iso: string): string {
    try {
      return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch { return ''; }
  }

  async function sendLine(): Promise<void> {
    const line = composer.trim();
    if (!line || sending) return;
    sending = true;
    lastError = '';
    try {
      // Per JWPK THREAD 1 spec: agentKind=null → composer writes raw to
      // PTY via /input (no ANT-chat envelope). agentKind set → wraps as
      // ant-chat via /agent-launch (existing flow).
      const usingAgentChat = agentKind !== null && agentKind !== '';
      const url = usingAgentChat
        ? `/api/terminals/${encodeURIComponent(terminalId)}/agent-launch`
        : `/api/terminals/${encodeURIComponent(terminalId)}/input`;
      const body = usingAgentChat ? { message: line } : { data: line + '\r' };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(`send failed: ${res.status}`);
      composer = '';
    } catch (cause) {
      lastError = cause instanceof Error ? cause.message : String(cause);
    } finally {
      sending = false;
    }
  }

  function handleKeydown(ev: KeyboardEvent): void {
    if (ev.key === 'Enter') {
      if (ev.metaKey || ev.ctrlKey) {
        ev.preventDefault();
        void sendLine();
        return;
      }
      if (!ev.shiftKey) {
        ev.preventDefault();
        void sendLine();
        return;
      }
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      (ev.target as HTMLTextAreaElement | null)?.blur();
    }
  }

  async function seedHistory(): Promise<void> {
    if (!linkedChatRoomId) return;
    try {
      const res = await fetch(`/api/chat-rooms/${encodeURIComponent(linkedChatRoomId)}/messages`);
      if (!res.ok) return;
      const body = (await res.json()) as { messages?: ChatMessage[] };
      messages = body.messages ?? [];
      scrollToBottom();
    } catch { /* non-blocking */ }
  }

  function appendMessage(msg: ChatMessage): void {
    if (messages.some((m) => m.id === msg.id)) return;
    messages.push(msg);
    scrollToBottom();
  }

  function teardownEventSource(): void {
    if (eventSource) {
      eventSource.onmessage = null;
      eventSource.onerror = null;
      eventSource.close();
    }
    eventSource = null;
  }

  // Re-seed + re-subscribe whenever linkedChatRoomId changes (fetched
  // by TerminalCard onMount, so often null at first paint then populated).
  $effect(() => {
    if (!browser) return;
    const roomId = linkedChatRoomId;
    teardownEventSource();
    if (!roomId) return;
    messages = [];
    void seedHistory();
    eventSource = new EventSource(`/api/realtime/${encodeURIComponent(roomId)}/events`);
    eventSource.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(ev.data) as { type?: string; message?: ChatMessage };
        if (parsed.type === 'message_added' && parsed.message) {
          appendMessage(parsed.message);
        }
      } catch { /* heartbeat / malformed */ }
    };
    eventSource.onerror = () => { /* auto-reconnect */ };
    return () => { teardownEventSource(); };
  });

  onDestroy(() => { teardownEventSource(); });
</script>

<section class="chat-view" aria-label="Terminal chat">
  <div class="thread" bind:this={scrollEl}>
    {#if !linkedChatRoomId}
      <div class="empty">
        <p><strong>No terminal chat available.</strong></p>
        <p class="muted">This terminal was created before terminal chat went live. Create a new terminal to enable the Chat view.</p>
      </div>
    {:else if !agentKind}
      <div class="empty">
        <p><strong>No agent selected.</strong></p>
        <p class="muted">Set an agent kind in the header to launch ant-chat dialogue here. With agentKind=none, composer input writes raw bytes to the PTY (see Raw view for output).</p>
      </div>
    {:else if messages.length === 0}
      <div class="empty">
        <p><strong>No messages yet.</strong></p>
        <p class="muted">Send a line below to start a conversation with the {agentKind} agent.</p>
      </div>
    {:else}
      {#each messages as msg (msg.id)}
        <article class="bubble" data-kind={msg.kind}>
          <header class="bubble-meta">
            <span class="author">{msg.authorDisplayName ?? msg.authorHandle}</span>
            <span class="kind">{msg.kind}</span>
            <time>{formatTime(msg.postedAt)}</time>
          </header>
          <pre class="body">{msg.body}</pre>
        </article>
      {/each}
    {/if}
  </div>

  <form class="composer" onsubmit={(e) => { e.preventDefault(); void sendLine(); }}>
    <textarea
      bind:value={composer}
      onkeydown={handleKeydown}
      placeholder={linkedChatRoomId ? 'Type a message — Enter to send' : 'No terminal chat available'}
      rows="2"
      disabled={!linkedChatRoomId}
      aria-label="Send message to terminal chat"
    ></textarea>
    <button type="submit" class="send" disabled={sending || composer.trim().length === 0 || !linkedChatRoomId}>
      {sending ? 'Sending…' : 'Send'}
    </button>
  </form>

  {#if lastError}<p class="error" role="alert">{lastError}</p>{/if}
</section>

<style>
  .chat-view {
    display: flex; flex-direction: column;
    min-height: 32rem; max-height: 32rem;
    background: var(--bg);
  }
  .thread {
    flex: 1 1 auto; overflow-y: auto;
    padding: 0.85rem;
    display: flex; flex-direction: column; gap: 0.6rem;
  }
  .empty {
    margin: auto; max-width: 32rem; text-align: center; color: var(--ink-strong);
  }
  .empty .muted { color: var(--ink-soft); font-size: 0.9rem; margin-top: 0.45rem; }
  .bubble {
    border: 1px solid var(--line-soft); border-radius: 0.55rem;
    background: var(--surface-card); padding: 0.5rem 0.7rem;
  }
  .bubble[data-kind="human"] { border-color: var(--accent); }
  .bubble-meta {
    display: flex; gap: 0.55rem; align-items: center;
    font-size: 0.74rem; color: var(--ink-soft); margin-bottom: 0.25rem;
  }
  .bubble-meta .author { color: var(--ink-strong); font-weight: 700; }
  .bubble-meta .kind { text-transform: uppercase; letter-spacing: 0.04em; font-size: 0.68rem; }
  .bubble .body {
    margin: 0; white-space: pre-wrap; word-break: break-word;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.88rem; color: var(--ink-strong);
  }
  .composer {
    display: flex; gap: 0.5rem; padding: 0.55rem 0.7rem;
    border-top: 1px solid var(--line-soft); background: var(--surface-card);
  }
  .composer textarea {
    flex: 1 1 auto; resize: none;
    padding: 0.4rem 0.55rem; border-radius: 0.4rem;
    border: 1px solid var(--line-soft);
    background: var(--bg); color: var(--ink-strong);
    font-family: ui-monospace, monospace; font-size: 0.88rem;
  }
  .composer textarea:disabled { opacity: 0.5; }
  .composer .send {
    padding: 0.4rem 0.85rem; border-radius: 999px;
    border: 1px solid var(--accent); background: var(--accent); color: white;
    font-weight: 800; cursor: pointer;
  }
  .composer .send:disabled { opacity: 0.55; cursor: not-allowed; }
  .error { margin: 0; padding: 0.4rem 0.7rem; color: var(--accent); font-weight: 700; }
</style>
