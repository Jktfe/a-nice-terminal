<script lang="ts">
  import { lookupExplanation, type Explanation } from '$lib/explainMap';

  type Props = {
    explainKey: string;
    anchorEl: HTMLElement;
    onClose: () => void;
  };

  let { explainKey, anchorEl, onClose }: Props = $props();

  const explanation = $derived<Explanation | undefined>(lookupExplanation(explainKey));

  let popoverEl = $state<HTMLDivElement | undefined>(undefined);

  $effect(() => {
    if (!popoverEl || !anchorEl) return;
    const rect = anchorEl.getBoundingClientRect();
    const popRect = popoverEl.getBoundingClientRect();
    let top = rect.bottom + 8;
    let left = rect.left;
    if (left + popRect.width > window.innerWidth - 16) {
      left = window.innerWidth - popRect.width - 16;
    }
    if (top + popRect.height > window.innerHeight - 16) {
      top = rect.top - popRect.height - 8;
    }
    popoverEl.style.top = `${top + window.scrollY}px`;
    popoverEl.style.left = `${left + window.scrollX}px`;
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div
  bind:this={popoverEl}
  class="explain-overlay"
  role="dialog"
  aria-label={`Explanation for ${explainKey}`}
>
  {#if explanation}
    <p class="explain-what"><strong>What:</strong> {explanation.what}</p>
    <p class="explain-why"><strong>Why:</strong> {explanation.why}</p>
    {#if explanation.docsPath}
      <a class="explain-docs" href={explanation.docsPath} target="_blank" rel="noopener">Read more →</a>
    {/if}
  {:else}
    <p class="explain-missing">No explanation yet for "{explainKey}". <button type="button" onclick={onClose}>Close</button></p>
  {/if}
</div>

<style>
  .explain-overlay {
    position: absolute;
    z-index: 9999;
    max-width: 18rem;
    padding: 0.75rem 1rem;
    background: var(--surface-raised);
    border: 1px solid var(--line-soft);
    border-radius: 0.6rem;
    box-shadow: 0 4px 16px rgba(0,0,0,0.12);
    font-size: 0.85rem;
    line-height: 1.45;
    color: var(--ink-strong);
  }
  .explain-what, .explain-why { margin: 0 0 0.4rem; }
  .explain-what strong, .explain-why strong { color: var(--accent); }
  .explain-docs {
    display: inline-block;
    margin-top: 0.3rem;
    color: var(--accent);
    text-decoration: none;
    font-weight: 700;
  }
  .explain-docs:hover { text-decoration: underline; }
  .explain-missing { color: var(--ink-soft); margin: 0; }
  .explain-missing button {
    margin-left: 0.3rem;
    padding: 0.15rem 0.4rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.3rem;
    background: var(--surface-card);
    color: var(--ink-soft); font: inherit; font-size: 0.8rem; cursor: pointer;
  }
</style>
