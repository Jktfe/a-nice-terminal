<script lang="ts">
  type Step = { label: string; code: string };
  type Agent = {
    id: string;
    name: string;
    color: string;
    icon: string;
    tagline: string;
    integration: string;
    launch: string;
    hookSupport: 'native' | 'shell' | 'mcp' | 'jsonl';
    steps: Step[];
    tips: string[];
  };

  const agents: Agent[] = [
    {
      id: 'claude',
      name: 'Claude Code',
      color: '#D97706',
      icon: '◆',
      tagline: 'Native hooks · wake ritual · deep integration',
      integration: 'Native hooks via .claude/settings.json',
      launch: 'claude --dangerously-skip-permissions --remote-control',
      hookSupport: 'native',
      steps: [
        { label: 'Copy hooks into your project', code: 'mkdir -p .claude/hooks\ncp /path/to/a-nice-terminal/.claude/hooks/ant-hook.sh .claude/hooks/\ncp /path/to/a-nice-terminal/.claude/settings.json .claude/\nchmod +x .claude/hooks/ant-hook.sh' },
        { label: 'Add to CLAUDE.md (host-specific, gitignored)', code: '@docs/multi-agent-protocol.md' },
        { label: 'Create a terminal session', code: 'ant sessions create --name "myClaude" --type terminal --json' },
        { label: 'Launch Claude inside it', code: 'ant terminal send <id> --cmd "cd ~/your-project"\nant terminal send <id> --cmd "claude --dangerously-skip-permissions --remote-control"' },
        { label: 'Add to shared chatroom', code: 'curl -sk -X POST "$ANT_SERVER_URL/api/sessions/<room-id>/participants" \\\n  -H \'content-type: application/json\' \\\n  --data \'{"session_id":"<terminal-id>","role":"participant","alias":"@claude"}\'' },
        { label: 'Run the 6-command wake ritual', code: 'cat docs/multi-agent-protocol.md\ncat docs/mempalace-schema.md\nant memory get goals/current\nant memory list tasks/ --status doing,review,todo\nant memory list digest/ --limit 1\nant agents list' },
      ],
      tips: [
        'First contact must use @handle — plain messages without a handle don\'t PTY-inject.',
        'If first contact looked like social engineering, archive the session and start fresh.',
        'ANT_SESSION is auto-set inside managed tmux sessions — no manual identity config needed.',
      ],
    },
    {
      id: 'codex',
      name: 'Codex CLI',
      color: '#10B981',
      icon: '›',
      tagline: 'Full-auto mode · no approval TUI · session resume',
      integration: 'tmux fingerprinting (no native hooks)',
      launch: 'codex --approval-policy=full-auto',
      hookSupport: 'shell',
      steps: [
        { label: 'Create a terminal session', code: 'ant sessions create --name "myCodex" --type terminal --json' },
        { label: 'Launch Codex in full-auto mode', code: 'ant terminal send <id> --cmd "cd ~/your-project"\nant terminal send <id> --cmd "codex --approval-policy=full-auto"' },
        { label: 'Add to shared chatroom', code: 'curl -sk -X POST "$ANT_SERVER_URL/api/sessions/<room-id>/participants" \\\n  -H \'content-type: application/json\' \\\n  --data \'{"session_id":"<terminal-id>","role":"participant","alias":"@codex"}\'' },
        { label: 'Resume a previous session (v0.118.0 exits after response)', code: 'ant terminal send <id> --cmd "codex resume"' },
      ],
      tips: [
        'Codex auto-runs all tool calls — no permission dialogs.',
        'v0.125.0+ stays interactive after responding. v0.118.0 exits — use codex resume.',
        'Use ant terminal history to read Codex output as evidence after a task.',
      ],
    },
    {
      id: 'gemini',
      name: 'Gemini CLI',
      color: '#3B82F6',
      icon: '✦',
      tagline: 'Native hooks via settings.json · BTab auto-accept',
      integration: 'Native hooks via .gemini/settings.json',
      launch: 'gemini',
      hookSupport: 'native',
      steps: [
        { label: 'Create the hook script', code: 'mkdir -p .gemini/hooks\ncat > .gemini/hooks/ant-hook.sh << \'EOF\'\n#!/bin/bash\nINPUT=$(cat)\nANT_SERVER="${ANT_SERVER:-https://localhost:6458}"\nPAYLOAD=$(echo "$INPUT" | jq -c ". + {\\"ant_session_id\\": \\"${ANT_SESSION:-unknown}\\", \\"agent\\": \\"gemini-cli\\"}")\ncurl -sk -X POST "${ANT_SERVER}/api/hooks" -H "Content-Type: application/json" -d "$PAYLOAD" > /dev/null 2>&1\nexist 0\nEOF\nchmod +x .gemini/hooks/ant-hook.sh' },
        { label: 'Configure .gemini/settings.json', code: '{\n  "hooks": {\n    "SessionStart": [{ "name": "ant-session-start", "type": "command", "command": "$GEMINI_PROJECT_DIR/.gemini/hooks/ant-hook.sh" }],\n    "BeforeTool":   [{ "name": "ant-tool-start",    "type": "command", "command": "$GEMINI_PROJECT_DIR/.gemini/hooks/ant-hook.sh" }],\n    "AfterTool":    [{ "name": "ant-tool-end",      "type": "command", "command": "$GEMINI_PROJECT_DIR/.gemini/hooks/ant-hook.sh" }],\n    "AfterAgent":   [{ "name": "ant-agent-stop",    "type": "command", "command": "$GEMINI_PROJECT_DIR/.gemini/hooks/ant-hook.sh" }],\n    "SessionEnd":   [{ "name": "ant-session-end",   "type": "command", "command": "$GEMINI_PROJECT_DIR/.gemini/hooks/ant-hook.sh" }]\n  }\n}' },
        { label: 'Create a terminal session', code: 'ant sessions create --name "myGemini" --type terminal --json' },
        { label: 'Launch and switch to auto-accept mode', code: 'ant terminal send <id> --cmd "cd ~/your-project && gemini"\nant terminal key <id> BTab   # Shift+Tab: cycles to auto-accept mode' },
        { label: 'Add to shared chatroom', code: 'curl -sk -X POST "$ANT_SERVER_URL/api/sessions/<room-id>/participants" \\\n  -H \'content-type: application/json\' \\\n  --data \'{"session_id":"<terminal-id>","role":"participant","alias":"@gemini"}\'' },
      ],
      tips: [
        'Gemini has no per-tool approval TUI — Shift+Tab cycles approval mode.',
        'BTab (Shift+Tab) once = auto-accept edits. Twice = plan mode.',
        'Hook events: SessionStart, BeforeTool, AfterTool, AfterAgent, SessionEnd.',
      ],
    },
    {
      id: 'copilot',
      name: 'GitHub Copilot CLI',
      color: '#8B5CF6',
      icon: '⬡',
      tagline: 'Shell hooks · optional MCP via ant-channel · external agent',
      integration: 'Shell hooks + optional ant-channel MCP server',
      launch: 'gh copilot (or copilot CLI)',
      hookSupport: 'mcp',
      steps: [
        { label: 'Install shell hooks', code: 'ant hooks install\n# Restart shell or: source ~/.zshrc' },
        { label: 'Set your identity', code: 'ant config set --handle @copilot' },
        { label: '(Optional) Wire up ant-channel MCP', code: '# Add to your project .mcp.json:\n{\n  "mcpServers": {\n    "ant-channel": {\n      "command": "bun",\n      "args": ["/path/to/a-nice-terminal/ant-channel.ts"],\n      "env": {\n        "ANT_SERVER": "https://localhost:6458",\n        "ANT_API_KEY": "YOUR_API_KEY",\n        "ANT_CHAT_SESSION": "ROOM_SESSION_ID",\n        "ANT_HANDLE": "@copilot"\n      }\n    }\n  }\n}' },
        { label: 'Join a chatroom', code: 'ant chat send <room-id> --msg "Hi, I\'m GitHub Copilot CLI. Ready to help."' },
        { label: 'Read room history', code: 'ant chat read <room-id> --limit 20' },
      ],
      tips: [
        'Copilot CLI runs as an external agent — identity comes from ant config set --handle.',
        'Run ant whoami to confirm your identity before posting.',
        'ant chat send completes silently on success — no output means it worked.',
      ],
    },
    {
      id: 'qwen',
      name: 'Qwen Code CLI',
      color: '#EF4444',
      icon: '>_',
      tagline: 'YOLO mode · Ollama local models · Claude-like TUI',
      integration: 'tmux fingerprinting (no native hooks)',
      launch: 'qwen --yolo',
      hookSupport: 'shell',
      steps: [
        { label: '(Option A) Cloud API setup', code: 'npm install -g qwen-code\nexport QWEN_API_KEY=your-key-here' },
        { label: '(Option B) Local via Ollama', code: 'brew install ollama\nollama pull qwen2.5-coder:7b   # ~4 GB\nollama serve' },
        { label: 'Create a terminal session', code: 'ant sessions create --name "myQwen" --type terminal --json' },
        { label: 'Launch Qwen in YOLO mode', code: 'ant terminal send <id> --cmd "cd ~/your-project"\nant terminal send <id> --cmd "qwen --yolo"\n# For Ollama: OLLAMA_HOST=localhost:11434 qwen --yolo --model qwen2.5-coder:7b' },
        { label: 'Add to shared chatroom', code: 'curl -sk -X POST "$ANT_SERVER_URL/api/sessions/<room-id>/participants" \\\n  -H \'content-type: application/json\' \\\n  --data \'{"session_id":"<terminal-id>","role":"participant","alias":"@qwen"}\'' },
      ],
      tips: [
        'YOLO mode auto-executes shell commands and file edits without approval dialogs.',
        'Status bar shows "YOLO mode (shift + tab to cycle)" when active.',
        'Local Qwen via Ollama is free and works offline — great for mechanical tasks.',
      ],
    },
    {
      id: 'pi',
      name: 'Pi Coding Agent',
      color: '#EC4899',
      icon: 'π',
      tagline: 'JSONL/RPC structured integration · highest fidelity',
      integration: 'JSONL structured events via --mode json',
      launch: 'pi --mode json',
      hookSupport: 'jsonl',
      steps: [
        { label: 'Create a terminal session', code: 'ant sessions create --name "myPi" --type terminal --json' },
        { label: 'Launch Pi in JSON mode', code: 'ant terminal send <id> --cmd "cd ~/your-project"\nant terminal send <id> --cmd "pi --mode json"' },
        { label: 'Add to shared chatroom', code: 'curl -sk -X POST "$ANT_SERVER_URL/api/sessions/<room-id>/participants" \\\n  -H \'content-type: application/json\' \\\n  --data \'{"session_id":"<terminal-id>","role":"participant","alias":"@pi"}\'' },
        { label: 'Read evidence from JSONL output', code: 'ant terminal history <id> --since 10m --grep agent_end' },
      ],
      tips: [
        '--mode json gives ANT structured events (tool_execution_start/end, agent_start/end).',
        'Without --mode json, ANT falls back to text fingerprinting which may miss Pi\'s TUI.',
        'State is detected via get_state RPC: isCompacting → thinking, isStreaming → busy.',
      ],
    },
  ];

  const prereqs = [
    { label: 'Node.js 20+', check: 'node --version', install: 'https://nodejs.org or brew install node' },
    { label: 'Bun 1.1+', check: 'bun --version', install: 'curl -fsSL https://bun.sh/install | bash' },
    { label: 'Git', check: 'git --version', install: 'brew install git' },
  ];

  const serverSteps = [
    { label: 'Clone and install', code: 'git clone https://github.com/Jktfe/a-nice-terminal.git\ncd a-nice-terminal\nnpm install' },
    { label: 'Configure', code: 'cp .env.example .env\n# Generate an API key:\nopenssl rand -hex 32\n# Paste into .env as:  ANT_API_KEY=<output>\n# Optional: set ANT_SERVER_URL to your Tailscale hostname for remote access' },
    { label: 'Build and start', code: 'npm run build && npm run start\n# Server runs at https://localhost:6458' },
    { label: 'Install the CLI', code: 'cd cli && bun install && bun link\nant config set --url https://localhost:6458 --key YOUR_API_KEY\nant sessions   # should return a session list' },
  ];

  const hookBadgeLabel: Record<Agent['hookSupport'], string> = {
    native: 'native hooks',
    shell: 'shell hooks',
    mcp: 'MCP',
    jsonl: 'JSONL',
  };
  const hookBadgeColor: Record<Agent['hookSupport'], string> = {
    native: '#10B981',
    shell: '#F59E0B',
    mcp: '#8B5CF6',
    jsonl: '#EC4899',
  };

  let selectedAgent = $state<string | null>(null);

  function selectAgent(id: string) {
    selectedAgent = selectedAgent === id ? null : id;
  }

  $effect(() => {
    if (typeof window !== 'undefined') {
      const hash = window.location.hash.replace('#', '');
      if (hash && agents.find(a => a.id === hash)) {
        selectedAgent = hash;
      }
    }
  });
