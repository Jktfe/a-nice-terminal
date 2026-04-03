# ghostty-web Addon Compatibility Analysis for ANT

> Research conducted April 2026. Based on source-level analysis of ghostty-web v0.4.0 and ANT's xterm.js usage.

## Project Maturity

- **GitHub**: ~1.9k stars, 71 forks, 113 commits total
- **NPM**: v0.4.0 (Dec 2025); ~189k jsDelivr downloads/month
- **Contributors**: Primarily one developer (Jon Ayers, 87/113 commits) + Kyle Carberry from Coder
- **Self-described**: **"Proof of concept"** — Kyle Carberry on HN: "We spent little time on performance so far, this is more of a POC that will hopefully become a drop-in replacement for xterm.js over time."

## Addon-by-Addon Compatibility

| ANT Addon | ghostty-web Status | Impact |
|---|---|---|
| `@xterm/addon-fit` | **Built-in equivalent** — ships `FitAddon` at `ghostty-web/addons/fit`. Same API. | No issue |
| `@xterm/addon-webgl` | **Not needed** — renders via 2D Canvas. Dirty-row optimization at 60fps. Eliminates WebGL context limits. | Actually a win |
| `@xterm/addon-unicode11` | **Built-in (superior)** — WASM core uses Unicode 15.1 via Ghostty's native implementation. | No issue |
| `@xterm/addon-web-links` | **Built-in equivalent** — ships `OSC8LinkProvider` + `UrlRegexProvider`. Uses `registerLinkProvider()`. | No issue |
| `@xterm/addon-serialize` | **NOT AVAILABLE — BLOCKER** | See below |
| `@xterm/headless` | **NOT AVAILABLE — BLOCKER** | See below |

## Critical Blockers

### 1. No Serialize Addon

No `serialize()` method exists anywhere in ghostty-web. No GitHub issue tracks this.

**ANT dependency**: `HeadlessTerminalWrapper` uses `SerializeAddon` to capture full terminal state (scrollback + screen + cursor + ANSI attributes) for client restore and the `ant screen` API.

**Workaround**: The Buffer API (`getLine()`, `translateToString()`) exists for plain text extraction, but this loses colors, cursor position, and SGR attributes. A true replacement would need to reconstruct ANSI escape sequences from cell attributes — substantial work.

### 2. No Headless Mode

ghostty-web's `Terminal` class requires `open(HTMLElement)` and creates Canvas + textarea in the DOM. There is no headless API.

**ANT dependency**: `HeadlessTerminalWrapper` runs `@xterm/headless` server-side (Node.js) to maintain terminal state without rendering. Used by: pty-manager.ts, terminal-monitor.ts, agent routes, chairman routes, session state API.

**Theoretical path**: The low-level `GhosttyTerminal` WASM wrapper does support `write()`, viewport access, and cursor queries without a canvas. Someone could build a headless wrapper around the WASM layer, but this would require:
- New headless terminal class
- Custom serializer (GhosttyCell attributes → ANSI sequences)
- Verified Node.js WASM compatibility (no DOM polyfills)

This does not exist today and would be substantial engineering.

### 3. No Parser Hooks

No `parser` property, no `registerOscHandler()`, `registerCsiHandler()`, `registerDcsHandler()`, or equivalent. The VT parser is compiled into WASM and is not extensible from JavaScript.

**ANT dependency**: Registers custom OSC handlers for sequences 7 (CWD), 133 (shell integration), and 1337 (iTerm2 extensions).

**Workaround**: Intercept raw PTY data stream *before* it reaches ghostty-web, parse OSC sequences in JavaScript, then forward data to the terminal. Doable but adds a processing layer.

## Known Issues (from GitHub)

- WASM memory corruption with multi-codepoint grapheme clusters (issue #141)
- Scrollback bugs: `scrollbackLimit` interpreted as bytes not lines
- Open issue count: 22

## Revised Recommendation

The original synthesis said ghostty-web was a "drop-in replacement" — **this is incorrect**. The reality:

### What Works (browser rendering only)
- Terminal rendering in TerminalViewV2.tsx could use ghostty-web
- FitAddon, Unicode, WebLinks all have equivalents
- Better VT compliance for display purposes
- No WebGL context limit issues

### What Doesn't Work
- Server-side headless terminal (critical for ANT)
- Terminal state serialization (critical for session restore)
- Custom OSC parser hooks (important for shell integration)

### Recommended Approach: Split Architecture

```
Browser (TerminalViewV2.tsx):
  Current: xterm.js + WebGL + Fit + Unicode + WebLinks + Serialize
  Option:  ghostty-web (when stable) — rendering only

Server (headless-terminal.ts):
  Keep:    @xterm/headless + @xterm/addon-serialize + @xterm/addon-unicode11
  Reason:  No ghostty-web equivalent exists
```

This captures the VT compliance benefits for rendering while keeping the proven headless stack for server-side state. The split introduces mild complexity (two terminal libraries) but avoids the blockers entirely.

### When to Revisit

Monitor these developments:
- ghostty-web adding a headless/Node.js mode
- ghostty-web exposing parser hooks or an OSC handler API
- libghostty sub-libraries maturing beyond the VT parser
- xterm.js potentially adopting libghostty (issue #5686)

**Bottom line**: ghostty-web is promising for browser rendering but not ready to replace ANT's full xterm.js stack. Use it for the frontend only, if at all, and only after it moves past "proof of concept" status.
