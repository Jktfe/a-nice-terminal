<!--
  /manual — Every screen. One board.

  JWPK msg_748kn8qsjg + msg_2e53usy9yy + msg_56fssuhvi2:
  "very detailed and real screen sized". Slice 2 rebuild: tiles are now
  full screen-size (1280×800) instead of mini-cards, so when an operator
  zooms in they actually see screen content not a thumbnail label.

  Coordinates: 1px = 1px at zoom=1. Default zoom 0.18 so the whole 5500×4000
  canvas fits in a desktop viewport on first load; zoom in for detail.
  Pan + pinch zoom interactions wired; +/- buttons step in increments
  that hit useful read levels (40% = browse, 100% = pixel-perfect screen).

  Slice 3 (next commit if scope holds): inject the real Playwright-harvested
  screenshots as tile backgrounds. Slice 4: hoverable region overlays with
  function names + CLI verbs sourced from /api/discover + per-route sidecars.

  2026-05-21 split: tile/rail/toolbar sub-components extracted to
  $lib/components/Manual*.svelte; cluster + tile data lives in
  $lib/manual/ManualBoardData.ts to keep this route under the 600-line cap.
-->
<script lang="ts">
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import ManualTile from '$lib/components/ManualTile.svelte';
  import ManualRail from '$lib/components/ManualRail.svelte';
  import ManualToolbar from '$lib/components/ManualToolbar.svelte';
  import {
    CLUSTERS,
    HEADER_H,
    CLUSTER_PAD,
    clusterWidth,
    clusterHeight
  } from '$lib/manual/ManualBoardData';

  let zoom = $state(0.18);
  let panX = $state(0);
  let panY = $state(0);
  let isDragging = $state(false);
  let dragStartX = 0;
  let dragStartY = 0;
  let panStartX = 0;
  let panStartY = 0;
  let hoveredTile = $state<{ clusterId: string; slug: string } | null>(null);
  // Slice 4: click-to-pin state, lifted from the UX mockup interaction
  // pattern (docs/mockups/manual-rail-2026-05-19.html). Pinned tile
  // surfaces in the right rail; Esc clears the pin. The pinned tile
  // OVERRIDES the hover in the rail so the operator can mouse around
  // freely while reading the rail.
  let pinnedTile = $state<{ clusterId: string; slug: string } | null>(null);

  const railTile = $derived.by(() => {
    const target = pinnedTile ?? hoveredTile;
    if (!target) return null;
    const cluster = CLUSTERS.find((c) => c.id === target.clusterId);
    if (!cluster) return null;
    const tile = cluster.tiles.find((t) => t.slug === target.slug);
    if (!tile) return null;
    return { cluster, tile };
  });

  function pinTile(clusterId: string, slug: string): void {
    if (pinnedTile?.clusterId === clusterId && pinnedTile?.slug === slug) {
      pinnedTile = null;
      return;
    }
    pinnedTile = { clusterId, slug };
  }

  function clearPin(): void {
    pinnedTile = null;
  }

  $effect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && pinnedTile !== null) clearPin();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  function handlePointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    isDragging = true;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    panStartX = panX;
    panStartY = panY;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent): void {
    if (!isDragging) return;
    panX = panStartX + (event.clientX - dragStartX);
    panY = panStartY + (event.clientY - dragStartY);
  }

  function handlePointerUp(event: PointerEvent): void {
    if (!isDragging) return;
    isDragging = false;
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
  }

  function setZoom(next: number): void {
    zoom = Math.max(0.1, Math.min(1.5, next));
  }

  function fitToView(): void {
    zoom = 0.18;
    panX = 0;
    panY = 0;
  }
</script>

<script lang="ts" module>
  // Slice 4 (JWPK + UX msg_p16esv9ehx mockup lift): rail-pin state.
  // Lifted shape from docs/mockups/manual-rail-2026-05-19.html:
  //   hover = transient peek (no rail change), click = pin (rail opens
  //   to that tile), Esc = clear pin. Sticky right rail on desktop ≥
  //   1100px wide; collapses below.
</script>

<svelte:head>
  <title>Screens canvas · Every screen. One board. · ANT</title>
</svelte:head>

