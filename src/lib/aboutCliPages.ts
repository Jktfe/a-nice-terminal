export type AboutCliCapability = {
  name: string;
  detail: string;
};

export type AboutCliSource = {
  label: string;
  href: string;
};

export type AboutCliPage = {
  slug: string;
  sourcePage: string;
  fileName: string;
  name: string;
  shortName: string;
  badge: string;
  summary: string;
  character: {
    handle: string;
    title: string;
    opener: string;
    voice: string;
    command: string;
    artifact: string;
  };
  theme: {
    accent: string;
    accent2: string;
    bg: string;
    panel: string;
  };
  loop: string[];
  capabilities: AboutCliCapability[];
  goodFit: string[];
  boundaries: string[];
  signals: string[];
  sources: AboutCliSource[];
};

export const aboutCliPages: AboutCliPage[] = [
  {
    slug: 'claude-code',
    sourcePage: '/about-cli-originals/claude-code.html',
    fileName: 'ABOUT-CLAUDE-CODE',
    name: 'Claude Code',
    shortName: 'Claude',
    badge: 'Lifecycle hooks',
    summary:
      'A repository coding CLI with a deep lifecycle surface: prompts, tools, hooks, subagents, transcripts, and stop events can all become part of an observable engineering loop.',
    character: {
      handle: '@claudes-claude',
      title: "The operator's console",
      opener: 'I turn repository rules into a working control surface.',
      voice:
        'Warm, rigorous, and instrumented: Claude Code feels less like a chat box and more like a command desk with rails.',
      command: 'claude --hook SessionStart --hook PreToolUse --hook Stop',
      artifact: 'hook ledger / subagent fan-out / transcript-backed handoff'
    },
    theme: {
      accent: '#c05621',
      accent2: '#f97316',
      bg: '#21140f',
      panel: '#fff7ed'
    },
    loop: ['Prompt', 'Hook', 'Tool', 'Verify', 'Stop'],
    capabilities: [
      {
        name: 'Lifecycle hooks',
        detail:
          'Run shell commands, HTTP endpoints, or prompt hooks at defined points in a Claude Code session.'
      },
      {
        name: 'Deterministic guardrails',
        detail:
          'Use event context to format, test, log, block, or enrich work without hoping the model remembers.'
      },
      {
        name: 'Subagent work',
        detail:
          'Delegate focused slices when parallel investigation or review is useful.'
      }
    ],
    goodFit: [
      'Projects with repeatable checks before changes land.',
      'Multi-step edits with clear verification paths.',
      'Hook-backed status, policy, and handoff workflows.'
    ],
    boundaries: [
      'Hooks expose events and tool input/output, not private reasoning.',
      'A repository still needs tests, review, and policy.',
      'Automation should stay visible enough to debug.'
    ],
    signals: ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'],
    sources: [
      { label: 'Claude Code hooks reference', href: 'https://code.claude.com/docs/en/hooks' },
      { label: 'Claude Code CLI reference', href: 'https://code.claude.com/docs/en/cli-reference' }
    ]
  },
  {
    slug: 'codex-cli',
    sourcePage: '/about-cli-originals/codex-cli.html',
    fileName: 'ABOUT-CODEX-CLI',
    name: 'OpenAI Codex CLI',
    shortName: 'Codex',
    badge: 'Terminal coding agent',
    summary:
      'A local terminal coding agent for reading files, editing code, running commands, checking tests, and leaving a clear trail of what changed.',
    character: {
      handle: '@codexs-codex',
      title: 'The terminal pair programmer',
      opener: 'I read first, patch second, and prove the result in the shell.',
      voice:
        'Sparse, pragmatic, and repo-native: Codex belongs beside the diff, the test command, and the handoff note.',
      command: 'codex --cwd . --ask-for-approval on-request',
      artifact: 'audited diff / command transcript / verification receipt'
    },
    theme: {
      accent: '#0f766e',
      accent2: '#22c55e',
      bg: '#071a16',
      panel: '#ecfdf5'
    },
    loop: ['Read', 'Patch', 'Approve', 'Test', 'Handoff'],
    capabilities: [
      {
        name: 'Local coding loop',
        detail:
          'Work from the project directory, inspect files, make patches, and verify with local commands.'
      },
      {
        name: 'Sandbox and approval modes',
        detail:
          'Keep risky file, shell, or network actions explicit through permissions and sandbox choices.'
      },
      {
        name: 'Repository instructions',
        detail:
          'Use local guidance such as AGENTS.md and configuration files to shape behavior.'
      }
    ],
    goodFit: [
      'Bug fixes with reproducible commands.',
      'Refactors where expected behavior is clear.',
      'Diff review and test creation from inspected code.'
    ],
    boundaries: [
      'Do not use it as an unreviewed commit machine.',
      'Destructive cleanup still needs explicit scope and approval.',
      'Production claims need real verification.'
    ],
    signals: ['Files', 'Patch', 'Sandbox', 'Approval', 'Tests'],
    sources: [
      { label: 'OpenAI Codex GitHub repository', href: 'https://github.com/openai/codex' },
      { label: 'Codex CLI reference', href: 'https://developers.openai.com/codex/cli/reference' },
      {
        label: 'Codex approvals and security',
        href: 'https://developers.openai.com/codex/agent-approvals-security'
      }
    ]
  },
  {
    slug: 'antigravity',
    sourcePage: '/about-cli-originals/antigravity.html',
    fileName: 'ABOUT-ANTIGRAVITY',
    name: 'Google Antigravity',
    shortName: 'Antigravity',
    badge: 'Agentic command centre',
    summary:
      'Google Antigravity is the agent-first development platform and CLI lane for orchestrating agents across editor, terminal, browser, tasks, artifacts, hooks, skills, and plugins.',
    character: {
      handle: '@antigravitys-agy',
      title: 'The mission-control deck',
      opener: 'I launch agent work from idea to verified artifact.',
      voice:
        'Fast, luminous, and orchestration-first: Antigravity should feel like a flight deck for coding agents, not a generic Gemini page.',
      command: 'antigravity run --agent --artifacts --verify',
      artifact: 'plan / task list / screenshot / browser recording'
    },
    theme: {
      accent: '#2563eb',
      accent2: '#00a8c7',
      bg: '#0b1020',
      panel: '#eff6ff'
    },
    loop: ['Launch', 'Plan', 'Act', 'Artifact', 'Verify'],
    capabilities: [
      {
        name: 'Agent orchestration',
        detail:
          'Coordinate agent work across a command-centre style platform instead of treating the model as a single editor autocomplete.'
      },
      {
        name: 'Editor, terminal, and browser',
        detail:
          'Let agents work across development surfaces and return artifacts that show what happened.'
      },
      {
        name: 'Antigravity CLI continuity',
        detail:
          'The Antigravity CLI direction keeps critical Gemini CLI-style capabilities such as skills, hooks, subagents, and extensions/plugins.'
      }
    ],
    goodFit: [
      'Agent-managed feature work where planning, execution, and verification need to stay visible.',
      'Workflows that benefit from a manager view, artifacts, and multi-surface orchestration.',
      'Teams moving from Gemini CLI into the Antigravity CLI/platform lane.'
    ],
    boundaries: [
      'Do not call it just Gemini CLI; Antigravity is the product/lane.',
      'Not every Gemini CLI feature has one-to-one parity during transition.',
      'Agent autonomy still needs artifacts, review, and permission boundaries.'
    ],
    signals: ['Agents', 'Artifacts', 'Skills', 'Hooks', 'Plugins'],
    sources: [
      { label: 'Google Antigravity', href: 'https://antigravity.google/' },
      {
        label: 'Antigravity CLI overview',
        href: 'https://antigravity.google/docs/cli-overview'
      },
      {
        label: 'Transitioning Gemini CLI to Antigravity CLI',
        href: 'https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/'
      }
    ]
  },
  {
    slug: 'github-copilot-cli',
    sourcePage: '/about-cli-originals/github-copilot-cli.html',
    fileName: 'ABOUT-GITHUB-COPILOT-CLI',
    name: 'GitHub Copilot CLI',
    shortName: 'Copilot',
    badge: 'GitHub-native terminal agent',
    summary:
      'Copilot in the terminal, built around trusted directories, tool approval prompts, repository instructions, GitHub context, and resumable sessions.',
    character: {
      handle: '@copilots-copilot',
      title: 'The pull-request co-pilot',
      opener: 'I live where issues, branches, reviews, and terminal work meet.',
      voice:
        'Polished, GitHub-native, and review-aware: Copilot should feel like a PR cockpit with an approval switch in reach.',
      command: 'copilot --trusted-directory . --resume',
      artifact: 'issue context / patch proposal / PR-ready summary'
    },
    theme: {
      accent: '#0969da',
      accent2: '#8250df',
      bg: '#0d1117',
      panel: '#f6f8fa'
    },
    loop: ['Issue', 'Plan', 'Patch', 'Review', 'PR'],
    capabilities: [
      {
        name: 'Terminal chat and delegation',
        detail:
          'Ask questions or delegate coding tasks from a local repository session.'
      },
      {
        name: 'Trust and approval model',
        detail:
          'Confirm trusted folders and approve tools that may modify or execute files.'
      },
      {
        name: 'GitHub-aware workflow',
        detail:
          'Use issues, pull requests, custom instructions, skills, and resumable agent sessions.'
      }
    ],
    goodFit: [
      'GitHub issue and pull request work.',
      'Local bug fixing with approval checkpoints.',
      'Scheduled maintenance prompts and recurring checks.'
    ],
    boundaries: [
      'Do not run in folders you do not trust.',
      'Do not paste hidden credentials into prompts.',
      'Autonomy still needs repo checks and review gates.'
    ],
    signals: ['Trust', 'Prompt', 'Approve', 'Schedule', 'Resume'],
    sources: [
      {
        label: 'Using GitHub Copilot CLI',
        href: 'https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/overview'
      },
      { label: 'GitHub Copilot CLI product page', href: 'https://github.com/features/copilot/cli' }
    ]
  },
  {
    slug: 'qwen-code',
    sourcePage: '/about-cli-originals/qwen-code.html',
    fileName: 'ABOUT-QWEN-CODE',
    name: 'Qwen Code',
    shortName: 'Qwen',
    badge: 'Configurable coding CLI',
    summary:
      'An open source coding-agent CLI optimized for Qwen models, with settings layers, project files, hooks, skills, and MCP for external tools.',
    character: {
      handle: '@qwens-qwen',
      title: 'The configurable workshop',
      opener: 'I make the repo itself part of the agent setup.',
      voice:
        'Precise, bright, and configurable: Qwen Code should feel like a lab bench where settings, hooks, and skills are laid out in reach.',
      command: 'qwen --settings .qwen/settings.json --hooks on',
      artifact: 'settings stack / hook event / MCP tool bridge'
    },
    theme: {
      accent: '#0369a1',
      accent2: '#9333ea',
      bg: '#08111f',
      panel: '#f0f9ff'
    },
    loop: ['Settings', 'Skills', 'Prompt', 'Hooks', 'MCP'],
    capabilities: [
      {
        name: 'Configuration layers',
        detail:
          'Use system, user, project, environment, and command-line settings with documented precedence.'
      },
      {
        name: 'Hooks and skills',
        detail:
          'Run lifecycle scripts and package reusable instructions under project-local .qwen folders.'
      },
      {
        name: 'MCP tools',
        detail:
          'Connect to external data sources and tools without hand-pasting every dependency.'
      }
    ],
    goodFit: [
      'Large codebase reading and focused edits.',
      'Repo-specific agent behavior that should be versioned.',
      'Observable lifecycle events through hooks.'
    ],
    boundaries: [
      'Avoid undocumented private model-behavior claims.',
      'Committed settings should be reviewed like source code.',
      'Status claims need hooks, transcripts, or terminal evidence.'
    ],
    signals: ['settings.json', '.qwen', 'Hooks', 'Skills', 'MCP'],
    sources: [
      {
        label: 'Qwen Code configuration',
        href: 'https://qwenlm.github.io/qwen-code-docs/en/users/configuration/settings/'
      },
      { label: 'Qwen Code hooks', href: 'https://qwenlm.github.io/qwen-code-docs/en/users/features/hooks/' },
      { label: 'Qwen Code product page', href: 'https://qwen.ai/qwencode' }
    ]
  },
  {
    slug: 'pi-local',
    sourcePage: '/about-cli-originals/pi-local.html',
    fileName: 'ABOUT-PI-LOCAL',
    name: 'Pi local runtime',
    shortName: 'Pi',
    badge: 'Local runtime lane',
    summary:
      'A small-context local runtime pattern for ANT-friendly model work. It is a lane around local models and transcript adapters, not a single vendor CLI.',
    character: {
      handle: '@pis-pi',
      title: 'The local bench',
      opener: 'I keep small jobs close to the development environment and make their evidence portable.',
      voice:
        'Compact, practical, and grounded: Pi is the bench runtime for local models, narrow tasks, and transcript adapters.',
      command: 'ollama run gemma3 --keepalive 10m',
      artifact: 'local transcript / usage line / adapter event'
    },
    theme: {
      accent: '#9a5b00',
      accent2: '#f59e0b',
      bg: '#1b1308',
      panel: '#fff7ed'
    },
    loop: ['Small task', 'Local model', 'Transcript', 'Adapter', 'Verify'],
    capabilities: [
      {
        name: 'Local model execution',
        detail:
          'Run supported models in a developer-controlled environment through a local runtime such as Ollama.'
      },
      {
        name: 'Constrained work',
        detail:
          'Handle small, well-scoped tasks where short context and low ceremony are strengths.'
      },
      {
        name: 'Adapter-friendly evidence',
        detail:
          'Project transcripts, usage, and terminal events into the same evidence model as other CLIs.'
      }
    ],
    goodFit: [
      'Local checks, small patches, and fast triage.',
      'Offline-friendly experiments where the selected model really is local.',
      'Transcript-adapter development across heterogeneous CLIs.'
    ],
    boundaries: [
      'Do not claim all data stays local if the selected wrapper calls a remote service.',
      'Escalate broad repository work to a larger context lane.',
      'Safety-critical coding still needs separate review.'
    ],
    signals: ['Prompt', 'Local', 'JSONL', 'Usage', 'Verify'],
    sources: [
      { label: 'Ollama CLI reference', href: 'https://docs.ollama.com/cli' },
      { label: 'Gemma with Ollama', href: 'https://ai.google.dev/gemma/docs/integrations/ollama' }
    ]
  }
];

export function getAboutCliPage(slug: string): AboutCliPage | undefined {
  return aboutCliPages.find((page) => page.slug === slug);
}
