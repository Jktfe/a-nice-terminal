# Research: CLI Architecture, IPC Protocols & Direct Integration

## Executive Summary

The recommended architecture is a three-layer system: (1) terminal multiplexer in Rust/Go for PTY management, (2) agent orchestrator in TypeScript using Claude Agent SDK as a library, (3) swappable CLI/web UI. Communication via JSON-RPC over Unix domain sockets. MCP's stdio transport is unsuitable for high-frequency terminal I/O and should be replaced with a purpose-built protocol.

## 1. CLI Framework Landscape (2025-2026)

### Node.js/TypeScript

| Framework | Stars | Best For | Key Strength |
|-----------|-------|----------|-------------|
| **oclif** (Salesforce) | High | Large enterprise CLIs | Plugin architecture, auto-generated help, testing framework |
| **commander.js** | Highest downloads | Medium-complexity | Minimal, stable, well-documented |
| **yargs** | High | Rich argument parsing | Coercion, middleware |
| **citty** (UnJS) | Growing | TypeScript-first | Lightweight, clean subcommands |
| **Ink** (React for CLI) | ~5k | Rich TUI output | React components for CLI UI. Powers parts of Shopify CLI |
| **@clack/prompts** | Growing | Interactive prompts | Beautiful prompts. Used by SvelteKit CLI |

### Polyglot: Rust/Go Shell + Node Business Logic

**Go with Charm ecosystem (bubbletea + lipgloss + bubbles + huh):**
- bubbletea is arguably the best TUI framework in any language
- Powers `gh` CLI, `lazygit`, `glow`
- Sub-50ms startup (vs 200-500ms for Node)
- The Charm ecosystem is why most "smooth feeling" modern CLIs look gorgeous

**Rust with clap + ratatui:**
- clap is the standard Rust CLI parser
- ratatui (successor to tui-rs) for TUI
- Pattern: Rust frontend for instant startup + smooth rendering, Node/TypeScript backend via IPC

**Pragmatic middle ground:**
- Write CLI entry point in TypeScript (fast enough for most uses)
- Use Bun instead of Node for ~60-80ms startup (vs ~300ms Node)
- Reserve Rust/Go for performance-critical subprocesses or TUI rendering

### What Makes the Best CLIs Great

**`gh` (GitHub CLI):** Every interactive prompt has a flag equivalent. Aliases. Extensions. JSON output with `--json` and jq expressions. Go + cobra + bubbletea.

**`vercel`:** Near-zero-config. Intelligent defaults. Beautiful output. Fast.

**`railway`:** Smoothest onboarding of any CLI. Interactive project selection, environment linking. Feels like a GUI.

**Common patterns:** Excellent error messages, meaningful use of color, fast startup, respects `NO_COLOR` and `CI` env vars, pipe-friendly.

## 2. Why MCP's stdio Transport Falls Short

| Problem | Impact |
|---------|--------|
| **Process lifecycle coupling** | MCP server dies when client dies. Bad for persistent terminal sessions |
| **Serialization overhead** | JSON-RPC over stdin/stdout too heavy for high-frequency terminal I/O |
| **Single-channel limitation** | One input + one output stream. No natural out-of-band signals (Ctrl+C, window resize) |
| **Startup cost** | Each invocation spins up new process. No natural state persistence |
| **Discovery ceremony** | Explicit configuration in config files. Unnecessary for tightly integrated CLI |
| **No streaming primitives** | No built-in concept of bidirectional byte stream — which is what terminal I/O fundamentally is |

## 3. IPC Alternatives

### Comparison Matrix

| Transport | Latency | Streaming | Bidirectional | Complexity | Platform |
|-----------|---------|-----------|---------------|------------|----------|
| **Unix domain sockets** | Near-zero | Yes | Yes | Low | Linux/macOS |
| Named pipes | Low | Unidirectional | Need two | Low | Cross-platform |
| HTTP/REST localhost | Medium | SSE/long-poll | Not natural | Low | Universal |
| **WebSocket localhost** | Low | Yes | Yes | Medium | Universal |
| gRPC over Unix socket | Low | Yes | Yes | High | Universal |
| **JSON-RPC over Unix socket** | Near-zero | With notifications | Yes | Low | Linux/macOS |

### Recommended: JSON-RPC 2.0 over Unix Domain Sockets

This is the sweet spot:
- Same protocol LSP uses (Language Server Protocol)
- Structured request-response plus notifications
- Fast local transport (near-zero overhead)
- Simple to implement, libraries in every language
- VS Code uses this pattern internally

