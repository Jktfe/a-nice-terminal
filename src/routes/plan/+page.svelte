<script lang="ts">
  import PlanView from '$lib/components/PlanView/PlanView.svelte';
  import { samplePlanEvents } from '$lib/components/PlanView/_fixture';

  // M3.5 — Plan View route. Currently driven by fixture events; will swap to
  // live projector data once @ocloudant-dev lands run_events plan_* projection.
  // Keep this file dumb: route is a thin mount, all logic in PlanView.svelte.
  let mode: 'dark' | 'light' = $state('dark');
</script>

<svelte:head>
  <title>ANT · Plan</title>
</svelte:head>

<button
  class="mode-toggle"
  type="button"
  onclick={() => (mode = mode === 'dark' ? 'light' : 'dark')}
  aria-label="Toggle theme"
>{mode}</button>

<PlanView events={samplePlanEvents} themeMode={mode} />

<style>
  .mode-toggle {
    position: fixed;
    top: 18px;
    right: 18px;
    z-index: 50;
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    background: rgba(0, 0, 0, 0.04);
    color: inherit;
    border: 0.5px solid currentColor;
    border-radius: 4px;
    padding: 4px 10px;
    cursor: pointer;
    opacity: 0.6;
  }
  .mode-toggle:hover { opacity: 1; }
</style>
