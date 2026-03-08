<script>
  const sessionBody = `{
  "type": "terminal" | "conversation",
  "name": "My Session"
}`;

  const patchBody = `{
  "name": "New Name"
}`;

  const messageBody = `{
  "role": "human" | "agent" | "system",
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

  const envVars = `# Server configuration
ANT_PORT=3000          # Server port (default: 3000)
ANT_HOST=localhost     # Bind address (default: localhost)
ANT_API_KEY=mySecret   # Optional API key for authentication

# Client configuration (set in .env)
VITE_ANT_API_KEY=mySecret  # Must match ANT_API_KEY`;

  const tocSections = [
    { id: 'getting-started', label: 'Getting Started' },
    { id: 'environment-variables', label: 'Environment Variables' },
    { id: 'security', label: 'Security' },
    { id: 'api-reference', label: 'API Reference' },
    { id: 'websocket-events', label: 'WebSocket Events' },
    { id: 'mcp-server', label: 'MCP Server' },
  ];
</script>

<svelte:head>
  <title>Docs - A Nice Terminal</title>
  <meta name="description" content="Documentation for A Nice Terminal - API reference, WebSocket events, environment variables, and security." />
  <meta property="og:title" content="Docs - A Nice Terminal" />
  <meta property="og:url" content="https://antonline.dev/docs" />
</svelte:head>

