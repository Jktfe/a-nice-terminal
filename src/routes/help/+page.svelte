<script lang="ts">
  const sections = [
    {
      title: 'Sessions',
      color: '#6366F1',
      commands: [
        { cmd: 'ant sessions', desc: 'List all sessions' },
        { cmd: 'ant sessions create', desc: 'Create a new session', flags: '--name "My Session" --type terminal|chat' },
        { cmd: 'ant sessions archive <id>', desc: 'Archive a session' },
        { cmd: 'ant sessions delete <id>', desc: 'Delete a session' },
        { cmd: 'ant sessions export <id>', desc: 'Export session evidence', flags: '--target obsidian|open-slide|osaurus|all' },
      ],
    },
    {
      title: 'Terminal',
      color: '#22C55E',
      commands: [
        { cmd: 'ant terminal <id>', desc: 'Connect to a terminal session (interactive PTY)' },
        { cmd: 'ant terminal send <id>', desc: 'Send a command non-interactively', flags: '--cmd "ls -la"' },
      ],
    },
    {
      title: 'Chat',
      color: '#6366F1',
      commands: [
        { cmd: 'ant chat <id>', desc: 'Open a chat session (interactive)' },
        { cmd: 'ant chat send <id>', desc: 'Send a single message', flags: '--msg "hello"' },
        { cmd: 'ant chat read <id>', desc: 'Read message history', flags: '--limit 50' },
        { cmd: 'ant chat reply <id>', desc: 'Reply to the latest message', flags: '--msg "yes do it"' },
        { cmd: 'ant chat join <id>', desc: 'Join a real-time streaming chat (Ctrl+C to exit)' },
        { cmd: 'ant chat leave <id>', desc: 'Remove this terminal/agent from a chatroom', flags: '--session <id> or --handle @name' },
        { cmd: 'ant chat focus <id>', desc: 'Queue normal room messages for one agent', flags: '--handle @name --ttl 30m --reason "building"' },
        { cmd: 'ant chat unfocus <id>', desc: 'Exit focus mode and deliver one digest', flags: '--handle @name' },
        { cmd: 'ant chat participants <id>', desc: 'List all participants in a chat session' },
      ],
    },
    {
      title: 'Messages',
      color: '#26A69A',
      commands: [
        { cmd: 'ant msg <id> "text"', desc: 'Broadcast a message to all session participants' },
        { cmd: 'ant msg <id> @handle "text"', desc: 'Send a targeted message to one participant' },
        { cmd: 'ant msg <id> @everyone "text"', desc: 'Explicit broadcast to everyone' },
      ],
      note: 'Sender identity is resolved automatically from the tmux session or registered process tree.',
    },
    {
      title: 'Tasks',
      color: '#F59E0B',
      commands: [
        { cmd: 'ant task <id> list', desc: 'List all tasks in a session' },
        { cmd: 'ant task <id> create "title"', desc: 'Propose a new task', flags: '--desc "description"' },
        { cmd: 'ant task <id> accept <task-id>', desc: 'Accept a proposed task' },
        { cmd: 'ant task <id> assign <task-id> @handle', desc: 'Assign a task to a participant' },
        { cmd: 'ant task <id> review <task-id>', desc: 'Mark a task as ready for review' },
        { cmd: 'ant task <id> done <task-id>', desc: 'Mark a task as complete' },
        { cmd: 'ant task <id> delete <task-id>', desc: 'Delete a task' },
      ],
      note: 'Task IDs can be shortened to the first 8 characters shown in `task list`.',
    },
    {
      title: 'File References',
      color: '#EC4899',
      commands: [
        { cmd: 'ant flag <id> <file-path>', desc: 'Flag a file reference in a session', flags: '--note "why this matters"' },
        { cmd: 'ant flag <id> list', desc: 'List all flagged files in a session' },
        { cmd: 'ant flag <id> remove <ref-id>', desc: 'Remove a file reference' },
      ],
    },
    {
      title: 'Search & Share',
      color: '#42A5F5',
      commands: [
        { cmd: 'ant search <query>', desc: 'Full-text search across all sessions (FTS5)' },
        { cmd: 'ant share <id>', desc: 'Generate a read-only share link for a session' },
        { cmd: 'ant qr', desc: 'Show QR code to connect ANTios to this server' },
      ],
    },
    {
      title: 'Memory',
      color: '#818CF8',
      commands: [
        { cmd: 'ant memory get <key>', desc: 'Read one mempalace row by key' },
        { cmd: 'ant memory put <key> <value>', desc: 'Upsert one row using a stable key' },
        { cmd: 'ant memory list <prefix>', desc: 'List rows under a prefix', flags: 'tasks/ agents/ docs/' },
        { cmd: 'ant memory search <query>', desc: 'Search operational memory', flags: '--all to include archives' },
        { cmd: 'ant memory audit', desc: 'Report duplicate, oversize, and noisy rows' },
        { cmd: 'ant memory delete <key>', desc: 'Delete one row by key' },
      ],
      note: 'Operational memory excludes session archives by default so agents do not burn tokens on old transcripts.',
    },
    {
      title: 'Setup & Config',
      color: '#AB47BC',
      commands: [
        { cmd: 'ant hooks install', desc: 'Install ANT shell hooks into ~/.zshrc (enables command capture)' },
        { cmd: 'ant whoami', desc: 'Show the identity ANT will stamp on outbound chat' },
        { cmd: 'ant register', desc: 'Bind this shell parent process to a handle', flags: '--handle @name --ttl 12h' },
        { cmd: 'ant config', desc: 'Show current config (server URL, API key, handle)' },
        { cmd: 'ant config set', desc: 'Set connection details', flags: '--url https://... --key abc --handle @myhandle' },
      ],
    },
  ];

  const taskWorkflow = [
    { status: 'proposed', color: '#F59E0B', desc: 'Created with `task create`' },
    { status: 'accepted', color: '#26A69A', desc: '`task accept <id>`' },
    { status: 'assigned', color: '#6366F1', desc: '`task assign <id> @handle`' },
    { status: 'review',   color: '#F59E0B', desc: '`task review <id>`' },
    { status: 'complete', color: '#22C55E', desc: '`task done <id>`' },
  ];
