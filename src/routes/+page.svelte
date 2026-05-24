<!--
  Root / — Dashboard overview surface (PATH-IA-B per
  dashboard-ia-design-contract-2026-05-14). Replaces the prior
  "Rooms.-as-home" page per JWPK D1.x feedback.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import DashboardSection from '$lib/components/DashboardSection.svelte';
  import RoomStrip from '$lib/components/RoomStrip.svelte';
  import { roomBookmarks, sortByBookmark } from '$lib/stores/roomBookmarks.svelte';
  import type { RoomCard } from '$lib/domain/types';
  import type { Ask } from '$lib/server/askStore';

  type Props = {
    data: {
      chatRoomsFromServer: RoomCard[];
      asksFromServer: Ask[];
      serverRoomListFailed: boolean;
    };
  };

  let { data }: Props = $props();

  // Dashboard list/grid toggle — JWPK v3-lift. RoomStrip already supports
  // view='list'|'grid' + gridCols; this just wires the selector + persists
  // the choice in localStorage so each operator's preferred density sticks.
  const DASH_VIEW_KEY = 'ant.dashboard.view.v1';
  let dashView = $state<'list' | 'grid'>('list');

  onMount(() => {
    roomBookmarks.init();
    try {
      const stored = window.localStorage.getItem(DASH_VIEW_KEY);
      if (stored === 'grid' || stored === 'list') dashView = stored;
    } catch { /* localStorage blocked / private mode — stay on default */ }
  });

  function setDashView(next: 'list' | 'grid') {
    dashView = next;
    try { window.localStorage.setItem(DASH_VIEW_KEY, next); } catch { /* no-op */ }
  }

  const TOP_N = 5;

  // #155: dashboard now has TWO room strips — a "Starred" section that
  // shows every pinned room (no slice) in user-defined drag order, and
  // a "Recent" section showing top-N rooms that aren't starred. The
  // bookmark ids array IS the display order — sortByBookmark honours
  // it — and drag commits via roomBookmarks.move().
  const allOpenable = $derived(
    data.chatRoomsFromServer.map((room) => ({ ...room, isOpenable: true }))
  );
  const starredRooms = $derived(
    sortByBookmark(allOpenable, roomBookmarks.ids).slice(0, roomBookmarks.ids.length)
  );
  const recentRooms = $derived(
    allOpenable.filter((room) => !roomBookmarks.has(room.id)).slice(0, TOP_N)
  );
  const openAsks = $derived(
    data.asksFromServer.filter((ask) => ask.status === 'open').slice(0, TOP_N)
  );
</script>

<svelte:head>
  <title>Dashboard | ANT vNext</title>
</svelte:head>

