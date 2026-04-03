# Warp API Capabilities: Corrected Research

> Follow-up research conducted April 2026 to correct overly narrow assessment in original synthesis.

## Previous Assessment (Incorrect)

> "No terminal control API — only cloud agent orchestration (Oz API)"

**This was too narrow.** Warp has more integration surface than initially reported.

## What Warp Actually Has

### 1. Oz REST API (Cloud Agent Orchestration)

- **Base URL**: `https://app.warp.dev/api/v1/`
- **Auth**: Bearer token via `WARP_API_KEY`
- **Core endpoints**:
  - `POST /agent/runs` — Start a cloud agent run with a prompt
  - `GET /agent/runs` — List runs with filtering/pagination
  - `GET /agent/runs/{runId}` — Get run details, state, transcript
  - `POST /agent/runs/{runId}/cancel` — Cancel a run
  - `POST /agent/schedules` — CRUD for scheduled/recurring runs
  - `GET /agent/artifacts/{uid}` — Download artifacts (PRs, screenshots, plans)
  - Inter-run messaging and parent-child run hierarchies

### 2. Oz CLI — Runs Agents Locally Too

The `oz` CLI (bundled with Warp, also standalone via Homebrew) is more than cloud-only:
- `oz agent run` — Runs an agent **locally** in your CWD, streaming to terminal
- `oz agent run-cloud` — Cloud execution
- `oz run list/get` — Inspect runs
- `oz agent list` — List available skills
- `oz model list` — List available LLM models
- Supports MCP server connections, agent profiles, session sharing

### 3. OSC 777 Protocol — Bidirectional Terminal Communication

**Key finding the previous agent missed.** The `claude-code-warp` plugin (warpdotdev/claude-code-warp, 96 stars) demonstrates a real communication protocol:

- Uses `printf '\033]777;notify;%s;%s\007'` with `warp://cli-agent` URI scheme
- Enables structured bidirectional communication between CLI agents and the Warp terminal
- Warp auto-detects Claude Code, Codex, Amp, Gemini CLI, Droid, and OpenCode sessions
- Provides utility bar with voice, image attachment, and code review features

### 4. URI Scheme — External App Integration

- `warp://action/new_window` — Open new window
- `warp://action/new_tab?command=...` — Open tab with command
- `warp://action/open_config` — Open settings
- Works from browsers, other apps, scripts

### 5. Published SDKs

- **TypeScript**: `oz-agent-sdk` on npm (v1.0.2, Apache 2.0)
- **Python**: `oz-agent-sdk` on PyPI (v0.10.1)
- Both fully typed with retries and error handling
- **Rust MCP SDK**: `rmcp` maintained by Warp

### 6. Open Source Components

Warp has open-sourced:
- Themes repository
- Rust MCP SDK (`rmcp`)
- Claude Code integration plugin
- Various agent-related tooling

The terminal client itself remains **closed source** (GitHub repo warpdotdev/Warp is issues-only, 26K stars).

## What Does NOT Exist

- No API to send keystrokes/input to a Warp terminal session from outside
- No API to read terminal buffer contents programmatically
- No session management API (create/destroy/list local terminal sessions)
- No plugin/extension SDK for the terminal UI itself
- No open-source terminal client

## Relevance to ANT

### What's Interesting

1. **OSC 777 protocol pattern** — Warp's approach of using escape sequences for agent-terminal communication is worth studying. ANT could adopt a similar pattern for its own agent communication, using OSC sequences as a structured channel alongside the PTY data stream.

2. **Oz CLI local mode** — The pattern of a CLI that runs agents both locally and in the cloud is relevant to ANT's daemon architecture.

3. **Agent auto-detection** — Warp detecting which AI agent is running and providing contextual UI is a pattern ANT should implement.

### What's Not Useful

- Warp still can't be embedded in a web app
- No way to programmatically manage Warp terminal sessions from ANT
- Cloud agent runs go through Warp's infrastructure, not ANT's
- Closed-source terminal means no code reuse

### Revised Verdict

**Don't integrate Warp as a dependency** — but **do study its patterns**:
- OSC-based agent communication protocol
- Block model for command output
- Agent detection and contextual UI
- Local+cloud agent execution via a unified CLI

These are design patterns ANT can implement independently.
