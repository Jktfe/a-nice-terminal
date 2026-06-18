<!--
  RoomLinksPanel — sibling-room navigation (Task #49 v3 parity).

  Renders the outgoing + incoming room_links for a room so the user can
  jump straight to a linked discussion / spawned-from room. Lets the user
  link an existing room with one of four relationship labels:
    - discussion_of        (sibling discussion)
    - promoted_summary_for (summary view of another room)
    - spawned_from         (this room emerged from the other)
    - follows_up           (follow-up conversation)

  Per JWPK msg_e3tj4mw2rc 2026-05-19: net-new room creation is now
  in-scope too. The form has a mode toggle (Link existing | Create new);
  Create-new POSTs to /api/chat-rooms then chains POST /links so the new
  room appears in the panel immediately. Restores v3 parity.
-->
<script lang="ts">
  import Skeleton from './Skeleton.svelte';

  type RoomLinkWithPeer = {
    id: string;
    sourceRoomId: string;
    targetRoomId: string;
    relationship: 'discussion_of' | 'promoted_summary_for' | 'spawned_from' | 'follows_up';
    title: string | null;
    peerRoomId: string;
    peerRoomName: string;
  };

  type CandidateRoom = { id: string; name: string };
  type LinkFormMode = 'existing' | 'create';

  type Props = {
    roomId: string;
    canManage?: boolean;
  };

  let { roomId, canManage = true }: Props = $props();

  const RELATIONSHIP_LABEL: Record<RoomLinkWithPeer['relationship'], string> = {
    discussion_of: 'Discussion',
    promoted_summary_for: 'Summary',
    spawned_from: 'Spawned from',
    follows_up: 'Follow-up'
  };

  let outgoing = $state<RoomLinkWithPeer[]>([]);
  let incoming = $state<RoomLinkWithPeer[]>([]);
  let isLoading = $state(true);
  let lastErrorMessage = $state('');

  let isLinkFormOpen = $state(false);
  let formMode = $state<LinkFormMode>('existing');
  let candidateRooms = $state<CandidateRoom[]>([]);
  let selectedRoomId = $state('');
  let selectedRelationship = $state<RoomLinkWithPeer['relationship']>('discussion_of');
  let isCreatingLink = $state(false);
  // Create-new mode (JWPK msg_e3tj4mw2rc 2026-05-19): operator types a
  // name for a brand-new room, picks the relationship; we POST /api/chat-
  // rooms then chain POST /links so the new room appears in the panel
  // immediately. Restores v3 parity — single-step create-and-link.
  let newRoomName = $state('');

  async function loadLinksFromServer() {
    isLoading = true;
    lastErrorMessage = '';
    try {
      const response = await fetch(`/api/chat-rooms/${encodeURIComponent(roomId)}/links`);
      if (!response.ok) throw new Error(`Could not load links (${response.status}).`);
      const body = (await response.json()) as { outgoing: RoomLinkWithPeer[]; incoming: RoomLinkWithPeer[] };
      outgoing = body.outgoing ?? [];
      incoming = body.incoming ?? [];
    } catch (cause) {
      lastErrorMessage = cause instanceof Error ? cause.message : 'Could not load links.';
    } finally {
      isLoading = false;
    }
  }

  async function loadCandidateRooms() {
    try {
      const response = await fetch('/api/chat-rooms');
      if (!response.ok) return;
      const body = (await response.json()) as { chatRooms?: { id: string; name: string }[] };
      const linked = new Set([
        ...outgoing.map((link) => link.peerRoomId),
        ...incoming.map((link) => link.peerRoomId)
      ]);
      candidateRooms = (body.chatRooms ?? [])
        .filter((room) => room.id !== roomId && !linked.has(room.id))
        .map((room) => ({ id: room.id, name: room.name }));
    } catch {
      candidateRooms = [];
    }
  }

  async function submitLinkExistingRoom() {
    if (!selectedRoomId) return;
    isCreatingLink = true;
    lastErrorMessage = '';
    try {
      const response = await fetch(`/api/chat-rooms/${encodeURIComponent(roomId)}/links`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetRoomId: selectedRoomId, relationship: selectedRelationship })
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(failure.message ?? 'Could not link room.');
      }
      selectedRoomId = '';
      isLinkFormOpen = false;
      await loadLinksFromServer();
    } catch (cause) {
      lastErrorMessage = cause instanceof Error ? cause.message : 'Could not link room.';
    } finally {
      isCreatingLink = false;
    }
  }

  async function submitCreateAndLinkRoom() {
    const trimmedName = newRoomName.trim();
    if (trimmedName.length === 0) return;
    isCreatingLink = true;
    lastErrorMessage = '';
    try {
      // 1. Create the new room.
      const createResponse = await fetch('/api/chat-rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: trimmedName })
      });
      if (!createResponse.ok) {
        const failure = await createResponse.json().catch(() => ({ message: createResponse.statusText }));
        throw new Error(failure.message ?? `Could not create room (${createResponse.status}).`);
      }
      const createBody = (await createResponse.json()) as { chatRoom?: { id?: string } };
      const newRoomId = createBody.chatRoom?.id;
      if (!newRoomId) {
        throw new Error('Server did not return a new room id.');
      }
      // 2. Link it to the current room with the picked relationship.
      const linkResponse = await fetch(`/api/chat-rooms/${encodeURIComponent(roomId)}/links`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetRoomId: newRoomId, relationship: selectedRelationship })
      });
      if (!linkResponse.ok) {
        const failure = await linkResponse.json().catch(() => ({ message: linkResponse.statusText }));
        // Surface the partial-success state — the room exists but isn't
        // linked. Operator can manually link it via the existing-mode tab
        // without recreating; the error message tells them what happened.
        throw new Error(`Created '${trimmedName}' but could not link it: ${failure.message ?? linkResponse.statusText}.`);
      }
      newRoomName = '';
      isLinkFormOpen = false;
      await loadLinksFromServer();
    } catch (cause) {
      lastErrorMessage = cause instanceof Error ? cause.message : 'Could not create + link room.';
    } finally {
      isCreatingLink = false;
    }
  }

  async function removeLink(linkId: string) {
    lastErrorMessage = '';
    try {
      const response = await fetch(
        `/api/chat-rooms/${encodeURIComponent(roomId)}/links?linkId=${encodeURIComponent(linkId)}`,
        { method: 'DELETE' }
      );
      if (!response.ok && response.status !== 204) {
        throw new Error(`Could not remove link (${response.status}).`);
      }
      await loadLinksFromServer();
    } catch (cause) {
      lastErrorMessage = cause instanceof Error ? cause.message : 'Could not remove link.';
    }
  }

  function openLinkForm() {
    isLinkFormOpen = !isLinkFormOpen;
    if (isLinkFormOpen) void loadCandidateRooms();
  }

  $effect(() => {
    if (roomId) void loadLinksFromServer();
  });
