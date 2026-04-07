<script lang="ts">
  import { stripAnsi } from '$lib/utils/ansi.js';
  import MessageBubble from './MessageBubble.svelte';

  let {
    sessionId,
    allSessions = [],
    ws,              // the parent's WebSocket instance (reactive)
    onSendCommand,   // (cmd: string) => Promise<void>
  }: {
    sessionId: string;
    allSessions?: any[];
    ws: WebSocket | null;
    onSendCommand: (cmd: string) => Promise<void>;
  } = $props();

  interface PtyBubble {
    id: string;
    role: 'assistant' | 'user';
    content: string;
    created_at: string;
    sender_id: string | null;
  }

  let bubbles = $state<PtyBubble[]>([]);
  let inputText = $state('');
  let scrollEl = $state<HTMLDivElement | null>(null);
  let atBottom = $state(true);
  let sending = $state(false);

  // Accumulate PTY output and debounce into bubbles
  let pendingOutput = '';
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let _msgSeq = 0;

  function flushOutput() {
    const cleaned = stripAnsi(pendingOutput).trim();
    pendingOutput = '';
    debounceTimer = null;
    if (!cleaned) return;
    bubbles = [...bubbles, {
      id: `pty-${++_msgSeq}`,
      role: 'assistant',
      content: cleaned,
      created_at: new Date().toISOString(),
      sender_id: null,
    }];
    setTimeout(scrollDown, 30);
  }

  function handleOutput(raw: string) {
    pendingOutput += raw;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flushOutput, 700);
  }

  // Attach/detach WS listener when ws changes
  let _attachedWs: WebSocket | null = null;

  function onMessage(event: MessageEvent) {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'terminal_output' && data.sessionId === sessionId) {
        handleOutput(data.data ?? '');
      }
    } catch {}
  }

  $effect(() => {
    if (_attachedWs && _attachedWs !== ws) {
      _attachedWs.removeEventListener('message', onMessage);
      _attachedWs = null;
    }
    if (ws && ws !== _attachedWs) {
      ws.addEventListener('message', onMessage);
      _attachedWs = ws;
    }
  });

  function scrollDown() {
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
  }

  function onScroll() {
    if (!scrollEl) return;
    atBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 80;
  }

  async function sendCmd() {
    const text = inputText.trim();
    if (!text || sending) return;
    sending = true;
    // Add as user bubble immediately
    bubbles = [...bubbles, {
      id: `user-${++_msgSeq}`,
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
      sender_id: null,
    }];
    inputText = '';
    setTimeout(scrollDown, 30);
    try {
      await onSendCommand(text);
    } finally {
      sending = false;
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendCmd();
    }
  }
</script>

<div class="flex flex-col h-full overflow-hidden">
  <!-- Bubble feed -->
  <div
    class="flex-1 overflow-y-auto px-3 py-3 space-y-2"
    bind:this={scrollEl}
    onscroll={onScroll}
  >
    {#if bubbles.length === 0}
      <div class="flex flex-col items-center justify-center h-full text-center opacity-50 gap-2">
        <span class="text-2xl">⌨</span>
        <p class="text-xs" style="color:var(--text-muted);">Terminal output will appear here</p>
        <p class="text-[11px]" style="color:var(--text-faint);">Type below to send commands</p>
      </div>
    {:else}
      {#each bubbles as b (b.id)}
        <MessageBubble
          message={b}
          {sessionId}
          {allSessions}
        />
      {/each}
    {/if}
  </div>

  <!-- Scroll-to-bottom -->
  {#if !atBottom && bubbles.length > 0}
    <div class="flex justify-center py-1">
      <button
        onclick={scrollDown}
        class="flex items-center gap-1 px-3 py-1 text-xs rounded-full border shadow"
        style="background:var(--bg-card);border-color:#6366F155;color:#6366F1;"
      >
        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
        </svg>
        Jump to bottom
      </button>
    </div>
  {/if}

  <!-- Input -->
  <div class="border-t px-3 py-2.5 flex items-center gap-2" style="border-color:var(--border-light);background:var(--bg-surface);">
    <input
      bind:value={inputText}
      onkeydown={onKeydown}
      placeholder="Send command to terminal…"
      class="flex-1 bg-transparent text-sm outline-none placeholder-gray-500"
      style="color:var(--text);"
    />
    <button
      onclick={sendCmd}
      disabled={!inputText.trim() || sending}
      class="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all disabled:opacity-40"
      style="background:#6366F1;color:#fff;"
    >
      {#if sending}
        <span class="animate-spin text-xs">⟳</span>
      {:else}
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/>
        </svg>
      {/if}
    </button>
  </div>
</div>
