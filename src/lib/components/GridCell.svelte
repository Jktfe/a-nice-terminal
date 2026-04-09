<script lang="ts">
  import { useGridStore } from '$lib/stores/grid.svelte';
  import Terminal from './Terminal.svelte';
  import ChatPane from './ChatPane.svelte';

  interface Session {
    id: string;
    name: string;
    type: string;
  }

  interface GridCell {
    id: string;
    sessionId: string | null;
  }

  let { cell, sessions }: { cell: GridCell; sessions: Session[] } = $props();

  const grid = useGridStore();

  const session = $derived(
    cell.sessionId ? sessions.find(s => s.id === cell.sessionId) ?? null : null
  );

  let showPicker = $state(false);
  let pickerSearch = $state('');
  let pickerEl = $state<HTMLElement | null>(null);

  const filteredSessions = $derived(
    sessions.filter(s =>
      s.name.toLowerCase().includes(pickerSearch.toLowerCase())
    )
  );

  function openPicker() {
    pickerSearch = '';
    showPicker = true;
  }

  function pick(sessionId: string) {
    grid.assignCell(cell.id, sessionId);
    showPicker = false;
  }

  function clear() {
    grid.clearCell(cell.id);
  }

  // Close picker on outside click
  function onWindowClick(e: MouseEvent) {
    if (pickerEl && !pickerEl.contains(e.target as Node)) {
      showPicker = false;
    }
  }

  function onPickerKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') showPicker = false;
  }
</script>

<svelte:window onclick={onWindowClick} />

<div
  class="relative flex flex-col rounded-lg overflow-hidden"
  style="background: var(--bg-card); border: 1px solid var(--border-light);"
>
  {#if cell.sessionId === null}
    <!-- Empty cell: show + button -->
    <button
      onclick={openPicker}
      class="flex-1 flex items-center justify-center transition-colors hover:bg-white/5"
      style="min-height: 80px; color: var(--text-faint);"
      title="Add session"
    >
      <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 4v16m8-8H4" />
      </svg>
    </button>

  {:else if session === null}
    <!-- Session was deleted -->
    <div class="flex-1 flex flex-col items-center justify-center gap-2 p-3">
      <p class="text-xs" style="color: var(--text-faint);">Session not found</p>
      <button
        onclick={clear}
        class="text-xs px-2 py-1 rounded transition-colors"
        style="color: var(--text-muted); background: var(--bg-input);"
      >Clear</button>
    </div>

  {:else}
    <!-- Filled cell: header + content -->
    <div
      class="flex items-center gap-1.5 px-2 flex-shrink-0"
      style="height: 28px; background: var(--bg-elevated, var(--bg-surface)); border-bottom: 1px solid var(--border-subtle);"
    >
      <span class="text-xs flex-shrink-0" style="color: var(--text-faint);">
        {session.type === 'terminal' ? '>' : '💬'}
      </span>
      <span class="flex-1 text-xs truncate font-medium" style="color: var(--text-muted);">{session.name}</span>
      <button
        onclick={clear}
        class="flex-shrink-0 w-4 h-4 flex items-center justify-center rounded transition-colors hover:bg-white/10"
        style="color: var(--text-faint);"
        title="Remove"
      >✕</button>
    </div>

    <!-- Session content -->
    <div class="flex-1 min-h-0 overflow-hidden">
      {#if session.type === 'terminal'}
        <Terminal sessionId={session.id} />
      {:else}
        <ChatPane sessionId={session.id} />
      {/if}
    </div>
  {/if}

  <!-- Session picker dropdown -->
  {#if showPicker}
    <div
      bind:this={pickerEl}
      role="listbox"
      tabindex="-1"
      onkeydown={onPickerKeydown}
      class="absolute inset-x-0 top-0 z-20 flex flex-col rounded-lg shadow-xl overflow-hidden"
      style="background: var(--bg-card); border: 1px solid var(--border-light); max-height: 260px;"
    >
      <div class="p-2 border-b flex-shrink-0" style="border-color: var(--border-subtle);">
        <input
          type="text"
          placeholder="Search sessions…"
          bind:value={pickerSearch}
          class="w-full px-2 py-1 rounded text-xs focus:outline-none focus:ring-1 focus:ring-[#6366F1]"
          style="background: var(--bg-input); color: var(--text);"
        />
      </div>
      <div class="overflow-y-auto flex-1">
        {#if filteredSessions.length === 0}
          <p class="text-xs p-3 text-center" style="color: var(--text-faint);">No sessions found</p>
        {:else}
          {#each filteredSessions as s (s.id)}
            <button
              onclick={() => pick(s.id)}
              class="w-full flex items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-white/5"
              style="color: var(--text);"
            >
              <span style="color: var(--text-faint); flex-shrink:0;">
                {s.type === 'terminal' ? '>' : '💬'}
              </span>
              <span class="truncate">{s.name}</span>
            </button>
          {/each}
        {/if}
      </div>
      <div class="p-2 border-t flex-shrink-0" style="border-color: var(--border-subtle);">
        <button
          onclick={() => showPicker = false}
          class="w-full text-xs py-1 rounded transition-colors"
          style="color: var(--text-faint); background: var(--bg-input);"
        >Cancel</button>
      </div>
    </div>
  {/if}
</div>
