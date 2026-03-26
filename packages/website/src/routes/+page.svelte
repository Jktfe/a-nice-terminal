<script lang="ts">
  let copied = $state(false);
  let activeTab = $state('rest');

  const installCmd = 'npx a-nice-terminal';

  const codeExamples: Record<string, { label: string; lang: string; code: string }> = {
    rest: {
      label: 'REST',
      lang: 'bash',
      code: `# Create a conversation session
curl -X POST http://localhost:3000/api/sessions \\
  -H "Content-Type: application/json" \\
  -d '{"type": "conversation", "name": "Agent Chat"}'

# Send a message
curl -X POST http://localhost:3000/api/sessions/:id/messages \\
  -H "Content-Type: application/json" \\
  -d '{"role": "agent", "content": "Task complete."}'`
    },
    cli: {
      label: 'CLI',
      lang: 'bash',
      code: `# Create a terminal session
ant create "My Build" -t terminal

# Execute a command and get structured output
ant exec "My Build" "npm test" --timeout 60

# Post a message to a conversation
ant post "Agent Chat" "Deploy succeeded" --role agent

# Follow terminal output in real-time
ant read "My Build" --follow`
    },
    mcp: {
      label: 'MCP',
      lang: 'json',
      code: `// Add to your AI client's MCP config
{
  "mcpServers": {
    "ant": {
      "command": "npx",
      "args": ["-y", "@anthropic/a-nice-terminal-mcp"]
    }
  }
}

// Then use tools like:
// ant_create_session, ant_send_message,
// ant_exec_command, ant_read_messages`
    }
  };

  const features = [
    {
      icon: 'M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
      title: 'Real Terminal',
      desc: 'PTY-backed shell sessions with full colour, resize handling, and signal propagation. Terminals survive server restarts via dtach.',
      link: '/features'
    },
    {
      icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
      title: 'Conversation Mode',
      desc: 'Rich text messaging with markdown, code blocks, streaming, threading, and clear role attribution for agent dialogue.',
      link: '/features'
    },
    {
      icon: 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4',
      title: 'Agent API',
      desc: 'Simple REST API and WebSocket for any AI agent. Create sessions, send messages, execute commands — all via HTTP.',
      link: '/docs'
    },
    {
      icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z',
      title: 'Multi-Agent Platform',
      desc: 'Agent registration with handles, @mention routing, conversation membership, and the ANTchat! protocol for chat rooms.',
      link: '/agents'
    },
    {
      icon: 'M4 6h16M4 12h16m-7 6h7',
      title: '15 CLI Commands',
      desc: 'Full-featured CLI for humans and agents: create, read, post, exec, attach, search, archive, and more.',
      link: '/cli'
    },
    {
      icon: 'M13 10V3L4 14h7v7l9-11h-7z',
      title: '28 MCP Tools',
      desc: 'Model Context Protocol server exposing sessions, messages, terminal, agent, workspace, search, and bridge tools.',
      link: '/mcp'
    }
  ];

  const stats = [
    { value: '15', label: 'CLI Commands' },
    { value: '28', label: 'MCP Tools' },
    { value: '12+', label: 'AI Tools Supported' },
    { value: '5', label: 'Terminal Themes' }
  ];

  async function copyInstall() {
    await navigator.clipboard.writeText(installCmd);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }

  let codeCopied = $state(false);
  async function copyCode() {
    await navigator.clipboard.writeText(codeExamples[activeTab].code);
    codeCopied = true;
    setTimeout(() => (codeCopied = false), 2000);
  }
</script>

<svelte:head>
  <title>ANT - A Nice Terminal for humans and AI agents</title>
  <meta name="description" content="Beautiful terminal and conversation sessions for humans and AI agents. Real PTY shells, rich messaging, 15 CLI commands, 28 MCP tools, and multi-agent orchestration." />
  <meta property="og:title" content="ANT - A Nice Terminal" />
  <meta property="og:description" content="Beautiful terminal and conversation sessions for humans and AI agents." />
  <meta property="og:url" content="https://antonline.dev" />
  <meta property="og:image" content="https://antonline.dev/ANTlogo.png" />
</svelte:head>

<!-- Hero -->
<section class="px-6 py-24 text-center md:py-32">
  <div class="mx-auto max-w-3xl">
    <div class="mb-8 inline-block rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-1.5 text-sm font-medium text-emerald-400">
      Open Source &middot; MIT Licence
    </div>

    <img src="/ANTlogo.png" alt="ANT - A Nice Terminal" class="mx-auto mb-8 h-20 md:h-24" />

    <p class="mx-auto mb-4 max-w-2xl text-lg text-neutral-400 md:text-xl">
      Beautiful terminal and conversation sessions for humans
      <span class="text-emerald-400">and</span> AI agents.
    </p>
    <p class="mb-10 text-neutral-500">
      A local web interface with real PTY shells, rich messaging, and a simple API
      that any agent can talk to.
    </p>

    <!-- Install command with copy button -->
    <div class="mx-auto mb-10 max-w-md">
      <button
        onclick={copyInstall}
        class="group relative w-full rounded-lg border border-white/[0.06] bg-[var(--color-surface)] px-5 py-3 text-left transition hover:border-white/10 cursor-pointer"
      >
        <code class="font-mono text-sm text-emerald-400">{installCmd}</code>
        <span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs transition-colors {copied ? 'text-emerald-400' : 'text-neutral-600 group-hover:text-neutral-400'}">
          {copied ? 'copied!' : 'copy'}
        </span>
      </button>
    </div>

    <!-- CTAs -->
    <div class="flex items-center justify-center gap-4">
      <a
        href="https://github.com/Jktfe/a-nice-terminal"
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

