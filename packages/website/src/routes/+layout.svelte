<script>
  import '../app.css';
  let { children } = $props();
  let mobileOpen = $state(false);
</script>

<svelte:head>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />

  <!-- OG Meta -->
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="A Nice Terminal" />
  <meta property="og:image" content="https://antonline.dev/og-image.png" />
  <meta name="twitter:card" content="summary_large_image" />
</svelte:head>

<div class="min-h-screen bg-[var(--color-bg)] flex flex-col">
  <!-- Nav -->
  <nav class="border-b border-white/[0.06] px-6 py-4">
    <div class="mx-auto flex max-w-6xl items-center justify-between">
      <a href="/" class="flex items-center gap-2">
        <img src="/ANTlogo.png" alt="ANT" class="h-8" />
      </a>

      <!-- Desktop nav -->
      <div class="hidden items-center gap-6 md:flex">
        <a href="/features" class="text-sm text-neutral-400 transition hover:text-white">Features</a>
        <a href="/cli" class="text-sm text-neutral-400 transition hover:text-white">CLI</a>
        <a href="/mcp" class="text-sm text-neutral-400 transition hover:text-white">MCP</a>
        <a href="/agents" class="text-sm text-neutral-400 transition hover:text-white">Agents</a>
        <a href="/docs" class="text-sm text-neutral-400 transition hover:text-white">Docs</a>
        <a
          href="https://github.com/Jktfe/a-nice-terminal"
          target="_blank"
          rel="noopener noreferrer"
          class="text-sm text-neutral-400 transition hover:text-white"
        >
          GitHub
        </a>
      </div>

      <!-- Mobile hamburger -->
      <button
        class="flex items-center justify-center md:hidden text-neutral-400 hover:text-white transition"
        onclick={() => mobileOpen = !mobileOpen}
        aria-label="Toggle menu"
      >
        {#if mobileOpen}
          <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        {:else}
          <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        {/if}
      </button>
    </div>

    <!-- Mobile menu -->
    {#if mobileOpen}
      <div class="mt-4 flex flex-col gap-3 border-t border-white/[0.06] pt-4 md:hidden">
        <a href="/features" class="text-sm text-neutral-400 transition hover:text-white" onclick={() => mobileOpen = false}>Features</a>
        <a href="/cli" class="text-sm text-neutral-400 transition hover:text-white" onclick={() => mobileOpen = false}>CLI</a>
        <a href="/mcp" class="text-sm text-neutral-400 transition hover:text-white" onclick={() => mobileOpen = false}>MCP</a>
        <a href="/agents" class="text-sm text-neutral-400 transition hover:text-white" onclick={() => mobileOpen = false}>Agents</a>
        <a href="/docs" class="text-sm text-neutral-400 transition hover:text-white" onclick={() => mobileOpen = false}>Docs</a>
        <a
          href="https://github.com/Jktfe/a-nice-terminal"
          target="_blank"
          rel="noopener noreferrer"
          class="text-sm text-neutral-400 transition hover:text-white"
          onclick={() => mobileOpen = false}
        >
          GitHub
        </a>
      </div>
    {/if}
  </nav>

  <!-- Content -->
  <div class="flex-1">
    {@render children()}
  </div>

  <!-- Footer -->
  <footer class="border-t border-white/[0.06] px-6 py-10">
    <div class="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 md:flex-row">
      <div class="text-sm text-neutral-500">
        MIT Licence &middot; Built by James King
      </div>
      <div class="flex items-center gap-6">
        <a
          href="https://github.com/Jktfe/a-nice-terminal"
          target="_blank"
          rel="noopener noreferrer"
          class="text-sm text-neutral-500 transition hover:text-white"
        >
          GitHub
        </a>
        <a href="/docs" class="text-sm text-neutral-500 transition hover:text-white">
          Docs
        </a>
      </div>
    </div>
  </footer>
</div>
