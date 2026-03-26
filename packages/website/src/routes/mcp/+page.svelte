<script lang="ts">
  import { mcpTools, mcpCategories, type DocEntry } from '$lib/data/mcp-tools';

  let search = $state('');
  let activeCategory = $state<string | null>(null);
  let expanded = $state<Set<string>>(new Set());
  let copiedName = $state<string | null>(null);
  let configCopied = $state(false);

  let filtered = $derived(
    mcpTools.filter((tool) => {
      const matchesSearch =
        !search ||
        tool.name.toLowerCase().includes(search.toLowerCase()) ||
        tool.description.toLowerCase().includes(search.toLowerCase());
      const matchesCategory = !activeCategory || tool.category === activeCategory;
      return matchesSearch && matchesCategory;
    })
  );

  function toggle(name: string) {
    const next = new Set(expanded);
    if (next.has(name)) {
      next.delete(name);
    } else {
      next.add(name);
    }
    expanded = next;
  }

  async function copyExample(example: string, name: string) {
    await navigator.clipboard.writeText(example);
    copiedName = name;
    setTimeout(() => (copiedName = null), 2000);
  }

  const mcpConfig = `{
  "mcpServers": {
    "ant": {
      "command": "npx",
      "args": ["-y", "@niceterminal/mcp"]
    }
  }
}`;

  async function copyConfig() {
    await navigator.clipboard.writeText(mcpConfig);
    configCopied = true;
    setTimeout(() => (configCopied = false), 2000);
  }
</script>

<svelte:head>
  <title>MCP Tools | ANT - A Nice Terminal</title>
  <meta name="description" content="Reference for all 28 ANT MCP tools across 9 categories. Connect any AI agent to ANT via the Model Context Protocol." />
  <meta property="og:title" content="MCP Tools | ANT - A Nice Terminal" />
  <meta property="og:description" content="28 MCP tools across 9 categories for AI agents to manage terminals, messages, and sessions." />
  <meta property="og:url" content="https://antonline.dev/mcp" />
</svelte:head>

