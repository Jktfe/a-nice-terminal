<script>
  /** @type {{ tabs: Array<{id: string, label: string}>, activeTab?: string, onchange?: (id: string) => void, children?: import('svelte').Snippet<[string]> }} */
  let { tabs, activeTab = $bindable(tabs[0]?.id ?? ''), onchange, children } = $props();

  function select(id) {
    activeTab = id;
    onchange?.(id);
  }
</script>

<div>
  <div class="flex gap-1 border-b border-white/[0.06]">
    {#each tabs as tab}
      <button
        onclick={() => select(tab.id)}
        class="relative cursor-pointer px-4 py-2.5 text-sm font-medium transition-colors
          {activeTab === tab.id ? 'text-white' : 'text-neutral-400 hover:text-neutral-300'}"
      >
        {tab.label}
        {#if activeTab === tab.id}
          <span class="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-500"></span>
        {/if}
      </button>
    {/each}
  </div>
  {#if children}
    <div class="pt-4">
      {@render children(activeTab)}
    </div>
  {/if}
</div>
