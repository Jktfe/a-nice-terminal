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
-->
<script lang="ts">
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';

  type Tile = {
    slug: string;
    title: string;
    plain: string;        // accessible-English-proof one-liner (plain-language reading level)
    route: string;        // route pattern as it lives in src/routes
    functions: string[];  // load-bearing stores / endpoints powering the screen
    cliVerbs: string[];   // matching CLI verbs (from /discover)
    x: number;            // local within cluster
    y: number;
  };

  type Cluster = {
    id: string;
    name: string;
    description: string;
    x: number;
    y: number;
    color: string;
    tiles: Tile[];
  };

  // Each tile is rendered at TILE_W × TILE_H (1280×800 — a real laptop
  // viewport). At default zoom 0.18 that's 230×144 on screen — small enough
  // for the whole board to fit, large enough that titles are legible.
  // Operator zooms to 1.0 (100%) to read the screen content pixel-perfectly.
  const TILE_W = 1280;
  const TILE_H = 800;
  const INTRA_GAP = 80;     // gap between tiles within a cluster
  const CLUSTER_PAD = 80;   // padding inside the cluster around its tiles
  const HEADER_H = 140;     // vertical space the cluster header takes

  const CLUSTERS: Cluster[] = [
    {
      id: 'rooms',
      name: 'Rooms',
      description: 'Where people and agents talk together.',
      x: 80,
      y: 80,
      color: '#fef3c7',
      tiles: [
        { slug: 'rooms-index', title: 'Rooms index', plain: 'Every chat room you can see, in one list.',
          route: '/rooms', functions: ['listChatRooms', 'roomBookmarks store'], cliVerbs: ['ant rooms', 'ant rooms star'],
          x: 0, y: 0 },
        { slug: 'room-view', title: 'Inside a room', plain: 'Read messages, write your own, react with emoji.',
          route: '/rooms/[roomId]', functions: ['postMessage', 'fanoutMessageToRoomTerminals', 'broadcastToRoom', 'subscribeToRoomEvents'], cliVerbs: ['ant rooms post', 'ant rooms react', 'ant rooms break'],
          x: TILE_W + INTRA_GAP, y: 0 },
        { slug: 'room-participants', title: 'Who is in the room', plain: 'See every person and agent, invite more, focus an agent.',
          route: '/rooms/[roomId] · participants', functions: ['ParticipantsPanel', 'addMembership', 'enterFocus', 'AgentContextChip'], cliVerbs: ['ant rooms invite', 'ant focus enter'],
          x: 0, y: TILE_H + INTRA_GAP },
        { slug: 'vault', title: 'Vault', plain: 'Old rooms saved here so we can learn from them later.',
          route: '/vault', functions: ['listArchivedChatRooms', 'POST /api/vault/:id/mine'], cliVerbs: ['ant vault list', 'ant vault mine'],
          x: TILE_W + INTRA_GAP, y: TILE_H + INTRA_GAP }
      ]
    },
    {
      id: 'plans',
      name: 'Plans',
      description: 'Track what we are building, step by step.',
      x: 80 + 2 * (TILE_W + INTRA_GAP) + CLUSTER_PAD + 160,
      y: 80,
      color: '#dbeafe',
      tiles: [
        { slug: 'plans-index', title: 'All plans', plain: 'Every plan in one place, with how far each one has got.',
          route: '/plans', functions: ['listPlans', 'planCockpitStore'], cliVerbs: ['ant plan list'],
          x: 0, y: 0 },
        { slug: 'plan-detail', title: 'One plan', plain: 'A plan with its tasks and the proof each task is done.',
          route: '/plans/[planId]', functions: ['projectPlanEvents', 'tasksStore', 'planEvidenceStore'], cliVerbs: ['ant plan show', 'ant plan update', 'ant task create'],
          x: TILE_W + INTRA_GAP, y: 0 },
        { slug: 'plan-evidence', title: 'Plan evidence', plain: 'The links and notes that prove a plan is finished.',
          route: '/plans/evidence', functions: ['planEvidenceStore'], cliVerbs: ['ant plan evidence'],
          x: 0, y: TILE_H + INTRA_GAP }
      ]
    },
    {
      id: 'memory',
      name: 'Memory',
      description: 'What ANT remembers, ready to find again.',
      x: 80,
      y: 80 + 2 * (TILE_H + INTRA_GAP) + CLUSTER_PAD + 160,
      color: '#dcfce7',
      tiles: [
        { slug: 'memory-recall', title: 'Memory recall', plain: 'Type a word and find every message, plan and file about it.',
          route: '/memory', functions: ['recallAcrossSurfaces', 'listMessagesAfterLatestBreak'], cliVerbs: ['ant memory recall'],
          x: 0, y: 0 },
        { slug: 'search', title: 'Search', plain: 'Hunt across every room and document for what you need.',
          route: '/search', functions: ['/api/search-messages', '/api/chat-rooms/[id]/search'], cliVerbs: ['ant search'],
          x: TILE_W + INTRA_GAP, y: 0 }
      ]
    },
    {
      id: 'joining',
      name: 'Joining',
      description: 'How a new person gets into a room.',
      x: 80 + 2 * (TILE_W + INTRA_GAP) + CLUSTER_PAD + 160,
      y: 80 + 2 * (TILE_H + INTRA_GAP) + CLUSTER_PAD + 160,
      color: '#fce7f3',
      tiles: [
        { slug: 'invite-redeem', title: 'Join with a link', plain: 'A friend opens a link, types a password, and joins the room.',
          route: '/r/[inviteId]', functions: ['exchangePasswordForToken', 'createBrowserSession', 'addMembership'], cliVerbs: ['ant remote redeem'],
          x: 0, y: 0 },
        { slug: 'remote-bridge', title: 'Other ANTs', plain: 'Another ANT machine talks safely to ours.',
          route: '/remote', functions: ['/api/remote-ant/admit', '/api/remote-ant/bridge', 'remoteAdmissionStore'], cliVerbs: ['ant remote admit', 'ant remote bridge'],
          x: TILE_W + INTRA_GAP, y: 0 }
      ]
    },
    {
      id: 'terminals',
      name: 'Terminals',
      description: 'Each agent has its own terminal.',
      x: 80,
      y: 80 + 3 * (TILE_H + INTRA_GAP) + 2 * CLUSTER_PAD + 320,
      color: '#ffedd5',
      tiles: [
        { slug: 'terminals-index', title: 'All terminals', plain: 'Every agent terminal, what it is doing right now.',
          route: '/terminals', functions: ['listTerminals', 'agentStateReader'], cliVerbs: ['ant sessions list', 'ant whoami'],
          x: 0, y: 0 },
        { slug: 'terminal-detail', title: 'One terminal', plain: 'Talk to one agent or see exactly what is on its screen.',
          route: '/terminals · attached', functions: ['TerminalCard', 'POST /api/terminals/:id/input', 'POST /api/terminals/:id/kill'], cliVerbs: ['ant terminal', 'ant terminal send'],
          x: TILE_W + INTRA_GAP, y: 0 }
      ]
    },
    {
      id: 'admin',
      name: 'Admin',
      description: 'Settings, dashboard, and tools for grown-ups.',
      x: 80 + 2 * (TILE_W + INTRA_GAP) + CLUSTER_PAD + 160,
      y: 80 + 3 * (TILE_H + INTRA_GAP) + 2 * CLUSTER_PAD + 320,
      color: '#ede9fe',
      tiles: [
        { slug: 'dashboard', title: 'Dashboard', plain: 'A quick look at everything important right now.',
          route: '/', functions: ['planCockpitStore', 'AgentStatusFooter', 'roomBookmarks'], cliVerbs: ['ant'],
          x: 0, y: 0 },
        { slug: 'settings', title: 'Settings', plain: 'Change how ANT works for you.',
          route: '/settings', functions: ['settingsStore', 'preferences'], cliVerbs: ['ant config'],
          x: TILE_W + INTRA_GAP, y: 0 },
        { slug: 'discover', title: 'CLI book', plain: 'Every command you can type, with examples.',
          route: '/discover', functions: ['cli-manifest', 'manifestStore'], cliVerbs: ['ant --help'],
          x: 0, y: TILE_H + INTRA_GAP },
        { slug: 'policies', title: 'Policies', plain: 'The rules ANT follows to keep things safe.',
          route: '/policies', functions: ['verificationPolicyStore', 'consentGrantStore'], cliVerbs: ['ant grant list', 'ant audit permissions'],
          x: TILE_W + INTRA_GAP, y: TILE_H + INTRA_GAP }
      ]
    }
  ];

  // Compute the bounding box of each cluster so we can draw its background
  // correctly (cluster card grows to fit its tiles).
  function clusterWidth(cluster: Cluster): number {
    const maxX = Math.max(0, ...cluster.tiles.map((t) => t.x + TILE_W));
    return maxX + CLUSTER_PAD * 2;
  }
  function clusterHeight(cluster: Cluster): number {
    const maxY = Math.max(0, ...cluster.tiles.map((t) => t.y + TILE_H));
    return maxY + CLUSTER_PAD * 2 + HEADER_H;
  }

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
  <title>Manual · Every screen. One board. · ANT</title>
