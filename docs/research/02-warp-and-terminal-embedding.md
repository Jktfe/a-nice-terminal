# Research: Warp Terminal & Embeddable Terminal Components

## Executive Summary

Warp is a product, not a platform. It cannot be embedded, has no SDK, no API, no headless mode. For a terminal platform that needs embeddability and full control, the answer is to build on embeddable components (libghostty, alacritty_terminal, xterm.js) and implement the block model and AI layers on top.

## 1. Warp Architecture

### Core Technology
- Written in **Rust** with custom GPU-accelerated rendering (Metal on macOS, Vulkan/OpenGL for Linux)
- The rendering pipeline treats terminal output as structured **blocks**, not a continuous scroll buffer
- Each block = one command invocation + its output, as a first-class selectable/copyable/collapsible object

### The Block Model
- Every command prompt + input + output is grouped into a discrete block
- Blocks are first-class objects: select, copy output, collapse, share, bookmark
- Detection uses **shell integration** — injects shell hooks (precmd/preexec) that emit OSC sequences marking command boundaries
- Without shell integration, falls back to heuristics (block model degrades)
- The prompt detection relies on these markers — fundamentally a cooperation between shell and terminal emulator

### Command Boundary Detection
- Uses `precmd` and `preexec` hooks in the shell
- Emits proprietary OSC escape sequences
- Rust parser consumes sequences and segments terminal buffer into blocks
- Each block gets a separate internal grid for prompt + input + output

### AI Agent System
- Uses multiple LLM providers (OpenAI/Anthropic)
- Agent mode: executes multi-step tasks, observes output, decides next steps, iterates
- AI has access to block context: output of previous commands, CWD, shell environment, error messages
- Local ML classifier detects natural language vs shell commands (fully local, no network)
- Agent Management Panel shows status: running, waiting for input, idle, stopped

## 2. Warp Integration Surface — The Hard Truth

### Can You Embed Warp? **No.**
- No `warp-core` library
- No embedding API
- No programmatic control API (no REST, gRPC, Unix socket, IPC)
- No headless mode
- Cannot be used as a backend for a web UI
- No session state/history exposed via API
- AI interactions not accessible externally

### What Exists
- **Warp CLI (`warp-cli`)**: Limited to launching Warp, opening directories. Not a control plane.
- **Warp Workflows**: Shareable parameterized YAML templates. Not programmatic.
- **Warp Drive**: Cloud-synced workflows. Product feature, not integration surface.
- **Shell integration hooks**: Undocumented, internal OSC sequences.

### Warp Agent Mode — Also Not Accessible
- Cannot trigger agent programmatically from outside Warp
- Cannot feed goals via API
- Cannot subscribe to agent actions/results
- Cannot pipe commands through the agent
- It's a UI-driven feature, not a service

## 3. Warp Limitations

| Concern | Status |
|---------|--------|
| Open source | **No.** Proprietary, closed-source core. Some peripheral repos open (themes, completions) |
| Self-hosting | **No.** AI features depend on Warp's cloud. Cannot point at own LLM |
| Account required | Yes — requires login (controversial for a terminal) |
| tmux integration | Blocks degrade inside tmux |
| Platform support | macOS (primary), Linux (available), Windows (available), Web (hosted SaaS only) |
| Pricing | Free individual, paid Team/Enterprise |

### Business Model & Viability
- Raised ~$73M+ VC funding
- SaaS recurring revenue from teams/enterprises
- Terminal market is notoriously hard to monetize
- AI features are a cost center (LLM API calls) creating margin pressure
- Lock-in risk: if Warp pivots/shuts down, migration is non-trivial

## 4. Embeddable Terminal Components

### libghostty (Zig, MIT License) — Most Promising
- Created by Mitchell Hashimoto (HashiCorp co-founder)
- **Purpose-built for embedding** — C ABI library
- Handles terminal emulation, grid state, and rendering instructions
- Host application provides the rendering surface
- Full VT spec compliance, extreme performance focus
- Platform-native UI toolkits (AppKit on macOS, GTK on Linux)
- ~25k+ GitHub stars within months of open-sourcing (Dec 2024)
- **Best choice for native embedding**

### alacritty_terminal (Rust, MIT License)
- Separated terminal emulation logic as a reusable Rust crate
- Handles PTY, parsing, and terminal grid state **without any rendering**
- Can be used as a backend with custom rendering (including WebGL/WASM)
- Very high performance
- No block model, no AI — build on top
- ~57k stars for Alacritty overall
- **Best choice for Rust-based projects**

