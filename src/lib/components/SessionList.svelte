<script lang="ts">
  import { useSessionStore } from '$lib/stores/sessions.svelte';
  import SessionCard from './SessionCard.svelte';
  import { goto } from '$app/navigation';

  const store = useSessionStore();
  let searchText = $state('');
  let showNewSessionModal = $state(false);
  let newSessionName = $state('');
  let newSessionType = $state<'chat' | 'terminal'>('chat');

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
    const session = await store.createSession(newSessionName.trim(), newSessionType);
    newSessionName = '';
    newSessionType = 'chat';
    showNewSessionModal = false;
    goto(`/session/${session.id}`);
  }
</script>

<div class="flex flex-col h-screen w-screen bg-[#0A1628] text-white overflow-hidden">
  <!-- Header with Logo -->
  <div class="flex items-center justify-between px-6 py-6 border-b border-[var(--border-light)]">
    <div class="flex items-center gap-3">
      <div class="w-10 h-10 rounded-lg bg-gradient-indigo flex items-center justify-center font-bold text-sm">
        ANT
      </div>
      <h1 class="text-2xl font-bold">A Nice Terminal</h1>
    </div>
    <button
      onclick={() => (showNewSessionModal = true)}
      class="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-indigo hover:shadow-lg transition-all duration-200 text-white text-sm font-medium"
      title="Create new session"
    >
      <span>+</span>
      <span>New Session</span>
    </button>
  </div>

  <!-- Connection Status -->
  <div class="flex items-center gap-2 px-6 py-2 text-xs text-gray-400 bg-[#16161A]/50">
    <div class="w-2 h-2 rounded-full bg-[#22C55E] animate-pulse-subtle"></div>
    <span>Connected</span>
  </div>

  <!-- Search Bar -->
  <div class="px-6 py-4">
    <div class="relative">
      <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        type="text"
        placeholder="Search sessions..."
        bind:value={searchText}
        class="w-full pl-10 pr-4 py-2.5 rounded-lg bg-[#1A1A22] text-sm text-white placeholder-gray-500 focus:ring-2 focus:ring-[#6366F1] transition-all"
      />
    </div>
  </div>

  <!-- Session List -->
  <div class="flex-1 overflow-y-auto px-6 pb-6">
    {#if store.loading && store.sessions.length === 0}
      <div class="flex flex-col items-center justify-center h-full gap-3">
        <div class="w-8 h-8 rounded-full border-2 border-[#6366F1] border-t-transparent animate-spin"></div>
        <p class="text-gray-400 text-sm">Loading sessions...</p>
      </div>
    {:else if store.error}
      <div class="flex flex-col items-center justify-center h-full gap-4">
        <div class="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center">
          <span class="text-xl">⚠️</span>
        </div>
        <p class="text-gray-200 font-medium text-center">Failed to load sessions</p>
        <p class="text-gray-500 text-sm text-center max-w-xs">{store.error}</p>
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
        <p class="text-gray-300 font-medium">
          {searchText ? 'No sessions found' : 'No sessions yet'}
        </p>
        <p class="text-gray-500 text-sm">
          {searchText ? 'Try a different search' : 'Create your first session to get started'}
        </p>
      </div>
    {:else}
      <div class="space-y-2">
        {#each filtered as session (session.id)}
          <button
            class="w-full text-left group animate-slide-in"
            onclick={() => goto(`/session/${session.id}`)}
          >
            <SessionCard {session} />
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>

<!-- New Session Modal -->
{#if showNewSessionModal}
  <div class="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center">
    <div class="bg-[#1A1A22] rounded-t-2xl sm:rounded-2xl w-full sm:w-96 p-6 border border-[var(--border-light)] animate-slide-in">
      <h2 class="text-xl font-bold mb-4">Create New Session</h2>

      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-300 mb-2">Session Name</label>
          <input
            type="text"
            placeholder="My awesome session..."
            bind:value={newSessionName}
            class="w-full px-3 py-2 rounded-lg bg-[#0D0D12] text-white placeholder-gray-600 focus:ring-2 focus:ring-[#6366F1] transition-all"
            autofocus
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-300 mb-2">Type</label>
          <div class="flex gap-3">
            <button
              onclick={() => (newSessionType = 'chat')}
              class="flex-1 px-3 py-2 rounded-lg transition-all"
              class:bg-[#6366F1]={newSessionType === 'chat'}
              class:text-white={newSessionType === 'chat'}
              class:bg-[#0D0D12]={newSessionType !== 'chat'}
              class:text-gray-400={newSessionType !== 'chat'}
            >
              💬 Chat
            </button>
            <button
              onclick={() => (newSessionType = 'terminal')}
              class="flex-1 px-3 py-2 rounded-lg transition-all"
              class:bg-[#22C55E]={newSessionType === 'terminal'}
              class:text-white={newSessionType === 'terminal'}
              class:bg-[#0D0D12]={newSessionType !== 'terminal'}
              class:text-gray-400={newSessionType !== 'terminal'}
            >
              > Terminal
            </button>
          </div>
        </div>

        <div class="flex gap-3 pt-4">
          <button
            onclick={() => (showNewSessionModal = false)}
            class="flex-1 px-4 py-2 rounded-lg bg-[#0D0D12] hover:bg-[#16161A] transition-colors text-sm font-medium"
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
