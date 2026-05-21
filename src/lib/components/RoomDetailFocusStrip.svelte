<!--
  RoomDetailFocusStrip — the inline strip rendered above MessageList
  whenever one or more members are in focus mode. Extracted from
  rooms/[roomId]/+page.svelte so the route stays under the 600-line cap.
  Zero behaviour / DOM / style change vs the inline original.
-->
<script lang="ts">
  import type { FocusEntry } from '$lib/server/focusModeStore';

  type Props = {
    focusedMembers: FocusEntry[];
    labelForMember: (handle: string) => string;
  };

  let { focusedMembers, labelForMember }: Props = $props();
</script>

{#if focusedMembers.length > 0}
  <section class="focus-strip" aria-label="Active focus mode">
    <span class="focus-dot" aria-hidden="true"></span>
    <strong>{focusedMembers.length === 1 ? 'Focus mode' : 'Focus modes'}</strong>
    <span>{focusedMembers.map((entry) => labelForMember(entry.memberHandle)).join(', ')}</span>
  </section>
{/if}

<style>
  .focus-strip {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0.6rem 0 0.7rem;
    padding: 0.55rem 0.75rem;
    border: 1px solid color-mix(in srgb, var(--accent) 22%, var(--line-soft));
    border-radius: 0.75rem;
    background: color-mix(in srgb, var(--accent) 7%, var(--surface-card));
    color: var(--ink-strong);
    font-size: 0.86rem;
  }
  .focus-strip span:last-of-type {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ink-soft);
  }
  .focus-dot {
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 999px;
    background: var(--accent);
    box-shadow: 0 0 0 0.25rem color-mix(in srgb, var(--accent) 15%, transparent);
    flex: 0 0 auto;
  }
</style>
