<script lang="ts">
  import { useSessionStore } from '$lib/stores/sessions.svelte';
  import { useGridStore } from '$lib/stores/grid.svelte';
  import { SESSIONS_CHANNEL } from '$lib/ws-channels';
  import SessionCard from './SessionCard.svelte';
  import SessionPairCard from './SessionPairCard.svelte';
  import GridView from './GridView.svelte';
  import { goto } from '$app/navigation';
  import { theme } from '$lib/stores/theme.svelte';

  const grid = useGridStore();
  const store = useSessionStore();

  let searchText = $state('');
  let creatingTerminal = $state(false);
  let creatingChat = $state(false);

  // ── Inline modal state (replaces window.prompt / confirm) ──
  let modal = $state<{
    mode: 'create-terminal' | 'create-chat' | 'confirm-delete';
    name: string;
    defaultName: string;
    error: string;
    /** For confirm-delete: the session to delete */
    targetSession?: any;
  } | null>(null);
  let modalInputEl = $state<HTMLInputElement | null>(null);

  function openCreateModal(type: 'terminal' | 'chat') {
    const defaultName = getUniqueName(type === 'terminal' ? 'Terminal' : 'Chat', type);
    modal = {
      mode: type === 'terminal' ? 'create-terminal' : 'create-chat',
      name: defaultName,
      defaultName,
      error: '',
    };
    // Focus after DOM update
    setTimeout(() => modalInputEl?.select(), 0);
  }

  function openDeleteModal(session: any) {
    modal = {
      mode: 'confirm-delete',
      name: session.name,
      defaultName: '',
      error: '',
      targetSession: session,
    };
  }

  async function submitCreateModal() {
    if (!modal || (modal.mode !== 'create-terminal' && modal.mode !== 'create-chat')) return;
    const trimmed = modal.name.trim();
    if (!trimmed) { modal.error = 'Name cannot be empty'; return; }
    const existing = store.sessions.find(s => s.name === trimmed);
    if (existing) { modal.error = `"${trimmed}" already exists`; return; }

    const isTerminal = modal.mode === 'create-terminal';
    if (isTerminal) creatingTerminal = true; else creatingChat = true;
    modal = null;

    try {
      const session = await store.createSession(trimmed, isTerminal ? 'terminal' : 'chat', isTerminal ? 'forever' : '15m');
      goto(`/session/${session.id}`);
    } catch (e) {
      // Re-open modal with error if creation fails
      modal = {
        mode: isTerminal ? 'create-terminal' : 'create-chat',
        name: trimmed,
        defaultName: trimmed,
        error: e instanceof Error ? e.message : 'Failed to create session',
      };
    } finally {
      creatingTerminal = false;
      creatingChat = false;
    }
  }

  async function submitDeleteModal() {
    if (!modal || modal.mode !== 'confirm-delete' || !modal.targetSession) return;
    const id = modal.targetSession.id;
    modal = null;
    store.dismissRecoverable(id);
  }

  function handleModalKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') { modal = null; return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (modal?.mode === 'confirm-delete') submitDeleteModal();
      else submitCreateModal();
    }
  }

  // ── Dashboard WS for badge events ──────────────────────────────────
  // Track sessions that need input (pulsing indicator) and idle sessions (dimmer)
  let needsInputMap = $state(new Map<string, { eventClass: string; summary: string }>());
  let idleAttentionSet = $state(new Set<string>());

  let dashboardWs: WebSocket | null = null;
  let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function connectDashboardWs() {
    if (typeof window === 'undefined') return;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    dashboardWs = new WebSocket(`${protocol}//${location.host}/ws`);

    dashboardWs.onopen = () => {
      dashboardWs?.send(JSON.stringify({ type: 'join_session', sessionId: SESSIONS_CHANNEL }));
    };

    dashboardWs.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'sessions_changed') {
          void store.load();
        } else if (msg.type === 'session_needs_input') {
          const next = new Map(needsInputMap);
          next.set(msg.sessionId, { eventClass: msg.eventClass, summary: msg.summary });
          needsInputMap = next;
          // If it needs input, it's not just idle
          const nextIdle = new Set(idleAttentionSet);
          nextIdle.delete(msg.sessionId);
          idleAttentionSet = nextIdle;
        } else if (msg.type === 'session_input_resolved') {
          const next = new Map(needsInputMap);
          next.delete(msg.sessionId);
          needsInputMap = next;
        } else if (msg.type === 'session_idle_attention') {
          // Only show idle if not already needs-input
          if (!needsInputMap.has(msg.sessionId)) {
            const next = new Set(idleAttentionSet);
            next.add(msg.sessionId);
            idleAttentionSet = next;
          }
        }
      } catch {}
    };

    dashboardWs.onclose = () => {
      dashboardWs = null;
      wsReconnectTimer = setTimeout(connectDashboardWs, 3000);
    };
  }

  $effect(() => {
    connectDashboardWs();
    return () => {
      if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
      dashboardWs?.close();
    };
  });

  const filtered = $derived(
    store.sessions.filter(s =>
      s.name.toLowerCase().includes(searchText.toLowerCase())
    )
  );

  // Split by type
  const terminals = $derived(filtered.filter(s => s.type === 'terminal'));
  const chats = $derived(filtered.filter(s => s.type === 'chat'));

  // For each terminal, find its linked chat from the full (unfiltered) sessions list
  function linkedChatFor(terminal: any): any | null {
    if (!terminal.linked_chat_id) return null;
    return store.sessions.find(s => s.id === terminal.linked_chat_id) ?? null;
  }

  // Standalone chats — not linked to any terminal
  const linkedChatIds = $derived(new Set(
    store.sessions
      .filter(s => s.type === 'terminal' && s.linked_chat_id)
      .map(s => s.linked_chat_id as string)
  ));
  const standaloneChatsSrc = $derived(chats.filter(s => !linkedChatIds.has(s.id)));

  $effect(() => {
    store.load();
  });

  function getUniqueName(base: string, type: string): string {
    const existing = new Set(store.sessions.filter(s => s.type === type).map(s => s.name));
    if (!existing.has(base)) return base;
    for (let i = 2; i < 100; i++) {
      const candidate = `${base} ${i}`;
      if (!existing.has(candidate)) return candidate;
    }
    return `${base} ${Date.now()}`;
  }

  function createTerminal() { openCreateModal('terminal'); }
  function createChat() { openCreateModal('chat'); }
