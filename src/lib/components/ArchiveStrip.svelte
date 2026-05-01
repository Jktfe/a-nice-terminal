<script lang="ts">
  import { goto } from '$app/navigation';
  import type { Session } from '$lib/stores/sessions.svelte';

  let {
    recoverable,
    onRestore,
    onDelete,
    maxVisible = 4,
  }: {
    recoverable: Session[];
    onRestore: (id: string) => void;
    onDelete: (session: Session) => void;
    maxVisible?: number;
  } = $props();

  function timestamp(value: string | null | undefined): number {
    if (!value) return 0;
    const normalized = value.includes('Z') || value.includes('+') ? value : value.replace(' ', 'T') + 'Z';
    return new Date(normalized).getTime() || 0;
  }

  const visible = $derived.by(() => {
    const sorted = [...recoverable].sort(
      (a, b) => timestamp(b.deleted_at) - timestamp(a.deleted_at),
    );
    return sorted.slice(0, maxVisible);
  });

  function truncate(name: string, max = 14): string {
    if (name.length <= max) return name;
    return name.slice(0, max - 1) + '…';
  }
</script>

{#if recoverable.length > 0}
  <div class="archive-strip">
    <span class="archive-strip__label">Archived:</span>

    <div class="archive-strip__chips">
      {#each visible as session (session.id)}
        <div class="archive-chip" title={session.name}>
          <span class="archive-chip__icon">{session.type === 'terminal' ? '>_' : '💬'}</span>
          <span class="archive-chip__name">{truncate(session.name)}</span>
          <button
            type="button"
            class="archive-chip__btn archive-chip__btn--restore"
            onclick={() => onRestore(session.id)}
            title="Restore"
            aria-label="Restore {session.name}"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 12a9 9 0 1 0 3-6.7L3 8"/>
              <path d="M3 3v5h5"/>
            </svg>
          </button>
          <button
            type="button"
            class="archive-chip__btn archive-chip__btn--delete"
            onclick={() => onDelete(session)}
            title="Delete permanently"
            aria-label="Delete {session.name}"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 6h18"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6M14 11v6"/>
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
          </button>
        </div>
      {/each}
    </div>

    <button
      type="button"
      class="archive-strip__see-all"
      onclick={() => goto('/archive')}
      title="Open archive manager"
    >
      See all…
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M5 12h14"/>
        <path d="m13 6 6 6-6 6"/>
      </svg>
    </button>
  </div>
{/if}

<style>
  .archive-strip {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    border-top: 1px solid var(--border-light);
    background: var(--bg);
    flex-shrink: 0;
  }

  .archive-strip__label {
    color: var(--text-faint);
    font-size: 12px;
    font-weight: 600;
    flex-shrink: 0;
  }

  .archive-strip__chips {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .archive-strip__chips::-webkit-scrollbar { display: none; }

  .archive-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    border: 1px solid var(--border-light);
    border-radius: 8px;
    background: var(--bg-card);
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 500;
    flex-shrink: 0;
    transition: border-color 0.15s ease, background-color 0.15s ease;
  }

  .archive-chip:hover {
    border-color: var(--border-subtle);
    background: var(--bg-elevated, var(--bg-card));
  }

  .archive-chip__icon {
    font-family: var(--font-mono);
    font-size: 11px;
    color: #6366F1;
  }

  .archive-chip__name {
    color: var(--text);
    font-weight: 600;
    white-space: nowrap;
  }

  .archive-chip__btn {
    width: 22px;
    height: 22px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--text-faint);
    cursor: pointer;
    transition: background-color 0.15s ease, color 0.15s ease;
  }

  .archive-chip__btn--restore:hover {
    color: #10B981;
    background: rgba(16, 185, 129, 0.12);
  }

  .archive-chip__btn--delete:hover {
    color: #EF4444;
    background: rgba(239, 68, 68, 0.12);
  }

  .archive-strip__see-all {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 5px 10px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    flex-shrink: 0;
    transition: color 0.15s ease, background-color 0.15s ease;
  }

  .archive-strip__see-all:hover {
    color: #6366F1;
    background: rgba(99, 102, 241, 0.08);
  }
</style>
