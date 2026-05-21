<!--
  RoomQuickNav — left-rail room hopper.

  Consumes the existing roomBookmarks store (which already persists
  to localStorage + syncs cross-device via /api/preferences/room-bookmarks)
  and renders each starred room as a navigable link. Currently-active
  room is highlighted.

  Layout: visible only on wide viewports (≥1100px). Below that the
  user gets the existing single-column mobile UX and the rail collapses
  out. Width fix step 1 (commit 28ff94f) raised the outer shell cap
  to 1680px which gave us the canvas to place this without crowding the
  chat column.

  Per JWPK msg_r2qkxstx6k: "the left hand panel is the starred and
  persistant room hopping" — keeps the rail purely navigational, no
  + Add room button, no recents tab. Tight + focused.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { roomBookmarks } from '$lib/stores/roomBookmarks.svelte';

  type Props = {
    currentRoomId: string;
    /** Display label per room id (passed in by the page since the
     *  bookmarks store only knows ids, not names). Missing entries
     *  fall back to the id itself. */
    roomLabels?: Map<string, string>;
  };

  let { currentRoomId, roomLabels = new Map() }: Props = $props();

  onMount(() => {
    roomBookmarks.init();
  });

  // JWPK msg_u2ca1h86a5: hide archived rooms from the rail entirely.
  // /api/chat-rooms returns active rooms only, so any starred id NOT in
  // roomLabels is either archived or deleted — silently omit it. Bookmark
  // store retains the id, so unarchiving the room makes it reappear here
  // on the next page load.
  const starredIds = $derived(
    roomBookmarks.ids.filter((id) => roomLabels.has(id))
  );

  function labelFor(roomId: string): string {
    return roomLabels.get(roomId) ?? roomId;
  }

  function isCurrent(roomId: string): boolean {
    return roomId === currentRoomId;
  }

  async function hopToRoom(roomId: string): Promise<void> {
    if (isCurrent(roomId)) return;
    await goto(`/rooms/${encodeURIComponent(roomId)}`);
  }
</script>

<aside class="room-quick-nav" aria-label="Starred rooms quick navigation">
  <h2 class="rail-heading">Starred</h2>
  {#if starredIds.length === 0}
    <p class="empty">
      No starred rooms yet. Star a room on the
      <a href="/rooms">rooms page</a> to pin it here.
    </p>
  {:else}
    <ul class="room-list">
      {#each starredIds as roomId (roomId)}
        <li>
          <button
            type="button"
            class="room-link"
            class:current={isCurrent(roomId)}
            aria-current={isCurrent(roomId) ? 'page' : undefined}
            onclick={() => void hopToRoom(roomId)}
          >
            <span class="star" aria-hidden="true">★</span>
            <span class="room-name">{labelFor(roomId)}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</aside>

<style>
  .room-quick-nav {
    position: sticky;
    top: 4.5rem;
    align-self: start;
    width: 16rem;
    max-height: calc(100vh - 6rem);
    overflow-y: auto;
    padding: 0.85rem 0.9rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.95rem;
    background: var(--surface-card);
    display: none;
  }

  /* Visible only when the shell + viewport have room to spare. The 28ff94f
     shell cap (1680px) means a 16rem rail can sit beside a ~1100px chat
     column on common 1440-1920 desktop widths without crowding. */
  @media (min-width: 1240px) {
    .room-quick-nav { display: block; }
  }

  .rail-heading {
    margin: 0 0 0.6rem;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-soft);
    font-weight: 800;
  }

  .empty {
    margin: 0;
    color: var(--ink-soft);
    font-size: 0.82rem;
    line-height: 1.4;
  }
  .empty a {
    color: var(--accent);
    text-decoration: none;
    font-weight: 700;
  }
  .empty a:hover { text-decoration: underline; }

  .room-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .room-link {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.4rem 0.55rem;
    border: 1px solid transparent;
    border-radius: 0.55rem;
    background: transparent;
    color: var(--ink-strong);
    font: inherit;
    font-size: 0.88rem;
    text-align: left;
    cursor: pointer;
  }
  .room-link:hover {
    border-color: var(--accent);
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
  .room-link.current {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    color: var(--accent);
    font-weight: 800;
  }
  .room-link:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .star {
    color: color-mix(in srgb, var(--accent) 80%, transparent);
    font-size: 0.9rem;
    flex: 0 0 auto;
  }

  .room-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
