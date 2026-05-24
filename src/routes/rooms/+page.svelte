<!--
  Rooms route — interactive surface for room creation.

  Hosts:
    - CreateChatRoomForm  (M01 start-a-chatroom)
    - "Your rooms" section: rooms you have made (clickable). Shows an
      empty-state nudge pointing at the form when you have made none yet.

  When the form reports a new room, the page re-asks the server for the list
  so the new room appears immediately. No client-side optimistic insert yet —
  the round-trip is cheap and shows we trust the server view.
-->
<script lang="ts">
  import RoomStrip from '$lib/components/RoomStrip.svelte';
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import CreateChatRoomForm from '$lib/components/CreateChatRoomForm.svelte';
  import type { RoomCard } from '$lib/domain/types';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { roomBookmarks } from '$lib/stores/roomBookmarks.svelte';
  import Explainable from '$lib/components/Explainable.svelte';

  type Props = {
    data: { chatRoomsFromServer: RoomCard[]; serverRoomListFailed: boolean };
  };

  let { data }: Props = $props();

  import { onMount, onDestroy } from 'svelte';

  // Lane D (JWPK msg_hcwpvjwfg8 + msg_xyrlvisazp, 2026-05-19): when the
  // plan page sends operators here with ?attachPlanId=PLAN, show a banner
  // + put RoomStrip into "pick to attach" mode. Clicking a room POSTs to
  // /api/plans/:planId/rooms (cookie-authed) and removes the query param.
  const attachPlanId = $derived(page.url.searchParams.get('attachPlanId'));
  let attachState = $state<'idle' | 'attaching' | 'attached' | 'error'>('idle');
  let attachError = $state<string>('');
  let attachedRoomName = $state<string>('');

  async function attachPlanToRoom(roomId: string, roomName: string): Promise<void> {
    if (!attachPlanId) return;
    attachState = 'attaching';
    attachError = '';
    try {
      const response = await fetch(
        `/api/plans/${encodeURIComponent(attachPlanId)}/rooms`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ roomId })
        }
      );
      if (!response.ok) {
        attachState = 'error';
        attachError =
          response.status === 401
            ? 'You need to be signed in to attach a plan. Visit /login.'
            : response.status === 404
              ? 'Room not found.'
              : `Attach failed (HTTP ${response.status}).`;
        return;
      }
      attachState = 'attached';
      attachedRoomName = roomName;
    } catch (cause) {
      attachState = 'error';
      attachError = cause instanceof Error ? cause.message : 'Attach failed.';
    }
  }

  function cancelAttachMode(): void {
    // Drop the query param so the picker UI exits.
    goto('/rooms', { replaceState: true, keepFocus: true, noScroll: true });
    attachState = 'idle';
  }

  function gotoPlan(): void {
    if (attachPlanId) goto(`/plans/${encodeURIComponent(attachPlanId)}`);
  }

  // Init-from-prop so the first SSR HTML already renders the right section
  // (with or without the empty-state nudge). Refreshing after a new room
  // is created assigns the array directly, no $effect copy needed.
  // svelte-ignore state_referenced_locally
  let chatRoomsFromServer = $state<RoomCard[]>(data.chatRoomsFromServer);

  // JWPK msg_m3h97n3noq: v3 had a dashboard grid view with rows×cols up
  // to 5×5. Lifted here as a simpler list/grid toggle on /rooms with a
  // 1-4 column stepper. Preference persists per-device via localStorage.
  //
  // JWPK msg_iozs65ulux 2026-05-24 + Silent heroes ack: scroll problem for
  // 100+ rooms. Added: compact density mode + filter chips + name filter
  // + sort affordance. All three persist independently.
  const VIEW_STORAGE_KEY = 'ant.dashboard.view';
  const COLS_STORAGE_KEY = 'ant.dashboard.gridCols';
  const FILTER_STORAGE_KEY = 'ant.rooms.filter.v1';
  const SORT_STORAGE_KEY = 'ant.rooms.sort.v1';

  type DensityView = 'list' | 'grid' | 'compact';
  type FilterChip = 'all' | 'starred' | 'active' | 'quiet';
  type SortKey = 'recent' | 'alphabetical' | 'starred-first';

  let dashboardView = $state<DensityView>('list');
  let dashboardGridCols = $state(2);
  let filterChip = $state<FilterChip>('all');
  let nameFilter = $state('');
  let sortKey = $state<SortKey>('recent');
  // Reference to the filter input so the `/` keyboard shortcut (added
  // below) can focus it. Common pattern across productivity tools
  // (Slack, Linear, GitHub) — power users with 100+ rooms reach for
  // search via keyboard more often than mouse.
  let filterInputEl = $state<HTMLInputElement | undefined>();

  onMount(() => {
    try {
      const v = localStorage.getItem(VIEW_STORAGE_KEY);
      if (v === 'list' || v === 'grid' || v === 'compact') dashboardView = v;
      const c = Number(localStorage.getItem(COLS_STORAGE_KEY));
      if (Number.isFinite(c) && c >= 1 && c <= 4) dashboardGridCols = c;
      const f = localStorage.getItem(FILTER_STORAGE_KEY);
      if (f === 'all' || f === 'starred' || f === 'active' || f === 'quiet') filterChip = f;
      const s = localStorage.getItem(SORT_STORAGE_KEY);
      if (s === 'recent' || s === 'alphabetical' || s === 'starred-first') sortKey = s;
    } catch { /* private-mode safe */ }
    // Need the bookmarks store hydrated so the Starred chip + sort work
    // off the user's actual pinned list, not an empty array.
    roomBookmarks.init();

    // `/` focuses the filter input (skip when the user is already typing
    // into an input/textarea or has a modifier held). Esc inside the
    // search input clears it (native HTMLInputElement type="search"
    // behaviour). Common ergonomic for power users.
    window.addEventListener('keydown', handleGlobalKeydown);
  });

  onDestroy(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', handleGlobalKeydown);
    }
  });

  function handleGlobalKeydown(event: KeyboardEvent): void {
    if (event.key !== '/') return;
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const target = event.target as HTMLElement | null;
    if (target) {
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (target.isContentEditable) return;
    }
    if (!filterInputEl) return;
    event.preventDefault();
    filterInputEl.focus();
    filterInputEl.select();
  }

  function setView(next: DensityView): void {
    dashboardView = next;
    try { localStorage.setItem(VIEW_STORAGE_KEY, next); } catch { /* ignore */ }
  }

  function setGridCols(next: number): void {
    const clamped = Math.max(1, Math.min(4, next));
    dashboardGridCols = clamped;
    try { localStorage.setItem(COLS_STORAGE_KEY, String(clamped)); } catch { /* ignore */ }
  }

  function setFilterChip(next: FilterChip): void {
    filterChip = next;
    try { localStorage.setItem(FILTER_STORAGE_KEY, next); } catch { /* ignore */ }
  }

  function setSortKey(next: SortKey): void {
    sortKey = next;
    try { localStorage.setItem(SORT_STORAGE_KEY, next); } catch { /* ignore */ }
  }

  function isActiveRoom(room: RoomCard): boolean {
    return room.attentionState === 'working'
      || room.attentionState === 'asking'
      || room.attentionState === 'blocked';
  }

  function matchesNameFilter(room: RoomCard, needle: string): boolean {
    // JWPK 2026-05-24 follow-up: filter input also matches the optional
    // room description (a19a496) so "find rooms about board meetings"
    // works as the user expects when descriptions exist. Description is
    // nullable; name match remains the fallback.
    if (needle.length === 0) return true;
    if (room.name.toLowerCase().includes(needle)) return true;
    if (room.description && room.description.toLowerCase().includes(needle)) return true;
    return false;
  }

  function compareAlphabetical(a: RoomCard, b: RoomCard): number {
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  }

  async function refreshRoomListFromServer() {
    const response = await fetch('/api/chat-rooms');
    if (!response.ok) return;
    const body = (await response.json()) as { chatRooms: RoomCard[] };
    chatRoomsFromServer = body.chatRooms ?? [];
  }

  const allYourRooms = $derived(
    chatRoomsFromServer.map((room) => ({ ...room, isOpenable: true }))
  );

  const hasNoRoomsYet = $derived(allYourRooms.length === 0);

  // Filter chip + name filter combine into the visible set. Sort applies
  // on top. Server-driven order (last_post_order DESC) is preserved as
  // 'recent' sort default.
  const filteredYourRooms = $derived.by(() => {
    const needle = nameFilter.trim().toLowerCase();
    const filtered = allYourRooms.filter((room) => {
      if (!matchesNameFilter(room, needle)) return false;
      if (filterChip === 'all') return true;
      if (filterChip === 'starred') return roomBookmarks.has(room.id);
      if (filterChip === 'active') return isActiveRoom(room);
      if (filterChip === 'quiet') return !isActiveRoom(room);
      return true;
    });
    if (sortKey === 'alphabetical') {
      return [...filtered].sort(compareAlphabetical);
    }
    if (sortKey === 'starred-first') {
      // Starred rooms float to top in roomBookmarks.ids order; the rest
      // keep server order (recent first).
      const isStarred = (r: RoomCard) => roomBookmarks.has(r.id);
      const bookmarkIndex = new Map(roomBookmarks.ids.map((id, idx) => [id, idx]));
      return [...filtered].sort((a, b) => {
        const aStar = isStarred(a), bStar = isStarred(b);
        if (aStar && !bStar) return -1;
        if (!aStar && bStar) return 1;
        if (aStar && bStar) {
          return (bookmarkIndex.get(a.id) ?? 0) - (bookmarkIndex.get(b.id) ?? 0);
        }
        return 0; // both unstarred — keep input order (server recent)
      });
    }
    // 'recent' (default) — leave server order untouched.
    return filtered;
  });

  // Aliased for backwards-compat with existing markup blocks.
  const yourRooms = $derived(filteredYourRooms);