</script>

<section class="room-links" aria-label="Linked rooms">
  <header class="links-header">
    <h2 class="links-title">Linked rooms</h2>
    {#if canManage}
      <button
        type="button"
        class="link-add-btn"
        onclick={openLinkForm}
        aria-expanded={isLinkFormOpen}
      >{isLinkFormOpen ? 'Cancel' : '+ Link a room'}</button>
    {/if}
  </header>

  {#if isLinkFormOpen}
    <!-- Mode toggle — Link existing vs Create new. JWPK msg_e3tj4mw2rc:
         restoring v3 parity for the single-step create-and-link flow. -->
    <div class="link-mode-toggle" role="tablist" aria-label="Link mode">
      <button
        type="button"
        role="tab"
        class="link-mode-btn"
        class:active={formMode === 'existing'}
        aria-selected={formMode === 'existing'}
        onclick={() => (formMode = 'existing')}
      >Link existing</button>
      <button
        type="button"
        role="tab"
        class="link-mode-btn"
        class:active={formMode === 'create'}
        aria-selected={formMode === 'create'}
        onclick={() => (formMode = 'create')}
      >Create new</button>
    </div>

    {#if formMode === 'existing'}
      <form class="link-form" onsubmit={(event) => { event.preventDefault(); void submitLinkExistingRoom(); }}>
        <label class="link-form-field">
          <span class="link-form-label">Target room</span>
          <select bind:value={selectedRoomId} required>
            <option value="">— select a room —</option>
            {#each candidateRooms as candidate (candidate.id)}
              <option value={candidate.id}>{candidate.name}</option>
            {/each}
          </select>
        </label>
        <label class="link-form-field">
          <span class="link-form-label">Relationship</span>
          <select bind:value={selectedRelationship}>
            <option value="discussion_of">Discussion</option>
            <option value="promoted_summary_for">Summary</option>
            <option value="spawned_from">Spawned from</option>
            <option value="follows_up">Follow-up</option>
          </select>
        </label>
        <button
          type="submit"
          class="link-create-btn"
          disabled={!selectedRoomId || isCreatingLink}
        >{isCreatingLink ? 'Linking…' : 'Link'}</button>
      </form>
    {:else}
      <form class="link-form" onsubmit={(event) => { event.preventDefault(); void submitCreateAndLinkRoom(); }}>
        <label class="link-form-field">
          <span class="link-form-label">New room name</span>
          <input
            type="text"
            bind:value={newRoomName}
            placeholder="e.g. Migration follow-ups"
            required
            disabled={isCreatingLink}
            autocomplete="off"
          />
        </label>
        <label class="link-form-field">
          <span class="link-form-label">Relationship</span>
          <select bind:value={selectedRelationship} disabled={isCreatingLink}>
            <option value="discussion_of">Discussion</option>
            <option value="promoted_summary_for">Summary</option>
            <option value="spawned_from">Spawned from</option>
            <option value="follows_up">Follow-up</option>
          </select>
        </label>
        <button
          type="submit"
          class="link-create-btn"
          disabled={newRoomName.trim().length === 0 || isCreatingLink}
        >{isCreatingLink ? 'Creating…' : 'Create + link'}</button>
      </form>
    {/if}
  {/if}

  {#if lastErrorMessage}
    <p class="links-error" role="alert">{lastErrorMessage}</p>
  {/if}

  {#if isLoading}
    <div class="links-skeleton" aria-label="Loading linked rooms" role="status">
      <Skeleton height="0.95rem" width="55%" />
      <Skeleton height="0.95rem" width="40%" />
      <Skeleton height="0.95rem" width="70%" />
    </div>
  {:else if outgoing.length === 0 && incoming.length === 0}
    <p class="links-empty">No linked rooms yet.</p>
  {:else}
    {#if outgoing.length > 0}
      <ul class="link-list">
        {#each outgoing as link (link.id)}
          <li class="link-row">
            <a class="link-jump" href="/rooms/{encodeURIComponent(link.peerRoomId)}">
              <span class="link-badge">{RELATIONSHIP_LABEL[link.relationship]}</span>
              <span class="link-name">{link.title ?? link.peerRoomName}</span>
            </a>
            {#if canManage}
              <button
                type="button"
                class="link-remove"
                title={`Remove link to ${link.peerRoomName}`}
                aria-label={`Remove link to ${link.peerRoomName}`}
                onclick={() => void removeLink(link.id)}
              >×</button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    {#if incoming.length > 0}
      <h3 class="incoming-heading">Parent rooms</h3>
      <ul class="link-list">
        {#each incoming as link (link.id)}
          <li class="link-row">
            <a class="link-jump link-jump-parent" href="/rooms/{encodeURIComponent(link.peerRoomId)}">
              <span class="link-badge link-badge-parent">Parent</span>
              <span class="link-name">{link.peerRoomName}</span>
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>

<style>
  .room-links {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    padding: 0.85rem 1rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.9rem;
    background: var(--surface-card);
  }
  .links-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .links-title {
    margin: 0;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-soft);
    font-weight: 700;
  }
  .link-add-btn {
    padding: 0.25rem 0.6rem;
    border-radius: 999px;
    border: 1px solid var(--line-soft);
    background: transparent;
    color: var(--accent);
    font-size: 0.78rem;
    font-weight: 700;
    cursor: pointer;
  }
  .link-add-btn:hover { border-color: var(--accent); }
  .link-form {
    display: grid;
    grid-template-columns: 1fr 1fr auto;
    gap: 0.4rem;
    padding: 0.6rem 0.55rem;
    border: 1px dashed var(--surface-edge);
    border-radius: 0.6rem;
    background: var(--bg);
  }
  .link-form-field {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 0.75rem;
    color: var(--ink-soft);
  }
  .link-form-label {
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .link-form select,
  .link-form input[type='text'] {
    padding: 0.35rem 0.5rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.45rem;
    background: var(--surface-card);
    color: var(--ink-strong);
    font-size: 0.85rem;
    min-width: 0;
  }
  .link-form input[type='text']:focus {
    outline: none;
    border-color: var(--accent);
  }
  /* Mode toggle (Link existing | Create new) — sits above the link
     form so the operator sees the v3-parity create-and-link path
     immediately. Pill-button pair matches the dashboard list/grid
     toggle pattern (43914f6). */
  .link-mode-toggle {
    display: inline-flex;
    margin-bottom: 0.45rem;
    border: 1px solid var(--line-soft);
    border-radius: 999px;
    overflow: hidden;
    background: var(--surface-card);
  }
  .link-mode-btn {
    appearance: none;
    border: none;
    background: transparent;
    color: var(--ink-soft);
    font: inherit;
    font-size: 0.78rem;
    font-weight: 700;
    padding: 0.35rem 0.85rem;
    cursor: pointer;
    line-height: 1;
  }
  .link-mode-btn + .link-mode-btn { border-left: 1px solid var(--line-soft); }
  .link-mode-btn:hover { color: var(--ink-strong); }
  .link-mode-btn.active {
    background: var(--accent);
    color: white;
  }
  .link-create-btn {
    align-self: end;
    padding: 0.45rem 0.85rem;
    border-radius: 999px;
    border: 1px solid var(--accent);
    background: var(--accent);
    color: white;
    font-weight: 800;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .link-create-btn:disabled { opacity: 0.55; cursor: not-allowed; }
  .links-error {
    margin: 0;
    color: var(--accent);
    font-size: 0.82rem;
  }
  .links-skeleton {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    padding: 0.4rem 0;
  }
  .links-empty {
    margin: 0.15rem 0;
    color: var(--ink-soft);
    font-size: 0.85rem;
    font-style: italic;
  }
  .link-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .link-row {
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }
  .link-jump {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.4rem 0.6rem;
    border: 1px solid color-mix(in srgb, var(--accent) 18%, transparent);
    border-radius: 0.5rem;
    background: color-mix(in srgb, var(--accent) 6%, transparent);
    color: var(--ink-strong);
    font: inherit;
    text-align: left;
    text-decoration: none;
    cursor: pointer;
  }
  .link-jump:hover {
    border-color: color-mix(in srgb, var(--accent) 40%, transparent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  .link-jump-parent {
    border-style: dashed;
    background: transparent;
  }
  .link-badge {
    padding: 0.1rem 0.45rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent) 22%, transparent);
    color: var(--accent);
    font-size: 0.65rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    flex-shrink: 0;
  }
  .link-badge-parent {
    background: transparent;
    border: 1px solid var(--surface-edge);
    color: var(--ink-soft);
  }
  .link-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.88rem;
  }
  .link-remove {
    width: 1.6rem;
    height: 1.6rem;
    padding: 0;
    border-radius: 999px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--ink-soft);
    cursor: pointer;
    font-size: 0.95rem;
  }
  .link-remove:hover { color: var(--accent); border-color: var(--accent); }
  .incoming-heading {
    margin: 0.4rem 0 0.1rem;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-soft);
    font-weight: 700;
  }
</style>
