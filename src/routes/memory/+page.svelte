<!--
  /memory route — unified recall across rooms, notes, agent activity,
  shared files, and (slice 6) open asks.

  Plain GET form submits to /memory?q=value. The browser navigates, the
  loader runs server-side, the first HTML response carries all hit kinds.
  SSR-first via $derived(data.x). The loader calls /api/memory-recall with
  surfaces=all so all five kinds (message / note / agentEvent / file /
  ask) surface here. The accepted endpoint default contract
  (message+note only) remains intact for pre-existing callers that do not
  opt in.

  Slice 6 split: per-kind render and helpers moved to MemoryHitCard.svelte
  so this page stays under cap. The page owns SSR-derived data + states +
  form + list mount + key generation; the card owns per-row rendering.

  Slice 9: optional ?roomId URL-param scope. When set, the page shows a
  "Scoped to <Room>" banner with a "Clear scope" link that preserves ?q.
  When the room is unknown (slice 8 endpoint returns 404), the page shows
  a soft-fail error banner with a "Show results from all rooms" link.
  Default no-?roomId callers behave exactly as before — zero drift.

  Per @evolveantcodex contract guardrails (slices 2 + 4 + 6 + 9):
    - States distinguish empty-query / no-hits / failure / hits.
    - GET form has its own accessible name.
    - Recall failure surfaces as an inline error message, not a crash.
    - Slice 6 split keeps /memory page slim and renders ask hits via the
      same card with discovery-only treatment (no answer/dismiss UI).
    - Slice 9 banner uses role="status" for scoped indicator and
      role="alert" for unknown-room error. "Clear scope" link preserves
      q and drops roomId.
-->
<script lang="ts">
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import Explainable from '$lib/components/Explainable.svelte';
  import MemoryHitCard from '$lib/components/MemoryHitCard.svelte';
  import MemoryEditor from '$lib/components/MemoryEditor.svelte';
  import type { RecallHitIncludingAsks } from '$lib/server/memoryRecallStore';

  type Props = {
    data: {
      queryFromServer: string;
      hitsFromServer: RecallHitIncludingAsks[];
      roomNameByRoomId: Record<string, string>;
      recallFetchFailed: boolean;
      roomIdScope?: string;
      roomScopeName?: string;
      roomScopeUnknown: boolean;
      longMemoryEnabled: boolean;
    };
  };

  let { data }: Props = $props();

  const queryFromServer = $derived<string>(data.queryFromServer);
  const hitsFromServer = $derived<RecallHitIncludingAsks[]>(data.hitsFromServer);
  const roomNameByRoomId = $derived<Record<string, string>>(data.roomNameByRoomId);
  const recallFetchFailed = $derived<boolean>(data.recallFetchFailed);
  const roomIdScope = $derived<string | undefined>(data.roomIdScope);
  const roomScopeName = $derived<string | undefined>(data.roomScopeName);
  const roomScopeUnknown = $derived<boolean>(data.roomScopeUnknown);
  const longMemoryEnabled = $derived<boolean>(data.longMemoryEnabled);

  // "Clear scope" preserves q and drops roomId per slice 9 guardrails.
  const clearScopeHref = $derived<string>(
    queryFromServer.length === 0
      ? '/memory'
      : `/memory?q=${encodeURIComponent(queryFromServer)}`
  );

  function stableKeyFor(hit: RecallHitIncludingAsks): string {
    if (hit.kind === 'message') return `message-${hit.messageHit.message.id}`;
    if (hit.kind === 'note') return `note-${hit.noteHit.roomId}`;
    if (hit.kind === 'agentEvent') return `agentEvent-${hit.eventHit.id}`;
    if (hit.kind === 'file') return `file-${hit.fileHit.id}`;
    return `ask-${hit.askHit.id}`;
  }
</script>

<svelte:head>
  <title>Memory | ANT vNext</title>
</svelte:head>

<SimplePageShell
  eyebrow="Memory"
  title="Recall across rooms and notes."
  summary="Search messages, chair notes, agent activity, shared files, and open asks in one place."
