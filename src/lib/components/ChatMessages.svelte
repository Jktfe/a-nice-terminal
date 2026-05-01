<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import MessageBubble from '$lib/components/MessageBubble.svelte';
  import MessageInput from '$lib/components/MessageInput.svelte';
  import { useWsStore } from '$lib/stores/ws.svelte.js';
  import AgentEventCard from '$lib/components/AgentEventCard.svelte';
  import TerminalLine from '$lib/components/TerminalLine.svelte';
  import TerminalSummary from '$lib/components/TerminalSummary.svelte';
  import { SPECIAL_KEYS } from '$lib/shared/special-keys.js';
  import QuickLaunchBar from '$lib/components/QuickLaunchBar.svelte';
  import TerminalContextStrip from '$lib/components/TerminalContextStrip.svelte';
  import AgentDot from '$lib/components/AgentDot.svelte';
  import { agentColor } from '$lib/nocturne';
  import { activeRoutingMentions, bracketRoutingMention } from '$lib/utils/mentions';
  import type { AgentStatus } from '$lib/shared/agent-status';
  import type { ShortcutScope } from '$lib/shared/personal-settings';

  interface PageSession {
    id: string;
    name: string;
    type: string;
    handle?: string;
    display_name?: string;
    linked_chat_id?: string | null;
    cli_flag?: string | null;
    status?: string | null;
    ttl?: string | null;
    last_activity?: string | null;
    meta?: string | Record<string, unknown> | null;
  }

  interface ParticipantEntry {
    sess: PageSession;
    count: number;
    active: boolean;
  }

  interface StatusPayload {
    needs_input?: boolean;
    summary?: string;
    agent_status?: AgentStatus;
    session?: { status?: string | null };
  }

  interface Props {
    // For terminal sessions, these are the linked chat messages;
    // for chat sessions, these are the main session messages.
    messages: Record<string, unknown>[];
    sessionId: string;
    session: PageSession | null;
    allSessions: PageSession[];
    participantsActive?: ParticipantEntry[];
    linkedChatId: string;
    linkedChatHasMore: boolean;
    linkedChatLoadingMore: boolean;
    replyTo: Record<string, unknown> | null;
    atBottom: boolean;
    mentionHandles: { handle: string; name: string }[];
    readReceipts: Record<string, { session_id: string; reader_name: string; reader_handle: string | null; read_at: string }[]>;
    searchQuery: string;
    searchResults: { id: string }[];
    searchSelectedIndex: number;
    searchLoading: boolean;
    activeSearchResultId: string | null;
    onSend: (text: string, replyToId?: string | null) => void;
    onPostToLinkedChat: (text: string, replyToId?: string | null) => void;
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
    onMessagePinToggled?: (id: string, pinned: boolean) => void;
    onLinkedMessagePinToggled?: (id: string, pinned: boolean) => void;
    onReply: (msg: Record<string, unknown>) => void;
    onClearReply: () => void;
    onAgentRespond: (sessionId: string, payload: unknown) => void;
    onScrollElMounted?: (el: HTMLElement) => void;
    onScroll?: () => void;
    parentContext?: { roomName: string; messages: Record<string, unknown>[] } | null;
    shortcutScope?: ShortcutScope | 'all';
  }

  const {
    messages,
    sessionId,
    session,
    allSessions,
    participantsActive = [],
    linkedChatId,
    linkedChatHasMore,
    linkedChatLoadingMore,
    replyTo,
    atBottom,
    mentionHandles,
    readReceipts,
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
    onMessagePinToggled,
    onLinkedMessagePinToggled,
    onReply,
    onClearReply,
    onAgentRespond,
    onScrollElMounted,
    onScroll,
    parentContext = null,
    shortcutScope = 'all',
  }: Props = $props();

  let parentContextOpen = $state(false);

  let scrollElLocal = $state<HTMLElement | null>(null);
  let agentStatuses = $state<Record<string, StatusPayload>>({});
  let statusPollTimer: ReturnType<typeof setInterval> | null = null;
  let typingTimeout: ReturnType<typeof setTimeout> | null = null;

  const wsStore = useWsStore();

  const statusParticipants = $derived.by(() => {
    const seen = new Set<string>();
    return participantsActive.filter((participant) => {
      const sess = participant.sess;
      if (sess.type !== 'terminal' || seen.has(sess.id)) return false;
      seen.add(sess.id);
      return true;
    });
  });

  const footerStatusParticipants = $derived(
    session?.type === 'terminal' ? [] : statusParticipants
  );
  const statusSessionIds = $derived(statusParticipants.map((participant) => participant.sess.id));
  const quickLaunchScope = $derived<ShortcutScope | null>(
    shortcutScope === 'all' ? null : shortcutScope
  );

  async function fetchAgentStatuses() {
    const ids = statusSessionIds;
    if (ids.length === 0) {
      agentStatuses = {};
      return;
    }

    const entries = await Promise.all(ids.map(async (id) => {
      try {
        const res = await fetch(`/api/sessions/${id}/status`);
        if (!res.ok) return null;
        const data = await res.json();
        return [id, data as StatusPayload] as const;
      } catch {
        return null;
      }
    }));

    const next: Record<string, StatusPayload> = {};
    for (const entry of entries) {
      if (entry) next[entry[0]] = entry[1];
    }
    agentStatuses = next;
  }

  onMount(() => {
    wsStore.connect();
    fetchAgentStatuses();
    statusPollTimer = setInterval(fetchAgentStatuses, 8000);
  });

  onDestroy(() => {
    if (typingTimeout) clearTimeout(typingTimeout);
    if (statusPollTimer) clearInterval(statusPollTimer);
  });

  $effect(() => {
    const key = statusSessionIds.join('|');
    if (key) fetchAgentStatuses();
    else agentStatuses = {};
  });

  function statusPayload(sess: PageSession): StatusPayload | null {
    return agentStatuses[sess.id] ?? null;
  }

  function senderSession(msg: Record<string, unknown>): PageSession | null {
    const senderId = typeof msg.sender_id === 'string' ? msg.sender_id : null;
    if (!senderId) return null;
    return allSessions.find((s) =>
      s.id === senderId ||
      s.handle === senderId ||
      (s as any).alias === senderId
    ) ?? null;
  }

  function agentStatusForMessage(msg: Record<string, unknown>): AgentStatus | null {
    const sess = senderSession(msg);
    if (!sess) return null;
    return statusPayload(sess)?.agent_status ?? null;
  }

  function agentNeedsInputForMessage(msg: Record<string, unknown>): boolean {
    const sess = senderSession(msg);
    if (!sess) return false;
    return !!statusPayload(sess)?.needs_input;
  }

  function statusState(sess: PageSession): AgentStatus['state'] | 'needs_input' | 'unknown' {
    const payload = statusPayload(sess);
    if (payload?.needs_input) return 'needs_input';
    if (payload?.agent_status?.state) return payload.agent_status.state;
    const sessionState = payload?.session?.status || sess.status;
    if (sessionState === 'idle') return 'idle';
    if (sessionState === 'active') return 'ready';
    if (sessionState === 'offline') return 'unknown';
    return 'unknown';
  }

  function statusStyle(state: AgentStatus['state'] | 'needs_input' | 'unknown'): { label: string; color: string; bg: string; border: string } {
    const map: Record<string, { label: string; color: string; bg: string; border: string }> = {
      ready:       { label: 'Ready',       color: '#16A34A', bg: '#DCFCE7', border: '#86EFAC' },
      idle:        { label: 'Idle',        color: '#64748B', bg: '#F1F5F9', border: '#CBD5E1' },
      busy:        { label: 'Working',     color: '#D97706', bg: '#FEF3C7', border: '#FCD34D' },
      thinking:    { label: 'Thinking',    color: '#7C3AED', bg: '#EDE9FE', border: '#C4B5FD' },
      focus:       { label: 'Focus',       color: '#92400E', bg: '#FEF3C7', border: '#FCD34D' },
      needs_input: { label: 'Needs input', color: '#DC2626', bg: '#FEE2E2', border: '#FCA5A5' },
      error:       { label: 'Error',       color: '#DC2626', bg: '#FEE2E2', border: '#FCA5A5' },
      unknown:     { label: 'Unknown',     color: '#6B7280', bg: '#F3F4F6', border: '#D1D5DB' },
    };
    return map[state] ?? map.unknown;
  }

  function contextLabel(status: AgentStatus | undefined): string {
    if (!status) return '';
    if (typeof status.contextRemainingPct === 'number') return `${status.contextRemainingPct}% ctx`;
    if (typeof status.contextUsedPct === 'number') return `${status.contextUsedPct}% used`;
    return '';
  }

  function participantLabel(sess: PageSession): string {
    return sess.handle || sess.display_name || sess.name || sess.id.slice(0, 8);
  }

  function statusDetail(sess: PageSession): string {
    const payload = statusPayload(sess);
    const status = payload?.agent_status;
    if (payload?.needs_input) return payload.summary || 'Waiting for a response';
    if (status?.state === 'focus') {
      const focus = status.focus;
      const room = focus?.roomName ? ` in ${focus.roomName}` : '';
      const queued = typeof focus?.queueCount === 'number' ? ` · ${focus.queueCount} queued` : '';
      return `${status.activity || 'Focus mode'}${room}${queued}`;
    }
    if (status?.waitingFor) return `Waiting: ${status.waitingFor}`;
    if (status?.activity) return status.activity;
    const bits = [status?.model, contextLabel(status)].filter(Boolean);
    if (bits.length > 0) return bits.join(' · ');
    const sessionState = payload?.session?.status || sess.status;
    if (sessionState) return `No live CLI status yet · session ${sessionState}`;
    return '';
  }

  function notifyTyping(typing: boolean) {
    const handle = session?.handle;
    if (!handle) return;
    fetch(`/api/sessions/${linkedChatId || sessionId}/typing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle, typing }),
    }).catch(() => {});
  }

  function handleTypingInput() {
    notifyTyping(true);
    if (typingTimeout) clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => notifyTyping(false), 2500);
  }

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

  const messageLookup = $derived.by(() => {
    const lookup = new Map<string, any>();
    for (const msg of messages) {
      if (msg?.id && msg?.msg_type !== 'terminal_line') lookup.set(String(msg.id), msg);
    }
    return lookup;
  });

  function getReplyMessage(message: any) {
    if (!message?.reply_to) return null;
    return messageLookup.get(String(message.reply_to)) ?? null;
  }

  function getThreadDepth(message: any): number {
    let depth = 0;
    let current = message;
    const seen = new Set<string>();

    while (current?.reply_to && depth < 3) {
      const replyId = String(current.reply_to);
      if (seen.has(replyId)) break;
      seen.add(replyId);

      const parent = messageLookup.get(replyId);
      if (!parent) break;

      depth += 1;
      current = parent;
    }

    return depth;
  }

  function threadStyle(message: any): string {
    const depth = getThreadDepth(message);
    if (depth === 0) return '';
    const indent = depth * 18;
    return `margin-left:${indent}px;padding-left:10px;border-left:1px solid var(--border-subtle);`;
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
  let linkedChatInputEl = $state<HTMLTextAreaElement | null>(null);
  let sendBtnEl = $state<HTMLButtonElement | null>(null);
  const routingMentionHandles = $derived.by(() => {
    if (mentionHandles.some((h) => h.handle === '@everyone')) return mentionHandles;
    return [...mentionHandles, { handle: '@everyone', name: 'Everyone' }];
  });
  const linkedMentionChips = $derived(activeRoutingMentions(linkedChatInput, routingMentionHandles));

  function resizeLinkedChatInput() {
    if (!linkedChatInputEl) return;
    const maxHeight = typeof window === 'undefined'
      ? 220
      : Math.max(150, Math.floor(window.innerHeight * 0.32));
    linkedChatInputEl.style.height = 'auto';
    const nextHeight = Math.min(linkedChatInputEl.scrollHeight, maxHeight);
    linkedChatInputEl.style.height = `${nextHeight}px`;
    linkedChatInputEl.style.overflowY = linkedChatInputEl.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }

  function handleLinkedChatInput() {
    handleTypingInput();
    resizeLinkedChatInput();
  }

  function insertQuickLaunchCommand(command: string) {
    linkedChatInput = command;
    queueMicrotask(() => {
      resizeLinkedChatInput();
      linkedChatInputEl?.focus();
      linkedChatInputEl?.setSelectionRange(command.length, command.length);
    });
  }

  function bracketLinkedMention(handle: string) {
    linkedChatInput = bracketRoutingMention(linkedChatInput, handle);
    queueMicrotask(() => {
      resizeLinkedChatInput();
      linkedChatInputEl?.focus();
    });
  }

  async function discardAgentEvent(message: any, chatId: string, linked: boolean) {
    const res = await fetch(`/api/sessions/${chatId}/messages?msgId=${message.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meta: { status: 'discarded', chosen: 'discard' } }),
    });
    if (!res.ok) return;
    const data = await res.json();
    if (linked) onLinkedMessageMetaUpdated(message.id, data.meta);
    else onMessageMetaUpdated(message.id, data.meta);
  }

  function handleLinkedChatKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleLinkedSend();
    }
  }

  function handleLinkedSend() {
    if (!linkedChatInput.trim()) return;
    onPostToLinkedChat(linkedChatInput.trim(), (replyTo?.id as string | undefined) ?? null);
    linkedChatInput = '';
    onClearReply();
    setTimeout(resizeLinkedChatInput, 0);
  }

  $effect(() => {
    linkedChatInput;
    queueMicrotask(resizeLinkedChatInput);
  });

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

  {#if session?.type === 'terminal'}
    <TerminalContextStrip {session} {allSessions} {linkedChatId} />
  {/if}

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
        {#if parentContext && parentContext.messages.length > 0}
          <div class="mx-2 mb-3 rounded-lg overflow-hidden" style="border: 1px dashed #6366F140; background: #6366F108;">
            <button
              class="w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors"
              style="color: #6366F1; background: transparent; border: none; cursor: pointer;"
              onclick={() => parentContextOpen = !parentContextOpen}
            >
              <svg class="w-3 h-3 transition-transform" style="transform: {parentContextOpen ? 'rotate(180deg)' : 'rotate(0)'}; flex-shrink: 0;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
              </svg>
              <span style="font-weight: 500;">Context from {parentContext.roomName}</span>
              <span class="ml-auto px-1.5 py-0.5 rounded text-[10px] font-medium" style="background: #6366F120; color: #6366F1;">{parentContext.messages.length}</span>
            </button>
            {#if parentContextOpen}
              <div class="px-3 pb-2 space-y-1.5" style="max-height: 300px; overflow-y: auto; border-top: 1px solid #6366F115;">
                {#each parentContext.messages as msg ((msg as any).id)}
                  <div class="flex gap-2 py-1 text-xs" style="opacity: 0.8;">
                    <span class="font-medium flex-shrink-0" style="color: #6366F1; min-width: 60px;">{(msg as any).sender_name || (msg as any).role || 'unknown'}</span>
                    <span style="color: var(--text-muted); word-break: break-word;">{((msg as any).content || '').slice(0, 200)}{((msg as any).content || '').length > 200 ? '...' : ''}</span>
                  </div>
                {/each}
              </div>
            {/if}
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
                onDiscard={async (message) => { await discardAgentEvent(message, linkedChatId, true); }}
              />
            {:else}
              <div style={threadStyle(group.items[0])}>
                <MessageBubble
                  message={group.items[0]}
                  replyMessage={getReplyMessage(group.items[0])}
                  {sessionId}
                  {allSessions}
                  agentStatus={agentStatusForMessage(group.items[0])}
                  agentNeedsInput={agentNeedsInputForMessage(group.items[0])}
                  readReceipts={readReceipts[group.items[0].id] ?? []}
                  onReply={(msg) => { onReply(msg); }}
                  onDeleted={(id) => { onLinkedMessageDeleted(id); }}
                  onMetaUpdated={(id, meta) => { onLinkedMessageMetaUpdated(id, meta); }}
                  onPinToggled={(id, pinned) => { onLinkedMessagePinToggled?.(id, pinned); }}
                />
              </div>
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
        <!-- Pinned messages section -->
        {#if messages.some((m: any) => m.pinned)}
          <div class="mb-3 p-2 rounded-lg border" style="background:var(--bg-card);border-color:var(--border-subtle);">
            <div class="text-[10px] uppercase tracking-wider mb-2" style="color:var(--text-muted);">📌 Pinned</div>
            {#each messages.filter((m: any) => m.pinned) as msg (msg.id)}
              <MessageBubble
                message={msg}
                {sessionId}
                {allSessions}
                agentStatus={agentStatusForMessage(msg)}
                agentNeedsInput={agentNeedsInputForMessage(msg)}
                readReceipts={readReceipts[String(msg.id)] ?? []}
                onReply={(msg) => { onReply(msg); }}
                onDeleted={(id) => { onMessageDeleted(id); }}
                onMetaUpdated={(id, meta) => { onMessageMetaUpdated(id, meta); }}
                onPinToggled={(id, pinned) => { onMessagePinToggled?.(id, pinned); }}
              />
            {/each}
          </div>
        {/if}
        {#each groupedMessages as group (group.key)}
          <div class="rounded-xl p-1 transition-all duration-200"
               data-message-anchor={group.key}
               style={groupSearchStyle(group)}>
            {#if group.type === 'terminal_line'}
              <TerminalLine messages={group.items} />
            {:else if group.type === 'agent_event'}
              <AgentEventCard
                message={group.items[0]}
                sessionId={sessionId}
                onRespond={async (payload) => { onAgentRespond(sessionId, payload); }}
                onDiscard={async (message) => { await discardAgentEvent(message, sessionId, false); }}
              />
            {:else}
              <div style={threadStyle(group.items[0])}>
                <MessageBubble
                  message={group.items[0]}
                  replyMessage={getReplyMessage(group.items[0])}
                  {sessionId}
                  {allSessions}
                  agentStatus={agentStatusForMessage(group.items[0])}
                  agentNeedsInput={agentNeedsInputForMessage(group.items[0])}
                  readReceipts={readReceipts[group.items[0].id] ?? []}
                  onReply={(msg) => { onReply(msg); }}
                  onDeleted={(id) => { onMessageDeleted(id); }}
                  onMetaUpdated={(id, meta) => { onMessageMetaUpdated(id, meta); }}
                  onPinToggled={(id, pinned) => { onMessagePinToggled?.(id, pinned); }}
                />
              </div>
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

  {#if session?.type === 'terminal'}
    <QuickLaunchBar scope="linkedChats" onInsertCommand={insertQuickLaunchCommand} />
  {/if}

  <!-- Input bar -->
  {#if session?.type === 'terminal'}
    {#if replyTo}
      <div class="mx-3 mb-2 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#1A1A22] border border-[#6366F133] text-xs">
        <svg class="w-3 h-3 text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"/>
        </svg>
        <span class="text-gray-400">Replying to</span>
        <span class="font-mono text-[#6366F1]">{String(replyTo.sender_id ?? (replyTo.role === 'assistant' ? 'Assistant' : 'You'))}</span>
        <span class="text-gray-600 truncate flex-1">{String(replyTo.content ?? '').slice(0, 60)}</span>
        <button onclick={onClearReply} class="text-gray-600 hover:text-gray-400 flex-shrink-0 ml-auto">✕</button>
      </div>
    {/if}
    {#if wsStore.getTyping().length > 0}
      <div class="px-3 pb-1 text-xs" style="color:var(--text-muted);">
        {wsStore.getTyping().join(', ')} {wsStore.getTyping().length === 1 ? 'is' : 'are'} typing…
      </div>
    {/if}
    {#if linkedMentionChips.length > 0}
      <div class="px-3 pb-1 flex items-center gap-1.5 overflow-x-auto" style="font-size:11px;color:var(--text-faint);">
        <span class="shrink-0 font-medium">Tagged</span>
        {#each linkedMentionChips as h (h.handle)}
          {@const ac = agentColor(h.handle)}
          <span
            class="inline-flex items-center gap-1.5 shrink-0"
            style="
              padding: 3px 6px;
              border-radius: var(--radius-full);
              background: {ac.color}12;
              border: 0.5px solid {ac.color}35;
              color: {ac.color};
            "
            title="This mention will notify {h.name}. Click x to make it visible only."
          >
            <AgentDot id={h.handle.replace('@', '')} size={6} />
            <span style="font-family:var(--font-mono);font-weight:600;">{h.handle}</span>
            <button
              type="button"
              class="cursor-pointer"
              style="color:{ac.color};background:none;border:none;padding:0;line-height:1;"
              title="Do not notify {h.handle}"
              aria-label="Do not notify {h.handle}"
              onclick={() => bracketLinkedMention(h.handle)}
            >
              ✕
            </button>
          </span>
        {/each}
      </div>
    {/if}
    <div class="flex items-end gap-2 p-3 border-t" style="border-color:var(--border-light);">
      <textarea
        bind:this={linkedChatInputEl}
        class="flex-1 rounded-lg px-3 py-2 text-sm outline-none resize-none"
        style="background:var(--bg-card);border:1px solid var(--border-subtle);color:var(--text);"
        placeholder="Message linked chat…"
        bind:value={linkedChatInput}
        oninput={handleLinkedChatInput}
        onkeydown={handleLinkedChatKeydown}
        rows="2"
      ></textarea>
      <button
        bind:this={sendBtnEl}
        class="px-3 py-2 text-sm rounded-lg font-medium shrink-0"
        style="background:#6366F1;color:#fff;"
      >Send</button>
    </div>
  {:else}
    {#if footerStatusParticipants.length > 0}
      <div
        class="shrink-0 px-3 py-2 border-t overflow-x-auto scrollbar-none"
        style="border-color:var(--border-light);background:var(--bg-surface);"
        aria-label="Agent status"
      >
        <div class="flex items-center gap-2 min-w-max">
          <span
            class="text-[10px] uppercase tracking-wide shrink-0"
            style="color:var(--text-faint);font-family:var(--font-mono);letter-spacing:0;"
          >Agents</span>
          {#each footerStatusParticipants as participant (participant.sess.id)}
            {@const sess = participant.sess}
            {@const state = statusState(sess)}
            {@const stateStyle = statusStyle(state)}
            {@const payload = statusPayload(sess)}
            {@const status = payload?.agent_status}
            {@const detail = statusDetail(sess)}
            {@const ctx = contextLabel(status)}
            <div
              class="inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs shrink-0"
              style="background:{stateStyle.bg};border-color:{stateStyle.border};color:{stateStyle.color};"
              title={detail || `${participantLabel(sess)}: ${stateStyle.label}`}
            >
              <span
                class="w-2 h-2 rounded-full shrink-0"
                style="background:{stateStyle.color};box-shadow:0 0 0 2px rgba(255,255,255,0.75);"
              ></span>
              <span class="font-semibold truncate max-w-[96px]">{participantLabel(sess)}</span>
              <span style="color:{stateStyle.color}CC;">{stateStyle.label}</span>
              {#if ctx}
                <span class="font-mono text-[10px]" style="color:{stateStyle.color}AA;">{ctx}</span>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/if}
    <MessageInput
      onSend={onSend}
      {replyTo}
      onClearReply={onClearReply}
      handles={mentionHandles}
      quickLaunchScope={quickLaunchScope}
    />
  {/if}
</div>

<style>
</style>
