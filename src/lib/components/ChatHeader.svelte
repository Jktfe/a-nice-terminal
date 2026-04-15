<script lang="ts">
  import { goto } from '$app/navigation';
  import ShareButton from '$lib/components/ShareButton.svelte';
  import { theme } from '$lib/stores/theme.svelte';

  interface PageSession {
    id: string;
    name: string;
    type: string;
    handle?: string;
    display_name?: string;
    linked_chat_id?: string;
    ttl?: string;
    [key: string]: unknown;
  }

  interface Props {
    session: PageSession | null;
    mode: string;
    showPanel: boolean;
    showMenu: boolean;
    sessionId: string;
    openTaskCount: number;
    onModeChange: (m: string) => void;
    onPanelToggle: () => void;
    onMenuToggle: () => void;
    onMenuClose: () => void;
    onCopyId: () => void;
    onRename: () => void;
    onDelete: () => void;
    onCopyTmux: () => void;
  }

  const {
    session,
    mode,
    showPanel,
    showMenu,
    sessionId,
    openTaskCount,
    onModeChange,
    onPanelToggle,
    onMenuToggle,
    onMenuClose,
    onCopyId,
    onRename,
    onDelete,
    onCopyTmux,
  }: Props = $props();
</script>

<div class="flex items-center justify-between px-4 py-2.5 h-14 border-b flex-shrink-0"
     style="border-color: var(--border-light); background: var(--bg);">
  <button
    onclick={() => goto('/')}
    class="flex items-center gap-1.5 px-2 py-1.5 rounded-lg transition-all text-sm"
    style="color: var(--text-muted);"
  >
    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
    </svg>
    Back
  </button>

  <div class="flex-1 flex items-center justify-center min-w-0 px-3">
    <div class="text-center min-w-0">
      <h1 class="text-base font-semibold truncate leading-tight">{session?.name || 'Session'}</h1>
      <p class="text-[11px] leading-tight" style="color: var(--text-muted);">
        {#if session?.handle}
          <span class="font-mono" style="color:#22C55E;">{session.handle}</span>
          <span class="mx-1 opacity-40">·</span>
        {/if}
        <span>{mode === 'chat' ? 'Chat' : mode === 'terminal' ? 'Terminal' : 'Raw'}</span>
      </p>
    </div>
  </div>

  <div class="flex items-center gap-1.5">
    <button onclick={() => theme.toggle()} class="p-1.5 rounded-lg transition-all" style="color:var(--text-muted);" title="Toggle theme">
      {#if theme.dark}
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z"/>
        </svg>
      {:else}
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
        </svg>
      {/if}
    </button>

    <!-- Mode toggle — only shown for terminal sessions (chat sessions have no PTY) -->
    {#if session?.type === 'terminal'}
      <div class="flex rounded-lg p-0.5 border" style="background:var(--bg-card);border-color:var(--border-subtle);">
        <button
          class="px-2.5 py-1 text-xs rounded transition-all"
          style={mode==='chat' ? 'background:#6366F1;color:#fff;' : 'color:var(--text-muted);'}
          onclick={() => onModeChange('chat')}
          title="Chat — interactions & events"
        >💬</button>
        <button
          class="px-2.5 py-1 text-xs rounded transition-all"
          style={mode==='terminal' ? 'background:#22C55E;color:#fff;' : 'color:var(--text-muted);'}
          onclick={() => onModeChange('terminal')}
          title="Terminal — text output"
        >⌨</button>
      </div>
      <button
        class="px-2.5 py-1 text-xs rounded-lg border transition-all"
        style="border-color:var(--border-subtle);color:var(--text-muted);"
        title="Copy SSH+tmux command to clipboard"
        onclick={onCopyTmux}
      >📋 tmux</button>
    {/if}

    <!-- Panel toggle with badge -->
    <button
      onclick={onPanelToggle}
      class="relative px-2.5 py-1 text-xs rounded-lg border transition-all"
      style={showPanel
        ? 'background:#6366F122;border-color:#6366F1;color:#6366F1;'
        : 'border-color:var(--border-subtle);color:var(--text-muted);'}
      title="Participants, Tasks & Files"
    >
      ☰ Panel
      {#if openTaskCount > 0}
        <span class="absolute -top-1 -right-1 w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center bg-[#6366F1] text-white">{openTaskCount}</span>
      {/if}
    </button>

    {#if session}
      <ShareButton {sessionId} sessionType={session.type} />
    {/if}

    <!-- Menu -->
    <div class="relative">
      <button onclick={onMenuToggle} class="p-1.5 rounded-lg" style="color:var(--text-muted);" aria-label="Session menu">
        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/>
        </svg>
      </button>
      {#if showMenu}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="fixed inset-0 z-40" onclick={onMenuClose}></div>
        <div class="absolute right-0 mt-1 w-44 rounded-lg border shadow-xl z-50 overflow-hidden text-sm"
             style="background:var(--bg-card);border-color:var(--border-light);">
          <button onclick={onCopyId} class="w-full text-left px-3 py-2 border-b transition-colors" style="color:var(--text-muted);border-color:var(--border-subtle);">📋 Copy ID</button>
          <button onclick={onRename} class="w-full text-left px-3 py-2 border-b transition-colors" style="color:var(--text-muted);border-color:var(--border-subtle);">✏️ Rename</button>
          <button onclick={onDelete} class="w-full text-left px-3 py-2 text-red-400 hover:bg-red-500/10 transition-colors">🗑 Delete</button>
        </div>
      {/if}
    </div>
  </div>
</div>