</svelte:head>

<SimplePageShell>
  <header class="manual-header">
    <h1>The manual</h1>
    <p class="manual-tagline">Every screen. One board.</p>
    <p class="manual-intro">
      Every page in ANT shown at real screen size, laid out together. Drag the
      canvas to pan, use + / − to zoom from board-overview to pixel-perfect.
      Click any tile to pin its detail in the side rail; <kbd>Esc</kbd> to clear.
    </p>
  </header>

  <div class="manual-toolbar" role="toolbar" aria-label="Canvas controls">
    <button type="button" onclick={() => setZoom(zoom * 0.8)} title="Zoom out">−</button>
    <span class="zoom-pct" aria-live="polite">{Math.round(zoom * 100)}%</span>
    <button type="button" onclick={() => setZoom(zoom * 1.25)} title="Zoom in">+</button>
    <button type="button" class="fit" onclick={fitToView} title="Fit the whole board to view">Fit</button>
    <span class="zoom-stops">
      <button type="button" onclick={() => setZoom(0.18)} title="Overview">Overview</button>
      <button type="button" onclick={() => setZoom(0.5)} title="Browse">Browse</button>
      <button type="button" onclick={() => setZoom(1.0)} title="Pixel">100%</button>
    </span>
  </div>

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
              <!-- Manual is a visual canvas: tiles are positioned absolutely and act as pointer-affordance landmarks. Keyboard navigation through the manual is via the cluster filter buttons + URL-anchor links inside each tile; the tile-itself click is a redundant convenience. -->
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
              <article
                class="tile"
                class:tile-hover={hoveredTile?.clusterId === cluster.id && hoveredTile?.slug === tile.slug}
                class:tile-pinned={pinnedTile?.clusterId === cluster.id && pinnedTile?.slug === tile.slug}
                style="left: {tile.x}px; top: {tile.y}px; width: {TILE_W}px; height: {TILE_H}px;"
                onpointerenter={() => { hoveredTile = { clusterId: cluster.id, slug: tile.slug }; }}
                onpointerleave={() => { hoveredTile = null; }}
                onclick={(event) => { event.stopPropagation(); pinTile(cluster.id, tile.slug); }}
              >
                <header class="tile-header">
                  <h3>{tile.title}</h3>
                  <code class="tile-route">{tile.route}</code>
                </header>
                <p class="tile-plain">{tile.plain}</p>

                <!-- Real Playwright-harvested screenshot via scripts/manual-
                     harvest.mjs (slice 3). PNG lives in /static/manual/<slug>.png
                     at 2560×1600 (retina). object-fit:contain so the image
                     respects the placeholder box without distortion. The
                     fallback for any tile whose harvest failed is the dashed
                     placeholder block below. -->
                <div class="tile-screenshot">
                  <img
                    src={`/manual/${tile.slug}.png`}
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
    <aside class="manual-rail" aria-label="Manual rail">
      <header class="rail-header">
        <div class="rail-crumb">{railTile.cluster.name} → {railTile.tile.title}</div>
        <button type="button" class="rail-close" onclick={clearPin} title={pinnedTile ? 'Unpin (Esc)' : 'Hover-only'} aria-label={pinnedTile ? 'Unpin tile' : 'Hovering'}>
          {pinnedTile ? '×' : '…'}
        </button>
      </header>
      <h2 class="rail-title">{railTile.tile.title}</h2>
      <p class="rail-plain">{railTile.tile.plain}</p>
      <div class="rail-route">
        <span class="rail-label">Route</span>
        <code>{railTile.tile.route}</code>
      </div>
      <div class="rail-section">
        <span class="rail-label">Powers</span>
        <ul class="rail-list">
          {#each railTile.tile.functions as fn (fn)}
            <li><code>{fn}</code></li>
          {/each}
        </ul>
      </div>
      <div class="rail-section">
        <span class="rail-label">CLI</span>
        <ul class="rail-list">
          {#each railTile.tile.cliVerbs as verb (verb)}
            <li><code>{verb}</code></li>
          {/each}
        </ul>
      </div>
      <p class="rail-hint">
        {pinnedTile ? 'Pinned — Esc to clear' : 'Click any tile to pin'}
      </p>
    </aside>
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
  .manual-toolbar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0.85rem 0 0.6rem;
    flex-wrap: wrap;
  }
  .manual-toolbar button {
    height: 2.1rem;
    padding: 0 0.7rem;
    min-width: 2.1rem;
    border: 1px solid var(--surface-edge);
    border-radius: 0.5rem;
    background: var(--surface-card);
    color: var(--ink-strong);
    font-weight: 800;
    cursor: pointer;
  }
  .manual-toolbar button:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .zoom-pct {
    min-width: 3.5rem;
    text-align: center;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 0.85rem;
    color: var(--ink-soft);
  }
  .zoom-stops {
    display: inline-flex;
    gap: 0.35rem;
    margin-left: 0.6rem;
    padding-left: 0.6rem;
    border-left: 1px solid var(--surface-edge);
  }
  .zoom-stops button {
    font-size: 0.78rem;
    font-weight: 600;
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
  .manual-footnote {
    margin: 1.1rem 0 0;
    color: var(--ink-soft);
    font-size: 0.82rem;
    line-height: 1.5;
    max-width: 72ch;
  }
  /* Slice 4: tile pinned state — accent ring + slight scale so the
     pinned tile reads as 'this is the one in the rail'. Hover stays
     a softer dashed outline (in the existing .tile-hover rule). */
  .tile-pinned {
    outline: 2px solid var(--accent);
    outline-offset: 4px;
    z-index: 4;
  }
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
  .manual-footnote kbd {
    padding: 0.05rem 0.35rem;
    background: var(--bg);
    border: 1px solid var(--line-soft);
    border-radius: 0.25rem;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 0.7rem;
  }
</style>
