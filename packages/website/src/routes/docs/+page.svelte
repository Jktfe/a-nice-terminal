<script>
  const sessionBody = `{
  "type": "terminal" | "conversation",
  "title": "My Session"
}`;

  const patchBody = `{
  "title": "New Title"
}`;

  const messageBody = `{
  "role": "user" | "assistant",
  "content": "Hello from my agent!"
}`;

  const resizeBody = `{ "cols": 120, "rows": 40 }`;

  const mcpConfig = `{
  "mcpServers": {
    "ant": {
      "command": "npx",
      "args": ["-y", "@ant/mcp"]
    }
  }
}`;
</script>

<svelte:head>
  <title>Docs - A Nice Terminal</title>
</svelte:head>

<!-- Nav -->
<nav class="border-b border-white/[0.06] px-6 py-4">
  <div class="mx-auto flex max-w-6xl items-center justify-between">
    <a href="/" class="text-lg font-semibold text-white">
      <span class="text-emerald-500">ANT</span> &middot; A Nice Terminal
    </a>
    <div class="flex items-center gap-6">
      <a href="/docs" class="text-sm text-white">Docs</a>
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

<div class="mx-auto max-w-4xl px-6 py-16">
  <h1 class="mb-2 text-4xl font-bold text-white">Documentation</h1>
  <p class="mb-14 text-neutral-400">Everything you need to get up and running with A Nice Terminal.</p>

  <!-- Getting Started -->
  <section class="mb-16">
    <h2 class="mb-6 text-2xl font-semibold text-white" id="getting-started">Getting Started</h2>
    <div class="rounded-xl border border-white/[0.06] bg-[var(--color-surface)] p-6">
      <h3 class="mb-3 text-lg font-medium text-white">Installation</h3>
      <p class="mb-4 text-sm text-neutral-400">
        Run ANT directly with npx -- no global install required:
      </p>
      <pre class="mb-6 overflow-x-auto rounded-lg bg-black/40 p-4 text-sm"><code class="text-emerald-400">npx a-nice-terminal</code></pre>
      <p class="mb-4 text-sm text-neutral-400">
        Or install globally:
      </p>
      <pre class="mb-6 overflow-x-auto rounded-lg bg-black/40 p-4 text-sm"><code class="text-emerald-400">npm install -g a-nice-terminal
