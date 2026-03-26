<script>
  import Badge from './Badge.svelte';
  import ParamTable from './ParamTable.svelte';
  import CodeBlock from './CodeBlock.svelte';

  /**
   * @type {{
   *   tool: {
   *     name: string,
   *     category: string,
   *     description: string,
   *     params?: Array<{ name: string, type: string, required?: boolean, description: string }>,
   *     example?: string
   *   }
   * }}
   */
  let { tool } = $props();

  let expanded = $state(false);
</script>

<div class="rounded-xl border border-white/[0.06] bg-[var(--color-surface)] transition hover:border-white/10">
  <button
    onclick={() => (expanded = !expanded)}
    class="flex w-full cursor-pointer items-center gap-3 p-4 text-left"
  >
    <code class="shrink-0 font-mono text-sm text-emerald-400">{tool.name}</code>
    <Badge variant={tool.category} text={tool.category} />
    <span class="flex-1 text-sm text-neutral-400">{tool.description}</span>
    <svg
      class="h-4 w-4 shrink-0 text-neutral-500 transition-transform {expanded ? 'rotate-180' : ''}"
      fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
    >
      <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  </button>

  {#if expanded}
    <div class="space-y-4 border-t border-white/[0.06] p-4">
      {#if tool.params && tool.params.length > 0}
        <div>
          <h4 class="mb-2 text-xs font-semibold uppercase tracking-widest text-neutral-500">Parameters</h4>
          <ParamTable params={tool.params} />
        </div>
      {/if}
      {#if tool.example}
        <div>
          <h4 class="mb-2 text-xs font-semibold uppercase tracking-widest text-neutral-500">Example</h4>
          <CodeBlock code={tool.example} language="json" showChrome={false} />
        </div>
      {/if}
    </div>
  {/if}
</div>
