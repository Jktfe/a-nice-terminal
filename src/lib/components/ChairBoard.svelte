<!--
  ChairBoard — the chair's board of room digests.
  Backs M29 chair session-tracker slice 1.

  Renders a freshness header (when the board was last refreshed) and a
  list of ChairRow cards. Empty state nudges to create a room.
-->
<script lang="ts">
  import type { ChairRowDigest } from '$lib/server/chairStore';
  import ChairRow from './ChairRow.svelte';

  type Props = {
    digestRows: ChairRowDigest[];
    refreshedAt: string;
    onRefreshRequested?: () => void;
  };

  let { digestRows, refreshedAt, onRefreshRequested }: Props = $props();

  function describeMomentFromIso(isoTimestamp: string): string {
    try {
      return new Date(isoTimestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch {
      return '';
    }
  }
</script>

<section class="chair-board" aria-label="Chair digest board">
  <header class="chair-header">
    <div>
      <span class="header-eyebrow">Chair</span>
      <h2 class="header-title">Rooms at a glance</h2>
    </div>
    <div class="header-actions">
      <span class="refreshed-at">refreshed at {describeMomentFromIso(refreshedAt)}</span>
      <button type="button" onclick={onRefreshRequested} disabled={!onRefreshRequested}>
        Refresh
      </button>
    </div>
  </header>

  {#if digestRows.length === 0}
    <p class="empty-state">
      No rooms yet. Create one from the rooms page and the chair will start tracking it.
    </p>
  {:else}
    <div class="row-grid">
      {#each digestRows as row (row.roomId)}
        <ChairRow digest={row} />
      {/each}
    </div>
  {/if}
</section>

<style>
  .chair-board {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }

  .chair-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 0.6rem;
  }

  .header-eyebrow {
    display: block;
    font-size: 0.7rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--ink-soft);
  }

  .header-title {
    margin: 0;
    font-size: 1.4rem;
    font-weight: 800;
    color: var(--ink-strong);
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  .refreshed-at {
    font-size: 0.78rem;
    color: var(--ink-soft);
    font-variant-numeric: tabular-nums;
  }

  button {
    padding: 0.45rem 0.85rem;
    font-weight: 700;
    font-size: 0.85rem;
    background: var(--surface);
    border: 1px solid var(--surface-edge);
    border-radius: 999px;
    color: var(--ink-strong);
    cursor: pointer;
  }

  button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .empty-state {
    margin: 0;
    padding: 1.4rem 1rem;
    text-align: center;
    border: 1px dashed var(--surface-edge);
    border-radius: 1rem;
    color: var(--ink-soft);
  }

  .row-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 0.85rem;
  }
</style>
