<!--
  RoomMemoryLauncher — in-room memory side-panel.
  
  Fetches room memories from /api/rooms/:roomId/memories and displays
  them as clickable links. Also provides a quick-add form for new
  memories (title + body).
-->
<script lang="ts">
  import { onMount } from 'svelte';

  type RoomMemory = {
    memoryId: string;
    title: string;
    body: string;
    createdAt: string;
    linkedRooms: string[];
    tags: string[];
  };

  type Props = { roomId: string };
  let { roomId }: Props = $props();

  let memories = $state<RoomMemory[]>([]);
  let loading = $state(true);
  let error = $state('');
  let showNewForm = $state(false);
  let newTitle = $state('');
  let newBody = $state('');
  let submitting = $state(false);
  let expandedId = $state<string | null>(null);

  async function loadMemories() {
    loading = true;
    error = '';
    try {
      const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/memories`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { memories: RoomMemory[] };
      memories = data.memories ?? [];
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load memories';
    } finally {
      loading = false;
    }
  }

  async function createMemory() {
    if (!newTitle.trim() || submitting) return;
    submitting = true;
    try {
      const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/memories`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: newTitle.trim(), body: newBody.trim(), tags: [] })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      newTitle = '';
      newBody = '';
      showNewForm = false;
      await loadMemories();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to create memory';
    } finally {
      submitting = false;
    }
  }

  onMount(() => { void loadMemories(); });
</script>

<section class="memory-panel" aria-labelledby="room-memory-heading">
  <div class="panel-header">
    <h2 id="room-memory-heading" class="heading">Room memories</h2>
    <button
      type="button"
      class="add-btn"
      onclick={() => showNewForm = !showNewForm}
      aria-label={showNewForm ? 'Cancel new memory' : 'Add new memory'}
    >
      {showNewForm ? '✕' : '+'}
    </button>
  </div>

  {#if showNewForm}
    <form class="new-form" onsubmit={(e) => { e.preventDefault(); void createMemory(); }}>
      <input
        type="text"
        placeholder="Memory title…"
        bind:value={newTitle}
        class="input"
        required
      />
      <textarea
        placeholder="What should be remembered?"
        bind:value={newBody}
        class="textarea"
        rows={3}
      ></textarea>
      <button type="submit" class="submit-btn" disabled={submitting || !newTitle.trim()}>
        {submitting ? 'Saving…' : 'Save memory'}
      </button>
    </form>
  {/if}

  {#if loading}
    <p class="status">Loading…</p>
  {:else if error}
    <p class="status err">{error}</p>
  {:else if memories.length === 0}
    <p class="status">No memories pinned to this room yet.</p>
  {:else}
    <ul class="memory-list" role="list">
      {#each memories as mem}
        <li class="memory-item">
          <button
            type="button"
            class="memory-title"
            onclick={() => expandedId = expandedId === mem.memoryId ? null : mem.memoryId}
            aria-expanded={expandedId === mem.memoryId}
          >
            <span class="title-text">{mem.title}</span>
            <span class="expand-icon">{expandedId === mem.memoryId ? '▾' : '▸'}</span>
          </button>
          {#if expandedId === mem.memoryId}
            <div class="memory-body">
              <p class="meta">{new Date(mem.createdAt).toLocaleString()} · {mem.tags.join(', ') || 'no tags'}</p>
              <pre class="body-text">{mem.body}</pre>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  <form method="GET" action="/memory" class="search-form">
    <input type="hidden" name="roomId" value={roomId} />
    <input
      name="q"
      type="search"
      placeholder="Search all room memory…"
      class="search-input"
    />
    <button type="submit" class="search-btn">Search</button>
  </form>
</section>

<style>
  .memory-panel {
    padding: 0.6rem 0;
  }
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  .heading {
    margin: 0;
    font-size: 0.95rem;
    color: var(--ink-strong);
  }
  .add-btn {
    width: 1.6rem;
    height: 1.6rem;
    border-radius: 999px;
    border: 1px solid var(--surface-edge);
    background: var(--surface-card);
    color: var(--ink-strong);
    font-size: 1rem;
    line-height: 1;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .add-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .new-form {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin-bottom: 0.6rem;
    padding: 0.5rem;
    border: 1px solid var(--surface-edge);
    border-radius: 0.5rem;
    background: var(--surface);
  }
  .input, .textarea {
    padding: 0.4rem 0.55rem;
    font-size: 0.9rem;
    border: 1px solid var(--surface-edge);
    border-radius: 0.4rem;
    background: var(--bg);
    color: var(--ink-strong);
    font-family: inherit;
  }
  .textarea { resize: vertical; }
  .submit-btn {
    align-self: flex-start;
    padding: 0.35rem 0.8rem;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 999px;
    font-weight: 700;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .submit-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .status {
    margin: 0.4rem 0;
    font-size: 0.85rem;
    color: var(--ink-soft);
  }
  .status.err { color: #c0392b; }
  .memory-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .memory-item {
    border: 1px solid var(--surface-edge);
    border-radius: 0.45rem;
    overflow: hidden;
  }
  .memory-title {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.45rem 0.6rem;
    background: var(--surface-card);
    border: none;
    color: var(--ink-strong);
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
    text-align: left;
  }
  .memory-title:hover {
    background: color-mix(in srgb, var(--accent, #6b21a8) 6%, var(--surface-card));
  }
  .title-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .expand-icon {
    font-size: 0.75rem;
    color: var(--ink-soft);
    flex-shrink: 0;
  }
  .memory-body {
    padding: 0.5rem 0.6rem;
    background: var(--surface);
    border-top: 1px solid var(--surface-edge);
  }
  .meta {
    margin: 0 0 0.3rem;
    font-size: 0.75rem;
    color: var(--ink-soft);
  }
  .body-text {
    margin: 0;
    font-size: 0.85rem;
    line-height: 1.4;
    color: var(--ink-strong);
    white-space: pre-wrap;
    font-family: inherit;
  }
  .search-form {
    display: flex;
    gap: 0.4rem;
    margin-top: 0.6rem;
    padding-top: 0.6rem;
    border-top: 1px solid var(--surface-edge);
  }
  .search-input {
    flex: 1;
    padding: 0.4rem 0.55rem;
    font-size: 0.85rem;
    border: 1px solid var(--surface-edge);
    border-radius: 0.4rem;
    background: var(--bg);
    color: var(--ink-strong);
  }
  .search-btn {
    padding: 0.4rem 0.7rem;
    background: var(--surface-card);
    color: var(--ink-strong);
    border: 1px solid var(--surface-edge);
    border-radius: 999px;
    font-weight: 700;
    font-size: 0.8rem;
    cursor: pointer;
  }
  .search-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
</style>