ant</code></pre>
      <p class="mb-4 text-sm text-neutral-400">
        ANT starts a local server on <code class="rounded bg-white/[0.06] px-1.5 py-0.5 text-xs text-emerald-400">http://localhost:3000</code> with:
      </p>
      <ul class="space-y-2 text-sm text-neutral-400">
        <li class="flex items-start gap-2">
          <span class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"></span>
          A web-based terminal interface with PTY shell sessions
        </li>
        <li class="flex items-start gap-2">
          <span class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"></span>
          Conversation sessions for structured agent dialogue
        </li>
        <li class="flex items-start gap-2">
          <span class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"></span>
          REST API and WebSocket for programmatic access
        </li>
      </ul>
    </div>
  </section>

  <!-- API Reference -->
  <section class="mb-16">
    <h2 class="mb-6 text-2xl font-semibold text-white" id="api-reference">API Reference</h2>
    <p class="mb-6 text-sm text-neutral-400">
      All endpoints are available at <code class="rounded bg-white/[0.06] px-1.5 py-0.5 text-xs text-emerald-400">http://localhost:3000/api</code>.
      Responses are JSON.
    </p>

    <!-- Sessions -->
    <div class="mb-8 rounded-xl border border-white/[0.06] bg-[var(--color-surface)] p-6">
      <h3 class="mb-4 text-lg font-medium text-white">Sessions</h3>
      <div class="space-y-4">
        <div class="rounded-lg border border-white/[0.04] bg-black/20 p-4">
          <div class="mb-2 flex items-center gap-3">
            <span class="rounded bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-400">GET</span>
            <code class="text-sm text-neutral-300">/api/sessions</code>
          </div>
          <p class="text-sm text-neutral-500">List all sessions (terminal and conversation).</p>
        </div>

        <div class="rounded-lg border border-white/[0.04] bg-black/20 p-4">
          <div class="mb-2 flex items-center gap-3">
            <span class="rounded bg-blue-500/20 px-2 py-0.5 text-xs font-medium text-blue-400">POST</span>
            <code class="text-sm text-neutral-300">/api/sessions</code>
          </div>
          <p class="mb-3 text-sm text-neutral-500">Create a new session.</p>
          <pre class="overflow-x-auto rounded-lg bg-black/40 p-3 text-xs"><code class="text-neutral-300">{sessionBody}</code></pre>
        </div>

        <div class="rounded-lg border border-white/[0.04] bg-black/20 p-4">
          <div class="mb-2 flex items-center gap-3">
            <span class="rounded bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-400">GET</span>
            <code class="text-sm text-neutral-300">/api/sessions/:id</code>
          </div>
          <p class="text-sm text-neutral-500">Get a single session by ID.</p>
        </div>

        <div class="rounded-lg border border-white/[0.04] bg-black/20 p-4">
          <div class="mb-2 flex items-center gap-3">
            <span class="rounded bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-400">PATCH</span>
            <code class="text-sm text-neutral-300">/api/sessions/:id</code>
          </div>
          <p class="mb-3 text-sm text-neutral-500">Update a session (e.g. rename it).</p>
          <pre class="overflow-x-auto rounded-lg bg-black/40 p-3 text-xs"><code class="text-neutral-300">{patchBody}</code></pre>
        </div>

        <div class="rounded-lg border border-white/[0.04] bg-black/20 p-4">
          <div class="mb-2 flex items-center gap-3">
            <span class="rounded bg-red-500/20 px-2 py-0.5 text-xs font-medium text-red-400">DELETE</span>
            <code class="text-sm text-neutral-300">/api/sessions/:id</code>
          </div>
          <p class="text-sm text-neutral-500">Delete a session and all its messages.</p>
        </div>
      </div>
    </div>

    <!-- Messages -->
    <div class="mb-8 rounded-xl border border-white/[0.06] bg-[var(--color-surface)] p-6">
      <h3 class="mb-4 text-lg font-medium text-white">Messages</h3>
      <div class="space-y-4">
        <div class="rounded-lg border border-white/[0.04] bg-black/20 p-4">
          <div class="mb-2 flex items-center gap-3">
            <span class="rounded bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-400">GET</span>
            <code class="text-sm text-neutral-300">/api/sessions/:id/messages</code>
          </div>
          <p class="text-sm text-neutral-500">List all messages in a conversation session.</p>
        </div>

        <div class="rounded-lg border border-white/[0.04] bg-black/20 p-4">
          <div class="mb-2 flex items-center gap-3">
            <span class="rounded bg-blue-500/20 px-2 py-0.5 text-xs font-medium text-blue-400">POST</span>
            <code class="text-sm text-neutral-300">/api/sessions/:id/messages</code>
          </div>
          <p class="mb-3 text-sm text-neutral-500">Send a message to a conversation session.</p>
          <pre class="overflow-x-auto rounded-lg bg-black/40 p-3 text-xs"><code class="text-neutral-300">{messageBody}</code></pre>
        </div>

        <div class="rounded-lg border border-white/[0.04] bg-black/20 p-4">
          <div class="mb-2 flex items-center gap-3">
            <span class="rounded bg-red-500/20 px-2 py-0.5 text-xs font-medium text-red-400">DELETE</span>
            <code class="text-sm text-neutral-300">/api/sessions/:id/messages/:messageId</code>
          </div>
          <p class="text-sm text-neutral-500">Delete a specific message.</p>
        </div>
      </div>
    </div>
  </section>

  <!-- WebSocket Events -->
  <section class="mb-16">
    <h2 class="mb-6 text-2xl font-semibold text-white" id="websocket-events">WebSocket Events</h2>
    <p class="mb-6 text-sm text-neutral-400">
      Connect via Socket.IO at <code class="rounded bg-white/[0.06] px-1.5 py-0.5 text-xs text-emerald-400">http://localhost:3000</code>
      for real-time updates.
    </p>

    <div class="rounded-xl border border-white/[0.06] bg-[var(--color-surface)] p-6">
      <div class="space-y-4">
        <div class="rounded-lg border border-white/[0.04] bg-black/20 p-4">
          <div class="mb-2 flex items-center gap-3">
            <span class="rounded bg-purple-500/20 px-2 py-0.5 text-xs font-medium text-purple-400">EVENT</span>
            <code class="text-sm text-neutral-300">session:created</code>
          </div>
          <p class="text-sm text-neutral-500">Emitted when a new session is created. Payload contains the full session object.</p>
        </div>

        <div class="rounded-lg border border-white/[0.04] bg-black/20 p-4">
          <div class="mb-2 flex items-center gap-3">
            <span class="rounded bg-purple-500/20 px-2 py-0.5 text-xs font-medium text-purple-400">EVENT</span>
            <code class="text-sm text-neutral-300">session:updated</code>
          </div>
          <p class="text-sm text-neutral-500">Emitted when a session is renamed or modified.</p>
        </div>

        <div class="rounded-lg border border-white/[0.04] bg-black/20 p-4">
          <div class="mb-2 flex items-center gap-3">
            <span class="rounded bg-purple-500/20 px-2 py-0.5 text-xs font-medium text-purple-400">EVENT</span>
            <code class="text-sm text-neutral-300">session:deleted</code>
          </div>
          <p class="text-sm text-neutral-500">Emitted when a session is deleted.</p>
        </div>

        <div class="rounded-lg border border-white/[0.04] bg-black/20 p-4">
          <div class="mb-2 flex items-center gap-3">
            <span class="rounded bg-purple-500/20 px-2 py-0.5 text-xs font-medium text-purple-400">EVENT</span>
            <code class="text-sm text-neutral-300">message:created</code>
          </div>
          <p class="text-sm text-neutral-500">Emitted when a new message is added to a conversation session.</p>
        </div>

        <div class="rounded-lg border border-white/[0.04] bg-black/20 p-4">
          <div class="mb-2 flex items-center gap-3">
            <span class="rounded bg-purple-500/20 px-2 py-0.5 text-xs font-medium text-purple-400">EVENT</span>
            <code class="text-sm text-neutral-300">terminal:output</code>
          </div>
          <p class="text-sm text-neutral-500">Streams terminal output for a given session. Subscribe by joining the session room.</p>
        </div>

        <div class="rounded-lg border border-white/[0.04] bg-black/20 p-4">
          <div class="mb-2 flex items-center gap-3">
            <span class="rounded bg-purple-500/20 px-2 py-0.5 text-xs font-medium text-purple-400">EMIT</span>
            <code class="text-sm text-neutral-300">terminal:input</code>
          </div>
          <p class="text-sm text-neutral-500">Send keystrokes to a terminal session.</p>
        </div>

        <div class="rounded-lg border border-white/[0.04] bg-black/20 p-4">
          <div class="mb-2 flex items-center gap-3">
            <span class="rounded bg-purple-500/20 px-2 py-0.5 text-xs font-medium text-purple-400">EMIT</span>
            <code class="text-sm text-neutral-300">terminal:resize</code>
          </div>
          <p class="mb-3 text-sm text-neutral-500">Resize the terminal PTY.</p>
          <pre class="overflow-x-auto rounded-lg bg-black/40 p-3 text-xs"><code class="text-neutral-300">{resizeBody}</code></pre>
        </div>
      </div>
    </div>
  </section>

  <!-- MCP Server -->
  <section class="mb-16">
    <h2 class="mb-6 text-2xl font-semibold text-white" id="mcp-server">MCP Server</h2>
    <p class="mb-6 text-sm text-neutral-400">
      ANT includes a Model Context Protocol (MCP) server that exposes terminal and conversation
      capabilities to any MCP-compatible AI client.
    </p>

    <div class="rounded-xl border border-white/[0.06] bg-[var(--color-surface)] p-6">
      <h3 class="mb-3 text-lg font-medium text-white">Configuration</h3>
      <p class="mb-4 text-sm text-neutral-400">
        Add the ANT MCP server to your client configuration:
      </p>
      <pre class="mb-6 overflow-x-auto rounded-lg bg-black/40 p-4 text-sm"><code class="text-neutral-300">{mcpConfig}</code></pre>

      <h3 class="mb-3 text-lg font-medium text-white">Available Tools</h3>
      <p class="mb-4 text-sm text-neutral-400">
        The MCP server exposes tools for session management, message sending, and terminal
        interaction. Your AI client can use these to:
      </p>
      <ul class="space-y-2 text-sm text-neutral-400">
        <li class="flex items-start gap-2">
          <span class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"></span>
          Create and manage terminal or conversation sessions
        </li>
        <li class="flex items-start gap-2">
          <span class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"></span>
          Send structured messages with role attribution
        </li>
        <li class="flex items-start gap-2">
          <span class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"></span>
          Execute commands in terminal sessions
        </li>
        <li class="flex items-start gap-2">
          <span class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"></span>
          Read terminal output and conversation history
        </li>
      </ul>
    </div>
  </section>

  <!-- Back to top -->
  <div class="text-center">
    <a href="/docs" class="text-sm text-neutral-500 transition hover:text-white">Back to top</a>
  </div>
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
      <a href="/" class="text-sm text-neutral-500 transition hover:text-white">
        Home
      </a>
    </div>
  </div>
</footer>
