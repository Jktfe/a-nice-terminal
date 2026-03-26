<script>
  /**
   * @type {{ params: Array<{ name: string, type: string, required?: boolean, description: string }> }}
   */
  let { params } = $props();
</script>

<div class="overflow-x-auto rounded-lg border border-white/[0.06]">
  <table class="w-full text-left text-sm">
    <thead>
      <tr class="border-b border-white/[0.06] bg-[var(--color-surface)]">
        <th class="px-4 py-2.5 text-xs font-semibold uppercase tracking-widest text-neutral-500">Name</th>
        <th class="px-4 py-2.5 text-xs font-semibold uppercase tracking-widest text-neutral-500">Type</th>
        <th class="px-4 py-2.5 text-xs font-semibold uppercase tracking-widest text-neutral-500">Required</th>
        <th class="px-4 py-2.5 text-xs font-semibold uppercase tracking-widest text-neutral-500">Description</th>
      </tr>
    </thead>
    <tbody>
      {#each params as param}
        <tr class="border-b border-white/[0.04] last:border-b-0">
          <td class="px-4 py-3">
            <code class="font-mono text-xs text-emerald-400">{param.name}</code>
          </td>
          <td class="px-4 py-3">
            <code class="font-mono text-xs text-neutral-400">{param.type}</code>
          </td>
          <td class="px-4 py-3">
            {#if param.required}
              <span class="inline-block h-2 w-2 rounded-full bg-emerald-500"></span>
            {/if}
          </td>
          <td class="px-4 py-3 text-neutral-400">{param.description}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