>
  <form
    method="GET"
    action="/memory"
    class="recall-form"
    aria-label="Search across rooms and notes"
  >
    <label for="memoryRecallField" class="visually-hidden">Recall query</label>
    <input
      id="memoryRecallField"
      name="q"
      type="search"
      autocomplete="off"
      placeholder="Type a word or phrase…"
      value={queryFromServer}
      class="recall-input"
    />
    {#if roomIdScope !== undefined}
      <label class="long-memory-toggle">
        <input type="checkbox" name="longMemory" value="1" checked={longMemoryEnabled} />
        <span>Long memory</span>
      </label>
    {/if}
    <button type="submit" class="primary">Recall</button>
  </form>

  <MemoryEditor />

  {#if roomScopeUnknown}
    <!-- Slice 9 B1 fix: unknown-room is an EXCLUSIVE state. The alert
         below is the only result-region content rendered in this case;
         the generic "Nothing matches" / hit-list block below is gated
         on !roomScopeUnknown so the user does not see error + false
         no-match copy simultaneously (per @codex2 BLOCKER + @evolveantcodex). -->
    <p class="error-message" role="alert">
      We could not find that room.
      <a class="banner-link" href={clearScopeHref}>Show results from all rooms</a>
    </p>
  {:else if roomIdScope !== undefined}
    <p class="scope-banner" role="status">
      Scoped to <strong>{roomScopeName ?? roomIdScope}</strong>.
      {#if longMemoryEnabled}
        Searching all history.
      {:else}
        Searching since the latest break.
      {/if}
      <a class="banner-link" href={clearScopeHref}>Clear scope</a>
    </p>
  {/if}

  {#if !roomScopeUnknown}
    {#if recallFetchFailed}
      <p class="error-message" role="alert">
        Could not run the recall just now. Try again in a moment.
      </p>
    {:else if queryFromServer.length === 0}
      <p class="empty-prompt">
        Start by typing a word or phrase above. Recall looks across messages,
        chair notes, agent activity, shared files, and open asks.
      </p>
    {:else if hitsFromServer.length === 0}
      <p class="empty-prompt">
        Nothing matches "<span class="quoted">{queryFromServer}</span>" yet.
        Try a different word, or check the spelling.
      </p>
    {:else}
    <p class="result-count">
      Found {hitsFromServer.length}
      {hitsFromServer.length === 1 ? 'hit' : 'hits'} for
      "<span class="quoted">{queryFromServer}</span>".
    </p>
    <ul class="hit-list" aria-label="Recall results">
      {#each hitsFromServer as hit (stableKeyFor(hit))}
        <li>
          <MemoryHitCard hit={hit} {roomNameByRoomId} />
        </li>
      {/each}
    </ul>
    {/if}
  {/if}
</SimplePageShell>

<style>
  .recall-form { display: flex; gap: 0.5rem; margin-bottom: 1.25rem; }
  .recall-input {
    flex: 1;
    padding: 0.55rem 0.75rem;
    font-size: 1rem;
    border: 1px solid var(--surface-edge);
    border-radius: 0.5rem;
    background: var(--bg);
    color: var(--ink-strong);
  }
  .recall-input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  .long-memory-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0 0.65rem;
    border: 1px solid var(--surface-edge);
    border-radius: 999px;
    color: var(--ink);
    font-size: 0.9rem;
    font-weight: 700;
    white-space: nowrap;
  }
  .long-memory-toggle input { accent-color: var(--accent); }
  button.primary {
    padding: 0.55rem 1.1rem;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 999px;
    font-weight: 700;
    cursor: pointer;
  }
  .empty-prompt { color: var(--ink-soft); line-height: 1.5; }
  .quoted { font-weight: 700; color: var(--ink-strong); }
  .result-count { margin: 0 0 0.75rem; color: var(--ink-soft); font-size: 0.95rem; }
  .hit-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .error-message { margin: 0 0 0.75rem; color: var(--accent); }
  .scope-banner {
    margin: 0 0 0.75rem;
    padding: 0.5rem 0.7rem;
    border: 1px solid var(--surface-edge);
    border-radius: 0.5rem;
    background: var(--surface);
    color: var(--ink);
  }
  .banner-link {
    margin-left: 0.4rem;
    color: var(--accent);
    font-weight: 700;
    text-decoration: none;
  }
  .banner-link:hover { text-decoration: underline; }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
