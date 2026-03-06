<script>
  const curlExample = `# Create a conversation session
curl -X POST http://localhost:3000/api/sessions \\
  -H "Content-Type: application/json" \\
  -d '{"type": "conversation", "title": "Agent Chat"}'

# Send a message
curl -X POST http://localhost:3000/api/sessions/:id/messages \\
  -H "Content-Type: application/json" \\
  -d '{"role": "assistant", "content": "Task complete."}'`;
</script>

<svelte:head>
  <title>A Nice Terminal - Beautiful terminal and conversation sessions</title>
</svelte:head>

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

<!-- Hero -->
<section class="px-6 py-24 text-center md:py-32">
  <div class="mx-auto max-w-3xl">
    <div class="mb-6 inline-block rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-1.5 text-sm font-medium text-emerald-400">
      Open Source &middot; MIT Licence
    </div>
    <h1 class="mb-6 text-5xl font-bold tracking-tight text-white md:text-6xl">
      A Nice Terminal
    </h1>
    <p class="mx-auto mb-4 max-w-2xl text-lg text-neutral-400 md:text-xl">
      Beautiful terminal and conversation sessions for humans
      <span class="text-emerald-400">and</span> AI agents.
    </p>
    <p class="mb-10 text-neutral-500">
      A localhost web interface with real PTY shells, rich messaging, and a simple API
      that any agent can talk to.
    </p>

    <!-- Install command -->
    <div class="mx-auto mb-10 max-w-md">
      <div class="group relative rounded-lg border border-white/[0.06] bg-[var(--color-surface)] px-5 py-3">
        <code class="font-mono text-sm text-emerald-400">npx a-nice-terminal</code>
        <span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-neutral-600">
          copy
        </span>
      </div>
    </div>

    <!-- CTAs -->
    <div class="flex items-center justify-center gap-4">
      <a
        href="https://github.com/jamesking/a-nice-terminal"
        target="_blank"
        rel="noopener noreferrer"
        class="rounded-lg bg-emerald-500 px-6 py-2.5 text-sm font-medium text-black transition hover:bg-emerald-400"
      >
        Get Started
      </a>
      <a
        href="/docs"
        class="rounded-lg border border-white/[0.06] bg-[var(--color-surface)] px-6 py-2.5 text-sm font-medium text-white transition hover:border-white/10"
      >
        View Docs
      </a>
    </div>
  </div>
</section>

<!-- Features -->
<section class="border-t border-white/[0.06] px-6 py-20">
  <div class="mx-auto max-w-6xl">
    <h2 class="mb-4 text-center text-3xl font-bold text-white">Built for developers and agents</h2>
    <p class="mx-auto mb-14 max-w-xl text-center text-neutral-500">
      Three core capabilities in one clean interface.
    </p>

    <div class="grid gap-6 md:grid-cols-3">
      <!-- Real Terminal -->
      <div class="rounded-xl border border-white/[0.06] bg-[var(--color-surface)] p-6">
        <div class="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10">
          <svg class="h-5 w-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
        <h3 class="mb-2 text-lg font-semibold text-white">Real Terminal</h3>
        <p class="text-sm leading-relaxed text-neutral-400">
          PTY-backed shell sessions in a beautiful interface. Full colour support, resize handling,
          and proper signal propagation -- a real terminal, not a simulation.
        </p>
      </div>

      <!-- Conversation Mode -->
      <div class="rounded-xl border border-white/[0.06] bg-[var(--color-surface)] p-6">
        <div class="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10">
          <svg class="h-5 w-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </div>
        <h3 class="mb-2 text-lg font-semibold text-white">Conversation Mode</h3>
        <p class="text-sm leading-relaxed text-neutral-400">
          Rich text messaging for structured AI agent dialogue. Markdown rendering, code blocks,
          and clear role attribution -- perfect for agent-to-human communication.
        </p>
      </div>

      <!-- Agent API -->
      <div class="rounded-xl border border-white/[0.06] bg-[var(--color-surface)] p-6">
        <div class="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10">
          <svg class="h-5 w-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
          </svg>
        </div>
        <h3 class="mb-2 text-lg font-semibold text-white">Agent API</h3>
        <p class="text-sm leading-relaxed text-neutral-400">
          Simple REST API and WebSocket for any AI agent to interact. Create sessions, send
          messages, execute commands -- all via straightforward HTTP calls.
        </p>
      </div>
    </div>
  </div>
</section>

<!-- Code Example -->
<section class="border-t border-white/[0.06] px-6 py-20">
  <div class="mx-auto max-w-3xl">
    <h2 class="mb-4 text-center text-3xl font-bold text-white">Dead simple to integrate</h2>
    <p class="mx-auto mb-10 max-w-xl text-center text-neutral-500">
      Send a message from any agent with a single HTTP call.
    </p>

    <div class="overflow-hidden rounded-xl border border-white/[0.06] bg-[var(--color-surface)]">
      <div class="flex items-center gap-2 border-b border-white/[0.06] px-4 py-2.5">
        <div class="h-3 w-3 rounded-full bg-red-500/60"></div>
        <div class="h-3 w-3 rounded-full bg-yellow-500/60"></div>
        <div class="h-3 w-3 rounded-full bg-green-500/60"></div>
        <span class="ml-2 text-xs text-neutral-500">bash</span>
      </div>
      <pre class="overflow-x-auto p-5 text-sm leading-relaxed"><code class="text-neutral-300">{curlExample}</code></pre>
    </div>
  </div>
</section>

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
