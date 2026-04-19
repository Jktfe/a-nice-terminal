<script lang="ts">
  import MessageBubble from '$lib/components/MessageBubble.svelte';
  import MessageInput from '$lib/components/MessageInput.svelte';
  import AgentEventCard from '$lib/components/AgentEventCard.svelte';
  import TerminalLine from '$lib/components/TerminalLine.svelte';
  import TerminalSummary from '$lib/components/TerminalSummary.svelte';
  import { SPECIAL_KEYS } from '$lib/shared/special-keys.js';

  interface PageSession {
    id: string;
    name: string;
    type: string;
    handle?: string;
    display_name?: string;
    linked_chat_id?: string | null;
  }

  interface Props {
    // For terminal sessions, these are the linked chat messages;
    // for chat sessions, these are the main session messages.
    messages: Record<string, unknown>[];
    sessionId: string;
    session: PageSession | null;
    allSessions: PageSession[];
    linkedChatId: string;
    linkedChatHasMore: boolean;
    linkedChatLoadingMore: boolean;
    replyTo: Record<string, unknown> | null;
    atBottom: boolean;
    mentionHandles: { handle: string; name: string }[];
    readReceipts: Record<string, { session_id: string; reader_name: string; reader_handle: string | null; read_at: string }[]>;
    onSend: (text: string) => void;
    onPostToLinkedChat: (text: string) => void;
    onLoadOlder: () => void;
    onScrollToBottom: () => void;
    onMessageDeleted: (id: string) => void;
    onMessageMetaUpdated: (id: string, meta: Record<string, unknown>) => void;
    onLinkedMessageDeleted: (id: string) => void;
    onLinkedMessageMetaUpdated: (id: string, meta: Record<string, unknown>) => void;
    onMessagePinToggled?: (id: string, pinned: boolean) => void;
    onLinkedMessagePinToggled?: (id: string, pinned: boolean) => void;
    onReply: (msg: Record<string, unknown>) => void;
    onClearReply: () => void;
    onAgentRespond: (sessionId: string, payload: unknown) => void;
    onScrollElMounted?: (el: HTMLElement) => void;
    onScroll?: () => void;
  }

  const {
    messages,
    sessionId,
    session,
    allSessions,
    linkedChatId,
    linkedChatHasMore,
    linkedChatLoadingMore,
    replyTo,
    atBottom,
    mentionHandles,
    readReceipts,
    onSend,
    onPostToLinkedChat,
    onLoadOlder,
    onScrollToBottom,
    onMessageDeleted,
    onMessageMetaUpdated,
    onLinkedMessageDeleted,
    onLinkedMessageMetaUpdated,
    onMessagePinToggled,
    onLinkedMessagePinToggled,
    onReply,
    onClearReply,
    onAgentRespond,
    onScrollElMounted,
    onScroll,
  }: Props = $props();

  let scrollElLocal = $state<HTMLElement | null>(null);

  $effect(() => {
    if (scrollElLocal) onScrollElMounted?.(scrollElLocal);
  });

  // Group consecutive terminal_line messages into single blocks for compact rendering
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function groupMessages(msgs: any[]): { key: string; type: string; items: any[] }[] {
    const groups: { key: string; type: string; items: any[] }[] = [];
    for (const msg of msgs) {
      const t = (msg.msg_type as string) || 'chat';
      if (t === 'terminal_line' && groups.length > 0 && groups[groups.length - 1].type === 'terminal_line') {
        groups[groups.length - 1].items.push(msg);
      } else {
        groups.push({ key: msg.id as string, type: t, items: [msg] });
      }
    }
    return groups;
  }

  let linkedChatInput = $state('');
  let sendBtnEl = $state<HTMLButtonElement | null>(null);

  function handleLinkedSend() {
    console.log('[ChatMessages] handleLinkedSend called, input="' + linkedChatInput + '"');
    if (!linkedChatInput.trim()) return;
    onPostToLinkedChat(linkedChatInput.trim());
    linkedChatInput = '';
  }

  // Workaround: Svelte 5 event delegation sometimes fails on buttons in
  // child components. Attach a native DOM listener as a belt-and-braces fix.
  $effect(() => {
    if (sendBtnEl) {
      const handler = () => handleLinkedSend();
      sendBtnEl.addEventListener('click', handler);
      return () => sendBtnEl?.removeEventListener('click', handler);
    }
  });

  // ── Special key buttons for terminal-linked chat pages ──
  // Send a key sequence to the terminal session via the REST endpoint.
  // The terminal's sessionId is session.id (the terminal session itself).
  let keyBtnEls = $state<(HTMLButtonElement | null)[]>([]);

  async function sendSpecialKey(seq: string) {
    if (!session || session.type !== 'terminal') return;
    const terminalId = session.id;
    if (seq === '__paste__') {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          await fetch(`/api/sessions/${terminalId}/terminal/input`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: text }),
          });
        }
      } catch (err) {
        console.warn('[ChatMessages] clipboard read failed:', err);
      }
      return;
    }
    await fetch(`/api/sessions/${terminalId}/terminal/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: seq }),
    });
  }

  // Native addEventListener for each key button (Svelte 5 onclick bug workaround)
  $effect(() => {
    const cleanups: (() => void)[] = [];
    for (let i = 0; i < keyBtnEls.length; i++) {
      const el = keyBtnEls[i];
      if (!el) continue;
      const seq = SPECIAL_KEYS[i]?.seq;
      if (!seq) continue;
      const handler = () => sendSpecialKey(seq);
      el.addEventListener('click', handler);
      cleanups.push(() => el.removeEventListener('click', handler));
    }
    return () => { for (const fn of cleanups) fn(); };
  });
</script>

<div class="flex-1 flex flex-col overflow-hidden">
  <!-- Messages scroll area -->
  <div class="flex-1 overflow-y-auto px-4 py-4 space-y-3 relative"
       bind:this={scrollElLocal}
       onscroll={onScroll}>
    {#if session?.type === 'terminal'}
      {#if messages.length === 0}
        <div class="flex flex-col items-center justify-center h-full text-center opacity-60">
          <p class="text-4xl mb-3">💬</p>
          <p class="font-medium" style="color:var(--text);">No messages in linked chat</p>
        </div>
      {:else}
        {#if linkedChatLoadingMore}
          <div class="flex justify-center py-2 text-xs" style="color:var(--text-muted);">Loading older messages…</div>
        {:else if linkedChatHasMore}
          <div class="flex justify-center py-1">
            <button
              onclick={onLoadOlder}
              class="text-xs px-3 py-1 rounded-full border transition-all"
              style="border-color:var(--border-subtle);color:var(--text-muted);"
            >Load older messages</button>
          </div>
        {/if}
        {#each groupMessages(messages) as group (group.key)}
          {#if group.type === 'terminal_line'}
            <TerminalSummary messages={group.items} />
          {:else if group.type === 'agent_event'}
            <AgentEventCard
              message={group.items[0]}
              sessionId={linkedChatId}
              onRespond={async (payload) => { onAgentRespond(linkedChatId, payload); }}
            />
          {:else}
            <MessageBubble
              message={group.items[0]}
              {sessionId}
              {allSessions}
              readReceipts={readReceipts[group.items[0].id] ?? []}
              onReply={(msg) => { onReply(msg); }}
              onDeleted={(id) => { onLinkedMessageDeleted(id); }}
              onMetaUpdated={(id, meta) => { onLinkedMessageMetaUpdated(id, meta); }}
              onPinToggled={(id, pinned) => { onLinkedMessagePinToggled?.(id, pinned); }}
            />
          {/if}
        {/each}
      {/if}
    {:else}
      {#if messages.length === 0}
        <div class="flex flex-col items-center justify-center h-full text-center opacity-60">
          <p class="text-4xl mb-3">💬</p>
          <p class="font-medium" style="color:var(--text);">No messages yet</p>
          <p class="text-sm mt-1" style="color:var(--text-muted);">Type below, or use <code class="font-mono text-xs">ant msg</code> from a terminal</p>
        </div>
      {:else}
        <!-- Pinned messages section -->
        {#if messages.some((m: any) => m.pinned)}
          <div class="mb-3 p-2 rounded-lg border" style="background:var(--bg-card);border-color:var(--border-subtle);">
            <div class="text-[10px] uppercase tracking-wider mb-2" style="color:var(--text-muted);">📌 Pinned</div>
            {#each messages.filter((m: any) => m.pinned) as msg (msg.id)}
              <MessageBubble
                message={msg}
                {sessionId}
                {allSessions}
                onReply={(msg) => { onReply(msg); }}
                onDeleted={(id) => { onMessageDeleted(id); }}
                onMetaUpdated={(id, meta) => { onMessageMetaUpdated(id, meta); }}
                onPinToggled={(id, pinned) => { onMessagePinToggled?.(id, pinned); }}
              />
            {/each}
          </div>
        {/if}
        {#each groupMessages(messages) as group (group.key)}
          {#if group.type === 'terminal_line'}
            <TerminalLine messages={group.items} />
          {:else}
            <MessageBubble
              message={group.items[0]}
              {sessionId}
              {allSessions}
              readReceipts={readReceipts[group.items[0].id] ?? []}
              onReply={(msg) => { onReply(msg); }}
              onDeleted={(id) => { onMessageDeleted(id); }}
              onMetaUpdated={(id, meta) => { onMessageMetaUpdated(id, meta); }}
              onPinToggled={(id, pinned) => { onMessagePinToggled?.(id, pinned); }}
            />
          {/if}
        {/each}
      {/if}
    {/if}
  </div>

  <!-- Scroll-to-bottom button -->
  {#if !atBottom}
    <div class="flex justify-center py-1">
      <button
        onclick={onScrollToBottom}
        class="flex items-center gap-1.5 px-3 py-1 text-xs rounded-full shadow-lg border transition-all"
        style="background:var(--bg-card);border-color:#6366F155;color:#6366F1;"
      >
        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
        </svg>
        Jump to bottom
      </button>
    </div>
  {/if}

  <!-- Special key buttons for terminal sessions -->
  {#if session?.type === 'terminal'}
    <div class="flex items-center gap-1.5 px-2 h-9 overflow-x-auto shrink-0 scrollbar-none" style="background:var(--bg-card);">
      {#each SPECIAL_KEYS as key, i}
        <button
          bind:this={keyBtnEls[i]}
          class="shrink-0 px-3 py-1.5 rounded-md text-xs transition-colors"
          style="background:var(--bg-card);color:var(--text-muted);border:1px solid var(--border-subtle);"
        >{key.label}</button>
      {/each}
    </div>
  {/if}

  <!-- Input bar -->
  {#if session?.type === 'terminal'}
    <div class="flex gap-2 p-3 border-t" style="border-color:var(--border-light);">
      <input
        class="flex-1 rounded-lg px-3 py-2 text-sm outline-none"
        style="background:var(--bg-card);border:1px solid var(--border-subtle);color:var(--text);"
        placeholder="Message linked chat…"
        bind:value={linkedChatInput}
        onkeydown={(e) => { if (e.key === 'Enter') handleLinkedSend(); }}
      />
      <button
        bind:this={sendBtnEl}
        class="px-3 py-2 text-sm rounded-lg font-medium"
        style="background:#6366F1;color:#fff;"
      >Send</button>
    </div>
  {:else}
    <MessageInput
      onSend={onSend}
      {replyTo}
      onClearReply={onClearReply}
      handles={mentionHandles}
    />
  {/if}
</div>
