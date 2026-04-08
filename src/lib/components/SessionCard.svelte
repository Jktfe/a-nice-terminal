<script lang="ts">
  let { session, onclick, onArchive, onDelete } = $props();

  const isTerminal = $derived(session.type === 'terminal');
  const accentColor = $derived(isTerminal ? '#22C55E' : '#6366F1');
  const bgAccent = $derived(isTerminal ? 'rgba(34, 197, 94, 0.1)' : 'rgba(99, 102, 241, 0.1)');
  const icon = $derived(isTerminal ? '>' : '💬');

  function timeAgo(dateStr: string) {
    // SQLite datetime('now') returns UTC without 'Z' — add it so browsers parse as UTC not local time
    const utc = dateStr.includes('Z') || dateStr.includes('+') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
    const diff = Date.now() - new Date(utc).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} hr ago`;
    const days = Math.floor(hrs / 24);
    return `${days} day${days > 1 ? 's' : ''} ago`;
  }

  function getStatusDot(status: string) {
    const statusMap: Record<string, { color: string; label: string }> = {
      active: { color: '#22C55E', label: 'Active' },
      idle: { color: '#6366F1', label: 'Idle' },
      completed: { color: '#8B5CF6', label: 'Completed' }
    };
    return statusMap[status] || { color: '#6B7280', label: status };
  }

  // Derive terminal status from last_activity (updated every ~10s by PTY output)
  // rather than the static DB status field which is never auto-updated.
  function deriveStatus(s: typeof session) {
    if (s.type === 'terminal' && s.last_activity) {
      const utc = s.last_activity.includes('Z') || s.last_activity.includes('+')
        ? s.last_activity : s.last_activity.replace(' ', 'T') + 'Z';
      const ageMs = Date.now() - new Date(utc).getTime();
      if (ageMs < 60_000)      return { color: '#22C55E', label: 'Active' };
      if (ageMs < 5 * 60_000)  return { color: '#F59E0B', label: 'Running' };
    }
    return getStatusDot(s.status);
  }

  const statusInfo = $derived(deriveStatus(session));

  function handleDelete(e: MouseEvent) {
    e.stopPropagation();
    onDelete?.();
  }

  function handleArchive(e: MouseEvent) {
    e.stopPropagation();
    onArchive?.();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="group relative px-4 py-3 rounded-lg border transition-all duration-200 card-hover overflow-hidden cursor-pointer"
  style="background: var(--bg-surface); border-color: var(--border-subtle);"
  onclick={onclick}
>
  <!-- Accent Border Left -->
  <div
    class="absolute inset-y-0 left-0 w-1 opacity-0 group-hover:opacity-100 transition-opacity"
    style="background-color: {accentColor}"
  ></div>

  <div class="flex items-center gap-3 pl-2">
    <!-- Icon -->
    <div
      class="w-10 h-10 rounded-lg flex items-center justify-center text-lg font-bold flex-shrink-0"
      style="background: {bgAccent}; color: {accentColor}"
    >
      {icon}
    </div>

    <!-- Content -->
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-1.5 min-w-0">
        <p class="font-medium text-sm truncate" style="color: var(--text);">{session.name}</p>
        {#if session.handle}
          <span class="text-[10px] font-mono px-1 py-px rounded flex-shrink-0" style="background:{accentColor}18;color:{accentColor}99;">{session.handle}</span>
        {/if}
      </div>
      <div class="flex items-center gap-2 mt-1">
        <span class="text-xs" style="color: var(--text-muted);">
          {isTerminal ? 'Terminal' : 'Chat'}
        </span>
        <div class="w-1 h-1 rounded-full" style="background: var(--text-faint);"></div>
        <div class="flex items-center gap-1">
          <div
            class="w-1.5 h-1.5 rounded-full"
            style="background-color: {statusInfo.color}"
          ></div>
          <span class="text-xs" style="color: var(--text-muted);">{statusInfo.label}</span>
        </div>
      </div>
    </div>

    <!-- Time + Actions -->
    <div class="flex items-center gap-2 flex-shrink-0">
      {#if session.ttl === 'forever'}
        <span class="text-xs px-1.5 py-0.5 rounded font-medium group-hover:hidden"
          style="background: rgba(34,197,94,0.15); color: #22C55E;">
          ⚡ AON
        </span>
      {:else}
        <span class="text-xs whitespace-nowrap group-hover:hidden" style="color: var(--text-faint);">
          {timeAgo(session.updated_at)}
        </span>
      {/if}

      <!-- Action buttons — visible on hover -->
      <div class="hidden group-hover:flex items-center gap-1">
        <button
          onclick={handleArchive}
          class="p-1.5 rounded transition-all"
          style="color: var(--text-muted);"
          title="Archive session"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
          </svg>
        </button>
        <button
          onclick={handleDelete}
          class="p-1.5 rounded transition-all text-red-400 hover:text-red-300"
          title="Delete session"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</div>
