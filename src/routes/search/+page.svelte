<!--
  Search route — find a message in any room.
  Backs M14 search-across-rooms slice 2 (page UI).

  The form submits as a plain GET to /search?q=value. The browser
  navigates, +page.ts runs server-side, and the first HTML response
  already carries the hits. No client-side fetch needed for the happy
  path — same SSR-first pattern as /chair.

  $derived(data.x) lets a follow-up navigation (typing a new query and
  hitting Enter) refresh the hits without a state copy.
-->
<script lang="ts">
  import { onMount, tick } from 'svelte';
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import Explainable from '$lib/components/Explainable.svelte';
  import type { MessageSearchHit } from '$lib/server/messageSearchStore';

  type Props = {
    data: {
      queryFromServer: string;
      roomIdFromServer: string;
      hitsFromServer: MessageSearchHit[];
      searchFetchFailed: boolean;
    };
  };

  let { data }: Props = $props();

  const queryFromServer = $derived<string>(data.queryFromServer);
  const roomIdFromServer = $derived<string>(data.roomIdFromServer);
  const hitsFromServer = $derived<MessageSearchHit[]>(data.hitsFromServer);
  const searchFetchFailed = $derived<boolean>(data.searchFetchFailed);

  function postedTimeFor(postedAt: string): string {
    const moment = new Date(postedAt);
    if (Number.isNaN(moment.getTime())) return postedAt;
    return moment.toLocaleString();
  }

  // Auto-focus the search input on first paint + after a navigation
  // refresh so the page feels typing-ready. Cursor lands at the end of
  // any pre-filled query so the operator can keep refining.
  let searchInput: HTMLInputElement | null = $state(null);
  onMount(() => { void focusSearchInput(); });
  $effect(() => {
    // Re-focus when navigations swap queryFromServer (e.g. the chip
    // clear, or a new room context). Read it so the effect tracks.
    void queryFromServer;
    void focusSearchInput();
  });
  async function focusSearchInput() {
    await tick();
    if (!searchInput) return;
    searchInput.focus({ preventScroll: true });
    const len = searchInput.value.length;
    try { searchInput.setSelectionRange(len, len); } catch { /* type='search' may not support */ }
  }

  function previewBody(body: string): string {
    const oneLine = body.replace(/\s+/g, ' ').trim();
    if (oneLine.length <= 220) return oneLine;
    return oneLine.slice(0, 217) + '…';
  }
</script>

<svelte:head>
  <title>Search | ANT vNext</title>
</svelte:head>

<SimplePageShell
  eyebrow="Search"
  title="Find a message"
  summary={roomIdFromServer
    ? 'Search this room. Type a phrase and hit Enter.'
    : 'Search every chat room you can reach. Type a phrase and hit Enter.'}
>
  <form method="GET" action="/search" class="search-form">
    {#if roomIdFromServer}
      <input type="hidden" name="roomId" value={roomIdFromServer} />
    {/if}
    <label for="searchQueryField" class="visually-hidden">Search query</label>
    <Explainable explainKey="search-input">
    <input
      bind:this={searchInput}
      id="searchQueryField"
      name="q"
      type="search"
      autocomplete="off"
      placeholder="Type a word or phrase…"
      value={queryFromServer}
      class="search-input"
    />
    <button type="submit" class="primary">Search</button>
    </Explainable>
  </form>

  {#if roomIdFromServer}
    <p class="filter-strip" aria-label="Active filters">
      <span class="filter-label">Filtered to:</span>
      <span class="filter-chip">
        room <code>{roomIdFromServer}</code>
        <a
          class="filter-clear"
          href={`/search${queryFromServer ? '?q=' + encodeURIComponent(queryFromServer) : ''}`}
          aria-label="Clear room filter"
        >×</a>
      </span>
    </p>
  {/if}

  {#if searchFetchFailed}
    <p class="error-message" role="alert">
      Could not run the search just now. Try again in a moment.
    </p>
  {:else if queryFromServer.length === 0}
    <p class="empty-prompt">
      Start by typing a word or phrase above. Search looks at every message in
      every chat room, including system notices and break dividers.
    </p>
  {:else if hitsFromServer.length === 0}
    <p class="empty-prompt">
      Nothing matches "<span class="quoted">{queryFromServer}</span>" yet.
      Try a different word, or check the spelling.
    </p>
  {:else}
    <p class="result-count">
      Found {hitsFromServer.length}
      {hitsFromServer.length === 1 ? 'match' : 'matches'} for
      "<span class="quoted">{queryFromServer}</span>".
    </p>
    <ul class="hit-list" aria-label="Search results">
      {#each hitsFromServer as hit (hit.message.id)}
        <li class="hit-card">
          <div class="hit-header">
            <a class="room-link" href="/rooms/{hit.roomId}">{hit.roomName}</a>
            <span class="author">{hit.message.authorDisplayName}</span>
            <span class="posted-time">{postedTimeFor(hit.message.postedAt)}</span>
          </div>
          <p class="hit-body">{previewBody(hit.message.body)}</p>
        </li>
      {/each}
    </ul>
  {/if}
</SimplePageShell>

<style>
  .search-form {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1.25rem;
  }

  .search-input {
    flex: 1;
    padding: 0.55rem 0.75rem;
    font-size: 1rem;
    border: 1px solid var(--surface-edge);
    border-radius: 0.5rem;
    background: var(--bg);
    color: var(--ink-strong);
  }

  .search-input:focus {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  button.primary {
    padding: 0.55rem 1.1rem;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 999px;
    font-weight: 700;
    cursor: pointer;
  }

  .empty-prompt {
    color: var(--ink-soft);
    line-height: 1.5;
  }

  /* Search filter UI — active filter chip with one-click clear. */
  .filter-strip {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    margin: 0 0 0.85rem;
    color: var(--ink-soft);
    font-size: 0.85rem;
    flex-wrap: wrap;
  }
  .filter-label {
    font-weight: 700;
    text-transform: uppercase;
    font-size: 0.72rem;
    letter-spacing: 0.05em;
  }
  .filter-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.18rem 0.55rem 0.18rem 0.7rem;
    border: 1px solid var(--accent);
    border-radius: 999px;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    font-weight: 700;
  }
  .filter-chip code {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 0.82rem;
    color: var(--accent);
  }
  .filter-clear {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.3rem;
    height: 1.3rem;
    border-radius: 999px;
    color: var(--accent);
    text-decoration: none;
    font-size: 1rem;
    font-weight: 800;
    line-height: 1;
  }
  .filter-clear:hover {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
  }

  .quoted {
    font-weight: 700;
    color: var(--ink-strong);
  }

  .result-count {
    margin: 0 0 0.75rem;
    color: var(--ink-soft);
    font-size: 0.95rem;
  }

  .hit-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .hit-card {
    padding: 0.85rem 1rem;
    border: 1px solid var(--surface-edge);
    border-radius: 0.65rem;
    background: var(--surface);
  }

  .hit-header {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.6rem;
    margin-bottom: 0.35rem;
    font-size: 0.9rem;
    color: var(--ink-soft);
  }

  .room-link {
    font-weight: 700;
    color: var(--accent);
    text-decoration: none;
  }

  .room-link:hover {
    text-decoration: underline;
  }

  .author {
    font-weight: 600;
    color: var(--ink);
  }

  .posted-time {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
  }

  .hit-body {
    margin: 0;
    line-height: 1.45;
    color: var(--ink-strong);
  }

  .error-message {
    margin: 0 0 0.75rem;
    color: var(--accent);
  }

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
