<!--
  RoomDetailFocusPanel — shared focus-mode panel body. Extracted from
  rooms/[roomId]/+page.svelte so the identical block can render in BOTH
  the More-dropdown and the pinned right-rail. Owns the per-pull "pulling"
  state + DELETE call locally; parent only supplies the focused-members
  catalogue and the "open the Set focus modal" callback.
-->
<script lang="ts">
  import { exitFocusForMember, formatFocusWindow } from './roomDetailHelpers';
  import type { FocusEntry } from '$lib/server/focusModeStore';

  type Props = {
    roomId: string;
    focusedMembers: FocusEntry[];
    labelForMember: (handle: string) => string;
    onOpenFocusModal: () => void;
  };

  let {
    roomId,
    focusedMembers,
    labelForMember,
    onOpenFocusModal
  }: Props = $props();

  let exitingFocusHandle = $state<string | null>(null);

  async function exitFocus(memberHandle: string): Promise<void> {
    exitingFocusHandle = memberHandle;
    try {
      await exitFocusForMember(roomId, memberHandle);
    } finally {
      exitingFocusHandle = null;
    }
  }
</script>

<div class="focus-panel">
  {#if focusedMembers.length > 0}
    <ul class="focus-list" aria-label="Focused members">
      {#each focusedMembers as entry (entry.memberHandle)}
        <li class="focus-entry">
          <div>
            <strong>{labelForMember(entry.memberHandle)}</strong>
            <span>{formatFocusWindow(entry)}</span>
            {#if entry.reason}<p>{entry.reason}</p>{/if}
          </div>
          <button
            type="button"
            class="focus-secondary"
            disabled={exitingFocusHandle === entry.memberHandle}
            onclick={() => void exitFocus(entry.memberHandle)}
          >{exitingFocusHandle === entry.memberHandle ? 'Pulling…' : 'Pull out'}</button>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="focus-empty">No one is heads-down in this room.</p>
  {/if}

  <button type="button" class="focus-primary" onclick={onOpenFocusModal}>
    Set agent focus
  </button>
</div>

<style>
  .focus-panel {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .focus-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .focus-entry {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.7rem;
    border: 1px solid color-mix(in srgb, var(--accent) 22%, var(--line-soft));
    border-radius: 0.75rem;
    background: color-mix(in srgb, var(--accent) 7%, var(--surface-card));
  }
  .focus-entry strong {
    display: block;
    color: var(--ink-strong);
    font-size: 0.9rem;
  }
  .focus-entry span,
  .focus-empty {
    margin: 0;
    color: var(--ink-soft);
    font-size: 0.82rem;
  }
  .focus-entry p {
    margin: 0.25rem 0 0;
    color: var(--ink-strong);
    font-size: 0.85rem;
  }
  .focus-primary,
  .focus-secondary {
    border-radius: 999px;
    font: inherit;
    font-size: 0.82rem;
    font-weight: 800;
    cursor: pointer;
  }
  .focus-primary {
    align-self: flex-start;
    padding: 0.48rem 0.8rem;
    border: 1px solid var(--accent);
    background: var(--accent);
    color: white;
  }
  .focus-secondary {
    padding: 0.34rem 0.7rem;
    border: 1px solid var(--line-soft);
    background: var(--surface-raised);
    color: var(--ink-strong);
  }
  .focus-secondary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