**For terminal byte streams**: Use a separate binary channel on the same socket, or a second socket per session. Length-prefixed binary frames for raw PTY data alongside JSON-RPC for control messages.

### Protocol Design

**Two channels per session:**
1. **Control channel** (JSON-RPC): session lifecycle, command execution requests, state queries, AI interactions
2. **Data channel** (binary frames): raw PTY input/output bytes, resize events

```
Control: {"jsonrpc":"2.0","method":"session.create","params":{"shell":"zsh"},"id":1}
Control: {"jsonrpc":"2.0","method":"session.input","params":{"sid":"abc","data":"ls\n"},"id":2}
Data:    [4-byte length][raw PTY bytes]
```

## 4. How Claude Code Communicates

- **Direct API calls**: HTTPS to Anthropic API for model inference
- **Subprocess spawning**: Bash, Read, Write tools execute as child processes
- **Hooks system**: External processes notified of events via shell commands or HTTP POST
  - Hooks receive JSON on stdin, return JSON on stdout
  - Exit code protocol: 0 = success, 2 = block action
  - Four handler types: command, http, prompt, agent
- **Claude Agent SDK**: Programmatic interface — function calls, event emitters, async iterators

## 5. How VS Code Communicates (Instructive)

VS Code uses **DIFFERENT protocols for different needs**:

| Component | Protocol | Why |
|-----------|----------|-----|
| Extension Host | Custom binary IPC | JSON was too slow for high-frequency messages |
| Terminal | Raw bytes over PTY fds | Terminal I/O is fundamentally binary |
| Language Servers | JSON-RPC (LSP) over stdio/TCP | Structured, standardized |
| Debug Adapters | JSON-RPC (DAP) | Structured, standardized |

**Key insight**: A monolithic protocol for everything is the wrong approach. Use the right protocol for each communication need.

## 6. Claude Code Hooks as Integration Path

Rather than MCP, use Claude Code's hooks for integration:

```json
{
  "hooks": {
    "PreToolUse": [{
      "hooks": [{ "type": "http", "url": "http://localhost:3000/api/hooks/pre-tool", "timeout": 300 }]
    }],
    "PostToolUse": [{
      "hooks": [{ "type": "http", "url": "http://localhost:3000/api/hooks/post-tool", "timeout": 300 }]
    }],
    "Notification": [{
      "hooks": [{ "type": "http", "url": "http://localhost:3000/api/hooks/notification", "timeout": 300 }]
    }]
  }
}
```

Benefits:
- Intercept tool calls and route Bash commands to your managed terminals
- Capture output and feed to your UI
- Display agent status in your terminal chrome
- Approve/deny permissions via your own UI

Limitation: Hooks are per-event (spawn process or HTTP call per event). A persistent daemon that hooks communicate with via Unix socket mitigates latency.

## 7. Event-Driven Architecture (Preferred)

For terminal control, event-driven is clearly superior to request-response:
- Terminal output is a stream of events (bytes arriving asynchronously)
- User input is event-driven (keystrokes)
- AI agent actions are asynchronous (variable inference time)
- Request-response creates artificial sync points that make UI laggy

**Ideal**: Event bus where terminal, AI agent, and CLI UI are all producers and consumers. Each component processes events at its own pace. This is how modern terminal emulators (Alacritty, Kitty, WezTerm) work internally.

## 8. Direct Integration: Claude Agent SDK

### Using Claude Code as a Library (Best Approach)

```typescript
import { query } from '@anthropic-ai/claude-code';

const result = await query({
  prompt: "Fix the failing tests",
  options: {
    allowedTools: ["Bash", "Read", "Write", "Edit"],
    cwd: "/path/to/project",
    // Custom system prompt, tool configs, etc.
  }
});

// Streaming via async iterators
for await (const event of result) {
  if (event.type === 'text') renderText(event.text);
  if (event.type === 'tool_use') handleToolCall(event);
  if (event.type === 'tool_result') handleToolResult(event);
}
```

This gives you:
- Full tool use (Bash, file ops, etc.) without subprocess wrapping
- Streaming via async iterators — events as they happen
- Configuration of allowed/disallowed tools
- Custom system prompts
- Ability to provide custom tool implementations
- Session/conversation management
- AbortController for cancellation
- Fine-grained control over what the agent can do
- Intercept tool calls/results to feed into your own UI

### Using Anthropic API Directly