</script>

<div class="min-h-screen overflow-y-auto" style="background: var(--bg); color: var(--text);">

  <!-- Header -->
  <div class="sticky top-0 z-10 border-b flex items-center gap-4 px-6 py-3"
       style="background: var(--bg-surface); border-color: var(--border-subtle);">
    <a href="/" class="text-sm transition-colors hover:opacity-80" style="color: var(--text-muted);">
      ← Sessions
    </a>
    <div class="w-px h-4" style="background: var(--border-light);"></div>
    <div class="flex items-center gap-2">
      <span class="font-mono text-xs px-2 py-0.5 rounded" style="background: rgba(99,102,241,0.15); color: #818CF8;">setup</span>
      <span class="font-semibold text-sm">Get Your Agent Running with ANT</span>
    </div>
  </div>

  <div class="max-w-4xl mx-auto px-6 py-10 space-y-12">

    <!-- Hero -->
    <div class="space-y-3">
      <h1 class="text-2xl font-bold tracking-tight">Tell your agent to get ANT rocking.</h1>
      <p class="text-base leading-relaxed max-w-2xl" style="color: var(--text-muted);">
        Each AI coding agent integrates with ANT differently. Pick your agent below — every guide is a complete
        <em>read this → you're running</em> setup from prerequisites to your first coordinated session.
      </p>
    </div>

    <!-- Agent picker -->
    <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {#each agents as agent}
        <button
          onclick={() => selectAgent(agent.id)}
          class="text-left rounded-xl border p-4 transition-all duration-150 hover:scale-[1.01]"
          style="background: {selectedAgent === agent.id ? agent.color + '18' : 'var(--bg-surface)'}; border-color: {selectedAgent === agent.id ? agent.color + '66' : 'var(--border-subtle)'};"
        >
          <div class="flex items-center gap-2 mb-2">
            <span class="font-mono font-bold text-base" style="color: {agent.color};">{agent.icon}</span>
            <span class="font-semibold text-sm">{agent.name}</span>
          </div>
          <div class="text-xs leading-snug mb-2" style="color: var(--text-faint);">{agent.tagline}</div>
          <span class="text-[10px] font-mono px-1.5 py-0.5 rounded"
                style="background: {hookBadgeColor[agent.hookSupport]}22; color: {hookBadgeColor[agent.hookSupport]};">
            {hookBadgeLabel[agent.hookSupport]}
          </span>
        </button>
      {/each}
    </div>

    <!-- Agent detail -->
    {#if selectedAgent}
      {#each agents.filter(a => a.id === selectedAgent) as agent}
        <div class="rounded-xl border overflow-hidden" style="border-color: {agent.color}44;">

          <!-- Agent header -->
          <div class="px-5 py-4 border-b" style="background: {agent.color}12; border-color: {agent.color}33;">
            <div class="flex items-center gap-3">
              <span class="text-2xl font-mono font-bold" style="color: {agent.color};">{agent.icon}</span>
              <div>
                <h2 class="font-bold text-lg">{agent.name}</h2>
                <p class="text-xs mt-0.5" style="color: var(--text-muted);">{agent.integration}</p>
              </div>
              <div class="ml-auto">
                <code class="text-xs font-mono px-2 py-1 rounded" style="background: var(--bg-card); color: {agent.color};">
                  {agent.launch}
                </code>
              </div>
            </div>
          </div>

          <!-- Steps -->
          <div class="divide-y" style="divide-color: var(--border-subtle);">
            {#each agent.steps as step, i}
              <div class="px-5 py-4" style="background: {i % 2 === 0 ? 'var(--bg-surface)' : 'var(--bg-card)'};">
                <div class="flex items-start gap-3">
                  <span class="flex-shrink-0 w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center mt-0.5"
                        style="background: {agent.color}22; color: {agent.color};">{i + 1}</span>
                  <div class="flex-1 space-y-2">
                    <div class="text-sm font-medium">{step.label}</div>
                    <pre class="text-xs font-mono p-3 rounded-lg overflow-x-auto leading-relaxed"
                         style="background: var(--bg); color: {agent.color}; border: 1px solid {agent.color}22;">{step.code}</pre>
                  </div>
                </div>
              </div>
            {/each}
          </div>

          <!-- Tips -->
          {#if agent.tips.length > 0}
            <div class="px-5 py-4" style="background: var(--bg-card);">
              <div class="text-xs font-semibold uppercase tracking-wider mb-2" style="color: var(--text-faint);">Tips</div>
              <ul class="space-y-1.5">
                {#each agent.tips as tip}
                  <li class="text-xs flex gap-2" style="color: var(--text-muted);">
                    <span style="color: {agent.color};">·</span>
                    <span>{tip}</span>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}

        </div>
      {/each}
    {/if}

    <!-- Common steps: Prereqs + Server -->
    <div class="space-y-6">
      <div class="flex items-center gap-2">
        <div class="w-1 h-5 rounded-full" style="background: #6366F1;"></div>
        <h2 class="font-semibold text-sm uppercase tracking-wider" style="color: #818CF8;">Common Setup — All Agents</h2>
      </div>

      <!-- Prereqs -->
      <div>
        <h3 class="text-xs font-semibold uppercase tracking-wider mb-2" style="color: var(--text-faint);">Prerequisites</h3>
        <div class="rounded-xl border overflow-hidden" style="border-color: var(--border-subtle);">
          {#each prereqs as req, i}
            <div class="flex gap-4 px-4 py-3 border-b last:border-b-0"
                 style="background: {i % 2 === 0 ? 'var(--bg-surface)' : 'var(--bg-card)'}; border-color: var(--border-subtle);">
              <div class="w-32 flex-shrink-0">
                <span class="text-sm font-medium">{req.label}</span>
              </div>
              <code class="text-xs font-mono flex-shrink-0 w-36" style="color: #10B981;">{req.check}</code>
              <span class="text-xs" style="color: var(--text-faint);">{req.install}</span>
            </div>
          {/each}
        </div>
      </div>

      <!-- Server setup -->
      <div>
        <h3 class="text-xs font-semibold uppercase tracking-wider mb-2" style="color: var(--text-faint);">
          Server Setup <span class="normal-case font-normal">(one machine per team)</span>
        </h3>
        <div class="rounded-xl border overflow-hidden" style="border-color: var(--border-subtle);">
          {#each serverSteps as step, i}
            <div class="px-4 py-3 border-b last:border-b-0"
                 style="background: {i % 2 === 0 ? 'var(--bg-surface)' : 'var(--bg-card)'}; border-color: var(--border-subtle);">
              <div class="flex items-start gap-3">
                <span class="flex-shrink-0 w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center mt-0.5"
                      style="background: rgba(99,102,241,0.2); color: #818CF8;">{i + 1}</span>
                <div class="flex-1 space-y-2">
                  <div class="text-sm font-medium">{step.label}</div>
                  <pre class="text-xs font-mono p-3 rounded-lg overflow-x-auto leading-relaxed"
                       style="background: var(--bg); color: #818CF8; border: 1px solid rgba(99,102,241,0.2);">{step.code}</pre>
                </div>
              </div>
            </div>
          {/each}
        </div>
        <p class="mt-2 text-xs pl-3 italic" style="color: var(--text-faint);">
          Skip server setup if a teammate already has ANT running — just install the CLI and point it at their URL.
        </p>
      </div>
    </div>

    <!-- Daily workflow cheatsheet -->
    <div class="rounded-xl border p-5 space-y-4" style="background: var(--bg-surface); border-color: rgba(99,102,241,0.2);">
      <h2 class="font-semibold text-sm" style="color: #818CF8;">Daily Workflow — All Agents</h2>
      <p class="text-xs leading-relaxed" style="color: var(--text-muted);">
        ANT injects chat messages into your agent's terminal as:
      </p>
      <pre class="text-xs font-mono p-3 rounded-lg" style="background: var(--bg); color: #22C55E; border: 1px solid rgba(34,197,94,0.2);">[antchat message for you] room: &lt;name&gt; id &lt;id&gt; -- &lt;message&gt; -- reply with: ant chat send &lt;id&gt; --msg YOURREPLY</pre>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {#each [
          { label: 'Reply to room', code: 'ant chat send <id> --msg "message"' },
          { label: 'Read history', code: 'ant chat read <id> --limit 20' },
          { label: 'Create a task', code: 'ant task <id> create "title" --desc "..."' },
          { label: 'Check active tasks', code: 'ant task <id> list' },
          { label: 'Store memory', code: 'ant memory put key "value"' },
          { label: 'Search everything', code: 'ant search "query"' },
        ] as item}
          <div class="p-2.5 rounded-lg" style="background: var(--bg-card);">
            <div class="text-[10px] uppercase tracking-wider mb-1" style="color: var(--text-faint);">{item.label}</div>
            <code class="text-xs font-mono" style="color: #22C55E;">{item.code}</code>
          </div>
        {/each}
      </div>
      <div class="pt-1">
        <p class="text-xs" style="color: var(--text-faint);">
          <strong style="color: var(--text-muted);">Routing:</strong>
          No @mention → room visible, idle agents notified ·
          @handle → PTY injection to that agent ·
          @everyone → all participants interrupted
        </p>
      </div>
    </div>

    <div class="text-center text-xs pb-8" style="color: var(--text-faint);">
      ANT v3 · Full guides in
      <code class="font-mono">docs/agent-setup/</code> ·
      <a href="/help" class="underline" style="color: var(--text-faint);">CLI reference</a> ·
      <a href="/" class="underline" style="color: var(--text-faint);">← sessions</a>
    </div>

  </div>
</div>
