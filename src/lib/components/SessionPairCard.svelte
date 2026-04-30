<script lang="ts">
  import { goto } from '$app/navigation';
  import { deriveTerminalActivityState } from '$lib/shared/terminal-activity';

  let {
    terminal,
    linkedChat = null,
    needsInput = null,
    idleAttention = false,
    onArchive,
    onDelete,
  }: {
    terminal: any;
    linkedChat: any | null;
    needsInput?: { eventClass: string; summary: string } | null;
    idleAttention?: boolean;
    onArchive?: () => void;
    onDelete?: () => void;
  } = $props();

  // Derive terminal active/idle status from last_activity
  const terminalStatus = $derived((() => {
    if (terminal.attention_state === 'focus') {
      return { label: 'FOCUS', color: '#92400E', bg: 'rgba(245,158,11,0.16)' };
    }
    if (terminal.last_activity) {
      const activity = deriveTerminalActivityState(terminal.last_activity);
      if (activity.state === 'working')  return { label: 'WORKING', color: '#22C55E', bg: 'rgba(34,197,94,0.12)' };
      if (activity.state === 'thinking') return { label: 'THINKING', color: '#F59E0B', bg: 'rgba(245,158,11,0.12)' };
    }
    const s = terminal.status ?? 'idle';
    if (s === 'active') return { label: 'ACTIVE', color: '#22C55E', bg: 'rgba(34,197,94,0.12)' };
    return { label: 'IDLE', color: '#F59E0B', bg: 'rgba(245,158,11,0.12)' };
  })());

  function handleCardClick() {
    goto(`/session/${terminal.id}`);
  }

  function handleChatClick(e: MouseEvent) {
    e.stopPropagation();
    if (linkedChat) {
      goto(`/session/${linkedChat.id}`);
    } else {
      goto(`/session/${terminal.id}`);
    }
  }

  function handleArchive(e: MouseEvent) {
    e.stopPropagation();
    onArchive?.();
  }

  function handleDelete(e: MouseEvent) {
    e.stopPropagation();
    onDelete?.();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  onclick={handleCardClick}
  class="group relative rounded-xl border overflow-hidden cursor-pointer transition-all duration-200 card-hover"
  style="background: var(--bg-card); border-color: var(--border-light);"
>
  <div class="flex items-stretch">
    <!-- Terminal half -->
    <div class="flex-1 min-w-0 flex items-center gap-3 px-4 py-3.5">
      <!-- Terminal icon -->
      <div
        class="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
        style="background: rgba(79,70,229,0.12);"
      >
        <!-- lucide terminal icon -->
        <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="4 17 10 11 4 5"></polyline>
          <line x1="12" y1="19" x2="20" y2="19"></line>
        </svg>
      </div>

      <div class="flex-1 min-w-0">
        <p class="font-semibold text-sm truncate" style="color: var(--text);">{terminal.name}</p>
        <div class="flex items-center gap-2 mt-0.5">
          <span
            class="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide"
            style="color: {terminalStatus.color}; background: {terminalStatus.bg};"
          >{terminalStatus.label}</span>
          {#if needsInput}
            <span
              class="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide"
              style="color: #EF4444; background: rgba(239,68,68,0.12);"
              title={needsInput.summary}
            >
              <span class="ant-pulse-dot" style="width:6px;height:6px;border-radius:50%;background:#EF4444;display:inline-block;"></span>
              NEEDS INPUT
            </span>
          {:else if terminal.attention_state === 'focus'}
            <span
              class="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide"
              style="color: #92400E; background: rgba(245,158,11,0.14);"
              title={terminal.attention_reason || `Focus mode${terminal.focus_room_name ? ` in ${terminal.focus_room_name}` : ''}`}
            >
              <span class="ant-pulse-dot" style="width:6px;height:6px;border-radius:50%;background:#F59E0B;display:inline-block;"></span>
              {terminal.focus_queue_count || 0} queued
            </span>
          {:else if idleAttention}
            <span
              class="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded uppercase tracking-wide"
              style="color: #F59E0B; background: rgba(245,158,11,0.08);"
              title="Terminal has been idle for a while"
            >
              <span style="width:5px;height:5px;border-radius:50%;background:#F59E0B;display:inline-block;opacity:0.6;"></span>
              IDLE
            </span>
          {/if}
          {#if terminal.ttl === 'forever'}
            <span class="text-[10px] font-medium" style="color: var(--text-faint);">Always On</span>
          {/if}
        </div>
      </div>
    </div>

    <!-- Divider -->
    <div class="w-px self-stretch" style="background: var(--border-light);"></div>

    <!-- Chat half -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      onclick={handleChatClick}
      class="flex-1 min-w-0 flex items-center gap-3 px-4 py-3.5 transition-colors duration-150 hover:bg-indigo-500/5"
    >
      <!-- chat icon -->
      <div
        class="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
        style="background: rgba(99,102,241,0.12);"
      >
        <!-- lucide message-square icon -->
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="#6366F1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
      </div>

      <div class="flex-1 min-w-0">
        {#if linkedChat}
          <p class="font-medium text-xs truncate" style="color: var(--text);">{linkedChat.name}</p>
          <p class="text-[10px] mt-0.5" style="color: var(--text-faint);">Linked chat</p>
        {:else}
          <p class="font-medium text-xs" style="color: var(--text-muted);">No chat linked</p>
          <p class="text-[10px] mt-0.5" style="color: var(--text-faint);">Linked chat unavailable</p>
        {/if}
      </div>
    </div>
  </div>

  <!-- Hover action buttons -->
  <div class="absolute top-2 right-2 hidden group-hover:flex items-center gap-1">
    {#if onArchive}
      <button
        onclick={handleArchive}
        class="p-1.5 rounded-lg transition-all"
        style="color: var(--text-muted); background: var(--bg-elevated);"
        title="Archive"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
        </svg>
      </button>
    {/if}
    {#if onDelete}
      <button
        onclick={handleDelete}
        class="p-1.5 rounded-lg transition-all text-red-400 hover:text-red-300"
        style="background: var(--bg-elevated);"
        title="Delete"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </button>
    {/if}
  </div>
</div>

<style>
  :global(.ant-pulse-dot) {
    animation: ant-pulse 1.5s ease-in-out infinite;
  }
  @keyframes ant-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.4; transform: scale(1.4); }
  }
</style>
