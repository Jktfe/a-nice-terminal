<!--
  ManualRail — right-side detail panel for the /manual board. Extracted
  from src/routes/manual/+page.svelte (2026-05-21) to keep the route under
  the 600-line component cap.

  Slice 4: surfaces the hovered/pinned tile's metadata (route, plain
  description, powering functions, CLI verbs) so operators can read tile
  detail without zooming. Pinned tile wins over hovered for stable
  reading. Pattern lifted from docs/mockups/manual-rail-2026-05-19.html.
-->
<script lang="ts">
  import type { Cluster, Tile } from '$lib/manual/ManualBoardData';

  type Props = {
    cluster: Cluster;
    tile: Tile;
    isPinned: boolean;
    onClose: () => void;
  };

  let { cluster, tile, isPinned, onClose }: Props = $props();
</script>

<aside class="manual-rail" aria-label="Manual rail">
  <header class="rail-header">
    <div class="rail-crumb">{cluster.name} → {tile.title}</div>
    <button type="button" class="rail-close" onclick={onClose} title={isPinned ? 'Unpin (Esc)' : 'Hover-only'} aria-label={isPinned ? 'Unpin tile' : 'Hovering'}>
      {isPinned ? '×' : '…'}
    </button>
  </header>
  <h2 class="rail-title">{tile.title}</h2>
  <p class="rail-plain">{tile.plain}</p>
  <div class="rail-route">
    <span class="rail-label">Route</span>
    <code>{tile.route}</code>
  </div>
  <div class="rail-section">
    <span class="rail-label">Powers</span>
    <ul class="rail-list">
      {#each tile.functions as fn (fn)}
        <li><code>{fn}</code></li>
      {/each}
    </ul>
  </div>
  <div class="rail-section">
    <span class="rail-label">CLI</span>
    <ul class="rail-list">
      {#each tile.cliVerbs as verb (verb)}
        <li><code>{verb}</code></li>
      {/each}
    </ul>
  </div>
  <p class="rail-hint">
    {isPinned ? 'Pinned — Esc to clear' : 'Click any tile to pin'}
  </p>
</aside>

<style>
  /* Right rail panel — pattern lifted from
     docs/mockups/manual-rail-2026-05-19.html. Sticky at top so the
     content stays put while the canvas pans + zooms. */
  .manual-rail {
    position: sticky;
    top: 1rem;
    align-self: start;
    max-height: calc(100vh - 2rem);
    overflow-y: auto;
    padding: 1.1rem 1.2rem;
    background: var(--surface-card);
    border: 1px solid var(--line-soft);
    border-radius: 0.85rem;
    box-shadow: 0 12px 32px rgba(15, 23, 42, 0.06);
    font-size: 0.85rem;
    color: var(--ink-strong);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .rail-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--line-soft);
  }
  .rail-crumb {
    color: var(--ink-soft);
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 700;
  }
  .rail-close {
    width: 1.7rem; height: 1.7rem;
    display: inline-flex; align-items: center; justify-content: center;
    border: 1px solid var(--line-soft); border-radius: 999px;
    background: transparent; color: var(--ink-soft);
    font-size: 1rem; font-weight: 700; cursor: pointer; line-height: 1;
  }
  .rail-close:hover { color: var(--accent); border-color: var(--accent); }
  .rail-title { margin: 0; font-size: 1rem; font-weight: 800; color: var(--ink-strong); }
  .rail-plain { margin: 0; color: var(--ink-soft); line-height: 1.5; }
  .rail-route, .rail-section {
    display: flex; flex-direction: column; gap: 0.25rem;
  }
  .rail-label {
    color: var(--ink-soft);
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 700;
  }
  .rail-route code {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 0.82rem;
    padding: 0.25rem 0.5rem;
    background: var(--bg);
    border-radius: 0.35rem;
    align-self: flex-start;
  }
  .rail-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .rail-list code {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 0.78rem;
    padding: 0.2rem 0.45rem;
    background: var(--bg);
    border: 1px solid var(--line-soft);
    border-radius: 0.35rem;
    color: var(--ink-strong);
    display: inline-block;
  }
  .rail-hint {
    margin: 0.4rem 0 0;
    padding-top: 0.5rem;
    border-top: 1px solid var(--line-soft);
    color: var(--ink-soft);
    font-size: 0.74rem;
    font-style: italic;
  }
</style>
