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

  type Props = {
    data: { chatRoomsFromServer: RoomCard[]; serverRoomListFailed: boolean };
  };

  let { data }: Props = $props();

  import { onMount } from 'svelte';

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
  const VIEW_STORAGE_KEY = 'ant.dashboard.view';
  const COLS_STORAGE_KEY = 'ant.dashboard.gridCols';
  let dashboardView = $state<'list' | 'grid'>('list');
  let dashboardGridCols = $state(2);

  onMount(() => {
    try {
      const v = localStorage.getItem(VIEW_STORAGE_KEY);
      if (v === 'list' || v === 'grid') dashboardView = v;
      const c = Number(localStorage.getItem(COLS_STORAGE_KEY));
      if (Number.isFinite(c) && c >= 1 && c <= 4) dashboardGridCols = c;
    } catch { /* private-mode safe */ }
  });

  function setView(next: 'list' | 'grid'): void {
    dashboardView = next;
    try { localStorage.setItem(VIEW_STORAGE_KEY, next); } catch { /* ignore */ }
  }

  function setGridCols(next: number): void {
    const clamped = Math.max(1, Math.min(4, next));
    dashboardGridCols = clamped;
    try { localStorage.setItem(COLS_STORAGE_KEY, String(clamped)); } catch { /* ignore */ }
  }

  async function refreshRoomListFromServer() {
    const response = await fetch('/api/chat-rooms');
    if (!response.ok) return;
    const body = (await response.json()) as { chatRooms: RoomCard[] };
    chatRoomsFromServer = body.chatRooms ?? [];
  }

  const yourRooms = $derived(
    chatRoomsFromServer.map((room) => ({ ...room, isOpenable: true }))
  );

  const hasNoRoomsYet = $derived(yourRooms.length === 0);
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

  <CreateChatRoomForm onRoomCreated={refreshRoomListFromServer} />

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