<!-- Stats -->
<section class="border-t border-white/[0.06] px-6 py-12">
  <div class="mx-auto grid max-w-4xl grid-cols-2 gap-6 md:grid-cols-4">
    {#each stats as stat}
      <div class="text-center">
        <div class="text-3xl font-bold text-emerald-400">{stat.value}</div>
        <div class="mt-1 text-sm text-neutral-500">{stat.label}</div>
      </div>
    {/each}
  </div>
</section>

<!-- Features -->
<section class="border-t border-white/[0.06] px-6 py-20">
  <div class="mx-auto max-w-6xl">
    <h2 class="mb-4 text-center text-3xl font-bold text-white">Built for developers and agents</h2>
    <p class="mx-auto mb-14 max-w-xl text-center text-neutral-500">
      Six core capabilities in one clean interface.
    </p>

    <div class="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      {#each features as feature}
        <a href={feature.link} class="group rounded-xl border border-white/[0.06] bg-[var(--color-surface)] p-6 transition hover:border-emerald-500/20">
          <div class="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10">
            <svg class="h-5 w-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d={feature.icon} />
            </svg>
          </div>
          <h3 class="mb-2 text-lg font-semibold text-white group-hover:text-emerald-400 transition-colors">{feature.title}</h3>
          <p class="text-sm leading-relaxed text-neutral-400">{feature.desc}</p>
        </a>
      {/each}
    </div>
  </div>
</section>

<!-- Screenshot -->
<section class="border-t border-white/[0.06] px-6 py-20">
  <div class="mx-auto max-w-5xl">
    <h2 class="mb-4 text-center text-3xl font-bold text-white">See it in action</h2>
    <p class="mx-auto mb-10 max-w-xl text-center text-neutral-500">
      A clean, dark interface designed for focus.
    </p>
    <div class="overflow-hidden rounded-xl border border-white/[0.06]">
      <img src="/ANTscreenshot.png" alt="A Nice Terminal interface screenshot" class="w-full" />
    </div>
  </div>
</section>

<!-- Code Examples with Tabs -->
<section class="border-t border-white/[0.06] px-6 py-20">
  <div class="mx-auto max-w-3xl">
    <h2 class="mb-4 text-center text-3xl font-bold text-white">Dead simple to integrate</h2>
    <p class="mx-auto mb-10 max-w-xl text-center text-neutral-500">
      Send a message from any agent — pick your favourite method.
    </p>

    <div class="overflow-hidden rounded-xl border border-white/[0.06] bg-[var(--color-surface)]">
      <!-- Tab bar -->
      <div class="flex items-center justify-between border-b border-white/[0.06] px-4">
        <div class="flex">
          {#each Object.entries(codeExamples) as [key, example]}
            <button
              onclick={() => activeTab = key}
              class="px-4 py-2.5 text-sm font-medium transition-colors cursor-pointer {activeTab === key ? 'text-emerald-400 border-b-2 border-emerald-400' : 'text-neutral-500 hover:text-neutral-300'}"
            >
              {example.label}
            </button>
          {/each}
        </div>
        <button onclick={copyCode} class="text-xs transition-colors cursor-pointer {codeCopied ? 'text-emerald-400' : 'text-neutral-600 hover:text-neutral-400'}">
          {codeCopied ? 'copied!' : 'copy'}
        </button>
      </div>

      <!-- Code content -->
      <pre class="overflow-x-auto p-5 text-sm leading-relaxed"><code class="text-neutral-300">{codeExamples[activeTab].code}</code></pre>
    </div>
  </div>
</section>

<!-- CTA -->
<section class="border-t border-white/[0.06] px-6 py-20">
  <div class="mx-auto max-w-2xl text-center">
    <h2 class="mb-4 text-3xl font-bold text-white">Ready to get started?</h2>
    <p class="mb-8 text-neutral-500">
      Install ANT in seconds and start building with AI agents.
    </p>
    <div class="flex items-center justify-center gap-4">
      <a
        href="https://github.com/Jktfe/a-nice-terminal"
        target="_blank"
        rel="noopener noreferrer"
        class="rounded-lg bg-emerald-500 px-8 py-3 text-sm font-medium text-black transition hover:bg-emerald-400"
      >
        View on GitHub
      </a>
      <a
        href="/docs"
        class="rounded-lg border border-white/[0.06] bg-[var(--color-surface)] px-8 py-3 text-sm font-medium text-white transition hover:border-white/10"
      >
        Read the Docs
      </a>
    </div>
  </div>
</section>
