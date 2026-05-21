<!--
  /rooms/[roomId]/decks — human-readable listing of decks attached to a
  single room. JWPK flagged that the JSON API path
  (/api/chat-rooms/:roomId/decks) wasn't browsable; this page is the
  on-screen counterpart. Each row links to /decks/:deckId (the shareable
  viewer) and shows slide count + created/updated stamps.
-->
<script lang="ts">
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const decks = $derived(data.decks);
</script>

<svelte:head><title>Decks · room {data.roomId} | ANT vNext</title></svelte:head>

<SimplePageShell
  eyebrow="Decks"
  title={`Decks in room ${data.roomId}.`}
  summary={`${decks.length} deck${decks.length === 1 ? '' : 's'} attached to this room.`}
>
  <a class="back" href={`/rooms/${encodeURIComponent(data.roomId)}`}>← Back to room</a>

  {#if decks.length === 0}
    <p class="empty-nudge">
      No decks yet in this room. Decks are shareable slide presentations — create one with the
      <code>POST /api/chat-rooms/{data.roomId}/decks</code> endpoint
      (body: <code>{`{"title": "...", "slides": [...]}`}</code>) and it will appear here.
    </p>
  {:else}
    <ul class="deck-list">
      {#each decks as deck (deck.id)}
        <li class="deck-row">
          <a class="deck-link" href={`/decks/${encodeURIComponent(deck.id)}`}>
            <span class="deck-title">{deck.title}</span>
            <span class="deck-meta">
              {deck.slides.length} slide{deck.slides.length === 1 ? '' : 's'}
              {#if deck.createdBy} · by {deck.createdBy}{/if}
              · created {new Date(deck.createdAtMs).toLocaleDateString()}
              {#if deck.updatedAtMs} · updated {new Date(deck.updatedAtMs).toLocaleDateString()}{/if}
            </span>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</SimplePageShell>

<style>
  .back {
    display: inline-block;
    margin-bottom: 0.85rem;
    color: var(--ink-soft);
    text-decoration: none;
    font-weight: 700;
    font-size: 0.85rem;
  }
  .back:hover { color: var(--accent); }
  .empty-nudge {
    margin: 0;
    padding: 1rem 1.1rem;
    border: 1px dashed var(--surface-edge);
    border-radius: 0.85rem;
    background: var(--bg);
    color: var(--ink-strong);
    line-height: 1.5;
  }
  .empty-nudge code {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.85rem;
    padding: 0.05rem 0.35rem;
    border-radius: 0.3rem;
    background: var(--surface-card);
  }
  .deck-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.55rem; }
  .deck-row {
    border: 1px solid var(--line-soft);
    border-radius: 0.85rem;
    background: var(--surface-card);
  }
  .deck-link {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.95rem 1.05rem;
    text-decoration: none;
    color: inherit;
    transition: border-color 0.12s;
  }
  .deck-link:hover .deck-title { color: var(--accent); }
  .deck-row:hover { border-color: var(--accent); }
  .deck-title { font-weight: 800; color: var(--ink-strong); font-size: 1.02rem; transition: color 0.12s; }
  .deck-meta { font-size: 0.82rem; color: var(--ink-soft); }
</style>
