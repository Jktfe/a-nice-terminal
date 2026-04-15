<script lang="ts">
  import { useSessionStore } from '$lib/stores/sessions.svelte';
  import { useGridStore } from '$lib/stores/grid.svelte';
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

  async function createTerminal() {
    creatingTerminal = true;
    try {
      const name = `Terminal ${store.sessions.filter(s => s.type === 'terminal').length + 1}`;
      const session = await store.createSession(name, 'terminal', 'forever');
      goto(`/session/${session.id}`);
    } finally {
      creatingTerminal = false;
    }
  }

  async function createChat() {
    creatingChat = true;
    try {
      const name = `Chat ${store.sessions.filter(s => s.type === 'chat').length + 1}`;
      const session = await store.createSession(name, 'chat', '15m');
      goto(`/session/${session.id}`);
    } finally {
      creatingChat = false;
    }
  }
</script>

<div class="flex flex-col h-screen w-screen overflow-hidden" style="background: var(--bg); color: var(--text);">

  <!-- ── Header ─────────────────────────────────────────────────── -->
  <div class="flex items-center justify-between px-6 py-4 border-b flex-shrink-0" style="border-color: var(--border-light);">
    <!-- Logo -->
    <div class="flex items-center gap-3">
      {#if theme.dark}
        <img src="/ANTlogo.png" alt="ANT" class="h-9 w-auto" />
      {:else}
        <img src="/ANTlogo-black-text.png" alt="ANT" class="h-9 w-auto" />
      {/if}
    </div>

    <!-- Header actions -->
    <div class="flex items-center gap-1">
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
        <div class="flex items-center gap-1 ml-1" style="color: var(--text-muted);">
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
      <GridView sessions={store.sessions} />
    </div>

  {:else}
  <!-- ── List view ──────────────────────────────────────────────── -->

    <!-- Search bar -->
    <div class="px-6 pt-5 pb-3 flex-shrink-0">
      <div class="relative">
        <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style="color: var(--text-faint);" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          placeholder="Search sessions…"
          bind:value={searchText}
          class="w-full pl-10 pr-4 py-2 rounded-lg text-sm focus:ring-2 focus:ring-[#6366F1] transition-all"
          style="background: var(--bg-card); color: var(--text); border: 1px solid var(--border-light);"
        />
      </div>
    </div>

    <!-- Recoverable rail -->
    {#if store.recoverable.length > 0}
      <div class="px-6 py-3 border-b flex-shrink-0" style="border-color: var(--border-subtle); background: var(--bg-surface);">
        <p class="text-xs font-medium mb-2" style="color: var(--text-faint);">Recently deleted — tap to restore</p>
        <div class="flex gap-2 overflow-x-auto pb-1">
          {#each store.recoverable as session (session.id)}
            <button
              onclick={() => store.restoreSession(session.id)}
              class="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs whitespace-nowrap transition-all flex-shrink-0"
              style="background: var(--bg-card); border-color: var(--border-light); color: var(--text-muted);"
              title="Restore {session.name}"
            >
              <span>{session.type === 'terminal' ? '>' : '💬'}</span>
              <span>{session.name}</span>
            </button>
          {/each}
        </div>
      </div>
    {/if}

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
      <div class="flex flex-col lg:flex-row gap-8 p-6 h-full">

        <!-- Terminals column — order-2 on mobile (below Chats), order-1 on desktop -->
        <div class="flex-1 min-w-0 order-2 lg:order-1">
          <!-- Section header -->
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-base font-semibold" style="color: var(--text);">
              Terminals
              {#if terminals.length > 0}
                <span class="ml-2 text-xs font-normal px-1.5 py-0.5 rounded-full" style="background: var(--bg-elevated); color: var(--text-faint);">{terminals.length}</span>
              {/if}
            </h2>
            <button
              onclick={createTerminal}
              disabled={creatingTerminal}
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white transition-all disabled:opacity-60"
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

        <!-- Chats column — order-1 on mobile (first), order-2 on desktop, fixed 300px -->
        <div class="lg:w-72 xl:w-80 flex-shrink-0 order-1 lg:order-2">
          <!-- Section header -->
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-base font-semibold" style="color: var(--text);">
              Chats
              {#if standaloneChatsSrc.length > 0}
                <span class="ml-2 text-xs font-normal px-1.5 py-0.5 rounded-full" style="background: var(--bg-elevated); color: var(--text-faint);">{standaloneChatsSrc.length}</span>
              {/if}
            </h2>
            <button
              onclick={createChat}
              disabled={creatingChat}
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white transition-all disabled:opacity-60"
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
    {/if}

  {/if}
</div>