Skip Claude Code entirely and define your own tools:
- Define tools for terminal operations (run command, read file, write file)
- Manage conversation loop yourself
- Full control over everything
- Downside: re-implement permission management, context window management, error recovery

### What Makes Smooth Tools Smooth vs Clunky

**Smooth:**
1. Instant startup (sub-100ms). Rust/Go wins.
2. Streaming responses (characters appear as generated)
3. Minimal chrome (whitespace and color, not boxes and borders)
4. Keyboard-first (vim bindings as option)
5. Context awareness (knows CWD, recent history, project type)
6. Graceful degradation (works in dumb terminals, SSH, tmux, CI)
7. Composability (pipe-friendly, `--json`, scriptable)
8. State persistence (conversations survive across sessions)

**Clunky:**
1. Slow startup (Python loading heavy ML libraries, Node with massive deps)
2. No streaming (10-second wall of text)
3. Over-designed TUI (full-screen takeover, boxes within boxes, ASCII logos)
4. Poor errors (cryptic tracebacks instead of helpful messages)
5. Context amnesia (every interaction starts fresh)
6. Fighting the terminal (breaks in pipes, fails in tmux, mangles Unicode)

## 9. The Three-Layer Architecture (Recommended)

### Layer 1 — Terminal Multiplexer (Rust or Go)
- Manages PTY sessions (via `portable-pty` in Rust or `creack/pty` in Go)
- Handles terminal I/O at byte level
- Exposes sessions via Unix domain socket IPC
- Captures and indexes terminal output for AI context
- **Hot path**: All terminal I/O goes through this layer

### Layer 2 — Agent Orchestrator (TypeScript/Node)
- Imports Claude Agent SDK directly (not subprocess)
- Connects to Layer 1 via Unix socket for terminal operations
- Manages conversation state, context windows, memory
- Implements custom tools that operate on Layer 1's terminal sessions
- Hooks into Claude Code's tool system so AI can "see" terminal output and "type" commands

### Layer 3 — UI (Swappable)
- **CLI**: TypeScript with Ink, or Go with bubbletea
- **Web**: React + xterm.js (current ANT approach)
- **Desktop**: Electron/Tauri wrapping web UI
- Renders AI responses streaming inline
- Presents terminal output from managed sessions
- Handles user input (commands to AI, direct terminal input, meta-commands)
- Communicates with Layer 2 via function calls (same process) or Unix socket (separate process)

### IPC Between Layers
- JSON-RPC 2.0 over Unix domain sockets for control
- Binary framing (length-prefixed) for terminal byte streams
- Two channels on same socket, or two sockets per session
- Structured enough to debug, lightweight enough for high frequency

### Why This Works
- Layer 1 in Rust/Go handles the hot path (terminal I/O) with minimal latency
- Layer 2 in TypeScript leverages Claude SDK directly — no subprocess wrapping
- Layer 3 is swappable (CLI today, web tomorrow, desktop later)
- No MCP needed — layers communicate via purpose-built protocol
- AI agent sees terminal output as context, issues commands as tool calls
- Event-driven throughout — no artificial synchronization points

## 10. The "CLI IS the Terminal" vs "CLI runs IN a Terminal" Question

| Approach | Examples | Investment | Flexibility |
|----------|----------|-----------|-------------|
| CLI IS the terminal | Warp | Years, tens of millions | Full control, must reimplement everything |
| CLI runs IN a terminal | Claude Code, aider | Weeks to months | Works anywhere, limited by terminal capabilities |
| CLI controls terminals | tmux/screen, ANT | Months | Manages sessions, adds complexity layer |

**The emerging winner**: "Runs IN a terminal" enhanced with ANSI escape codes for rich output. Claude Code proved this works. The three-layer architecture lets you keep this simplicity while adding the control-plane benefits of "controls terminals."

## Sources
- [Claude Agent SDK](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/sdk)
- [Claude Code Hooks](https://code.claude.com/docs/en/hooks)
- [oclif](https://oclif.io/)
- [Charm (bubbletea)](https://charm.sh/)
- [Ink (React for CLI)](https://github.com/vadim-demedes/ink)
- [clack/prompts](https://github.com/natemoo-re/clack)
- [VS Code Architecture](https://code.visualstudio.com/api/advanced-topics/extension-host)
- [JSON-RPC 2.0 Spec](https://www.jsonrpc.org/specification)
- [LSP Specification](https://microsoft.github.io/language-server-protocol/)