{#snippet livePill()}
  <!-- Static "Live" v1; a real health probe is a later no-auto-boot
       slice (SURFACE-SIZE-ONLY). -->
  <span class="status-pill" data-state="live" aria-label="Server status: live">
    <span class="dot" aria-hidden="true"></span>Live
  </span>
{/snippet}

<SimplePageShell
  eyebrow="Overview"
  title="Dashboard."
  summary="Recent rooms, open asks, and quick links to the deep surfaces."
  statusPill={livePill}
>
  {#if data.serverRoomListFailed}
    <p class="server-error" role="alert">Server rooms could not load.</p>
  {/if}

  <DashboardSection title="Open asks" eyebrow="Awaiting decisions" viewAllHref="/asks">
    {#if openAsks.length === 0}
      <div class="empty-celebrate" role="status" aria-label="No open asks">
        <span class="celebrate-icon" aria-hidden="true">✓</span>
        <div class="celebrate-text">
          <strong>No open asks.</strong>
          <span class="celebrate-detail">New decisions surface here automatically when a member opens one in a room.</span>
        </div>
      </div>
    {:else}
      <ul class="asks-list">
        {#each openAsks as ask}
          <li>
            <a href="/asks">
              <strong>{ask.title}</strong>
              <small>opened by {ask.openedByDisplayName}</small>
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </DashboardSection>

  {#if starredRooms.length + recentRooms.length > 0}
    <div class="dash-view-toggle" role="group" aria-label="Dashboard layout">
      <button
        type="button"
        class:active={dashView === 'list'}
        onclick={() => setDashView('list')}
        aria-pressed={dashView === 'list'}
        title="List view — one card per row"
      >☰ List</button>
      <button
        type="button"
        class:active={dashView === 'grid'}
        onclick={() => setDashView('grid')}
        aria-pressed={dashView === 'grid'}
        title="Grid view — two cards per row"
      >▦ Grid</button>
    </div>
  {/if}

  {#if starredRooms.length > 0}
    <DashboardSection title="Starred rooms" eyebrow="Pinned" viewAllHref="/rooms">
      <RoomStrip
        rooms={starredRooms}
        onReorder={(fromIndex, toIndex) =>
          roomBookmarks.moveByVisibleId(
            starredRooms[fromIndex].id,
            toIndex,
            starredRooms.map((room) => room.id)
          )
        }
        view={dashView}
        gridCols={2}
      />
    </DashboardSection>
  {/if}

  <DashboardSection title="Recent rooms" eyebrow="Live" viewAllHref="/rooms">
    {#if recentRooms.length === 0 && starredRooms.length === 0}
      <p class="empty-nudge">No rooms yet. <a href="/rooms">Create one</a> or use the <code>ant invite</code> CLI flow.</p>
    {:else if recentRooms.length === 0}
      <div class="empty-celebrate" role="status" aria-label="All rooms are starred">
        <span class="celebrate-icon celebrate-icon-star" aria-hidden="true">★</span>
        <div class="celebrate-text">
          <strong>Every room is starred.</strong>
          <span class="celebrate-detail">New unstarred rooms will appear here once they're created.</span>
        </div>
      </div>
    {:else}
      <RoomStrip rooms={recentRooms} view={dashView} gridCols={2} />
    {/if}
  </DashboardSection>
</SimplePageShell>

<style>
  .server-error {
    margin: 0 0 0.85rem;
    padding: 0.85rem 1rem;
    border: 1px solid var(--warn);
    border-radius: 0.85rem;
    color: var(--ink-strong);
    background: color-mix(in srgb, var(--warn) 18%, var(--surface-card));
    font-weight: 800;
  }
  .empty-nudge {
    margin: 0;
    padding: 0.75rem 0.95rem;
    border: 1px dashed var(--surface-edge);
    border-radius: 0.85rem;
    background: var(--bg);
    color: var(--ink-strong);
    line-height: 1.5;
  }
  /* Celebrate empty-states — pair an icon pill with reassuring copy
     for "no open asks" + "every room is starred". Uses --ok for the
     check version and --accent for the star version so the tone
     varies but the layout stays consistent across surfaces. */
  .empty-celebrate {
    display: flex;
    align-items: center;
    gap: 0.95rem;
    padding: 0.9rem 1rem;
    border-radius: 0.85rem;
    border: 1px solid color-mix(in srgb, var(--ok) 35%, var(--line-soft));
    background: color-mix(in srgb, var(--ok) 12%, var(--surface-card));
  }
  .celebrate-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border-radius: 999px;
    background: var(--ok);
    color: white;
    font-weight: 900;
    flex-shrink: 0;
  }
  .celebrate-icon-star {
    background: var(--accent);
  }
  .empty-celebrate:has(.celebrate-icon-star) {
    border-color: color-mix(in srgb, var(--accent) 35%, var(--line-soft));
    background: color-mix(in srgb, var(--accent) 12%, var(--surface-card));
  }
  .celebrate-text { display: flex; flex-direction: column; gap: 0.2rem; color: var(--ink-strong); }
  .celebrate-text strong { font-size: 0.98rem; }
  /* Dashboard list/grid toggle (JWPK v3-lift). Sits between Open asks
     and the room strips — small + monochrome so it doesn't compete with
     section headers; active state borrows the accent so the current
     view is unambiguous at a glance. */
  .dash-view-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0;
    margin: 0.3rem 0 -0.2rem;
    border: 1px solid var(--line-soft);
    border-radius: 999px;
    overflow: hidden;
    background: var(--surface-card);
  }
  .dash-view-toggle button {
    appearance: none;
    border: none;
    background: transparent;
    color: var(--ink-soft);
    font: inherit;
    font-size: 0.82rem;
    font-weight: 700;
    padding: 0.4rem 0.9rem;
    cursor: pointer;
    line-height: 1;
  }
  .dash-view-toggle button + button { border-left: 1px solid var(--line-soft); }
  .dash-view-toggle button:hover { color: var(--ink-strong); }
  .dash-view-toggle button.active {
    background: var(--accent);
    color: white;
  }
  .celebrate-detail { color: var(--ink-soft); font-size: 0.85rem; line-height: 1.4; }
  .empty-nudge code {
    font-family: ui-monospace, monospace;
    font-size: 0.85rem;
    padding: 0.05rem 0.35rem;
    background: var(--surface);
    border-radius: 0.3rem;
  }
  .asks-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.55rem; }
  .asks-list a {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding: 0.85rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.85rem;
    background: var(--bg);
    color: var(--ink-strong);
    text-decoration: none;
  }
  .asks-list small { color: var(--ink-soft); font-weight: 700; }

  .status-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.3rem 0.7rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--ok) 16%, var(--surface-card));
    color: var(--ink-strong);
    font-weight: 800;
    font-size: 0.82rem;
  }
  .status-pill .dot {
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 50%;
    background: var(--ok);
  }
</style>