<SimplePageShell showIntro={false}>
  <header class="manual-header">
    <nav class="discover-subnav" aria-label="Discover sections">
      <span class="subnav-label">Discover:</span>
      <a class="subnav-link" href="/discover">CLI verbs</a>
      <a class="subnav-link" href="/discover/visuals">Visuals</a>
      <a class="subnav-link" href="/discover/vocab">Vocab</a>
      <a class="subnav-link active" href="/manual" aria-current="page">Screens canvas</a>
    </nav>
    <h1>Screens canvas</h1>
    <p class="manual-tagline">Every screen. One board.</p>
    <p class="manual-intro">
      Every page in ANT laid out together. Drag the canvas to pan, use + / − to
      zoom from board-overview to pixel-perfect. Click any tile to pin its
      detail in the side rail; <kbd>Esc</kbd> to clear.
    </p>
    <p class="manual-stale-note" role="note">
      <strong>Tile screenshots are from May 20.</strong> Several surfaces have
      shipped since (PID-as-identity aliases, per-human inbox + asks-as-pill,
      rooms-sort-by-message-activity, new <code>ant artefact</code> /
      <code>ant attach</code> / <code>ant ask</code> CLI verbs). The cluster
      shape + navigation is current; the rendered pixels are not. Re-harvest
      via the Playwright collection script when next freed up.
    </p>
  </header>

  <ManualToolbar
    {zoom}
    onZoomOut={() => setZoom(zoom * 0.8)}
    onZoomIn={() => setZoom(zoom * 1.25)}
    onFit={fitToView}
    onZoomTo={setZoom}
  />

  <div class="manual-stage" class:rail-open={railTile !== null}>
  <section
    class="manual-canvas"
    aria-label="Manual canvas"
    onpointerdown={handlePointerDown}
    onpointermove={handlePointerMove}
    onpointerup={handlePointerUp}
    onpointercancel={handlePointerUp}
  >
    <div
      class="manual-plane"
      style="transform: translate({panX}px, {panY}px) scale({zoom});"
    >
      {#each CLUSTERS as cluster (cluster.id)}
        {@const cW = clusterWidth(cluster)}
        {@const cH = clusterHeight(cluster)}
        <div class="cluster" style="left: {cluster.x}px; top: {cluster.y}px; width: {cW}px; height: {cH}px; background: {cluster.color};">
          <header class="cluster-header" style="height: {HEADER_H}px;">
            <h2>{cluster.name}</h2>
            <p>{cluster.description}</p>
          </header>
          <div class="cluster-tiles" style="left: {CLUSTER_PAD}px; top: {HEADER_H + CLUSTER_PAD / 2}px;">
            {#each cluster.tiles as tile (tile.slug)}
              <ManualTile
                {tile}
                isHovered={hoveredTile?.clusterId === cluster.id && hoveredTile?.slug === tile.slug}
                isPinned={pinnedTile?.clusterId === cluster.id && pinnedTile?.slug === tile.slug}
                onEnter={() => { hoveredTile = { clusterId: cluster.id, slug: tile.slug }; }}
                onLeave={() => { hoveredTile = null; }}
                onClick={(event) => { event.stopPropagation(); pinTile(cluster.id, tile.slug); }}
              />
            {/each}
          </div>
        </div>
      {/each}
    </div>
  </section>

  <!-- Slice 4: right rail. Surfaces the hovered/pinned tile's metadata
       (route, plain description, powering functions, CLI verbs) so
       operators can read tile detail without zooming. Pinned tile wins
       over hovered for stable reading. -->
  {#if railTile}
    <ManualRail
      cluster={railTile.cluster}
      tile={railTile.tile}
      isPinned={pinnedTile !== null}
      onClose={clearPin}
    />
  {/if}
  </div>

  <p class="manual-footnote">
    Manual canvas — full screen-size tiles with real Playwright-harvested screenshots
    + a per-tile detail rail (hover for transient peek, click to pin, <kbd>Esc</kbd>
    to clear). All copy reads at a 6-year-old level by design (JWPK rule: documentation
    is accessible-English-proof). Region-level overlays per tile (lifted from the UX mockup pattern)
    are the next slice once per-tile coord data is hand-authored.
  </p>
</SimplePageShell>

<style>
  .manual-header {
    margin-bottom: 1rem;
  }
  .manual-header h1 {
    margin: 0;
    font-size: 1.9rem;
    font-weight: 900;
    color: var(--ink-strong);
  }
  .manual-tagline {
    margin: 0.2rem 0 0.5rem;
    font-size: 1.05rem;
    color: var(--accent);
    font-weight: 800;
  }
  .manual-intro {
    margin: 0;
    color: var(--ink-soft);
    max-width: 60ch;
    line-height: 1.5;
  }
  .manual-stale-note {
    margin: 0.85rem 0 0;
    padding: 0.65rem 0.85rem;
    max-width: 65ch;
    background: color-mix(in srgb, #d97706 12%, var(--surface-card));
    border-left: 3px solid #d97706;
    border-radius: 0.4rem;
    color: var(--ink-strong);
    font-size: 0.85rem;
    line-height: 1.5;
  }
  .manual-stale-note strong {
    color: #d97706;
  }
  .manual-stale-note code {
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 0.92em;
    background: color-mix(in srgb, var(--ink-strong) 6%, transparent);
    padding: 0.05em 0.3em;
    border-radius: 0.25em;
  }
  /* Subnav lifted from /discover/visuals so all four pillar pages share one
     consistent header navigation. */
  .discover-subnav {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-wrap: wrap;
    margin: 0 0 0.85rem;
    font-size: 0.86rem;
  }
  .subnav-label {
    color: var(--ink-soft);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-size: 0.72rem;
  }
  .subnav-link {
    padding: 0.2rem 0.55rem;
    border-radius: 0.35rem;
    border: 1px solid var(--surface-edge);
    background: var(--surface-card);
    color: var(--ink-strong);
    text-decoration: none;
    font-weight: 700;
  }
  .subnav-link:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .subnav-link.active {
    background: var(--accent);
    color: var(--surface-card);
    border-color: var(--accent);
  }
  /* Slice 4 rail layout — two columns when rail is open, single column
     otherwise. Mobile (<1100px) always single-column; rail stacks below
     the canvas. */
  .manual-stage {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.85rem;
    align-items: start;
  }
  .manual-stage.rail-open {
    grid-template-columns: 1fr min(22rem, 30vw);
  }
  @media (max-width: 1100px) {
    .manual-stage.rail-open { grid-template-columns: 1fr; }
  }
  .manual-canvas {
    position: relative;
    width: 100%;
    height: 78vh;
    min-height: 640px;
    overflow: hidden;
    border: 1px solid var(--surface-edge);
    border-radius: 1rem;
    background:
      radial-gradient(circle at 24px 24px, var(--surface-edge) 1px, transparent 1px) 0 0 / 48px 48px,
      var(--bg);
    cursor: grab;
    touch-action: none;
    user-select: none;
  }
  .manual-canvas:active {
    cursor: grabbing;
  }
  .manual-plane {
    position: absolute;
    inset: 0;
    transform-origin: 0 0;
    transition: transform 110ms ease-out;
    will-change: transform;
  }
  .cluster {
    position: absolute;
    border-radius: 32px;
    border: 2px solid color-mix(in srgb, var(--ink-strong) 14%, transparent);
    box-shadow: 0 24px 80px rgba(20, 18, 14, 0.10);
    overflow: hidden;
  }
  .cluster-header {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    padding: 36px 56px 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 8px;
  }
  .cluster-header h2 {
    margin: 0;
    font-size: 56px;
    font-weight: 900;
    color: var(--ink-strong);
    line-height: 1;
  }
  .cluster-header p {
    margin: 0;
    font-size: 26px;
    color: var(--ink-soft);
    line-height: 1.3;
  }
  .cluster-tiles {
    position: absolute;
  }
  .manual-footnote {
    margin: 1.1rem 0 0;
    color: var(--ink-soft);
    font-size: 0.82rem;
    line-height: 1.5;
    max-width: 72ch;
  }
  .manual-footnote kbd {
    padding: 0.05rem 0.35rem;
    background: var(--bg);
    border: 1px solid var(--line-soft);
    border-radius: 0.25rem;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 0.7rem;
  }
</style>
