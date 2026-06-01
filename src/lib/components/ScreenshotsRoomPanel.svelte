<!--
  ScreenshotsRoomPanel — Task #132 v3-parity: room screenshot gallery.

  Fetches from /api/chat-rooms/:roomId/screenshots and renders a
  compact grid. Each thumbnail links to the full PNG path.
-->
<script lang="ts">
  type Screenshot = {
    sha: string;
    room_id: string;
    taken_by: string;
    taken_at_ms: number;
    bytes: number;
    topic: string | null;
    dimensions: string | null;
    deck_slug: string | null;
  };

  type Props = {
    roomId: string;
  };

  let { roomId }: Props = $props();

  let screenshots = $state<Screenshot[]>([]);
  let isLoading = $state(true);
  let lastError = $state('');

  async function refresh() {
    try {
      const res = await fetch(`/api/chat-rooms/${encodeURIComponent(roomId)}/screenshots`);
      if (!res.ok) throw new Error(`Could not load screenshots (${res.status}).`);
      const body = (await res.json()) as { screenshots: Screenshot[] };
      screenshots = body.screenshots ?? [];
    } catch (e) {
      lastError = e instanceof Error ? e.message : 'Failed to load screenshots.';
    } finally {
      isLoading = false;
    }
  }

  function formatSize(b: number): string {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatTime(ms: number): string {
    const d = new Date(ms);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  refresh();
</script>

<div class="screenshots-panel">
  {#if isLoading}
    <p class="screenshots-loading">Loading screenshots…</p>
  {:else if lastError}
    <p class="screenshots-error">{lastError}</p>
  {:else if screenshots.length === 0}
    <p class="screenshots-empty">No screenshots in this room yet.</p>
  {:else}
    <div class="screenshots-grid">
      {#each screenshots as shot}
        <a class="screenshot-thumb" href={`/uploads/${shot.room_id}/${shot.sha}.png`} target="_blank">
          <img src={`/uploads/${shot.room_id}/${shot.sha}.png`} alt={shot.topic ?? 'Screenshot'} loading="lazy" />
          <span class="screenshot-meta">
            {shot.taken_by} · {formatSize(shot.bytes)}
            {#if shot.dimensions}· {shot.dimensions}{/if}
            · {formatTime(shot.taken_at_ms)}
          </span>
        </a>
      {/each}
    </div>
  {/if}
</div>

<style>
  .screenshots-panel { padding: 0.5rem 0; }
  .screenshots-loading, .screenshots-error, .screenshots-empty { color: #888; font-size: 0.875rem; }
  .screenshots-error { color: #c00; }
  .screenshots-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 0.5rem;
  }
  .screenshot-thumb {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    text-decoration: none;
    color: inherit;
    border-radius: 0.375rem;
    overflow: hidden;
    background: #f5f5f5;
  }
  .screenshot-thumb img {
    width: 100%;
    height: 100px;
    object-fit: cover;
    display: block;
  }
  .screenshot-meta {
    font-size: 0.7rem;
    color: #666;
    padding: 0 0.25rem 0.25rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
