<script lang="ts">
  import { useSessionStore, TTL_OPTIONS } from '$lib/stores/sessions.svelte';
  import { useGridStore } from '$lib/stores/grid.svelte';
  import SessionCard from './SessionCard.svelte';
  import GridView from './GridView.svelte';
  import { goto } from '$app/navigation';
  import { theme } from '$lib/stores/theme.svelte';

  const grid = useGridStore();

  const store = useSessionStore();
  let searchText = $state('');
  let showNewSessionModal = $state(false);
  let newSessionName = $state('');
  let newSessionType = $state<'chat' | 'terminal'>('chat');
  let newSessionTtl = $state('15m');

  const filtered = $derived(
    store.sessions.filter(s =>
      s.name.toLowerCase().includes(searchText.toLowerCase())
    )
  );

  $effect(() => {
    store.load();
  });

  async function createNewSession() {
    if (!newSessionName.trim()) return;
    const session = await store.createSession(newSessionName.trim(), newSessionType, newSessionTtl);
    newSessionName = '';
    newSessionType = 'chat';
    newSessionTtl = '15m';
    showNewSessionModal = false;
    goto(`/session/${session.id}`);
  }
</script>

<div class="flex flex-col h-screen w-screen overflow-hidden" style="background: var(--bg); color: var(--text);">
  <!-- Header with Logo -->
  <div class="flex items-center justify-between px-6 py-4 border-b" style="border-color: var(--border-light);">
    <div class="flex items-center gap-3">
      {#if theme.dark}
        <img src="/ANTlogo.png" alt="ANT" class="h-9 w-auto" />
      {:else}
        <img src="/ANTlogo-black-text.png" alt="ANT" class="h-9 w-auto" />
      {/if}
    </div>
    <div class="flex items-center gap-2">
      <!-- CLI Help link -->
      <a
        href="/help"
        class="p-2 rounded-lg transition-all duration-200 text-xs font-mono"
        style="color: var(--text-muted);"
        title="CLI command reference"
      >?</a>
      <!-- Theme toggle -->
      <button
        onclick={() => theme.toggle()}
        class="p-2 rounded-lg transition-all duration-200"
        style="color: var(--text-muted); background: transparent;"
        title={theme.dark ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {#if theme.dark}
          <!-- Sun icon -->
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
          </svg>
        {:else}
          <!-- Moon icon -->
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
          </svg>
        {/if}
      </button>
      <!-- Grid toggle -->
      <button
        onclick={() => grid.toggle()}
        class="p-2 rounded-lg transition-all duration-200"
        style={grid.enabled
          ? 'color: #6366F1; background: rgba(99,102,241,0.15);'
          : 'color: var(--text-muted); background: transparent;'}
        title="Toggle grid view"
      >
        <svg class="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
          <rect x="2" y="2" width="7" height="7" rx="1.5"/>
          <rect x="11" y="2" width="7" height="7" rx="1.5"/>
          <rect x="2" y="11" width="7" height="7" rx="1.5"/>
          <rect x="11" y="11" width="7" height="7" rx="1.5"/>
        </svg>
      </button>

      <!-- Grid dimension controls (visible when grid is enabled) -->
      {#if grid.enabled}
        <div class="flex items-center gap-1" style="color: var(--text-muted);">
          <span class="text-xs font-mono">C</span>
          <button
            onclick={() => grid.setDimensions(grid.cols - 1, grid.rows)}
            disabled={grid.cols <= 1}
            class="w-5 h-5 flex items-center justify-center rounded text-xs font-bold transition-colors hover:bg-white/10 disabled:opacity-30"
          >−</button>
          <span class="text-xs w-3 text-center">{grid.cols}</span>
          <button
            onclick={() => grid.setDimensions(grid.cols + 1, grid.rows)}
            disabled={grid.cols >= 5}
            class="w-5 h-5 flex items-center justify-center rounded text-xs font-bold transition-colors hover:bg-white/10 disabled:opacity-30"
          >+</button>
          <span class="text-xs font-mono ml-1">R</span>
          <button
            onclick={() => grid.setDimensions(grid.cols, grid.rows - 1)}
            disabled={grid.rows <= 1}
            class="w-5 h-5 flex items-center justify-center rounded text-xs font-bold transition-colors hover:bg-white/10 disabled:opacity-30"
          >−</button>
          <span class="text-xs w-3 text-center">{grid.rows}</span>
          <button
            onclick={() => grid.setDimensions(grid.cols, grid.rows + 1)}
            disabled={grid.rows >= 5}
            class="w-5 h-5 flex items-center justify-center rounded text-xs font-bold transition-colors hover:bg-white/10 disabled:opacity-30"
          >+</button>
        </div>
      {/if}

      <button
        onclick={() => (showNewSessionModal = true)}
        class="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-indigo hover:shadow-lg transition-all duration-200 text-white text-sm font-medium"
        title="Create new session"
      >
        <span>+</span>
        <span>New Session</span>
      </button>
    </div>
  </div>

  <!-- Connection Status -->
  <div class="flex items-center gap-2 px-6 py-2 text-xs" style="color: var(--text-muted); background: var(--bg-surface)50;">
    <div class="w-2 h-2 rounded-full bg-[#22C55E] animate-pulse-subtle"></div>
    <span>Connected</span>
  </div>

  <!-- Grid view (replaces list when enabled) -->
  {#if grid.enabled}
    <div class="flex-1 min-h-0 overflow-hidden">
      <GridView sessions={store.sessions} />
    </div>
  {/if}

  <!-- Search Bar (list mode only) -->
  {#if !grid.enabled}
  <div class="px-6 py-4">
    <div class="relative">
      <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        type="text"
        placeholder="Search sessions..."
        bind:value={searchText}
        class="w-full pl-10 pr-4 py-2.5 rounded-lg text-sm focus:ring-2 focus:ring-[#6366F1] transition-all"
        style="background: var(--bg-card); color: var(--text);"
      />
    </div>
  </div>

  <!-- Recoverable Sessions Rail (list mode only) -->
  {#if store.recoverable.length > 0}
    <div class="px-6 py-3 border-b" style="border-color: var(--border-subtle); background: var(--bg-surface);">
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
            <span class="text-xs px-1.5 py-0.5 rounded" style="background: rgba(99,102,241,0.15); color: #818CF8;">
              {session.ttl === 'forever' ? 'AON' : session.ttl}
            </span>
          </button>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Session List (list mode only) -->
  <div class="flex-1 overflow-y-auto px-6 pb-6">
    {#if store.loading && store.sessions.length === 0}
      <div class="flex flex-col items-center justify-center h-full gap-3">
        <div class="w-8 h-8 rounded-full border-2 border-[#6366F1] border-t-transparent animate-spin"></div>
        <p class="text-sm" style="color: var(--text-muted);">Loading sessions...</p>
      </div>
    {:else if store.error}
      <div class="flex flex-col items-center justify-center h-full gap-4">
        <div class="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center">
          <span class="text-xl">⚠️</span>
        </div>
        <p class="font-medium text-center" style="color: var(--text);">Failed to load sessions</p>
        <p class="text-sm text-center max-w-xs" style="color: var(--text-faint);">{store.error}</p>
        <button
          onclick={() => store.load()}
          class="text-[#22C55E] text-sm font-medium hover:text-[#4ADE80] transition-colors"
        >
          Retry
        </button>
      </div>
    {:else if filtered.length === 0}
      <div class="flex flex-col items-center justify-center h-full gap-4">
        <div class="w-12 h-12 rounded-full bg-indigo-500/10 flex items-center justify-center">
          <span class="text-xl">✨</span>
        </div>
        <p class="font-medium" style="color: var(--text-muted);">
          {searchText ? 'No sessions found' : 'No sessions yet'}
        </p>
        <p class="text-sm" style="color: var(--text-faint);">
          {searchText ? 'Try a different search' : 'Create your first session to get started'}
        </p>
      </div>
    {:else}
      <div class="space-y-2">
        {#each filtered as session (session.id)}
          <div class="animate-slide-in">
            <SessionCard
              {session}
              onclick={() => goto(`/session/${session.id}`)}
              onArchive={() => store.archiveSession(session.id)}
              onDelete={() => store.deleteSession(session.id)}
            />
          </div>
        {/each}
      </div>
    {/if}
  </div>
  {/if}
</div>

<!-- New Session Modal -->
{#if showNewSessionModal}
  <div class="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center">
    <div class="rounded-t-2xl sm:rounded-2xl w-full sm:w-96 p-6 border animate-slide-in" style="background: var(--bg-card); border-color: var(--border-light);">
      <h2 class="text-xl font-bold mb-4" style="color: var(--text);">Create New Session</h2>

      <div class="space-y-4">
        <div>
          <label for="new-session-name" class="block text-sm font-medium mb-2" style="color: var(--text-muted);">Session Name</label>
          <input
            id="new-session-name"
            type="text"
            placeholder="My awesome session..."
            bind:value={newSessionName}
            class="w-full px-3 py-2 rounded-lg focus:ring-2 focus:ring-[#6366F1] transition-all"
            style="background: var(--bg-input); color: var(--text);"
          />
        </div>

        <div>
          <p class="block text-sm font-medium mb-2" style="color: var(--text-muted);">Type</p>
          <div class="flex gap-3">
            <button
              onclick={() => (newSessionType = 'chat')}
              class="flex-1 px-3 py-2 rounded-lg transition-all"
              style={newSessionType === 'chat' ? 'background:#6366F1;color:#fff;' : 'background:var(--bg-input);color:var(--text-muted);'}
            >
              💬 Chat
            </button>
            <button
              onclick={() => (newSessionType = 'terminal')}
              class="flex-1 px-3 py-2 rounded-lg transition-all"
              style={newSessionType === 'terminal' ? 'background:#22C55E;color:#fff;' : 'background:var(--bg-input);color:var(--text-muted);'}
            >
              > Terminal
            </button>
          </div>
        </div>

        <div>
          <p class="block text-sm font-medium mb-2" style="color: var(--text-muted);">Session lifetime</p>
          <div class="grid grid-cols-4 gap-1.5">
            {#each TTL_OPTIONS as opt}
              <button
                onclick={() => (newSessionTtl = opt.value)}
                class="px-2 py-1.5 rounded-lg text-xs transition-all text-center"
                style={newSessionTtl === opt.value
                  ? 'background:#6366F1;color:#fff;'
                  : 'background:var(--bg-input);color:var(--text-muted);'}
              >
                {#if opt.value === 'forever'}
                  <span class="text-emerald-400">⚡</span> AON
                {:else}
                  {opt.label}
                {/if}
              </button>
            {/each}
          </div>
          <p class="text-xs mt-1.5" style="color: var(--text-faint);">
            {#if newSessionTtl === 'forever'}
              Always On — survives restarts, never auto-deleted
            {:else}
              {TTL_OPTIONS.find(o => o.value === newSessionTtl)?.label} recovery window after deletion
            {/if}
          </p>
        </div>

        <div class="flex gap-3 pt-2">
          <button
            onclick={() => (showNewSessionModal = false)}
            class="flex-1 px-4 py-2 rounded-lg transition-colors text-sm font-medium"
            style="background: var(--bg-input); color: var(--text);"
          >
            Cancel
          </button>
          <button
            onclick={createNewSession}
            disabled={!newSessionName.trim()}
            class="flex-1 px-4 py-2 rounded-lg bg-gradient-indigo hover:shadow-lg transition-all text-sm font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}