### WezTerm (Rust, GPL License)
- Has a **multiplexer/server mode** that can run headless
- Supports remote multiplexing over SSH
- Lua-based configuration/scripting system for programmatic control
- Terminal emulation not published as standalone embeddable crate
- **GPL license is a significant consideration**
- **Best choice if you need headless multiplexing**

### Kitty (C + Python, GPL License)
- **Remote control protocol**: send commands over Unix socket or pipe
- Run commands, get terminal content, set titles, etc.
- Most mature programmatic control interface of any GPU terminal
- `kitten` plugin system for extensibility
- Core not designed for embedding as library
- GPL licensed

### xterm.js (TypeScript, MIT License) — Web Standard
- De facto standard for web-based terminals
- Used by VS Code, GitHub Codespaces, Gitpod, Google Cloud Shell, Railway, etc.
- ~17.5k stars, actively maintained by Microsoft + Sourcegraph
- Three renderers: DOM, Canvas, WebGL (GPU-accelerated)
- Full VT100/VT220/xterm emulation, Unicode, ligatures, Sixel images
- Rich addon ecosystem
- **No serious competitor in web terminal emulation**
- **The only viable choice for web-based terminals**

## 5. Warp vs Building Custom — The Tradeoff

### What Warp Gives You (Months to Replicate)
1. **Block model with shell integration**: 2-4 months to replicate well (edge cases with nested shells, SSH, tmux)
2. **GPU-accelerated terminal rendering**: Free via alacritty_terminal or libghostty (native) or xterm.js WebGL (web)
3. **AI integration with terminal context**: 1-2 months to plumb LLM + output context
4. **Completions engine**: 2-3 months for comparable system
5. **Polished input editor**: Significant effort (multi-line editing, syntax highlighting, cursor movement like text editor)

### What Warp Locks You Out Of
1. Customization of core behavior (no plugins, extensions, custom rendering)
2. Data sovereignty (AI through Warp's cloud)
3. Embedding in your product
4. White-labeling
5. Platform flexibility (bound to Warp's roadmap)
6. Architecture decisions (block model is opinionated, can't change it)
7. Offline/airgapped environments
8. Pricing control

## 6. Open-Source Block-Based Alternatives

### Existing Block Detection Implementations
- **iTerm2 Shell Integration**: OSC 133 command boundary detection. macOS only, not embeddable.
- **VS Code Terminal**: Shell integration detecting command boundaries (OSC 633). TypeScript in VS Code codebase.
- **Wave Terminal**: Open source (Apache 2.0), block-inspired model. Electron + Go backend. ~5-10k stars.
- **Nushell**: Structured shell where output is typed data (tables, records). Fundamentally different — shell understands command boundaries natively.
- **Zellij**: Rust terminal multiplexer with WASM plugin system. Someone could build AI/blocks as a plugin.

### DIY Block Detection Requirements
1. Shell integration scripts (precmd/preexec hooks) emitting OSC markers — few hundred lines per shell
2. Terminal parser recognizing markers and segmenting buffer — moderate effort
3. Rendering layer treating blocks as first-class objects — the hard part (edge cases with interleaved output, long-running processes, interactive programs like vim)

## 7. Verdict

**Do not integrate Warp.** It offers zero integration surface.

**Build on:**
- **xterm.js** (WebGL addon) for web rendering — unchallenged
- **Shell integration** (OSC 133/633) for block model — well-established pattern
- **alacritty_terminal** or **libghostty** if native components are ever needed
- **Wave Terminal** is worth studying as an open-source reference implementation

The block model + shell integration is 2-4 months of focused work but gives you complete control over the experience, which is essential for a platform play.

## Sources
- [Ghostty](https://ghostty.org/) — libghostty embedding
- [Alacritty](https://github.com/alacritty/alacritty) — alacritty_terminal crate
- [WezTerm](https://wezfurlong.org/wezterm/) — multiplexer mode
- [Kitty Remote Control](https://sw.kovidgoyal.net/kitty/remote-control/)
- [xterm.js](https://xtermjs.org/) — web terminal standard
- [Wave Terminal](https://www.waveterm.dev/) — open-source block terminal
- [Zellij](https://zellij.dev/) — WASM plugin system
- [Nushell](https://www.nushell.sh/) — structured shell
