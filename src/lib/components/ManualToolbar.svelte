<!--
  ManualToolbar — zoom + fit controls for the /manual board canvas.
  Extracted from src/routes/manual/+page.svelte (2026-05-21) to keep the
  route under the 600-line component cap. State stays in the parent; this
  component just emits intent via callback props.
-->
<script lang="ts">
  type Props = {
    zoom: number;
    onZoomIn: () => void;
    onZoomOut: () => void;
    onFit: () => void;
    onZoomTo: (value: number) => void;
  };

  let { zoom, onZoomIn, onZoomOut, onFit, onZoomTo }: Props = $props();
</script>

<div class="manual-toolbar" role="toolbar" aria-label="Canvas controls">
  <button type="button" onclick={onZoomOut} title="Zoom out">−</button>
  <span class="zoom-pct" aria-live="polite">{Math.round(zoom * 100)}%</span>
  <button type="button" onclick={onZoomIn} title="Zoom in">+</button>
  <button type="button" class="fit" onclick={onFit} title="Fit the whole board to view">Fit</button>
  <span class="zoom-stops">
    <button type="button" onclick={() => onZoomTo(0.18)} title="Overview">Overview</button>
    <button type="button" onclick={() => onZoomTo(0.5)} title="Browse">Browse</button>
    <button type="button" onclick={() => onZoomTo(1.0)} title="Pixel">100%</button>
  </span>
</div>

<style>
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
</style>