</script>

<div class="min-h-screen overflow-y-auto" style="background: var(--bg); color: var(--text);">
  <!-- Header -->
  <div class="sticky top-0 z-10 border-b flex items-center gap-4 px-6 py-3"
       style="background: var(--bg-surface); border-color: var(--border-subtle);">
    <a href="/" class="text-sm transition-colors hover:text-white" style="color: var(--text-muted);">
      ← Sessions
    </a>
    <div class="w-px h-4" style="background: var(--border-light);"></div>
    <div class="flex items-center gap-2">
      <span class="font-mono text-xs px-2 py-0.5 rounded" style="background: rgba(99,102,241,0.15); color: #818CF8;">CLI</span>
      <span class="font-semibold text-sm">ANT Command Reference</span>
    </div>
    <div class="ml-auto">
      <code class="text-xs font-mono px-2 py-1 rounded" style="background: var(--bg-card); color: var(--text-muted);">ant --help</code>
    </div>
  </div>

  <div class="max-w-4xl mx-auto px-6 py-8 space-y-10">

    <!-- Intro -->
    <div class="rounded-xl border p-5" style="background: var(--bg-surface); border-color: var(--border-subtle);">
      <p class="text-sm leading-relaxed" style="color: var(--text-muted);">
        The <code class="font-mono text-xs px-1 py-px rounded" style="background: var(--bg-card); color: #818CF8;">ant</code> CLI
        runs on the same machine as the ANT server. When used <strong style="color: var(--text);">inside an ANT terminal session</strong>,
        sender identity is resolved automatically from the tmux session name — no config needed.
        Run <code class="font-mono text-xs px-1 py-px rounded" style="background: var(--bg-card); color: #818CF8;">ant whoami</code>
        before posting if the visible room handle looks wrong.
        Use <code class="font-mono text-xs px-1 py-px rounded" style="background: var(--bg-card); color: #818CF8;">ant config set --url https://host:6458 --key &lt;apikey&gt;</code> to connect remotely.
      </p>
    </div>

    <!-- Command sections -->
    {#each sections as section}
      <div>
        <div class="flex items-center gap-2 mb-3">
          <div class="w-1 h-5 rounded-full" style="background: {section.color};"></div>
          <h2 class="font-semibold text-sm uppercase tracking-wider" style="color: {section.color};">{section.title}</h2>
        </div>

        <div class="rounded-xl border overflow-hidden" style="border-color: var(--border-subtle);">
          {#each section.commands as item, i}
            <div class="flex gap-4 px-4 py-3 border-b last:border-b-0"
                 style="background: {i % 2 === 0 ? 'var(--bg-surface)' : 'var(--bg-card)'}; border-color: var(--border-subtle);">
              <div class="flex-shrink-0 w-72">
                <code class="text-xs font-mono" style="color: {section.color};">{item.cmd}</code>
                {#if item.flags}
                  <div class="mt-0.5">
                    <code class="text-[11px] font-mono" style="color: var(--text-faint);">{item.flags}</code>
                  </div>
                {/if}
              </div>
              <div class="text-sm" style="color: var(--text-muted);">{item.desc}</div>
            </div>
          {/each}
        </div>

        {#if section.note}
          <p class="mt-2 text-xs pl-3 italic" style="color: var(--text-faint);">{section.note}</p>
        {/if}
      </div>
    {/each}

    <!-- Task status workflow -->
    <div>
      <div class="flex items-center gap-2 mb-3">
        <div class="w-1 h-5 rounded-full" style="background: #F59E0B;"></div>
        <h2 class="font-semibold text-sm uppercase tracking-wider" style="color: #F59E0B;">Task Status Flow</h2>
      </div>
      <div class="rounded-xl border p-5 flex flex-wrap items-center gap-2" style="background: var(--bg-surface); border-color: var(--border-subtle);">
        {#each taskWorkflow as step, i}
          <div class="flex items-center gap-2">
            <div class="flex flex-col items-center gap-1">
              <span class="text-xs font-mono px-2 py-0.5 rounded-full font-semibold"
                    style="background: {step.color}22; color: {step.color}; border: 1px solid {step.color}44;">
                {step.status}
              </span>
              <span class="text-[10px]" style="color: var(--text-faint);">{step.desc}</span>
            </div>
            {#if i < taskWorkflow.length - 1}
              <span class="text-lg mb-4" style="color: var(--text-faint);">→</span>
            {/if}
          </div>
        {/each}
      </div>
    </div>

    <!-- Quick reference for AI sessions -->
    <div class="rounded-xl border p-5 space-y-3" style="background: var(--bg-surface); border-color: rgba(99,102,241,0.2);">
      <h2 class="font-semibold text-sm" style="color: #818CF8;">Quick Reference — Posting from an AI session</h2>
      <div class="space-y-2 font-mono text-xs" style="color: var(--text-muted);">
        <div class="p-2 rounded" style="background: var(--bg-card);">
          <span style="color: var(--text-faint);"># Send a message to a chat session (identity auto-detected)</span><br>
          <span style="color: #22C55E;">ant msg &lt;chat-session-id&gt; "I've finished the task"</span>
        </div>
        <div class="p-2 rounded" style="background: var(--bg-card);">
          <span style="color: var(--text-faint);"># Target another AI directly (injects notification into their PTY)</span><br>
          <span style="color: #22C55E;">ant msg &lt;chat-session-id&gt; @gemini "can you review this?"</span>
        </div>
        <div class="p-2 rounded" style="background: var(--bg-card);">
          <span style="color: var(--text-faint);"># Propose and complete a task</span><br>
          <span style="color: #22C55E;">ant task &lt;session-id&gt; create "Refactor auth module" --desc "Split into middleware + handler"</span><br>
          <span style="color: #22C55E;">ant task &lt;session-id&gt; done &lt;task-id&gt;</span>
        </div>
        <div class="p-2 rounded" style="background: var(--bg-card);">
          <span style="color: var(--text-faint);"># Flag a file you've changed</span><br>
          <span style="color: #22C55E;">ant flag &lt;session-id&gt; src/auth/middleware.ts --note "refactored — needs review"</span>
        </div>
      </div>
    </div>

    <div class="text-center text-xs pb-8" style="color: var(--text-faint);">
      ANT v3 · <code class="font-mono">ant --help</code> for full reference · <a href="/" class="underline" style="color: var(--text-faint);">← back to sessions</a>
    </div>

  </div>
</div>