</script>

<div class="flex flex-col h-screen w-screen overflow-hidden" style="background: var(--bg); color: var(--text);">

  <!-- ── Header ─────────────────────────────────────────────────── -->
  <div class="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b flex-shrink-0" style="border-color: var(--border-light);">
    <!-- Logo -->
    <div class="flex items-center gap-3">
      {#if theme.dark}
        <img src="/ANTlogo.png" alt="ANT" class="h-9 w-auto" />
      {:else}
        <img src="/ANTlogo-black-text.png" alt="ANT" class="h-9 w-auto" />
      {/if}
    </div>

    <!-- Header actions -->
    <div class="flex items-center gap-1 flex-wrap">
      <!-- Theme toggle -->
      <button
        onclick={() => theme.toggle()}
        class="p-2 rounded-lg transition-all duration-200"
        style="color: var(--text-muted); background: transparent;"
        title={theme.dark ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {#if theme.dark}
          <!-- Sun -->
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
          </svg>
        {:else}
          <!-- Moon -->
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
          </svg>
        {/if}
      </button>

      <!-- Docs / help -->
      <a
        href="/help"
        class="p-2 rounded-lg transition-all duration-200"
        style="color: var(--text-muted);"
        title="CLI command reference"
      >
        <!-- file-question icon -->
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M9 12h6m-3-3v6M7 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2h-2" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M9 12h.01M12 9a3 3 0 010 6" />
        </svg>
      </a>

      <!-- Grid toggle -->
      <button
        onclick={() => grid.toggle()}
        class="p-2 rounded-lg transition-all duration-200"
        style={grid.enabled
          ? 'color: #6366F1; background: rgba(99,102,241,0.12);'
          : 'color: var(--text-muted); background: transparent;'}
        title="Toggle grid view"
      >
        <!-- layout-grid icon -->
        <svg class="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
          <rect x="2" y="2" width="7" height="7" rx="1.5"/>
          <rect x="11" y="2" width="7" height="7" rx="1.5"/>
          <rect x="2" y="11" width="7" height="7" rx="1.5"/>
          <rect x="11" y="11" width="7" height="7" rx="1.5"/>
        </svg>
      </button>

      <!-- Grid dimension controls -->
      {#if grid.enabled}
        <div class="hidden sm:flex items-center gap-1 ml-1" style="color: var(--text-muted);">
          <span class="text-xs font-mono">C</span>
          <button onclick={() => grid.setDimensions(grid.cols - 1, grid.rows)} disabled={grid.cols <= 1}
            class="w-5 h-5 flex items-center justify-center rounded text-xs font-bold transition-colors hover:bg-white/10 disabled:opacity-30">−</button>
          <span class="text-xs w-3 text-center">{grid.cols}</span>
          <button onclick={() => grid.setDimensions(grid.cols + 1, grid.rows)} disabled={grid.cols >= 5}
            class="w-5 h-5 flex items-center justify-center rounded text-xs font-bold transition-colors hover:bg-white/10 disabled:opacity-30">+</button>
          <span class="text-xs font-mono ml-1">R</span>
          <button onclick={() => grid.setDimensions(grid.cols, grid.rows - 1)} disabled={grid.rows <= 1}
            class="w-5 h-5 flex items-center justify-center rounded text-xs font-bold transition-colors hover:bg-white/10 disabled:opacity-30">−</button>
          <span class="text-xs w-3 text-center">{grid.rows}</span>
          <button onclick={() => grid.setDimensions(grid.cols, grid.rows + 1)} disabled={grid.rows >= 5}
            class="w-5 h-5 flex items-center justify-center rounded text-xs font-bold transition-colors hover:bg-white/10 disabled:opacity-30">+</button>
        </div>
      {/if}
    </div>
  </div>

  <!-- ── Grid view ──────────────────────────────────────────────── -->
  {#if grid.enabled}
    <div class="flex-1 min-h-0 overflow-hidden">
      <GridView sessions={store.sessions} {needsInputMap} {idleAttentionSet} />
    </div>

  {:else}
  <!-- ── List view ──────────────────────────────────────────────── -->


    <!-- ── Loading / error states ── -->
    {#if store.loading && store.sessions.length === 0}
      <div class="flex-1 flex flex-col items-center justify-center gap-3">
        <div class="w-8 h-8 rounded-full border-2 border-[#6366F1] border-t-transparent animate-spin"></div>
        <p class="text-sm" style="color: var(--text-muted);">Loading sessions…</p>
      </div>
    {:else if store.error}
      <div class="flex-1 flex flex-col items-center justify-center gap-4">
        <p class="font-medium" style="color: var(--text);">Failed to load sessions</p>
        <p class="text-sm max-w-xs text-center" style="color: var(--text-faint);">{store.error}</p>
        <button onclick={() => store.load()} class="text-[#22C55E] text-sm font-medium hover:text-[#4ADE80] transition-colors">Retry</button>
      </div>

    {:else}
    <!-- ── Two-column layout ──────────────────────────────────────── -->
    <div class="flex-1 min-h-0 overflow-y-auto">
      <div class="flex flex-col lg:flex-row gap-6 lg:gap-8 p-4 sm:p-6 h-full">

        <!-- Terminals column — order-2 on mobile (below Chats), order-1 on desktop -->
        <div class="flex-1 min-w-0 order-2 lg:order-1">
          <!-- Section header -->
          <div class="flex items-center justify-between mb-4 gap-2">
            <h2 class="text-base font-semibold flex-shrink-0" style="color: var(--text);">
              Terminals
              {#if terminals.length > 0}
                <span class="ml-2 text-xs font-normal px-1.5 py-0.5 rounded-full" style="background: var(--bg-elevated); color: var(--text-faint);">{terminals.length}</span>
              {/if}
            </h2>
            <button
              onclick={createTerminal}
              disabled={creatingTerminal}
              class="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white transition-all disabled:opacity-60 w-full sm:w-auto"
              style="background: #4F46E5;"
            >
              {#if creatingTerminal}
                <svg class="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" stroke-dasharray="32" stroke-dashoffset="8" />
                </svg>
              {:else}
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 5v14M5 12h14"/>
                </svg>
              {/if}
              <span>New Terminal</span>
            </button>
          </div>

          <!-- Terminal pair cards -->
          {#if terminals.length === 0}
            <div class="flex flex-col items-center justify-center py-16 gap-3 rounded-xl border border-dashed" style="border-color: var(--border-light);">
              <div class="w-10 h-10 rounded-xl flex items-center justify-center" style="background: rgba(79,70,229,0.1);">
                <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="4 17 10 11 4 5"></polyline>
                  <line x1="12" y1="19" x2="20" y2="19"></line>
                </svg>
              </div>
              <p class="text-sm font-medium" style="color: var(--text-muted);">No terminals yet</p>
              <p class="text-xs" style="color: var(--text-faint);">Click "New Terminal" to get started</p>
            </div>
          {:else}
            <div class="space-y-2.5">
              {#each terminals as terminal (terminal.id)}
                <div class="animate-slide-in">
                  <SessionPairCard
                    {terminal}
                    linkedChat={linkedChatFor(terminal)}
                    needsInput={needsInputMap.get(terminal.id) ?? null}
                    idleAttention={idleAttentionSet.has(terminal.id)}
                    onArchive={() => store.archiveSession(terminal.id)}
                    onDelete={() => store.deleteSession(terminal.id)}
                  />
                </div>
              {/each}
            </div>
          {/if}
        </div>

        <!-- Vertical divider (desktop only) -->
        <div class="hidden lg:block w-px flex-shrink-0 self-stretch" style="background: var(--border-light);"></div>

        <!-- Horizontal divider (mobile only) -->
        <div class="lg:hidden h-px w-full order-15" style="background: var(--border-light);"></div>

        <!-- Chats column — order-1 on mobile (first), order-2 on desktop -->
        <div class="flex-1 min-w-0 order-1 lg:order-2">
          <!-- Section header -->
          <div class="flex items-center justify-between mb-4 gap-2">
            <h2 class="text-base font-semibold flex-shrink-0" style="color: var(--text);">
              Chats
              {#if standaloneChatsSrc.length > 0}
                <span class="ml-2 text-xs font-normal px-1.5 py-0.5 rounded-full" style="background: var(--bg-elevated); color: var(--text-faint);">{standaloneChatsSrc.length}</span>
              {/if}
            </h2>
            <button
              onclick={createChat}
              disabled={creatingChat}
              class="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white transition-all disabled:opacity-60 w-full sm:w-auto"
              style="background: #10B981;"
            >
              {#if creatingChat}
                <svg class="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" stroke-dasharray="32" stroke-dashoffset="8" />
                </svg>
              {:else}
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 5v14M5 12h14"/>
                </svg>
              {/if}
              <span>New Chat</span>
            </button>
          </div>

          <!-- Chat cards (standalone only) -->
          {#if standaloneChatsSrc.length === 0}
            <div class="flex flex-col items-center justify-center py-12 gap-3 rounded-xl border border-dashed" style="border-color: var(--border-light);">
              <div class="w-10 h-10 rounded-xl flex items-center justify-center" style="background: rgba(16,185,129,0.1);">
                <!-- message-square icon -->
                <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                </svg>
              </div>
              <p class="text-sm font-medium" style="color: var(--text-muted);">No standalone chats</p>
              <p class="text-xs text-center max-w-[180px]" style="color: var(--text-faint);">Linked chats open via their terminal pair card</p>
            </div>
          {:else}
            <div class="space-y-2">
              {#each standaloneChatsSrc as chat (chat.id)}
                <div class="animate-slide-in">
                  <SessionCard
                    session={chat}
                    onclick={() => goto(`/session/${chat.id}`)}
                    onArchive={() => store.archiveSession(chat.id)}
                    onDelete={() => store.deleteSession(chat.id)}
                  />
                </div>
              {/each}
            </div>
          {/if}
        </div>

      </div>
    </div>

    <!-- Archived / recoverable footer bar -->
    {#if store.recoverable.length > 0}
      <div class="flex items-center gap-3 px-4 sm:px-6 py-2 border-t flex-shrink-0 overflow-x-auto" style="border-color: var(--border-light);">
        <span class="text-xs font-medium flex-shrink-0" style="color: var(--text-faint);">Archived:</span>
        {#each store.recoverable as session (session.id)}
          <div class="flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs whitespace-nowrap flex-shrink-0" style="border-color: var(--border-light); color: var(--text-muted);">
            <span>{session.type === 'terminal' ? '>' : '💬'}</span>
            <span>{session.name}</span>
            <!-- Brain: save to memory palace then delete -->
            <button
              onclick={async () => {
                // Archive triggers memory palace export, then hard-delete from DB + UI
                await fetch(`/api/sessions/${session.id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ archived: true }),
                });
                await fetch(`/api/sessions/${session.id}`, { method: 'DELETE' });
                store.dismissRecoverable(session.id);
              }}
              class="p-0.5 rounded transition-colors hover:text-purple-500"
              style="color: var(--text-faint);"
              title="Save to memory & delete"
            >
              <!-- brain icon (lucide brain) -->
              <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/><path d="M12 18v4"/></svg>
            </button>
            <!-- Restore -->
            <button onclick={() => store.restoreSession(session.id)} class="p-0.5 rounded transition-colors" style="color: var(--text-faint);" title="Restore">
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
            </button>
            <!-- Delete permanently (with confirmation) -->
            <button onclick={() => openDeleteModal(session)} class="p-0.5 rounded transition-colors" style="color: var(--text-faint);" title="Delete permanently">
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
          </div>
        {/each}
      </div>
    {/if}
    {/if}

  {/if}

  <!-- ── Inline modal (replaces prompt/confirm) ── -->
  {#if modal}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="fixed inset-0 z-50 flex items-center justify-center"
      style="background: rgba(0,0,0,0.6); backdrop-filter: blur(4px);"
      onkeydown={handleModalKeydown}
      onmousedown={(e) => { if (e.target === e.currentTarget) modal = null; }}
    >
      <div
        class="w-full max-w-sm mx-4 rounded-xl border shadow-2xl"
        style="background: var(--bg-card, #1A1A22); border-color: var(--border-light, #ffffff10);"
      >
        {#if modal.mode === 'confirm-delete'}
          <!-- Delete confirmation -->
          <div class="p-5">
            <h3 class="text-sm font-semibold mb-2" style="color: var(--text);">Delete permanently?</h3>
            <p class="text-xs mb-4" style="color: var(--text-muted);">
              Delete "<strong>{modal.name}</strong>" permanently? This cannot be undone.
            </p>
            <div class="flex justify-end gap-2">
              <button
                onclick={() => { modal = null; }}
                class="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                style="color: var(--text-muted); background: var(--bg-elevated, #ffffff08);"
              >Cancel</button>
              <button
                onclick={submitDeleteModal}
                class="px-3 py-1.5 rounded-lg text-xs font-medium text-white transition-colors"
                style="background: #EF4444;"
              >Delete</button>
            </div>
          </div>
        {:else}
          <!-- Create terminal / chat -->
          <div class="p-5">
            <h3 class="text-sm font-semibold mb-3" style="color: var(--text);">
              {modal.mode === 'create-terminal' ? 'New Terminal' : 'New Chat'}
            </h3>
            <input
              bind:this={modalInputEl}
              bind:value={modal.name}
              placeholder={modal.defaultName}
              class="w-full px-3 py-2 rounded-lg text-sm outline-none mb-1"
              style="background: var(--bg, #0A1628); border: 1px solid {modal.error ? '#EF4444' : 'var(--border-subtle, #ffffff10)'}; color: var(--text);"
            />
            {#if modal.error}
              <p class="text-xs mt-1 mb-2" style="color: #EF4444;">{modal.error}</p>
            {/if}
            <div class="flex justify-end gap-2 mt-3">
              <button
                onclick={() => { modal = null; }}
                class="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                style="color: var(--text-muted); background: var(--bg-elevated, #ffffff08);"
              >Cancel</button>
              <button
                onclick={submitCreateModal}
                class="px-3 py-1.5 rounded-lg text-xs font-medium text-white transition-colors"
                style="background: {modal.mode === 'create-terminal' ? '#4F46E5' : '#10B981'};"
              >Create</button>
            </div>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
