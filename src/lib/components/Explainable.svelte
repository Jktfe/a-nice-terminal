<script lang="ts">
  import type { Snippet } from 'svelte';
  import { getExplainMode } from '$lib/stores/explainMode.svelte';
  import ExplainOverlay from './ExplainOverlay.svelte';

  type Props = {
    explainKey: string;
    children: Snippet;
  };

  let { explainKey, children }: Props = $props();

  const active = $derived(getExplainMode());
  let anchorEl = $state<HTMLDivElement | undefined>(undefined);
  let showOverlay = $state(false);

  function handleClick(e: MouseEvent) {
    if (!active) return;
    e.preventDefault();
    e.stopPropagation();
    showOverlay = true;
  }
</script>

<div
  bind:this={anchorEl}
  class="explainable"
  class:active
  onclick={handleClick}
  role={active ? 'button' : undefined}

  aria-label={active ? `Explain: ${explainKey}` : undefined}
>
  {@render children()}
</div>

{#if showOverlay && anchorEl}
  <ExplainOverlay {explainKey} {anchorEl} onClose={() => (showOverlay = false)} />
{/if}

<style>
  .explainable {
    display: contents;
  }
  .explainable.active {
    outline: 2px dotted var(--accent);
    outline-offset: 2px;
    cursor: help;
    border-radius: 0.2rem;
  }
  .explainable.active:focus {
    outline: 2px solid var(--accent);
  }
</style>
