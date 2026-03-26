<script>
  /**
   * @type {{
   *   categories: string[],
   *   placeholder?: string,
   *   value?: string,
   *   activeCategory?: string
   * }}
   */
  let {
    categories,
    placeholder = 'Search...',
    value = $bindable(''),
    activeCategory = $bindable('All')
  } = $props();

  let allCategories = $derived(['All', ...categories]);

  function selectCategory(cat) {
    activeCategory = cat;
  }
</script>

<div class="space-y-3">
  <div class="relative">
    <svg class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
      <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
    <input
      type="text"
      bind:value={value}
      {placeholder}
      class="w-full rounded-lg border border-white/[0.06] bg-[var(--color-surface)] py-2.5 pl-10 pr-4 text-sm text-white placeholder-neutral-500 outline-none transition focus:border-emerald-500/40"
    />
  </div>
  {#if allCategories.length > 1}
    <div class="flex flex-wrap gap-2">
      {#each allCategories as cat}
        <button
          onclick={() => selectCategory(cat)}
          class="cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition
            {activeCategory === cat
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
              : 'border-white/[0.06] bg-[var(--color-surface)] text-neutral-400 hover:border-white/10 hover:text-white'}"
        >
          {cat}
        </button>
      {/each}
    </div>
  {/if}
</div>
