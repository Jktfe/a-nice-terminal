<!--
  RoomNameHeader — single room-name card per D1.6-T1b reshape (JWPK D2.7).
  Replaces the SimplePageShell eyebrow/title/summary hero for the room
  view. Holds: room-name h1, "started by" subtitle, inline edit-name
  toggle, and a `menu` snippet slot for the RoomMenuDropdown that lives
  on the same card.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import RenameRoomHeaderForm from './RenameRoomHeaderForm.svelte';

  type Props = {
    roomId: string;
    roomName: string;
    startedBy: string;
    lastUpdate: string;
    menu?: Snippet;
    contractId?: string | null;
  };

  let { roomId, roomName, menu, contractId }: Props = $props();

  let showRenameForm = $state(false);
</script>

<section class="room-name-header" aria-labelledby="roomNameHeading">
  {#if contractId}
    <span class="contract-badge" title="Bound to contract: {contractId}">📜 {contractId}</span>
  {/if}
  <div class="title-row">
    <button
      type="button"
      class="edit-toggle"
      aria-label={showRenameForm ? 'Close rename form' : 'Rename room'}
      onclick={() => (showRenameForm = !showRenameForm)}
    >
      {showRenameForm ? '×' : '✎'}
    </button>
    <h1 id="roomNameHeading">{roomName}</h1>
    {@render menu?.()}
  </div>
  {#if showRenameForm}
    <div class="rename-slot">
      <RenameRoomHeaderForm {roomId} currentName={roomName} />
    </div>
  {/if}
</section>

<style>
  /* Task #70: float the room card under the global header so More /
     room actions stay reachable while scrolling. Sticks just under the
     SimplePageShell sticky nav (top: 0.65rem, height ~3.25rem). */
  .room-name-header {
    position: sticky;
    top: 4rem;
    z-index: 25;
    margin: 0.35rem 0 0.75rem;
    padding: 0.55rem 0.75rem;
    border-radius: 0.85rem;
    background: var(--surface-card);
    box-shadow: var(--shadow-card);
    backdrop-filter: blur(8px);
  }
  .title-row {
    display: flex;
    align-items: center;
    gap: 0.45rem;
  }
  h1 {
    margin: 0;
    font-size: clamp(1.15rem, 2.6vw, 1.65rem);
    line-height: 1.05;
    color: var(--ink-strong);
  }
  .edit-toggle {
    /* JWPK msg_jl2341y5r1 screenshot annotation: pencil moved from the
       right of the room title to the left so the room-name h1 is the
       focal element. Menu dropdown still floats to the trailing edge
       via its own margin-left:auto inside RoomMenuDropdown. */
    flex: 0 0 auto;
    width: 1.85rem;
    height: 1.85rem;
    border: 1px solid var(--line-soft);
    border-radius: 999px;
    background: var(--bg);
    color: var(--ink-strong);
    font-size: 1.1rem;
    cursor: pointer;
  }
  .edit-toggle:hover { border-color: var(--accent); color: var(--accent); }
  /* The menu snippet ({@render menu()}) follows the h1 in source order;
     push it to the trailing edge to preserve the existing layout where
     'More ▾' lives on the right of the title row. */
  .title-row :global(.room-menu-dropdown) {
    margin-left: auto;
  }
  .rename-slot { margin-top: 0.55rem; }
  .contract-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.15rem 0.5rem;
    background: var(--surface-card);
    border: 1px solid var(--accent);
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--accent);
    margin-bottom: 0.4rem;
  }
</style>
