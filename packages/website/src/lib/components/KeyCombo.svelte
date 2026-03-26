<script>
  /** @type {{ keys: string[] }} */
  let { keys } = $props();
</script>

<span class="inline-flex items-center gap-1">
  {#each keys as key, i}
    {#if i > 0}
      <span class="text-xs text-neutral-600">+</span>
    {/if}
    <kbd class="inline-block rounded border border-white/[0.08] bg-white/[0.06] px-1.5 py-0.5 font-mono text-xs text-neutral-300">
      {key}
    </kbd>
  {/each}
</span>
