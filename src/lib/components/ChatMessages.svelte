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
    searchQuery: string;
    searchResults: { id: string }[];
    searchSelectedIndex: number;
    searchLoading: boolean;
    activeSearchResultId: string | null;
    onSend: (text: string) => void;
    onPostToLinkedChat: (text: string) => void;
    onLoadOlder: () => void;
    onScrollToBottom: () => void;
    onSearchQueryChange: (value: string) => void;
    onSearchNext: () => void;
    onSearchPrev: () => void;
    onSearchClear: () => void;
    onMessageDeleted: (id: string) => void;
    onMessageMetaUpdated: (id: string, meta: Record<string, unknown>) => void;
    onLinkedMessageDeleted: (id: string) => void;
    onLinkedMessageMetaUpdated: (id: string, meta: Record<string, unknown>) => void;
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
    searchQuery,
    searchResults,
    searchSelectedIndex,
    searchLoading,
    activeSearchResultId,
    onSend,
    onPostToLinkedChat,
    onLoadOlder,
    onScrollToBottom,
    onSearchQueryChange,
    onSearchNext,
    onSearchPrev,
    onSearchClear,
    onMessageDeleted,
    onMessageMetaUpdated,
    onLinkedMessageDeleted,
    onLinkedMessageMetaUpdated,
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

  const groupedMessages = $derived(groupMessages(messages as any[]));
  const matchedMessageIds = $derived.by(() => new Set(searchResults.map((result) => result.id)));
  const messageAnchorMap = $derived.by(() => {
    const map = new Map<string, string>();
    for (const group of groupedMessages) {
      for (const item of group.items) {
        map.set(item.id, group.key);
      }
    }
    return map;
  });

  function groupHasSearchMatch(group: { items: any[] }): boolean {
    for (const item of group.items) {
      if (matchedMessageIds.has(item.id)) return true;
    }
    return false;
  }

  function groupHasActiveSearchResult(group: { items: any[] }): boolean {
    if (!activeSearchResultId) return false;
    return group.items.some((item) => item.id === activeSearchResultId);
  }

  function groupSearchStyle(group: { items: any[] }): string {
    if (groupHasActiveSearchResult(group)) {
      return 'background:rgba(59,130,246,0.08); box-shadow:0 0 0 1px rgba(59,130,246,0.45), 0 0 18px rgba(59,130,246,0.18);';
    }
    if (groupHasSearchMatch(group)) {
      return 'background:rgba(245,158,11,0.08); box-shadow:0 0 0 1px rgba(245,158,11,0.35);';
    }
    return 'background:transparent;';
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

  $effect(() => {
    const activeId = activeSearchResultId;
    groupedMessages;

    if (!scrollElLocal || !activeId) return;

    const anchorId = messageAnchorMap.get(activeId) || activeId;
    requestAnimationFrame(() => {
      const target = scrollElLocal?.querySelector<HTMLElement>(`[data-message-anchor="${anchorId}"]`);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  });
</script>

<div class="flex-1 flex flex-col overflow-hidden">
  <div class="flex items-center gap-2 px-4 py-2 border-b shrink-0"
       style="border-color:var(--border-light);background:var(--bg);">
    <div class="relative flex-1">
      <svg class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none"
           fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color:var(--text-faint);">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z"/>
      </svg>
      <input
        class="w-full rounded-lg pl-8 pr-9 py-2 text-sm outline-none"
        style="background:var(--bg-card);border:1px solid var(--border-subtle);color:var(--text);"
        placeholder="Search messages…"
        value={searchQuery}
        oninput={(e) => onSearchQueryChange((e.currentTarget as HTMLInputElement).value)}
        onkeydown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (searchResults.length > 0) {
              if (e.shiftKey) onSearchPrev();
              else onSearchNext();
            }
          } else if (e.key === 'Escape' && searchQuery.trim()) {
            e.preventDefault();
            onSearchClear();
          }
        }}
      />
      {#if searchQuery.trim()}
        <button
          class="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded transition-colors"
          style="color:var(--text-faint);"
          onclick={onSearchClear}
          title="Clear search"
        >
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      {/if}
    </div>

    <div class="flex items-center gap-1.5 shrink-0">
      <span class="text-xs min-w-[64px] text-right" style="color:var(--text-muted);">
        {#if searchLoading}
          Searching…
        {:else if searchQuery.trim()}
          {#if searchResults.length > 0}
            {searchSelectedIndex + 1}/{searchResults.length}
          {:else}
            No matches
          {/if}
        {:else}
          Search
        {/if}
      </span>
      <button
        class="p-1.5 rounded-lg transition-all"
        style="color:var(--text-muted);border:1px solid var(--border-subtle);"
        disabled={searchResults.length === 0}
        onclick={onSearchPrev}
        title="Previous match"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/>
        </svg>
      </button>
      <button
        class="p-1.5 rounded-lg transition-all"
        style="color:var(--text-muted);border:1px solid var(--border-subtle);"
        disabled={searchResults.length === 0}
        onclick={onSearchNext}
        title="Next match"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
        </svg>
      </button>
    </div>
  </div>

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
        {#each groupedMessages as group (group.key)}
          <div class="rounded-xl p-1 transition-all duration-200"
               data-message-anchor={group.key}
               style={groupSearchStyle(group)}>
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
                onReply={(msg) => { onReply(msg); }}
                onDeleted={(id) => { onLinkedMessageDeleted(id); }}
                onMetaUpdated={(id, meta) => { onLinkedMessageMetaUpdated(id, meta); }}
              />
            {/if}
          </div>
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
        {#each groupedMessages as group (group.key)}
          <div class="rounded-xl p-1 transition-all duration-200"
               data-message-anchor={group.key}
               style={groupSearchStyle(group)}>
            {#if group.type === 'terminal_line'}
              <TerminalLine messages={group.items} />
            {:else}
              <MessageBubble
                message={group.items[0]}
                {sessionId}
                {allSessions}
                onReply={(msg) => { onReply(msg); }}
                onDeleted={(id) => { onMessageDeleted(id); }}
                onMetaUpdated={(id, meta) => { onMessageMetaUpdated(id, meta); }}
              />
            {/if}
          </div>
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
