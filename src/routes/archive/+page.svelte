<!--
  /archive — recoverable rooms surface (v3 parity, JWPK ask).

  Two sections:
    1. Archived rooms — soft-archived (archived_at_ms set). Restorable via
       DELETE /api/chat-rooms/:id/archive. Card has a Restore button.
    2. Deleted rooms — soft-deleted (deleted_at_ms set). Server-side
       restore not implemented yet, so cards render read-only with a
       clear note pointing operators at the open backlog.
-->
<script lang="ts">
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import { invalidateAll } from '$app/navigation';
  import type { PageData } from './$types';
  import type { RecoverableRoomCard } from './+page';

  let { data }: { data: PageData } = $props();

  let busyId = $state<string | null>(null);
  let lastErrorMessage = $state('');

  async function restore(room: RecoverableRoomCard) {
    busyId = room.id;
    lastErrorMessage = '';
    try {
      const response = await fetch(`/api/chat-rooms/${encodeURIComponent(room.id)}/archive`, {
        method: 'DELETE'
      });
      if (!response.ok) {
        throw new Error(`Restore failed (${response.status}).`);
      }
      await invalidateAll();
    } catch (cause) {
      lastErrorMessage = cause instanceof Error ? cause.message : 'Restore failed.';
    } finally {
      busyId = null;
    }
  }

  function formatTimestamp(ms: number | null): string {
    if (!ms) return '—';
    return new Date(ms).toLocaleString();
  }
</script>

<svelte:head><title>Archive | ANT vNext</title></svelte:head>

<SimplePageShell
  eyebrow="Recovery"
  title="Archive."
  summary="Restore archived rooms or audit soft-deleted ones."
>
  <a class="back" href="/rooms">← Rooms</a>

  {#if data.serverFailed}
    <p class="server-error" role="alert">Could not load the archive list — server returned an error.</p>
  {/if}

  {#if lastErrorMessage}
    <p class="server-error" role="alert">{lastErrorMessage}</p>
  {/if}

  <section aria-labelledby="archivedHeading">
    <header class="section-header">
      <h2 id="archivedHeading">Archived ({data.archivedRooms.length})</h2>
      <p class="section-summary">Rooms you've archived. Restoring brings them back to your active list.</p>
    </header>
    {#if data.archivedRooms.length === 0}
      <p class="empty-nudge">No archived rooms.</p>
    {:else}
      <ul class="archive-list">
        {#each data.archivedRooms as room (room.id)}
          <li class="archive-row">
            <div class="archive-row-text">
              <span class="archive-row-name">{room.name}</span>
              <span class="archive-row-meta">
                archived {formatTimestamp(room.archivedAtMs)} · last update {room.lastUpdate}
              </span>
              {#if room.summary}
                <span class="archive-row-summary">{room.summary}</span>
              {/if}
            </div>
            <button
              type="button"
              class="restore-btn"
              disabled={busyId === room.id}
              onclick={() => restore(room)}
            >
              {busyId === room.id ? 'Restoring…' : 'Restore'}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section aria-labelledby="deletedHeading">
    <header class="section-header">
      <h2 id="deletedHeading">Soft-deleted ({data.deletedRooms.length})</h2>
      <p class="section-summary">
        Server-side undelete is not yet implemented — these rows are listed for audit only.
      </p>
    </header>
    {#if data.deletedRooms.length === 0}
      <p class="empty-nudge">No soft-deleted rooms.</p>
    {:else}
      <ul class="archive-list">
        {#each data.deletedRooms as room (room.id)}
          <li class="archive-row archive-row-readonly">
            <div class="archive-row-text">
              <span class="archive-row-name">{room.name}</span>
              <span class="archive-row-meta">
                deleted {formatTimestamp(room.deletedAtMs)} · last update {room.lastUpdate}
              </span>
              {#if room.summary}
                <span class="archive-row-summary">{room.summary}</span>
              {/if}
            </div>
            <span class="restore-disabled" aria-disabled="true" title="Undelete is not implemented yet">
              read-only
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</SimplePageShell>

<style>
  .back {
    display: inline-block;
    margin-bottom: 0.85rem;
    color: var(--ink-soft);
    text-decoration: none;
    font-weight: 700;
    font-size: 0.85rem;
  }
  .back:hover { color: var(--accent); }
  .server-error {
    margin: 0 0 0.85rem;
    padding: 0.85rem 1rem;
    border: 1px solid var(--warn);
    border-radius: 0.85rem;
    background: color-mix(in srgb, var(--warn) 18%, var(--surface-card));
    color: var(--ink-strong);
    font-weight: 800;
  }
  .section-header { margin: 1.25rem 0 0.85rem; }
  .section-header h2 { margin: 0; font-size: 1rem; font-weight: 800; color: var(--ink-strong); }
  .section-summary { margin: 0.25rem 0 0; color: var(--ink-soft); font-size: 0.85rem; }
  .empty-nudge {
    margin: 0;
    padding: 0.85rem 1rem;
    border: 1px dashed var(--surface-edge);
    border-radius: 0.85rem;
    background: var(--bg);
    color: var(--ink-soft);
  }
  .archive-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.55rem; }
  .archive-row {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.85rem 1rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.85rem;
    background: var(--surface-card);
  }
  .archive-row-readonly { opacity: 0.85; }
  .archive-row-text {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.18rem;
  }
  .archive-row-name { font-weight: 800; color: var(--ink-strong); }
  .archive-row-meta { font-size: 0.78rem; color: var(--ink-soft); }
  .archive-row-summary {
    font-size: 0.85rem;
    color: var(--ink-soft);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .restore-btn {
    flex-shrink: 0;
    padding: 0.5rem 1rem;
    border: 1px solid var(--accent);
    border-radius: 999px;
    background: var(--accent);
    color: white;
    font: inherit;
    font-weight: 800;
    cursor: pointer;
    transition: filter 0.12s;
  }
  .restore-btn:hover:not(:disabled) { filter: brightness(1.06); }
  .restore-btn:disabled { opacity: 0.6; cursor: wait; }
  .restore-disabled {
    flex-shrink: 0;
    padding: 0.45rem 0.85rem;
    border: 1px dashed var(--surface-edge);
    border-radius: 999px;
    color: var(--ink-soft);
    font-size: 0.78rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
</style>