</script>

<svelte:head>
  <title>Rooms | ANT vNext</title>
</svelte:head>

<SimplePageShell
  eyebrow="Room work"
  title="Start, join, and steer rooms."
  summary="Create a chat room with a name; rooms you make appear below."
>
  {#if data.serverRoomListFailed}
    <p class="server-error" role="alert">
      Server rooms could not load.
    </p>
  {/if}

  {#if attachPlanId}
    <aside class="attach-banner" aria-live="polite">
      {#if attachState === 'attached'}
        <div class="attach-row attach-success">
          <strong>Attached</strong> · plan
          <code>{attachPlanId}</code> ↔ <strong>{attachedRoomName}</strong>
          <div class="attach-actions">
            <button type="button" class="attach-btn primary" onclick={gotoPlan}>
              Back to plan
            </button>
            <button type="button" class="attach-btn" onclick={cancelAttachMode}>
              Stay here
            </button>
          </div>
        </div>
      {:else}
        <div class="attach-row">
          <span>
            <strong>Attach plan</strong>
            <code>{attachPlanId}</code>
            <span class="attach-hint">— pick a room below to link it.</span>
          </span>
          <button type="button" class="attach-btn" onclick={cancelAttachMode}>
            Cancel
          </button>
        </div>
        {#if attachState === 'attaching'}
          <p class="attach-state">Attaching…</p>
        {/if}
        {#if attachState === 'error'}
          <p class="attach-state attach-error" role="alert">{attachError}</p>
        {/if}
      {/if}
    </aside>
  {/if}

  <Explainable explainKey="rooms-create"><CreateChatRoomForm onRoomCreated={refreshRoomListFromServer} /></Explainable>

  <section aria-labelledby="yourRoomsHeading">
    <div class="rooms-toolbar">
      <h2 id="yourRoomsHeading" class="section-heading">Your rooms</h2>
      {#if !hasNoRoomsYet}
        <div class="view-toggle" role="group" aria-label="Dashboard view">
          <button
            type="button"
            class="view-toggle-btn"
            class:active={dashboardView === 'list'}
            aria-pressed={dashboardView === 'list'}
            onclick={() => setView('list')}
            title="List view"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 6h16M4 12h16M4 18h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
            <span class="view-label">List</span>
          </button>
          <button
            type="button"
            class="view-toggle-btn"
            class:active={dashboardView === 'grid'}
            aria-pressed={dashboardView === 'grid'}
            onclick={() => setView('grid')}
            title="Grid view"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="4" y="4" width="7" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="2"/>
              <rect x="13" y="4" width="7" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="2"/>
              <rect x="4" y="13" width="7" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="2"/>
              <rect x="13" y="13" width="7" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="2"/>
            </svg>
            <span class="view-label">Grid</span>
          </button>
          <button
            type="button"
            class="view-toggle-btn"
            class:active={dashboardView === 'compact'}
            aria-pressed={dashboardView === 'compact'}
            onclick={() => setView('compact')}
            title="Compact view — single-line rows for browsing many rooms"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
            </svg>
            <span class="view-label">Compact</span>
          </button>
          {#if dashboardView === 'grid'}
            <div class="cols-stepper" role="group" aria-label="Grid columns">
              <button
                type="button"
                class="cols-btn"
                onclick={() => setGridCols(dashboardGridCols - 1)}
                disabled={dashboardGridCols <= 1}
                aria-label="Fewer columns"
              >−</button>
              <span class="cols-value">{dashboardGridCols}</span>
              <button
                type="button"
                class="cols-btn"
                onclick={() => setGridCols(dashboardGridCols + 1)}
                disabled={dashboardGridCols >= 4}
                aria-label="More columns"
              >+</button>
            </div>
          {/if}
        </div>
      {/if}
    </div>

    {#if !hasNoRoomsYet}
      <div class="rooms-filter-bar">
        <div class="filter-chips" role="group" aria-label="Filter rooms">
          {#each (['all', 'starred', 'active', 'quiet'] as const) as chip}
            <button
              type="button"
              class="filter-chip"
              class:active={filterChip === chip}
              aria-pressed={filterChip === chip}
              onclick={() => setFilterChip(chip)}
            >
              {chip === 'all' ? 'All' : chip === 'starred' ? '★ Starred' : chip === 'active' ? 'Active' : 'Quiet'}
            </button>
          {/each}
        </div>

        <Explainable explainKey="rooms-filter">
          <input
            bind:this={filterInputEl}
            type="search"
            class="name-filter"
            placeholder="Filter by name or description… (press / to focus)"
            aria-label="Filter rooms by name or description. Press / to focus."
            bind:value={nameFilter}
          />
        </Explainable>

        <label class="sort-select-wrap">
          <span class="sort-label">Sort</span>
          <select
            class="sort-select"
            aria-label="Sort rooms"
            value={sortKey}
            onchange={(e) => setSortKey((e.currentTarget as HTMLSelectElement).value as SortKey)}
          >
            <option value="recent">Most recent activity</option>
            <option value="alphabetical">Alphabetical</option>
            <option value="starred-first">Starred first</option>
          </select>
        </label>
      </div>
    {/if}
    {#if hasNoRoomsYet}
      <p class="empty-nudge" role="note">
        You have not made any rooms yet. Use the form above to start one — fresh rooms appear here at the top.
      </p>
    {:else if attachPlanId && attachState !== 'attached'}
      <ul class="attach-picker" aria-label="Pick a room to attach the plan to">
        {#each yourRooms as r (r.id)}
          <li>
            <button
              type="button"
              class="attach-picker-row"
              disabled={attachState === 'attaching'}
              onclick={() => attachPlanToRoom(r.id, r.name)}
            >
              <span class="attach-picker-name">{r.name}</span>
              <span class="attach-picker-arrow" aria-hidden="true">→</span>
            </button>
          </li>
        {/each}
      </ul>
    {:else if yourRooms.length === 0}
      <p class="empty-nudge" role="status">
        No rooms match the current filter
        {#if filterChip !== 'all'}<strong>({filterChip})</strong>{/if}
        {#if nameFilter.trim().length > 0}matching <strong>"{nameFilter}"</strong>{/if}.
        <button type="button" class="filter-reset-btn" onclick={() => { setFilterChip('all'); nameFilter = ''; }}>Clear filters</button>
      </p>
    {:else}
      <RoomStrip rooms={yourRooms} view={dashboardView} gridCols={dashboardGridCols} />
    {/if}
  </section>
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
  .section-heading {
    margin: 1.25rem 0 0.55rem;
    font-size: 0.95rem;
    font-weight: 800;
    color: var(--ink-strong);
  }
  .empty-nudge {
    margin: 0;
    padding: 0.85rem 1rem;
    border: 1px dashed var(--surface-edge);
    border-radius: 0.85rem;
    background: var(--bg);
    color: var(--ink-strong);
    line-height: 1.45;
  }
  .rooms-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.85rem;
    flex-wrap: wrap;
    margin: 1.25rem 0 0.55rem;
  }
  .rooms-toolbar .section-heading {
    margin: 0;
  }

  /* Filter bar (slice 2026-05-24 scroll fix) — chip row + name input +
     sort select. Wraps on narrow viewports without falling apart. */
  .rooms-filter-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.75rem;
    margin: 0 0 0.75rem;
    padding: 0.45rem 0.6rem;
    background: var(--surface-card);
    border: 1px solid var(--line-soft);
    border-radius: 0.65rem;
  }
  .filter-chips {
    display: inline-flex;
    gap: 0.3rem;
    flex-wrap: wrap;
  }
  .filter-chip {
    background: transparent;
    border: 1px solid var(--line-soft);
    border-radius: 999px;
    padding: 0.22rem 0.7rem;
    font: 600 0.78rem/1.2 ui-sans-serif, system-ui, sans-serif;
    color: var(--ink-soft, #475569);
    cursor: pointer;
  }
  .filter-chip:hover {
    border-color: var(--accent, #6b21a8);
    color: var(--ink-strong, #0f172a);
  }
  .filter-chip.active {
    background: var(--accent, #6b21a8);
    color: white;
    border-color: var(--accent, #6b21a8);
  }
  .name-filter {
    flex: 1 1 12rem;
    min-width: 8rem;
    padding: 0.32rem 0.6rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.45rem;
    background: var(--bg, #fff);
    font: 500 0.85rem/1.3 ui-sans-serif, system-ui, sans-serif;
    color: var(--ink-strong, #0f172a);
  }
  .name-filter:focus {
    outline: 2px solid var(--accent, #6b21a8);
    outline-offset: 1px;
    border-color: transparent;
  }
  .sort-select-wrap {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font: 600 0.78rem/1.2 ui-sans-serif, system-ui, sans-serif;
    color: var(--ink-soft, #475569);
  }
  .sort-select {
    padding: 0.25rem 0.4rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.4rem;
    background: var(--bg, #fff);
    font: 500 0.82rem/1.2 ui-sans-serif, system-ui, sans-serif;
    color: var(--ink-strong, #0f172a);
  }
  .filter-reset-btn {
    margin-left: 0.5rem;
    background: transparent;
    border: 1px solid var(--accent, #6b21a8);
    color: var(--accent, #6b21a8);
    border-radius: 999px;
    padding: 0.15rem 0.7rem;
    font: 600 0.74rem/1.2 ui-sans-serif, system-ui, sans-serif;
    cursor: pointer;
  }
  .filter-reset-btn:hover {
    background: rgba(168, 85, 247, 0.08);
  }
  .view-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.2rem;
    border: 1px solid var(--line-soft);
    border-radius: 999px;
    background: var(--surface-card);
  }
  .view-toggle-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.3rem 0.65rem;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--ink-soft);
    font: inherit;
    font-size: 0.82rem;
    font-weight: 700;
    cursor: pointer;
  }
  .view-toggle-btn:hover { color: var(--ink-strong); }
  .view-toggle-btn.active {
    background: var(--accent);
    color: white;
  }
  .view-toggle-btn svg {
    width: 0.95rem;
    height: 0.95rem;
  }
  .view-toggle-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .view-label {
    font-size: 0.82rem;
    font-weight: 700;
  }
  @media (max-width: 480px) {
    .view-label { display: none; }
  }
  .cols-stepper {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    margin-left: 0.45rem;
    padding: 0.2rem 0.35rem;
    border: 1px solid var(--line-soft);
    border-radius: 999px;
    background: var(--bg);
  }
  .cols-btn {
    width: 1.4rem;
    height: 1.4rem;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--ink-strong);
    font: inherit;
    font-size: 0.95rem;
    font-weight: 800;
    cursor: pointer;
  }
  .cols-btn:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    color: var(--accent);
  }
  .cols-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .cols-value {
    min-width: 1ch;
    text-align: center;
    font-variant-numeric: tabular-nums;
    font-weight: 800;
    font-size: 0.85rem;
    color: var(--ink-strong);
  }

  .attach-banner {
    margin: 0 0 0.85rem;
    padding: 0.85rem 1rem;
    border: 1px solid var(--accent, #6b21a8);
    border-radius: 0.85rem;
    background: color-mix(in srgb, var(--accent, #6b21a8) 12%, var(--surface, #fff));
    display: grid;
    gap: 0.55rem;
  }
  .attach-banner code {
    padding: 0.15rem 0.4rem;
    background: var(--surface, #fff);
    border-radius: 0.35rem;
    font-size: 0.85em;
  }
  .attach-banner .attach-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.85rem;
    flex-wrap: wrap;
  }
  .attach-banner .attach-success {
    color: var(--ok, #15803d);
  }
  .attach-banner .attach-hint {
    color: var(--ink-muted, #475569);
    font-weight: 400;
  }
  .attach-banner .attach-state {
    margin: 0;
    font-weight: 600;
    font-size: 0.9rem;
    color: var(--ink-muted, #475569);
  }
  .attach-banner .attach-error {
    color: var(--danger, #b91c1c);
  }
  .attach-banner .attach-actions {
    display: flex;
    gap: 0.55rem;
  }
  .attach-btn {
    padding: 0.4rem 0.85rem;
    border: 1px solid var(--surface-edge, #d6d6d6);
    background: var(--surface, #fff);
    border-radius: 0.55rem;
    font-weight: 700;
    cursor: pointer;
    color: var(--ink-strong, #0f172a);
  }
  .attach-btn:hover {
    background: color-mix(in srgb, var(--accent, #6b21a8) 6%, var(--surface, #fff));
  }
  .attach-btn.primary {
    background: var(--accent, #6b21a8);
    color: white;
    border-color: var(--accent, #6b21a8);
  }

  .attach-picker {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.4rem;
  }
  .attach-picker-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    padding: 0.85rem 1rem;
    border: 1px solid var(--surface-edge, #d6d6d6);
    border-radius: 0.85rem;
    background: var(--surface, #fff);
    cursor: pointer;
    text-align: left;
    font-weight: 700;
    color: var(--ink-strong, #0f172a);
  }
  .attach-picker-row:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent, #6b21a8) 8%, var(--surface, #fff));
    border-color: var(--accent, #6b21a8);
  }
  .attach-picker-row:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .attach-picker-arrow {
    color: var(--accent, #6b21a8);
    font-size: 1.1rem;
  }
</style>
