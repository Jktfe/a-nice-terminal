<!--
  /manual/v2 — interactive screens canvas (JWPK msg_i538jl6ztt 2026-05-23).

  Slice 1: data model + first annotated state, read-only.
    - Loads /api/manual/states and /api/manual/states/:screenId/:stateSlug
    - Renders the screenshot with absolutely-positioned overlay regions
      for every annotation
    - Each overlay is clickable AND tab-focusable; selection drives the
      right-side inspector panel
    - Three sub-purposes flagged by the inspector layout: Learning
      (Item/CLI/Data sources/Logic/Intended Actions read-side), Audit
      (slice 6 will populate), Question captures (slice 3 will populate
      the Notes field)

  Future slices:
    - Slice 2: state-switcher (tabs above the canvas)
    - Slice 3: Notes capture writes to /api/manual/suggestions
    - Slice 4: tab-order + a11y polish (Enter/Esc/arrow keys)
    - Slice 5: Playwright auto-extract pipeline
    - Slice 6: audit log table + tab
    - Slice 7: multi-screen rollout
-->
<script lang="ts">
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import { onMount } from 'svelte';

  type Bbox = { x: number; y: number; w: number; h: number };
  type Annotation = {
    screen_id: string;
    state_slug: string;
    element_slug: string;
    item_name: string;
    bbox: Bbox;
    cli_verbs: string[];
    data_sources: string[];
    logic_text: string | null;
    intended_actions: string[];
    tab_order: number;
  };
  type ScreenState = {
    screen_id: string;
    state_slug: string;
    state_label: string;
    description: string | null;
    screenshot_path: string;
    viewport_w: number;
    viewport_h: number;
  };

  let states = $state<ScreenState[]>([]);
  let selectedState = $state<ScreenState | null>(null);
  let annotations = $state<Annotation[]>([]);
  let selectedAnnotation = $state<Annotation | null>(null);
  let loading = $state(true);
  let loadError = $state<string | null>(null);

  async function loadStates() {
    try {
      const response = await fetch('/api/manual/states');
      if (!response.ok) throw new Error(`states fetch ${response.status}`);
      const data = await response.json();
      states = data.states ?? [];
      if (states.length > 0) {
        await selectState(states[0]);
      }
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  async function selectState(state: ScreenState) {
    selectedState = state;
    selectedAnnotation = null;
    try {
      const response = await fetch(
        `/api/manual/states/${encodeURIComponent(state.screen_id)}/${encodeURIComponent(state.state_slug)}`
      );
      if (!response.ok) throw new Error(`state fetch ${response.status}`);
      const data = await response.json();
      annotations = data.annotations ?? [];
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
    }
  }

  function pickAnnotation(annotation: Annotation) {
    selectedAnnotation = annotation;
  }

  onMount(loadStates);
</script>

<SimplePageShell showIntro={false}>
  <div class="canvas-page">
    <header class="canvas-header">
      <div class="canvas-eyebrow">SCREENS · v2 (in build)</div>
      <h1>Interactive screens canvas</h1>
      <p class="canvas-summary">
        Every UI element on every screen is selectable. Pick one to see what it is, what
        powers it, and what you can do with it. Capture questions inline — they fan out
        to a central suggestions feed.
      </p>
    </header>

    {#if loading}
      <p class="canvas-status">Loading canvas …</p>
    {:else if loadError}
      <p class="canvas-error">Couldn't load canvas: {loadError}</p>
    {:else if !selectedState}
      <p class="canvas-status">No screens annotated yet.</p>
    {:else}
      <div class="canvas-layout">
        <!-- Left: screen tile with overlay boxes -->
        <section class="canvas-tile">
          <div class="canvas-meta">
            <div class="screen-title">{selectedState.screen_id} · {selectedState.state_label}</div>
            {#if selectedState.description}
              <div class="screen-description">{selectedState.description}</div>
            {/if}
          </div>
          <div class="canvas-image-frame">
            <img
              class="canvas-image"
              src={selectedState.screenshot_path}
              alt="Screen: {selectedState.screen_id} ({selectedState.state_label})"
              draggable="false"
            />
            <!-- Overlay regions positioned in % so the layout scales with the image -->
            {#each annotations as annotation (annotation.element_slug)}
              {@const xPct = (annotation.bbox.x / selectedState.viewport_w) * 100}
              {@const yPct = (annotation.bbox.y / selectedState.viewport_h) * 100}
              {@const wPct = (annotation.bbox.w / selectedState.viewport_w) * 100}
              {@const hPct = (annotation.bbox.h / selectedState.viewport_h) * 100}
              <button
                type="button"
                class="canvas-region"
                class:selected={selectedAnnotation?.element_slug === annotation.element_slug}
                style="left: {xPct}%; top: {yPct}%; width: {wPct}%; height: {hPct}%;"
                tabindex="0"
                aria-label="Select element: {annotation.item_name}"
                onclick={() => pickAnnotation(annotation)}
                onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickAnnotation(annotation); } }}
              >
                <span class="region-slug">{annotation.item_name}</span>
              </button>
            {/each}
          </div>
        </section>

        <!-- Right: inspector panel -->
        <aside class="canvas-inspector">
          {#if selectedAnnotation}
            <h2>{selectedAnnotation.item_name}</h2>

            <section class="inspector-section">
              <h3>CLI</h3>
              {#if selectedAnnotation.cli_verbs.length === 0}
                <p class="inspector-empty">No CLI verb wired to this element yet.</p>
              {:else}
                <ul class="inspector-list">
                  {#each selectedAnnotation.cli_verbs as verb}
                    <li><code>{verb}</code></li>
                  {/each}
                </ul>
              {/if}
            </section>

            <section class="inspector-section">
              <h3>Data sources</h3>
              {#if selectedAnnotation.data_sources.length === 0}
                <p class="inspector-empty">No data sources logged.</p>
              {:else}
                <ul class="inspector-list">
                  {#each selectedAnnotation.data_sources as src}
                    <li><code>{src}</code></li>
                  {/each}
                </ul>
              {/if}
            </section>

            <section class="inspector-section">
              <h3>Logic</h3>
              <p>{selectedAnnotation.logic_text ?? '—'}</p>
            </section>

            <section class="inspector-section">
              <h3>Intended actions</h3>
              {#if selectedAnnotation.intended_actions.length === 0}
                <p class="inspector-empty">—</p>
              {:else}
                <ul class="inspector-list">
                  {#each selectedAnnotation.intended_actions as action}
                    <li>{action}</li>
                  {/each}
                </ul>
              {/if}
            </section>

            <section class="inspector-section">
              <h3>Notes</h3>
              <p class="inspector-empty">Capture lands in slice 3 — Add button coming soon.</p>
            </section>
          {:else}
            <div class="inspector-empty-state">
              <p>Click any element on the screen to inspect it.</p>
              <p class="inspector-hint">Tab through them with your keyboard, or click directly.</p>
            </div>
          {/if}
        </aside>
      </div>
    {/if}
  </div>
</SimplePageShell>

<style>
  .canvas-page {
    padding: 1.25rem 1.5rem 2.5rem;
    color: var(--ink-strong, #0f172a);
  }
  .canvas-header { margin-bottom: 1rem; }
  .canvas-eyebrow {
    font: 600 0.7rem/1 ui-sans-serif, system-ui, sans-serif;
    letter-spacing: 0.08em;
    color: var(--accent, #6b21a8);
    margin-bottom: 0.5rem;
  }
  h1 { font: 800 1.85rem/1.1 ui-sans-serif, system-ui, sans-serif; margin: 0 0 0.25rem; }
  .canvas-summary {
    font: 500 0.95rem/1.5 ui-sans-serif, system-ui, sans-serif;
    color: var(--ink-muted, #475569);
    margin: 0;
    max-width: 60ch;
  }
  .canvas-status { color: var(--ink-muted, #475569); font-style: italic; }
  .canvas-error { color: #b91c1c; }

  .canvas-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 360px;
    gap: 1.5rem;
    margin-top: 1.25rem;
  }
  @media (max-width: 960px) {
    .canvas-layout { grid-template-columns: 1fr; }
  }

  .canvas-tile { display: flex; flex-direction: column; gap: 0.75rem; }
  .canvas-meta {
    background: var(--surface-2, #f8fafc);
    border: 1px solid var(--line-soft, #e2e8f0);
    border-radius: 12px;
    padding: 0.6rem 0.85rem;
  }
  .screen-title {
    font: 700 0.95rem/1.2 ui-sans-serif, system-ui, sans-serif;
    color: var(--ink-strong, #0f172a);
  }
  .screen-description {
    margin-top: 0.25rem;
    font: 500 0.85rem/1.35 ui-sans-serif, system-ui, sans-serif;
    color: var(--ink-muted, #475569);
  }
  .canvas-image-frame {
    position: relative;
    background: #fff;
    border: 1px solid var(--line-soft, #e2e8f0);
    border-radius: 12px;
    overflow: hidden;
    aspect-ratio: 16 / 10;
  }
  .canvas-image {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    user-select: none;
  }
  .canvas-region {
    position: absolute;
    background: rgba(168, 85, 247, 0.08);
    border: 1.5px solid rgba(168, 85, 247, 0.55);
    border-radius: 4px;
    cursor: pointer;
    transition: background 120ms ease, border-color 120ms ease;
    padding: 0;
    font: inherit;
    color: inherit;
    text-align: left;
  }
  .canvas-region:hover,
  .canvas-region:focus-visible {
    background: rgba(168, 85, 247, 0.18);
    border-color: rgba(107, 33, 168, 0.95);
    outline: 2px solid rgba(107, 33, 168, 0.85);
    outline-offset: 2px;
  }
  .canvas-region.selected {
    background: rgba(168, 85, 247, 0.28);
    border-color: rgba(107, 33, 168, 1);
    border-width: 2px;
  }
  .region-slug {
    position: absolute;
    top: 4px;
    left: 6px;
    font: 600 0.7rem/1.1 ui-sans-serif, system-ui, sans-serif;
    background: rgba(107, 33, 168, 0.92);
    color: white;
    padding: 2px 6px;
    border-radius: 4px;
    pointer-events: none;
    max-width: calc(100% - 12px);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    opacity: 0;
    transition: opacity 120ms ease;
  }
  .canvas-region:hover .region-slug,
  .canvas-region:focus-visible .region-slug,
  .canvas-region.selected .region-slug {
    opacity: 1;
  }

  .canvas-inspector {
    background: var(--surface, #fff);
    border: 1px solid var(--line-soft, #e2e8f0);
    border-radius: 12px;
    padding: 1rem 1.1rem;
    min-height: 320px;
    align-self: start;
    position: sticky;
    top: 1rem;
  }
  .canvas-inspector h2 {
    font: 800 1.05rem/1.2 ui-sans-serif, system-ui, sans-serif;
    margin: 0 0 0.75rem;
  }
  .inspector-section {
    border-top: 1px solid var(--line-soft, #e2e8f0);
    padding: 0.65rem 0;
  }
  .inspector-section:first-of-type { border-top: none; padding-top: 0; }
  .inspector-section h3 {
    font: 700 0.72rem/1 ui-sans-serif, system-ui, sans-serif;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-muted, #475569);
    margin: 0 0 0.4rem;
  }
  .inspector-section p {
    margin: 0;
    font: 500 0.86rem/1.45 ui-sans-serif, system-ui, sans-serif;
  }
  .inspector-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .inspector-list li {
    font: 500 0.85rem/1.4 ui-sans-serif, system-ui, sans-serif;
  }
  .inspector-list code {
    background: var(--surface-2, #f1f5f9);
    padding: 1px 6px;
    border-radius: 4px;
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 0.8rem;
  }
  .inspector-empty {
    font-style: italic;
    color: var(--ink-muted, #94a3b8);
  }
  .inspector-empty-state {
    color: var(--ink-muted, #475569);
    font: 500 0.9rem/1.5 ui-sans-serif, system-ui, sans-serif;
  }
  .inspector-empty-state p { margin: 0 0 0.4rem; }
  .inspector-hint { font-size: 0.8rem; color: var(--ink-muted, #94a3b8); }
</style>
