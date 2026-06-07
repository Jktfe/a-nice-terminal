<!--
  RoomDetailLeftPane — left rail wrapper for rooms/[roomId]. Holds the
  RoomQuickNav (when expanded) plus the per-rail collapse toggle button.
  Extracted from +page.svelte so the route stays under the 600-line cap.
  Zero behaviour / DOM / style change vs the inline original.
-->
<script lang="ts">
  import RoomQuickNav from './RoomQuickNav.svelte';

  type Props = {
    roomId: string;
    roomLabels: Record<string, string>;
    leftPaneCollapsed: boolean;
    onToggleLeftPane: () => void;
  };

  let { roomId, roomLabels, leftPaneCollapsed, onToggleLeftPane }: Props = $props();
</script>

<div class="left-pane">
  {#if !leftPaneCollapsed}
    <RoomQuickNav
      currentRoomId={roomId}
      roomLabels={new Map(Object.entries(roomLabels))}
    />
  {/if}
  <button
    type="button"
    class="pane-toggle pane-toggle-left"
    aria-label={leftPaneCollapsed ? 'Expand left pane (press [)' : 'Collapse left pane (press [)'}
    aria-expanded={!leftPaneCollapsed}
    title={leftPaneCollapsed ? 'Expand · [' : 'Collapse · ['}
    onclick={onToggleLeftPane}
  >
    <svg viewBox="0 0 12 24" aria-hidden="true">
      {#if leftPaneCollapsed}
        <path d="M3 4 L9 12 L3 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      {:else}
        <path d="M9 4 L3 12 L9 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      {/if}
    </svg>
  </button>
</div>

<style>
  /* Left pane wraps RoomQuickNav + its toggle button. Toggle is always
     visible (even when collapsed — the only way to expand back). */
  .left-pane {
    position: sticky;
    top: 4.5rem;
    align-self: start;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }
  .pane-toggle {
    align-self: flex-end;
    width: 1.4rem;
    height: 2.2rem;
    padding: 0;
    background: var(--surface-card);
    border: 1px solid var(--line-soft);
    border-radius: 0.45rem;
    color: var(--ink-soft);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: background 120ms ease, color 120ms ease;
  }
  .pane-toggle:hover {
    background: color-mix(in srgb, var(--accent, #6b21a8) 8%, var(--surface-card));
    color: var(--ink-strong);
  }
  .pane-toggle svg {
    width: 0.7rem;
    height: 1.2rem;
    display: block;
  }

  @media (max-width: 1239px) {
    /* Below the 3-col breakpoint the panes stack — hide collapse UX. */
    .pane-toggle { display: none; }
  }

  @media (max-width: 768px) {
    .left-pane { display: none; }
  }
</style>
