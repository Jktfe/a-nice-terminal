<script lang="ts">
  import { useGridStore } from '$lib/stores/grid.svelte';
  import { onDestroy } from 'svelte';

  interface Session {
    id: string;
    name: string;
    type: 'terminal' | 'chat' | 'agent' | string;
  }

  interface GridCellDef {
    id: string;
    sessionId: string | null;
  }

  interface Message {
    id: string;
    role: string;
    content: string;
    format: string;
    msg_type?: string;
    meta?: string;
    sender_id?: string;
  }

  interface TerminalRow {
    id: number;
    ts_ms: number;
    text: string;
  }

  let { cell, allSessions, onSwap, needsInputMap = new Map(), idleAttentionSet = new Set() }: {
    cell: GridCellDef;
    allSessions: Session[];
    onSwap?: (cellId: string, sessionId: string) => void;
    needsInputMap?: Map<string, { eventClass: string; summary: string }>;
    idleAttentionSet?: Set<string>;
  } = $props();

  // Derive badge state for this cell's session
  const cellNeedsInput = $derived(
    cell.sessionId ? (needsInputMap.get(cell.sessionId) ?? null) : null
  );
  const cellIdleAttention = $derived(
    cell.sessionId ? idleAttentionSet.has(cell.sessionId) : false
  );

  const grid = useGridStore();

  const session = $derived(
    cell.sessionId ? allSessions.find(s => s.id === cell.sessionId) ?? null : null
  );

  // ── Picker state ────────────────────────────────────────────────
  let showPicker = $state(false);
  let pickerSearch = $state('');
  let pickerEl = $state<HTMLElement | null>(null);

  const filteredSessions = $derived(
    allSessions.filter(s =>
      s.name.toLowerCase().includes(pickerSearch.toLowerCase())
    )
  );

  function openPicker(e?: MouseEvent) {
    e?.stopPropagation();
    pickerSearch = '';
    showPicker = true;
  }

  function pick(sessionId: string) {
    grid.assignCell(cell.id, sessionId);
    onSwap?.(cell.id, sessionId);
    showPicker = false;
  }

  function clear() {
    grid.clearCell(cell.id);
  }

  function onWindowClick(e: MouseEvent) {
    if (pickerEl && !pickerEl.contains(e.target as Node)) {
      showPicker = false;
    }
  }

  function onPickerKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') showPicker = false;
  }

  // ── View toggle (terminal sessions can flip to chat view) ────────
  let showChat = $state(false);

  // ── Content preview data ─────────────────────────────────────────
  let chatMessages = $state<Message[]>([]);
  let terminalLines = $state<TerminalRow[]>([]);
  let loadingContent = $state(false);

  let linkedChatId = $state<string | null>(null);

  async function loadContent(sid: string, type: string) {
    loadingContent = true;
    try {
      if (type === 'chat' || type === 'agent' || (type === 'terminal' && showChat)) {
        // For terminal+showChat, load the linked chat's messages
        const chatSid = (type === 'terminal' && showChat && linkedChatId) ? linkedChatId : sid;
        const res = await fetch(`/api/sessions/${chatSid}/messages?limit=20`);
        if (res.ok) {
          const data = await res.json();
          chatMessages = data.messages ?? [];
        }
      }
      if (type === 'terminal' && !showChat) {
        const res = await fetch(`/api/sessions/${sid}/terminal/history?since=5m&limit=10`);
        if (res.ok) {
          const data = await res.json();
          terminalLines = data.rows ?? [];
        }
      }
    } catch {
      // Network error — leave empty
    } finally {
      loadingContent = false;
    }
  }

  // Fetch linked_chat_id for terminal sessions
  async function fetchLinkedChatId(sid: string) {
    try {
      const res = await fetch(`/api/sessions/${sid}`);
      if (res.ok) {
        const data = await res.json();
        linkedChatId = data.linked_chat_id ?? null;
      }
    } catch {}
  }

  let contentScrollEl = $state<HTMLElement | null>(null);
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  function scrollContentToBottom() {
    if (contentScrollEl) {
      contentScrollEl.scrollTop = contentScrollEl.scrollHeight;
    }
  }

  // Fetch linked chat ID when session changes
  $effect(() => {
    if (session?.type === 'terminal') {
      fetchLinkedChatId(session.id);
    }
  });

  // Reload content when session or showChat changes
  $effect(() => {
    if (session) {
      // Access showChat to make this effect depend on it
      const _chat = showChat;
      chatMessages = [];
      terminalLines = [];
      loadContent(session.id, session.type).then(scrollContentToBottom);

      // Poll every 5s for fresh content
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(async () => {
        if (!session) return;
        const prevLen = chatMessages.length + terminalLines.length;
        await loadContent(session.id, session.type);
        const newLen = chatMessages.length + terminalLines.length;
        if (newLen > prevLen) scrollContentToBottom();
      }, 5000);
    } else {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }
  });

  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer);
  });

  // ── Agent event card helpers ──────────────────────────────────────
  function parseEvent(content: string) {
    try { return JSON.parse(content); }
    catch { return { class: 'unknown', payload: {}, text: content }; }
  }

  function parseMeta(meta: string | undefined) {
    try { return meta ? JSON.parse(meta) : {}; }
    catch { return {}; }
  }

  async function respondToEvent(msg: Message, type: string, choice: Record<string, any>) {
    if (!session) return;
    await fetch(`/api/sessions/${session.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'user',
        content: JSON.stringify({ type, event_id: msg.id, event_content: msg.content, choice }),
        format: 'json',
        msg_type: 'agent_response',
      }),
    });
    // Reload messages to reflect new state
    await loadContent(session.id, session.type);
  }

  // Bubble colour by role
  function bubbleBg(role: string, senderId?: string) {
    if (role === 'user') return '#F3F4F6';
    if (senderId) return '#EEF2FF'; // assistant/AI
    return '#ECFDF5';
  }

  function bubbleText(role: string, senderId?: string) {
    if (role === 'user') return '#374151';
    if (senderId) return '#4338CA';
    return '#065F46';
  }

  function senderLabel(msg: Message): string {
    if (msg.role === 'user') return 'You';
    if (msg.sender_id) return msg.sender_id.startsWith('@') ? msg.sender_id : 'Participant';
    return 'Assistant';
  }

  // ── Icon helpers ──────────────────────────────────────────────────
  function sessionIconName(type: string) {
    return type === 'terminal' ? 'terminal' : 'message-square';
  }

  function sessionIconColor(type: string) {
    return type === 'terminal' ? '#4F46E5' : '#6366F1';
  }
</script>

<svelte:window onclick={onWindowClick} />

<div
  class="relative flex flex-col rounded-[10px] overflow-hidden"
  style="
    background: #FFFFFF;
    border: 1px solid #E5E7EB;
    height: 100%;
  "
>
  {#if cell.sessionId === null}
    <!-- ── Empty slot ── -->
    <button
      onclick={(e) => openPicker(e)}
      class="flex-1 flex flex-col items-center justify-center gap-2 transition-colors"
      style="
        background: transparent;
        border: 1.5px dashed #E5E7EB;
        border-radius: 10px;
        cursor: pointer;
        margin: 0;
      "
      onmouseover={(e) => (e.currentTarget.style.background = '#F9FAFB')}
      onmouseout={(e) => (e.currentTarget.style.background = 'transparent')}
      onfocus={(e) => (e.currentTarget.style.background = '#F9FAFB')}
      onblur={(e) => (e.currentTarget.style.background = 'transparent')}
      title="Select session"
    >
      <!-- Plus icon (lucide style) -->
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
      <span style="font-family: Inter, sans-serif; font-size: 13px; color: #9CA3AF;">Select session</span>
    </button>

  {:else if session === null}
    <!-- ── Session deleted / not found ── -->
    <div class="flex-1 flex flex-col items-center justify-center gap-2 p-3">
      <p style="font-size: 12px; color: #9CA3AF; font-family: Inter, sans-serif;">Session not found</p>
      <button
        onclick={clear}
        style="font-size: 12px; color: #6B7280; background: #F3F4F6; border: none; border-radius: 6px; padding: 4px 10px; cursor: pointer;"
      >Clear</button>
    </div>

  {:else}
    <!-- ── Filled slot ── -->

    <!-- Slot header -->
    <div
      class="flex items-center gap-2 flex-shrink-0"
      style="
        height: 38px;
        padding: 0 12px;
        background: #F9FAFB;
        border-bottom: 1px solid #E5E7EB;
      "
    >
      <!-- Session type icon -->
      {#if session.type === 'terminal'}
        <!-- Terminal icon -->
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={sessionIconColor(session.type)} stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </svg>
      {:else}
        <!-- Message-square icon -->
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={sessionIconColor(session.type)} stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      {/if}

      <!-- Session name -->
      <span
        class="flex-1 truncate"
        style="font-family: Inter, sans-serif; font-size: 12px; font-weight: 600; color: #111827;"
      >{session.name}</span>

      <!-- Needs-input badge -->
      {#if cellNeedsInput}
        <span
          class="grid-pulse-dot"
          title={cellNeedsInput.summary}
        ></span>
      {:else if cellIdleAttention}
        <span
          class="grid-idle-dot"
          title="Terminal idle"
        ></span>
      {/if}

      <!-- Spacer -->
      <div style="flex:1;"></div>

      <!-- Toggle icon: only for terminal sessions — flips to chat view -->
      {#if session.type === 'terminal'}
        <button
          onclick={() => (showChat = !showChat)}
          title={showChat ? 'View terminal output' : 'View linked chat'}
          style="background: none; border: none; padding: 2px; cursor: pointer; color: {showChat ? '#6366F1' : '#9CA3AF'}; line-height: 0; border-radius: 4px;"
        >
          {#if showChat}
            <!-- terminal icon (switch back) -->
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line>
            </svg>
          {:else}
            <!-- message-square icon -->
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          {/if}
        </button>
      {/if}

      <!-- svelte-ignore a11y_mouse_events_have_key_events -->
      <!-- Swap / replace icon -->
      <button
        onclick={(e) => openPicker(e)}
        title="Replace session"
        style="background: none; border: none; padding: 2px; cursor: pointer; color: #9CA3AF; line-height: 0; border-radius: 4px;"
        onmouseover={(e) => (e.currentTarget.style.color = '#6B7280')}
        onmouseout={(e) => (e.currentTarget.style.color = '#9CA3AF')}
      >
        <!-- replace / swap icon -->
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5 3l4 4-4 4" />
          <path d="M9 7H3" />
          <path d="M19 21l-4-4 4-4" />
          <path d="M15 17h6" />
          <line x1="21" y1="7" x2="3" y2="7" />
          <line x1="3" y1="17" x2="21" y2="17" />
        </svg>
      </button>
    </div>

    <!-- Slot body: content preview -->
    <div class="flex-1 min-h-0 overflow-hidden">

      {#if session.type === 'terminal' && !showChat}
        <!-- ── Terminal preview ── -->
        <div
          class="h-full overflow-y-auto"
          style="background: #0D1117; padding: 12px;"
          bind:this={contentScrollEl}
        >
          {#if loadingContent}
            <span style="font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #8B949E;">Loading…</span>
          {:else if terminalLines.length === 0}
            <span style="font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #8B949E;">No recent output</span>
          {:else}
            {#each terminalLines as row (row.id)}
              <div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; line-height: 1.6; color: {row.text.startsWith('✶') || row.text.startsWith('✽') ? '#C9D1D9' : '#8B949E'}; white-space: pre-wrap; word-break: break-all;">
                {row.text}
              </div>
            {/each}
          {/if}
        </div>

      {:else}
        <!-- ── Chat preview ── -->
        <div
          class="h-full overflow-y-auto flex flex-col gap-2"
          style="padding: 12px; background: #FFFFFF;"
          bind:this={contentScrollEl}
        >
          {#if loadingContent}
            <span style="font-size: 10px; color: #9CA3AF; font-family: Inter, sans-serif;">Loading…</span>
          {:else if chatMessages.length === 0}
            <span style="font-size: 10px; color: #9CA3AF; font-family: Inter, sans-serif;">No messages yet</span>
          {:else}
            {#each chatMessages as msg (msg.id)}
              {#if msg.msg_type === 'agent_event'}
                <!-- ── Mini AgentEventCard ── -->
                {@const ev = parseEvent(msg.content)}
                {@const mt = parseMeta(msg.meta)}
                {@const responded = mt.status === 'responded' || mt.status === 'settled'}
                <div
                  style="
                    border-radius: 8px;
                    background: #EEF2FF;
                    border: 1px solid #6366F180;
                    padding: 8px 12px;
                    font-family: Inter, sans-serif;
                  "
                >
                  <div style="font-size: 8px; font-weight: 700; color: #6366F1; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px;">
                    {ev.class?.replace(/_/g, ' ') ?? 'event'}
                  </div>
                  {#if ev.class === 'permission_request'}
                    <div style="font-size: 10px; color: #374151; margin-bottom: 6px;">
                      {ev.payload?.command ?? ev.payload?.file ?? ev.text ?? ''}
                    </div>
                    {#if responded}
                      <div style="font-size: 10px; font-weight: 600; color: {mt.chosen === 'approve' ? '#22C55E' : '#EF4444'};">
                        ✓ {mt.chosen === 'approve' ? 'Approved' : 'Denied'}
                      </div>
                    {:else}
                      <div class="flex gap-1.5">
                        <button
                          onclick={() => respondToEvent(msg, 'approve', { action: 'approve' })}
                          style="padding: 4px 10px; border-radius: 6px; background: #22C55E; color: #fff; border: none; font-size: 10px; font-weight: 600; cursor: pointer;"
                        >Approve</button>
                        <button
                          onclick={() => respondToEvent(msg, 'deny', { action: 'deny' })}
                          style="padding: 4px 10px; border-radius: 6px; background: transparent; color: #EF4444; border: 1px solid #EF4444; font-size: 10px; font-weight: 600; cursor: pointer;"
                        >Deny</button>
                      </div>
                    {/if}
                  {:else}
                    <div style="font-size: 10px; color: #374151;">
                      {ev.payload?.message ?? ev.text ?? ev.payload?.question ?? ''}
                    </div>
                  {/if}
                </div>

              {:else}
                <!-- ── Regular message bubble ── -->
                <div
                  style="
                    border-radius: 8px;
                    background: {bubbleBg(msg.role, msg.sender_id)};
                    padding: 6px 10px;
                    font-family: Inter, sans-serif;
                  "
                >
                  <div style="font-size: 8px; font-weight: 600; color: #9CA3AF; margin-bottom: 2px; text-transform: uppercase; letter-spacing: 0.04em;">
                    {senderLabel(msg)}
                  </div>
                  <div style="font-size: 10px; color: {bubbleText(msg.role, msg.sender_id)}; line-height: 1.5; word-break: break-word;">
                    {msg.content.slice(0, 200)}{msg.content.length > 200 ? '…' : ''}
                  </div>
                </div>
              {/if}
            {/each}
          {/if}
        </div>
      {/if}
    </div>
  {/if}

  <!-- ── Session picker overlay ── -->
  {#if showPicker}
    <div
      bind:this={pickerEl}
      role="listbox"
      tabindex="-1"
      onkeydown={onPickerKeydown}
      class="absolute inset-0 z-20 flex flex-col overflow-hidden"
      style="background: #FFFFFF; border-radius: 10px; border: 1px solid #E5E7EB; box-shadow: 0 8px 24px rgba(0,0,0,0.12);"
    >
      <div style="padding: 10px 12px; border-bottom: 1px solid #E5E7EB;">
        <!-- svelte-ignore a11y_autofocus -->
        <input
          type="text"
          placeholder="Search sessions…"
          bind:value={pickerSearch}
          autofocus
          class="w-full focus:outline-none"
          style="
            background: #F9FAFB;
            border: 1px solid #E5E7EB;
            border-radius: 6px;
            padding: 6px 10px;
            font-size: 12px;
            color: #111827;
            font-family: Inter, sans-serif;
          "
        />
      </div>
      <div class="flex-1 overflow-y-auto">
        {#if filteredSessions.length === 0}
          <p style="font-size: 12px; color: #9CA3AF; text-align: center; padding: 16px; font-family: Inter, sans-serif;">
            No sessions found
          </p>
        {:else}
          {#each filteredSessions as s (s.id)}
            <!-- svelte-ignore a11y_mouse_events_have_key_events -->
            <button
              onclick={() => pick(s.id)}
              class="w-full text-left flex items-center gap-2 transition-colors"
              style="padding: 8px 12px; background: transparent; border: none; cursor: pointer; font-family: Inter, sans-serif; border-bottom: 1px solid #F3F4F6;"
              onmouseover={(e) => (e.currentTarget.style.background = '#F9FAFB')}
              onmouseout={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              {#if s.type === 'terminal'}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
                  <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
                </svg>
              {:else}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6366F1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              {/if}
              <span style="font-size: 12px; color: #111827; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{s.name}</span>
              <span style="font-size: 10px; color: #9CA3AF; text-transform: uppercase; letter-spacing: 0.04em;">{s.type}</span>
            </button>
          {/each}
        {/if}
      </div>
      <div style="padding: 8px 12px; border-top: 1px solid #E5E7EB;">
        <button
          onclick={() => (showPicker = false)}
          class="w-full"
          style="padding: 6px; border-radius: 6px; background: #F3F4F6; border: none; font-size: 12px; color: #6B7280; cursor: pointer; font-family: Inter, sans-serif;"
        >Cancel</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .grid-pulse-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #EF4444;
    display: inline-block;
    flex-shrink: 0;
    animation: ant-grid-pulse 1.5s ease-in-out infinite;
  }
  .grid-idle-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #F59E0B;
    display: inline-block;
    flex-shrink: 0;
    opacity: 0.5;
  }
  @keyframes ant-grid-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.4; transform: scale(1.5); }
  }
</style>