<div class="mx-auto max-w-6xl px-6 py-16 md:flex md:gap-12">
  <!-- Sidebar TOC (desktop) -->
  <aside class="hidden md:block md:w-48 shrink-0">
    <nav class="sticky top-8">
      <h4 class="mb-3 text-xs font-semibold uppercase tracking-widest text-neutral-500">On this page</h4>
      <ul class="space-y-2">
        {#each tocSections as section}
          <li>
            <a href="#{section.id}" class="text-sm text-neutral-400 transition hover:text-white">{section.label}</a>
          </li>
        {/each}
      </ul>
    </nav>
  </aside>

  <!-- Main content -->
  <div class="flex-1 min-w-0">
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
          ANT starts a local server on <code class="rounded bg-white/[0.06] px-1.5 py-0.5 text-xs text-emerald-400">$ANT_HOST:$ANT_PORT</code> (defaults to <code class="rounded bg-white/[0.06] px-1.5 py-0.5 text-xs text-emerald-400">localhost:3000</code>).
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

    <!-- Environment Variables -->
    <section class="mb-16">
      <h2 class="mb-6 text-2xl font-semibold text-white" id="environment-variables">Environment Variables</h2>
      <div class="rounded-xl border border-white/[0.06] bg-[var(--color-surface)] p-6">
        <p class="mb-4 text-sm text-neutral-400">
          Configure ANT with environment variables or a <code class="rounded bg-white/[0.06] px-1.5 py-0.5 text-xs text-emerald-400">.env</code> file:
        </p>
        <pre class="overflow-x-auto rounded-lg bg-black/40 p-4 text-sm"><code class="text-neutral-300">{envVars}</code></pre>

        <div class="mt-6 space-y-4">
          <div class="rounded-lg border border-white/[0.04] bg-black/20 p-4">
            <div class="mb-1 flex items-center gap-2">
              <code class="text-sm text-emerald-400">ANT_PORT</code>
              <span class="text-xs text-neutral-600">default: 3000</span>
            </div>
            <p class="text-sm text-neutral-500">The port ANT listens on.</p>
          </div>
          <div class="rounded-lg border border-white/[0.04] bg-black/20 p-4">
            <div class="mb-1 flex items-center gap-2">
              <code class="text-sm text-emerald-400">ANT_HOST</code>
              <span class="text-xs text-neutral-600">default: localhost</span>
            </div>
            <p class="text-sm text-neutral-500">Bind address. Set to <code class="rounded bg-white/[0.06] px-1 py-0.5 text-xs">0.0.0.0</code> to listen on all interfaces (e.g. for Tailscale access).</p>
          </div>
          <div class="rounded-lg border border-white/[0.04] bg-black/20 p-4">
            <div class="mb-1 flex items-center gap-2">
              <code class="text-sm text-emerald-400">ANT_API_KEY</code>
              <span class="text-xs text-neutral-600">optional</span>
            </div>
            <p class="text-sm text-neutral-500">When set, all REST and WebSocket requests must include this key via <code class="rounded bg-white/[0.06] px-1 py-0.5 text-xs">X-API-Key</code> header or Socket.IO auth.</p>
          </div>
          <div class="rounded-lg border border-white/[0.04] bg-black/20 p-4">
            <div class="mb-1 flex items-center gap-2">
              <code class="text-sm text-emerald-400">VITE_ANT_API_KEY</code>
              <span class="text-xs text-neutral-600">optional</span>
            </div>
            <p class="text-sm text-neutral-500">Client-side API key. Must match <code class="rounded bg-white/[0.06] px-1 py-0.5 text-xs">ANT_API_KEY</code> if set.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- Security -->
    <section class="mb-16">
      <h2 class="mb-6 text-2xl font-semibold text-white" id="security">Security</h2>
      <div class="rounded-xl border border-white/[0.06] bg-[var(--color-surface)] p-6">
        <div class="space-y-4 text-sm text-neutral-400">
          <div class="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
            <h4 class="mb-2 font-medium text-amber-400">Important</h4>
            <p>ANT provides real shell access via PTY sessions. It is designed for local or trusted-network use only.</p>
          </div>
          <div>
            <h4 class="mb-2 font-medium text-white">Localhost-only by default</h4>
            <p>ANT binds to <code class="rounded bg-white/[0.06] px-1 py-0.5 text-xs text-emerald-400">localhost</code> by default. Connections from other hosts are rejected unless you change <code class="rounded bg-white/[0.06] px-1 py-0.5 text-xs text-emerald-400">ANT_HOST</code>.</p>
          </div>
          <div>
            <h4 class="mb-2 font-medium text-white">API key authentication</h4>
            <p>Set <code class="rounded bg-white/[0.06] px-1 py-0.5 text-xs text-emerald-400">ANT_API_KEY</code> to require authentication on all endpoints. Requests without a valid key receive a 401 response.</p>
          </div>
          <div>
            <h4 class="mb-2 font-medium text-white">Remote access via Tailscale</h4>
            <p>For secure remote access (e.g. from your phone), use <a href="https://tailscale.com" target="_blank" rel="noopener noreferrer" class="text-emerald-400 hover:underline">Tailscale</a> to create a private network. Set <code class="rounded bg-white/[0.06] px-1 py-0.5 text-xs text-emerald-400">ANT_HOST=0.0.0.0</code> and use your Tailscale IP to connect.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- API Reference -->
    <section class="mb-16">
      <h2 class="mb-6 text-2xl font-semibold text-white" id="api-reference">API Reference</h2>
      <p class="mb-6 text-sm text-neutral-400">
        All endpoints are available at <code class="rounded bg-white/[0.06] px-1.5 py-0.5 text-xs text-emerald-400">/api</code>.
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
        Connect via Socket.IO for real-time updates.
      </p>

      <div class="rounded-xl border border-white/[0.06] bg-[var(--color-surface)] p-6">
        <div class="space-y-4">
          <div class="rounded-lg border border-white/[0.04] bg-black/20 p-4">
            <div class="mb-2 flex items-center gap-3">
              <span class="rounded bg-purple-500/20 px-2 py-0.5 text-xs font-medium text-purple-400">EVENT</span>
              <code class="text-sm text-neutral-300">error</code>
            </div>
            <p class="text-sm text-neutral-500">Generic error event emitted for invalid payloads, type mismatches, or access failures.</p>
          </div>

          <div class="rounded-lg border border-white/[0.04] bg-black/20 p-4">
            <div class="mb-2 flex items-center gap-3">
              <span class="rounded bg-purple-500/20 px-2 py-0.5 text-xs font-medium text-purple-400">EMIT</span>
              <code class="text-sm text-neutral-300">join_session</code>
            </div>
            <p class="text-sm text-neutral-500">Join a room for a session ID. Terminal sessions also initialise PTY streams.</p>
          </div>

          <div class="rounded-lg border border-white/[0.04] bg-black/20 p-4">
            <div class="mb-2 flex items-center gap-3">
              <span class="rounded bg-purple-500/20 px-2 py-0.5 text-xs font-medium text-purple-400">EVENT</span>
              <code class="text-sm text-neutral-300">session_joined</code>
            </div>
            <p class="text-sm text-neutral-500">Server confirms a successful room join and returns session type.</p>
          </div>

          <div class="rounded-lg border border-white/[0.04] bg-black/20 p-4">
            <div class="mb-2 flex items-center gap-3">
              <span class="rounded bg-purple-500/20 px-2 py-0.5 text-xs font-medium text-purple-400">EMIT</span>
              <code class="text-sm text-neutral-300">terminal_input</code>
            </div>
            <p class="text-sm text-neutral-500">Write input to a terminal session.</p>
          </div>

          <div class="rounded-lg border border-white/[0.04] bg-black/20 p-4">
            <div class="mb-2 flex items-center gap-3">
              <span class="rounded bg-purple-500/20 px-2 py-0.5 text-xs font-medium text-purple-400">EMIT</span>
              <code class="text-sm text-neutral-300">terminal_resize</code>
            </div>
            <p class="mb-3 text-sm text-neutral-500">Resize a terminal PTY.</p>
            <pre class="overflow-x-auto rounded-lg bg-black/40 p-3 text-xs"><code class="text-neutral-300">{resizeBody}</code></pre>
          </div>

          <div class="rounded-lg border border-white/[0.04] bg-black/20 p-4">
            <div class="mb-2 flex items-center gap-3">
              <span class="rounded bg-purple-500/20 px-2 py-0.5 text-xs font-medium text-purple-400">EVENT</span>
              <code class="text-sm text-neutral-300">terminal_output</code>
            </div>
            <p class="text-sm text-neutral-500">Server-side terminal stream output for a session.</p>
          </div>

          <div class="rounded-lg border border-white/[0.04] bg-black/20 p-4">
            <div class="mb-2 flex items-center gap-3">
              <span class="rounded bg-purple-500/20 px-2 py-0.5 text-xs font-medium text-purple-400">EMIT</span>
              <code class="text-sm text-neutral-300">stream_chunk</code>
            </div>
            <p class="text-sm text-neutral-500">Emit partial message content for a <code class="rounded bg-white/[0.06] px-1 py-0.5 text-xs">conversation</code> message.</p>
          </div>

          <div class="rounded-lg border border-white/[0.04] bg-black/20 p-4">
            <div class="mb-2 flex items-center gap-3">
              <span class="rounded bg-purple-500/20 px-2 py-0.5 text-xs font-medium text-purple-400">EMIT</span>
              <code class="text-sm text-neutral-300">stream_end</code>
            </div>
            <p class="text-sm text-neutral-500">Finalise streaming and persist the final message content.</p>
          </div>

          <div class="rounded-lg border border-white/[0.04] bg-black/20 p-4">
            <div class="mb-2 flex items-center gap-3">
              <span class="rounded bg-purple-500/20 px-2 py-0.5 text-xs font-medium text-purple-400">EVENT</span>
              <code class="text-sm text-neutral-300">message_created / message_updated / message_deleted</code>
            </div>
            <p class="text-sm text-neutral-500">Conversation message lifecycle events emitted to active session rooms.</p>
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
      <a href="#getting-started" class="text-sm text-neutral-500 transition hover:text-white">Back to top</a>
    </div>
  </div>
</div>
