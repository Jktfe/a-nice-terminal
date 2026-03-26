<script lang="ts">
  import { features, featureCategories } from '$lib/data/features';
  import { keyboardShortcuts } from '$lib/data/keyboard-shortcuts';

  let activeTab = $state<string>('Terminal');
  let filteredFeatures = $derived(features.filter(f => f.category === activeTab));

  /** Return an inline SVG icon path for a category. */
  function categoryIcon(cat: string): string {
    const icons: Record<string, string> = {
      Terminal: 'M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
      Conversations: 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z',
      'Multi-Agent': 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75',
      UI: 'M9 3H4a1 1 0 00-1 1v5a1 1 0 001 1h5a1 1 0 001-1V4a1 1 0 00-1-1zM20 3h-5a1 1 0 00-1 1v5a1 1 0 001 1h5a1 1 0 001-1V4a1 1 0 00-1-1z',
      'Developer Tools': 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4',
    };
    return icons[cat] || '';
  }

  /** Parse shortcut key string into individual key tokens. */
  function parseKeys(keys: string): string[] {
    return keys.split('+').map(k => k.trim());
  }
</script>

<svelte:head>
  <title>Features - A Nice Terminal</title>
  <meta name="description" content="Explore every feature of A Nice Terminal — real PTY terminals, conversation sessions, multi-agent orchestration, keyboard shortcuts, and terminal themes." />
  <meta property="og:title" content="Features - A Nice Terminal" />
  <meta property="og:url" content="https://antonline.dev/features" />
</svelte:head>

<div class="mx-auto max-w-6xl px-6 py-16">
  <!-- Header -->
  <div class="mb-14 text-center">
    <h1 class="mb-3 text-4xl font-bold text-white">Features</h1>
    <p class="text-neutral-400">Everything ANT can do</p>
  </div>

  <!-- Tab navigation -->
  <div class="mb-10 flex flex-wrap justify-center gap-2">
    {#each featureCategories as cat}
      <button
        onclick={() => activeTab = cat}
        class="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition cursor-pointer {activeTab === cat ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'border border-white/[0.06] bg-[var(--color-surface)] text-neutral-400 hover:text-white hover:border-white/10'}"
      >
        <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d={categoryIcon(cat)} />
        </svg>
        {cat}
      </button>
    {/each}
  </div>

  <!-- Feature cards -->
  <div class="mb-20 grid gap-6 md:grid-cols-2">
    {#each filteredFeatures as feature (feature.id)}
      <div class="rounded-xl border border-white/[0.06] bg-[var(--color-surface)] p-6">
        <div class="mb-4 flex items-center gap-3">
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10">
            <svg class="h-5 w-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d={feature.icon} />
            </svg>
          </div>
          <h3 class="text-lg font-semibold text-white">{feature.title}</h3>
        </div>

        <p class="mb-4 text-sm text-neutral-400">{feature.description}</p>

        <!-- Capabilities -->
        <ul class="mb-4 space-y-2 text-sm text-neutral-400">
          {#each feature.details.split('. ').filter(s => s.length > 20).slice(0, 3) as point}
            <li class="flex items-start gap-2">
              <span class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"></span>
              {point.endsWith('.') ? point : point + '.'}
            </li>
          {/each}
        </ul>

        <p class="text-xs leading-relaxed text-neutral-500">{feature.details}</p>
      </div>
    {/each}
  </div>

  <!-- Keyboard Shortcuts -->
  <section class="mb-20">
    <h2 class="mb-2 text-center text-2xl font-semibold text-white">Keyboard Shortcuts</h2>
    <p class="mx-auto mb-10 max-w-md text-center text-sm text-neutral-500">Full keyboard navigation for every major action.</p>

    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {#each keyboardShortcuts as shortcut}
        <div class="rounded-xl border border-white/[0.06] bg-[var(--color-surface)] p-4">
          <div class="mb-3 flex items-center gap-1.5">
            {#each parseKeys(shortcut.keys) as key}
              <kbd class="bg-white/[0.06] border border-white/[0.1] rounded px-1.5 py-0.5 text-xs font-mono text-neutral-300">{key}</kbd>
            {/each}
          </div>
          <p class="mb-1 text-sm font-medium text-white">{shortcut.label}</p>
          <p class="text-xs text-neutral-500">{shortcut.description}</p>
        </div>
      {/each}
    </div>
  </section>
</div>