<div class="mx-auto max-w-4xl px-6 py-16">
  <!-- Header -->
  <div class="mb-12">
    <h1 class="text-4xl font-bold text-white">MCP Tools</h1>
    <p class="mt-3 text-lg text-neutral-400">28 tools across 9 categories</p>
  </div>

  <!-- MCP Config -->
  <div class="mb-12 overflow-hidden rounded-xl border border-white/[0.06]">
    <!-- Terminal chrome -->
    <div class="flex items-center justify-between bg-[var(--color-surface)] px-5 py-3">
      <div class="flex items-center gap-3">
        <div class="flex gap-1.5">
          <span class="h-3 w-3 rounded-full bg-[#ff5f57]"></span>
          <span class="h-3 w-3 rounded-full bg-[#febc2e]"></span>
          <span class="h-3 w-3 rounded-full bg-[#28c840]"></span>
        </div>
        <span class="text-xs text-neutral-500">claude_desktop_config.json</span>
      </div>
      <button
        class="text-[11px] text-neutral-500 transition hover:text-white"
        onclick={copyConfig}
      >
        {configCopied ? 'Copied!' : 'Copy'}
      </button>
    </div>
    <pre class="overflow-x-auto bg-black/40 px-5 py-4"><code class="font-mono text-sm text-emerald-400">{mcpConfig}</code></pre>
  </div>

  <!-- Search + Filters -->
  <div class="mb-8 flex flex-col gap-4">
    <input
      type="text"
      placeholder="Search tools..."
      bind:value={search}
      class="w-full rounded-lg border border-white/[0.06] bg-[var(--color-surface)] px-4 py-3 text-sm text-white placeholder-neutral-500 outline-none transition focus:border-emerald-500/50"
    />
    <div class="flex flex-wrap gap-2">
      <button
        class="rounded-full px-3 py-1 text-xs font-medium transition {activeCategory === null ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/[0.04] text-neutral-400 border border-white/[0.06] hover:text-white'}"
        onclick={() => (activeCategory = null)}
      >
        All
      </button>
      {#each mcpCategories as cat}
        <button
          class="rounded-full px-3 py-1 text-xs font-medium transition {activeCategory === cat ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/[0.04] text-neutral-400 border border-white/[0.06] hover:text-white'}"
          onclick={() => (activeCategory = activeCategory === cat ? null : cat)}
        >
          {cat}
        </button>
      {/each}
    </div>
  </div>

  <!-- Results count -->
  <p class="mb-4 text-xs text-neutral-500">
    Showing {filtered.length} of {mcpTools.length} tools
  </p>

  <!-- Tool cards -->
  <div class="flex flex-col gap-3">
    {#each filtered as tool (tool.name)}
      <div class="rounded-xl border border-white/[0.06] bg-[var(--color-surface)] transition hover:border-white/[0.12]">
        <!-- Card header -->
        <button
          class="flex w-full items-start gap-3 px-5 py-4 text-left"
          onclick={() => toggle(tool.name)}
        >
          <code class="shrink-0 font-mono text-sm font-medium text-emerald-400">{tool.name}</code>
          <span class="shrink-0 rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-neutral-500">
            {tool.category}
          </span>
          <span class="ml-auto text-right text-sm text-neutral-400 hidden sm:inline">{tool.description}</span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-4 w-4 shrink-0 text-neutral-500 transition-transform {expanded.has(tool.name) ? 'rotate-180' : ''}"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        <!-- Description on mobile (below header) -->
        <p class="px-5 pb-3 text-sm text-neutral-400 sm:hidden">{tool.description}</p>

        <!-- Expanded content -->
        {#if expanded.has(tool.name)}
          <div class="border-t border-white/[0.06] px-5 py-4">
            {#if tool.params.length > 0}
              <h4 class="mb-3 text-xs font-medium uppercase tracking-wider text-neutral-500">Parameters</h4>
              <div class="overflow-x-auto">
                <table class="w-full text-sm">
                  <thead>
                    <tr class="border-b border-white/[0.06] text-left text-xs uppercase tracking-wider text-neutral-500">
                      <th class="pb-2 pr-4 font-medium">Name</th>
                      <th class="pb-2 pr-4 font-medium">Type</th>
                      <th class="pb-2 pr-4 font-medium">Required</th>
                      <th class="pb-2 font-medium">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each tool.params as param}
                      <tr class="border-b border-white/[0.04]">
                        <td class="py-2 pr-4 font-mono text-xs text-emerald-400">{param.name}</td>
                        <td class="py-2 pr-4 text-xs text-neutral-500">{param.type}</td>
                        <td class="py-2 pr-4 text-xs {param.required ? 'text-amber-400' : 'text-neutral-600'}">{param.required ? 'Yes' : 'No'}</td>
                        <td class="py-2 text-xs text-neutral-400">{param.description}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {:else}
              <p class="text-sm text-neutral-500">No parameters</p>
            {/if}

            {#if tool.example}
              <div class="mt-5">
                <h4 class="mb-3 text-xs font-medium uppercase tracking-wider text-neutral-500">Example</h4>
                <div class="overflow-hidden rounded-lg border border-white/[0.06]">
                  <!-- Terminal chrome -->
                  <div class="flex items-center justify-between bg-black/60 px-4 py-2.5">
                    <div class="flex gap-1.5">
                      <span class="h-3 w-3 rounded-full bg-[#ff5f57]"></span>
                      <span class="h-3 w-3 rounded-full bg-[#febc2e]"></span>
                      <span class="h-3 w-3 rounded-full bg-[#28c840]"></span>
                    </div>
                    <button
                      class="text-[11px] text-neutral-500 transition hover:text-white"
                      onclick={() => copyExample(tool.example!, tool.name)}
                    >
                      {copiedName === tool.name ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <pre class="overflow-x-auto bg-black/40 px-4 py-3"><code class="font-mono text-sm text-neutral-300">{tool.example}</code></pre>
                </div>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    {/each}
  </div>

  {#if filtered.length === 0}
    <div class="rounded-xl border border-white/[0.06] bg-[var(--color-surface)] px-6 py-12 text-center">
      <p class="text-neutral-500">No tools match your search.</p>
    </div>
  {/if}

  <!-- Back link -->
  <div class="mt-12 text-center">
    <a href="/docs" class="text-sm text-neutral-500 transition hover:text-white">Back to Documentation</a>
  </div>
</div>
