<!--
  ManualTile — one tile on the /manual canvas. Extracted from
  src/routes/manual/+page.svelte (2026-05-21) to keep the route under the
  600-line component cap. Pure presentation; pointer events bubble back to
  the parent via callback props so hover/pin state lives in one place.
-->
<script lang="ts">
  import type { Tile } from '$lib/manual/ManualBoardData';
  import { TILE_W, TILE_H } from '$lib/manual/ManualBoardData';

  type Props = {
    tile: Tile;
    isHovered: boolean;
    isPinned: boolean;
    onEnter: () => void;
    onLeave: () => void;
    onClick: (event: MouseEvent) => void;
  };

  let { tile, isHovered, isPinned, onEnter, onLeave, onClick }: Props = $props();
</script>

<!-- Manual is a visual canvas: tiles are positioned absolutely and act as pointer-affordance landmarks. Keyboard navigation through the manual is via the cluster filter buttons + URL-anchor links inside each tile; the tile-itself click is a redundant convenience. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<article
  class="tile"
  class:tile-hover={isHovered}
  class:tile-pinned={isPinned}
  style="left: {tile.x}px; top: {tile.y}px; width: {TILE_W}px; height: {TILE_H}px;"
  onpointerenter={onEnter}
  onpointerleave={onLeave}
  onclick={onClick}
>
  <header class="tile-header">
    <h3>{tile.title}</h3>
    <code class="tile-route">{tile.route}</code>
  </header>
  <p class="tile-plain">{tile.plain}</p>

  <!-- Real Playwright-harvested screenshot via scripts/manual-
       harvest.mjs (slice 3). PNG lives in external asset root at
       manual/<slug>.png, served by /api/assets. object-fit:contain so the image
       respects the placeholder box without distortion. The
       fallback for any tile whose harvest failed is the dashed
       placeholder block below. -->
  <div class="tile-screenshot">
    <img
      src={`/api/assets/manual/${tile.slug}.png`}
      alt={`Screenshot of ${tile.title}`}
      loading="lazy"
      onerror={(e) => {
        const img = e.currentTarget as HTMLImageElement;
        img.style.display = 'none';
        const fallback = img.nextElementSibling as HTMLElement | null;
        if (fallback) fallback.style.display = 'flex';
      }}
    />
    <div class="tile-screenshot-fallback" style="display: none;">
      <span class="tile-screenshot-label">screenshot of {tile.route}</span>
      <span class="tile-screenshot-sub">capture pending — run scripts/manual-harvest.mjs</span>
    </div>
  </div>

  <footer class="tile-footer">
    <div class="tile-detail tile-functions">
      <span class="tile-detail-label">Powers</span>
      {#each tile.functions as fn (fn)}
        <code>{fn}</code>
      {/each}
    </div>
    <div class="tile-detail tile-cli">
      <span class="tile-detail-label">CLI</span>
      {#each tile.cliVerbs as verb (verb)}
        <code>{verb}</code>
      {/each}
    </div>
  </footer>
</article>

<style>
  .tile {
    position: absolute;
    padding: 36px 44px 30px;
    border-radius: 22px;
    border: 1px solid var(--surface-edge);
    background: var(--surface-card);
    display: grid;
    grid-template-rows: auto auto 1fr auto;
    gap: 18px;
    box-shadow: 0 12px 40px rgba(20, 18, 14, 0.06);
    transition: transform 140ms ease-out, box-shadow 140ms ease-out, border-color 140ms ease-out;
  }
  .tile:hover,
  .tile.tile-hover {
    transform: translateY(-6px);
    box-shadow: 0 32px 80px rgba(20, 18, 14, 0.14);
    border-color: var(--accent);
  }
  .tile-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 24px;
    flex-wrap: wrap;
  }
  .tile-header h3 {
    margin: 0;
    font-size: 44px;
    font-weight: 900;
    color: var(--ink-strong);
    line-height: 1.1;
  }
  .tile-route {
    padding: 6px 16px;
    border-radius: 8px;
    background: var(--bg);
    color: var(--ink-soft);
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 22px;
  }
  .tile-plain {
    margin: 0;
    font-size: 26px;
    color: var(--ink-strong);
    line-height: 1.4;
  }
  .tile-screenshot {
    border: 1px solid var(--surface-edge);
    border-radius: 16px;
    background: var(--bg);
    overflow: hidden;
    position: relative;
    min-height: 0;
  }
  .tile-screenshot img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: top left;
    display: block;
  }
  .tile-screenshot-fallback {
    position: absolute;
    inset: 0;
    border: 2px dashed var(--surface-edge);
    border-radius: 16px;
    background: var(--bg);
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: var(--ink-soft);
  }
  .tile-screenshot-label {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 28px;
    font-weight: 700;
    color: var(--ink-strong);
  }
  .tile-screenshot-sub {
    font-size: 20px;
    color: var(--ink-soft);
    letter-spacing: 0.04em;
  }
  .tile-footer {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .tile-detail {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
  }
  .tile-detail-label {
    font-size: 20px;
    font-weight: 800;
    color: var(--ink-soft);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-right: 6px;
  }
  .tile-detail code {
    padding: 6px 14px;
    border-radius: 999px;
    background: var(--bg);
    color: var(--ink-strong);
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 20px;
  }
  .tile-cli code {
    border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 6%, transparent);
  }
  /* Slice 4: tile pinned state — accent ring + slight scale so the
     pinned tile reads as 'this is the one in the rail'. Hover stays
     a softer dashed outline (in the existing .tile-hover rule). */
  .tile-pinned {
    outline: 2px solid var(--accent);
    outline-offset: 4px;
    z-index: 4;
  }
</style>
