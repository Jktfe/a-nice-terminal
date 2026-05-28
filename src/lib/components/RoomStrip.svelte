<!--
  RoomStrip — render a list of room cards.

  Each card shows: state dot, name, member avatar chips, summary, last-update.
  Per-card actions (bookmark + archive + delete) sit outside the link wrapper
  so they don't trigger navigation. A single ConfirmRoomActionModal is mounted
  once for the strip; the `pending` state discriminates archive vs delete.

  Rooms with isOpenable=true become clickable links to /rooms/[id]; the link
  wraps only the body, not the action buttons.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import type { RoomCard } from '$lib/domain/types';
  import { roomBookmarks } from '$lib/stores/roomBookmarks.svelte';
  import AvatarChip from './AvatarChip.svelte';
  import ConfirmRoomActionModal from './ConfirmRoomActionModal.svelte';
  import RoomDigestPanel from './RoomDigestPanel.svelte';
  import RoomCardActivity from './RoomCardActivity.svelte';
  import LastMessagePreview from './LastMessagePreview.svelte';
  import RoomPlanProgressBadge from './RoomPlanProgressBadge.svelte';

  export type OpenableRoomCard = RoomCard & { isOpenable?: boolean };

  type Props = {
    rooms: OpenableRoomCard[];
    // #155: when set, cards become draggable and the parent gets a
    // (fromIndex, toIndex) callback to commit the reorder. Used by the
    // dashboard's Starred section. Omitted on the rooms-index strip,
    // which keeps server-driven order.
    onReorder?: (fromIndex: number, toIndex: number) => void;
    // JWPK msg_m3h97n3noq: lift v3's dashboard grid/column view. Default
    // 'list' (current single-column behaviour byte-identical). When 'grid',
    // cards lay out in gridCols columns at desktop widths; mobile always
    // collapses to one column for readability.
    // 'list' = full cards stacked (default), 'grid' = N-column tile layout,
    // 'compact' = single-line rows for browsing 100+ rooms without scroll
    // pain (added 2026-05-24, JWPK msg_iozs65ulux scroll slice).
    view?: 'list' | 'grid' | 'compact';
    gridCols?: number;
  };

  let { rooms, onReorder, view = 'list', gridCols = 2 }: Props = $props();
  const isReorderable = $derived(typeof onReorder === 'function');
  const safeGridCols = $derived(Math.max(1, Math.min(5, gridCols)));
  let dragFromIndex = $state<number | null>(null);
  let dragOverIndex = $state<number | null>(null);

  onMount(() => { roomBookmarks.init(); });

  type PendingAction = { id: string; name: string; action: 'archive' | 'delete' };
  let pending = $state<PendingAction | null>(null);
  let digestRoomId = $state<string | null>(null);
  // Error feedback — surfaces non-ok DELETE/archive responses so the
  // user sees what went wrong (JWPK msg_athx11bshr 2026-05-28: "I click
  // delete and nothing seems to happen"). Cleared on next openConfirm.
  let actionError = $state<{ id: string; message: string } | null>(null);

  function openConfirm(room: OpenableRoomCard, action: PendingAction['action']) {
    pending = { id: room.id, name: room.name, action };
    actionError = null;
  }

  function closeConfirm() {
    pending = null;
  }

  async function confirmPending() {
    const target = pending;
    if (!target) return;
    const url = target.action === 'delete'
      ? `/api/chat-rooms/${target.id}`
      : `/api/chat-rooms/${target.id}/archive`;
    const method = target.action === 'delete' ? 'DELETE' : 'POST';
    try {
      const resp = await fetch(url, { method });
      if (resp.ok) {
        if (target.action === 'delete') {
          roomBookmarks.remove(target.id);
        }
        await invalidateAll();
        actionError = null;
      } else {
        // Surface the server's message inline on the card so the user
        // sees the cause. Common case is 401 when the browser session
        // cookie was minted in a different room than the one being
        // acted on — the server-side step-3b fallback added 2026-05-28
        // should now succeed for any member-of-room caller; if the user
        // still sees a 401 here, they are not actually a member.
        let message = `${target.action === 'delete' ? 'Delete' : 'Archive'} failed (${resp.status}).`;
        try {
          const body = await resp.json();
          if (body && typeof body.message === 'string') message = body.message;
        } catch {
          /* ignore body parse errors — keep the generic message */
        }
        actionError = { id: target.id, message };
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Network error.';
      actionError = { id: target.id, message };
    }
    pending = null;
  }
</script>

{#snippet body(room: OpenableRoomCard)}
  <div class={`state-dot ${room.attentionState}`} aria-hidden="true"></div>
  <div class="content">
    <div class="name-row">
      <h3>{room.name}</h3>
      <RoomPlanProgressBadge progress={room.planProgress} />
    </div>
    {#if room.members && room.members.length > 0}
      <div class="members" aria-label={`${room.members.length} ${room.members.length === 1 ? 'participant' : 'participants'}`}>
        {#each room.members.slice(0, 5) as member, index (member.handle)}
          <span class="member-slot" style:--member-index={index}>
            <AvatarChip handle={member.handle} displayName={member.displayName} size="sm" />
          </span>
        {/each}
        {#if room.members.length > 5}
          <span
            class="member-overflow"
            style:--member-index={5}
            title={room.members.slice(5).map((m) => m.displayName ?? m.handle).join(', ')}
          >+{room.members.length - 5}</span>
        {/if}
      </div>
    {/if}
    {#if room.description}
      <!-- JWPK 2026-05-24 yz4clwzvbm msg_jj50zw48fr: user/agent-authored
           description trumps the auto-summary on room cards when set.
           Falls back to LastMessagePreview when description is null. -->
      <p class="room-description" title={room.description}>{room.description}</p>
    {:else}
      <LastMessagePreview summary={room.summary} />
    {/if}
    <small class="card-meta">
      <RoomCardActivity roomId={room.id} />
      <span class="card-last-update">{room.lastUpdate}</span>
    </small>
  </div>
{/snippet}

<section
  class="room-strip"
  data-view={view}
  style:--grid-cols={safeGridCols}
  aria-label="Rooms needing attention"
>
  {#each rooms as room, index (room.id)}
    <article
      class="room-card"
      class:bookmarked={roomBookmarks.has(room.id)}
      class:reorderable={isReorderable}
      class:drop-target={dragOverIndex === index && dragFromIndex !== null && dragFromIndex !== index}
      draggable={isReorderable}
      ondragstart={(event) => {
        if (!isReorderable) return;
        dragFromIndex = index;
        event.dataTransfer?.setData('text/plain', String(index));
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      }}
      ondragover={(event) => {
        if (!isReorderable || dragFromIndex === null) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        if (dragOverIndex !== index) dragOverIndex = index;
      }}
      ondragleave={() => {
        if (dragOverIndex === index) dragOverIndex = null;
      }}
      ondrop={(event) => {
        if (!isReorderable || dragFromIndex === null) return;
        event.preventDefault();
        const from = dragFromIndex;
        const to = index;
        dragFromIndex = null;
        dragOverIndex = null;
        if (from !== to) onReorder?.(from, to);
      }}
      ondragend={() => {
        dragFromIndex = null;
        dragOverIndex = null;
      }}
    >
      {#if room.isOpenable}
        <!--
          `draggable="false"` is required because the outer card div sets
          `draggable={isReorderable}` for reorder gestures. Without it the
          browser routes ⌘-click / middle-click into the drag-start
          gesture instead of the link's open-in-new-tab — JWPK msg_5umkyxrxr4
          2026-05-26 reported having to right-click to open rooms in a
          new tab. Explicitly opting the link out of drag fixes the
          gesture conflict without breaking the parent's reorder UX.
        -->
        <a
          class="card-body card-body-link"
          href={`/rooms/${room.id}`}
          draggable="false"
        >
          {@render body(room)}
        </a>
      {:else}
        <div class="card-body">
          {@render body(room)}
        </div>
      {/if}
      <div class="actions" aria-label="Room actions">
        <button
          type="button"
          class="action-btn digest"
          title="Open room digest"
          aria-label={`Show digest for "${room.name}"`}
          onclick={() => (digestRoomId = room.id)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16">
            <path d="M5 4h11l3 3v13a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1zM9 11h8M9 14h8M9 17h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <button
          type="button"
          class="action-btn bookmark"
          class:active={roomBookmarks.has(room.id)}
          aria-pressed={roomBookmarks.has(room.id)}
          title={roomBookmarks.has(room.id) ? 'Remove bookmark' : 'Bookmark this room'}
          aria-label={roomBookmarks.has(room.id) ? 'Remove bookmark' : 'Bookmark this room'}
          onclick={() => roomBookmarks.toggle(room.id)}
        >
          {roomBookmarks.has(room.id) ? '★' : '☆'}
        </button>
        <button
          type="button"
          class="action-btn archive"
          title="Archive room"
          aria-label={`Archive room "${room.name}"`}
          onclick={() => openConfirm(room, 'archive')}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16">
            <path d="M3 5h18v4H3zM5 9v10a1 1 0 001 1h12a1 1 0 001-1V9M10 13h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <button
          type="button"
          class="action-btn delete"
          title="Delete room"
          aria-label={`Delete room "${room.name}"`}
          onclick={() => openConfirm(room, 'delete')}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16">
            <path d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M8 7l1 13a1 1 0 001 1h4a1 1 0 001-1l1-13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
      {#if actionError && actionError.id === room.id}
        <p class="action-error" role="alert">
          {actionError.message}
          <button type="button" class="action-error-dismiss" onclick={() => (actionError = null)} aria-label="Dismiss error">×</button>
        </p>
      {/if}
    </article>
  {/each}
</section>

<ConfirmRoomActionModal
  open={pending !== null}
  action={pending?.action ?? 'delete'}
  roomName={pending?.name ?? ''}
  onCancel={closeConfirm}
  onConfirm={confirmPending}
/>

{#if digestRoomId}
  <RoomDigestPanel roomId={digestRoomId} onClose={() => (digestRoomId = null)} />
{/if}

<style>
  .room-strip {
    display: grid;
    gap: 0.75rem;
  }

  /* Dashboard grid view (JWPK msg_m3h97n3noq, v3 lift of useGridStore +
     DashboardHeader): when data-view="grid", lay cards out in N columns
     at desktop widths. --grid-cols is the parent-driven choice. Mobile
     (<720px) always collapses to one column regardless so cards stay
     readable; medium viewports tighten to half of the requested cols. */
  .room-strip[data-view='grid'] {
    grid-template-columns: repeat(var(--grid-cols, 2), minmax(0, 1fr));
    align-items: start;
  }
  @media (max-width: 1100px) {
    .room-strip[data-view='grid'] {
      grid-template-columns: repeat(min(var(--grid-cols, 2), 2), minmax(0, 1fr));
    }
  }
  @media (max-width: 720px) {
    .room-strip[data-view='grid'] {
      grid-template-columns: 1fr;
    }
  }

  /* Compact density view (JWPK msg_iozs65ulux 2026-05-24 scroll slice):
     single-line rows for browsing 100+ rooms. Members + summary collapse
     to ellipses; activity + last-update sit on the same line as the name.
     Tighter vertical rhythm so ~25 rooms fit in a desktop viewport vs
     the ~5-6 you get in list view. */
  .room-strip[data-view='compact'] {
    gap: 0.2rem;
  }
  .room-strip[data-view='compact'] .room-card {
    padding: 0.35rem 0.7rem;
    gap: 0.55rem;
  }
  .room-strip[data-view='compact'] .card-body {
    padding: 0;
  }
  .room-strip[data-view='compact'] .content {
    display: grid;
    grid-template-columns: minmax(8rem, 0.5fr) minmax(0, 1.2fr) minmax(6rem, max-content);
    gap: 0.7rem;
    align-items: center;
    min-width: 0;
  }
  .room-strip[data-view='compact'] .content > :global(h3) {
    margin: 0;
    font-size: 0.92rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .room-strip[data-view='compact'] .content > :global(.members),
  .room-strip[data-view='compact'] .content > :global(.last-message-preview) {
    margin: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 0.78rem;
  }
  .room-strip[data-view='compact'] .content > :global(.members) {
    display: none; /* avatars are noise in compact mode */
  }
  .room-strip[data-view='compact'] .content > :global(.card-meta) {
    margin: 0;
    font-size: 0.72rem;
    justify-self: end;
    text-align: right;
  }

  .room-card {
    display: flex;
    align-items: flex-start;
    gap: 0.8rem;
    padding: 1rem;
    border: 1px solid var(--line-soft);
    border-radius: 1rem;
    background: var(--surface-card);
    transition: border-color 0.12s, transform 0.12s;
  }

  .room-card.bookmarked {
    border-color: color-mix(in srgb, var(--accent) 38%, var(--line-soft));
  }

  /* #155 — drag affordance + active-drop visual */
  .room-card.reorderable {
    cursor: grab;
  }
  .room-card.reorderable:active {
    cursor: grabbing;
  }
  .room-card.drop-target {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent);
  }

  .card-body {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.8rem;
    flex: 1 1 auto;
    min-width: 0;
  }

  .card-body-link {
    text-decoration: none;
    color: inherit;
  }

  .card-body-link:hover {
    transform: translateY(-1px);
  }

  .card-body-link:hover h3 {
    color: var(--accent);
  }

  .name-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .name-row h3 { margin: 0; }
  .state-dot {
    width: 0.85rem;
    height: 0.85rem;
    margin-top: 0.2rem;
    border-radius: 999px;
    background: var(--ink-muted);
  }

  .state-dot.ready {
    background: var(--ok);
  }

  .state-dot.working {
    background: var(--accent);
  }

  .state-dot.asking {
    background: var(--info);
  }

  .state-dot.blocked,
  .state-dot.stale {
    background: var(--warn);
  }

  .content {
    min-width: 0;
  }

  h3 {
    margin: 0;
    font-size: 1rem;
    transition: color 0.12s;
  }

  .members {
    display: flex;
    align-items: center;
    margin-top: 0.4rem;
    /* Avatar stack — each slot overlaps the previous by ~0.55rem so
       the cards feel personal even at 5 participants. Z-index stacks
       so the leftmost avatar sits on top, which keeps the visual
       order matching the .members iteration order. */
  }
  .member-slot {
    display: inline-flex;
    margin-left: calc(var(--member-index) * -0.55rem);
    z-index: calc(10 - var(--member-index));
    border: 2px solid var(--surface-card);
    border-radius: 999px;
    line-height: 0;
    transition: transform 0.12s;
  }
  .member-slot:first-child { margin-left: 0; }
  .room-card:hover .member-slot { transform: translateY(-1px); }
  .member-overflow {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    height: 1.5rem;
    margin-left: calc(var(--member-index) * -0.55rem);
    z-index: calc(10 - var(--member-index));
    border: 2px solid var(--surface-card);
    border-radius: 999px;
    background: var(--bg);
    color: var(--ink-soft);
    font-size: 0.65rem;
    font-weight: 800;
    user-select: none;
  }

  /* #134: last-message preview rendered by LastMessagePreview.svelte */
  .room-description {
    margin: 0.3rem 0 0;
    color: var(--ink-soft);
    font-size: 0.82rem;
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  small {
    display: block;
    margin-top: 0.45rem;
    color: var(--ink-muted);
    font-weight: 700;
  }
  .card-meta {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    flex-wrap: wrap;
  }
  .card-last-update {
    color: var(--ink-soft);
    font-weight: 600;
  }

  .actions {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    flex: 0 0 auto;
  }

  .action-btn {
    width: 2rem;
    height: 2rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 1px solid var(--line-soft);
    border-radius: 999px;
    background: var(--surface-card);
    color: var(--ink-strong);
    font-size: 1rem;
    line-height: 1;
    cursor: pointer;
    transition: border-color 0.12s, background-color 0.12s, color 0.12s;
  }
  /* Mobile polish: bump action buttons to the 44px Apple HIG / 48dp
     Material touch-target minimum on coarse pointers so the room card
     icons (digest / bookmark / archive / delete) are actually tappable
     on iOS + Android. Desktop with a fine pointer keeps the compact
     32px footprint so the cards stay scannable. */
  @media (pointer: coarse) {
    .action-btn {
      width: 2.75rem;
      height: 2.75rem;
      font-size: 1.1rem;
    }
  }

  .action-btn:hover {
    border-color: var(--accent);
  }

  .action-btn.bookmark.active {
    color: #f5b400;
    border-color: #f5b400;
  }

  .action-btn.archive:hover {
    color: var(--accent);
  }

  .action-btn.delete:hover {
    color: var(--warn, #c92020);
    border-color: var(--warn, #c92020);
  }
  /* JWPK msg_athx11bshr 2026-05-28: surface delete/archive failures
     instead of silently dismissing the confirm dialog. Inline on the
     card so the user sees which room and what the server said. */
  .action-error {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0.4rem 0.6rem;
    padding: 0.35rem 0.55rem;
    font-size: 0.78rem;
    color: var(--warn, #c92020);
    background: color-mix(in srgb, var(--warn, #c92020) 8%, transparent);
    border: 1px solid color-mix(in srgb, var(--warn, #c92020) 30%, transparent);
    border-radius: 0.4rem;
  }
  .action-error-dismiss {
    margin-left: auto;
    width: 1.2rem;
    height: 1.2rem;
    border: none;
    background: transparent;
    color: var(--warn, #c92020);
    font-size: 1rem;
    line-height: 1;
    cursor: pointer;
    border-radius: 0.2rem;
  }
  .action-error-dismiss:hover {
    background: color-mix(in srgb, var(--warn, #c92020) 18%, transparent);
  }
</style>
