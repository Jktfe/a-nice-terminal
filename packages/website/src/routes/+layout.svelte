<script>
  import '../app.css';
  let { children } = $props();
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
      <a href="/" class="text-lg font-semibold text-white">
        <span class="text-emerald-500">ANT</span> &middot; A Nice Terminal
      </a>
      <div class="flex items-center gap-6">
        <a href="/docs" class="text-sm text-neutral-400 transition hover:text-white">Docs</a>
        <a
          href="https://github.com/jamesking/a-nice-terminal"
          target="_blank"
          rel="noopener noreferrer"
          class="text-sm text-neutral-400 transition hover:text-white"
        >
          GitHub
        </a>
      </div>
    </div>
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
          href="https://github.com/jamesking/a-nice-terminal"
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
