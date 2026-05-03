# ANTstorm Terminal Research

Date: 2026-05-02

This is the shared working doc for the ANTstorm discussion and localANTtasks experiments.

## Operating Rules

- ANTstorm is discussion and research only unless James or antclaude explicitly asks for code.
- antclaude leads ANTstorm and owns synthesis into a solid plan.
- antcodex leads localANTtasks and keeps experiments small, observable, and reported.
- Every claim should point to either local code, CLI/tool documentation, a reproduction, or an external source.
- Prefer concrete options with tradeoffs over generic agreement.

## Track 1: ANT Terminal As The Human-Readable Layer

Goal: make the interpreted ANT Terminal feel buttery smooth and readable, closer to a website than a raw terminal, while preserving durable context.

Research questions:

- How should ANT store command/session context so important state survives compaction and remains inspectable?
- Should rich command output support HTML, images, markdown, screenshots, and media cards? If yes, what is the trust/sandbox boundary?
- How should structured agent prompts render as first-class interactions instead of raw "y/n/a" text?
- What is the right event model for durable blocks, command lifecycle, tool calls, approvals, and image/file references?
- How much of this belongs in `run_events`, terminal history, linked chat, or a new artifact/event table?

Ideas to evaluate:

- Append-only event log with typed events for commands, prompts, approvals, files, screenshots, and rendered artifacts.
- Rich renderer that displays trusted markdown/HTML-like components from structured events, not arbitrary terminal HTML.
- Prompt cards with explicit actions, justification fields, timeout/status, and audit trail back to the PTY keystroke.
- Context cards that summarize long command output and preserve raw transcript links for audit.
- Per-block persistence and search, including command, cwd, exit status, duration, output excerpts, and related chat.

Risks:

- Rich rendering can become a security boundary if terminal output is treated as trusted HTML.
- Over-structured events can hide raw truth if the Raw Terminal is not one click away.
- Context storage can grow quickly without retention, indexing, and summarization policy.

## Track 2: RAW Browser Terminal Scrolling And Reliability

Goal: make the raw browser terminal solid, flicker-free, and reliable, especially where tmux scrollback and browser rendering fight each other.

Research questions:

- Where does flicker originate: xterm renderer, Svelte lifecycle, WebSocket burst behavior, tmux control mode, scroll anchoring, or history replay?
- What is the best split between tmux scrollback, SQLite persisted history, and xterm's browser buffer?
- Should raw history use xterm only for the live viewport while older scrollback is virtualized outside xterm?
- How should alternate screen, cursor movement, resize, and wrapped lines be represented without corrupting scrollback?
- Which xterm renderer and addons are reliable in current versions, including WebGL/canvas/DOM tradeoffs?

Ideas to evaluate:

- Treat xterm as the live PTY viewport and move deep scrollback to a separate virtualized transcript/search view.
- Persist normalized terminal chunks in SQLite and replay only the tail into xterm on attach.
- Use tmux as a recovery/audit source, but avoid relying on tmux alone for smooth browser scrolling.
- Measure xterm DOM vs canvas vs WebGL behavior with large burst output, resize, and alternate screen transitions.
- Add explicit scroll-anchor rules: user-scrolled state, live-follow state, replay state, and prompt-focus state.

Risks:

- Replaying too much raw data into xterm can cause flicker and layout thrash.
- tmux capture-pane may not preserve everything needed for pixel-perfect browser reconstruction.
- WebGL may improve performance but can introduce font/initialization races already observed in ANT.

## Local Experiments For Gemma

Each experiment should report: command run, environment, observed behavior, suspected cause, confidence, and next suggested test.

1. Generate burst output in the raw terminal and observe scroll/flicker behavior.
2. Compare behavior for normal output versus alternate screen apps such as `less`, `vim`, or `htop`.
3. Inspect current xterm configuration and identify renderer, scrollback, fit, and attach/replay behavior.
4. Inspect tmux capture/history settings and where ANT currently reads persisted terminal history.
5. Build tiny reproduction notes only; no broad code changes.

## Sources To Collect

External docs:

- xterm.js API, addons, renderer notes, scrollback, buffer, and WebGL/canvas behavior.
- tmux manual sections for history, capture-pane, control mode, alternate screen, and passthrough.
- OSC 133/shell integration references from iTerm2, VTE, WezTerm, Kitty, Ghostty, and Warp where available.
- Browser rendering and virtualization references relevant to large append-only logs.

Local docs/code:

- `README.md`
- `docs/LESSONS.md`
- `docs/multi-agent-protocol.md`
- `docs/ant-adapter-surface.md`
- `src/lib/components/Terminal.svelte`
- `src/lib/components/CommandBlock.svelte`
- `src/lib/server/pty-daemon.ts`
- `src/lib/server/prompt-bridge.ts`
- `src/lib/server/db.ts`

## Source-Backed Baseline

### External Findings

xterm.js:

- ANT is on `@xterm/xterm@6.0.0` with `@xterm/addon-fit@0.11.0`, `@xterm/addon-serialize@0.14.0`, and `@xterm/addon-webgl@0.19.0` installed locally.
- xterm's documented default scrollback is 1000 rows; ANT sets `scrollback: 100_000`.
- xterm exposes explicit scroll APIs (`scrollLines`, `scrollPages`, `scrollToBottom`, `scrollToLine`, `scrollToTop`) and selection APIs, so a better raw scroll UX can be measured without inventing a renderer first.
- xterm documents `smoothScrollDuration`, `scrollOnUserInput`, `scrollOnEraseInDisplay`, and `macOptionClickForcesSelection`. These are worth testing before changing architecture.
- xterm's project page describes the core as supporting common terminal apps including `bash`, `vim`, and `tmux`, plus an optional GPU-accelerated renderer. ANT currently avoids WebGL because of a local font/glyph race.

Sources:

- https://xtermjs.org/docs/api/terminal/classes/terminal/
- https://xtermjs.org/docs/api/terminal/interfaces/iterminaloptions/
- https://github.com/xtermjs/xterm.js/

tmux:

- Local version: `tmux 3.6a`.
- Local global options observed: `history-limit 2000`, `allow-passthrough off`.
- tmux `capture-pane` can print pane contents, include ANSI escapes with `-e`, join wrapped lines with `-J`, and select history with negative `-S` values.
- The tmux manual states that with `capture-pane -a`, the alternate screen is used and history is not accessible. This matters for raw scrollback during `less`, `vim`, `htop`, and similar apps.
- tmux control mode has flow-control support: `refresh-client -f pause-after=...`, `%pause`, `%continue`, and `%extended-output`. That gives ANT a possible route to backpressure instead of letting browser rendering fall behind.

Sources:

- https://manpages.debian.org/bookworm/tmux/tmux.1.en.html
- https://github.com/tmux/tmux/wiki/Control-Mode

OSC 133 and shell integration:

- Windows Terminal documents the OSC 133 lifecycle: `A` prompt start, `B` command line start, `C` command output start, and `D;exitcode` command finished.
- WezTerm supports OSC 7 for cwd, OSC 133 for input/output/prompt zones, and OSC 1337 user vars for additional pane state.
- WezTerm notes tmux users need `allow-passthrough on` for user vars; local tmux currently has `allow-passthrough off`, so any tmux-passthrough design needs explicit testing.
- iTerm2 shell integration exposes command metadata such as return status, working directory, and duration. That matches Track 1's durable command-block goals.

Sources:

- https://learn.microsoft.com/en-us/windows/terminal/tutorials/shell-integration
- https://wezterm.org/shell-integration.html
- https://iterm2.com/documentation-shell-integration.html

AI CLI integration:

- Claude Code hooks now expose structured hook types including command, prompt, agent, HTTP, and MCP tool hooks. Hook events include tool use, notification, session start, stop, and permission-oriented flows. This is a high-trust path for structured prompt cards.
- Claude hooks can return structured JSON decisions and can run async for long background tasks. That suggests ANT prompt cards should preserve "decision", "why", "status", and "deferred/background" semantics instead of only forwarding raw keystrokes.
- Gemini CLI documents persistent context files (`GEMINI.md`), trusted folders, headless mode, custom commands, a session browser, saved conversations, vim mode, and shell mode. ANT should treat Gemini as a structured agent where possible, not only as terminal text.

Sources:

- https://code.claude.com/docs/en/hooks
- https://google-gemini.github.io/gemini-cli/docs/cli/
- https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/commands.md

### Local Findings

Raw terminal path:

- `src/lib/components/Terminal.svelte:170` dynamically imports xterm and addons.
- `src/lib/components/Terminal.svelte:181` creates the terminal with `scrollback: 100_000`.
- `src/lib/components/Terminal.svelte:216` loads FitAddon and SerializeAddon only; WebGL is installed but not loaded.
- `src/lib/components/Terminal.svelte:221` explicitly keeps the DOM renderer because WebGL's glyph atlas can build before the font is ready and produce bad first render output.
- `src/lib/components/Terminal.svelte:248` fetches DB history before live output and buffers websocket terminal output until history is loaded.
- `src/lib/components/Terminal.svelte:258` loads `/terminal/history?limit=1000&since=0&raw=1`, so the browser gets only 1000 persisted chunks even though xterm scrollback is 100,000 rows.
- `src/lib/components/Terminal.svelte:314` forces a repaint 600ms after connect because browser route transitions can suppress xterm's internal requestAnimationFrame paint.
- `src/lib/components/Terminal.svelte:378` forwards xterm `onData` directly to PTY unless slow edit is active.
- `src/lib/components/Terminal.svelte:412` handles tab restore by fit, refresh, and resize/SIGWINCH.

Server/PTY path:

- `src/lib/server/pty-daemon.ts:203` serves reconnect scrollback through `tmux capture-pane`.
- `src/lib/server/pty-daemon.ts:213` captures only the last 1000 tmux history lines for reconnect scrollback.
- `src/lib/server/pty-daemon.ts:317` parses selected tmux control-mode events, including `%pause` and `%continue`, but most control-mode output is dropped.
- `src/lib/server/pty-daemon.ts:678` says reconnect serves scrollback from tmux's own buffer.
- `src/routes/api/sessions/[id]/terminal/history/+server.ts:1` exposes the persisted history API for agents and the browser, with default/max limits of 100/1000.
- `src/lib/server/db.ts` already has `terminal_transcripts`, `terminal_text_fts`, `terminal_events`, `run_events`, and `command_events`. Track 1 should probably extend this existing model instead of starting a new storage island.

### Initial Pressure Points

- There are three history/scrollback limits in play: xterm rows (`100_000`), browser history load (`1000` DB chunks), and tmux history (`2000` local rows, while reconnect capture uses `-S -1000`). This mismatch is a likely source of unreliable scroll expectations.
- Raw terminal flicker is already being worked around with write chunking, queued writes, forced refresh, fit-on-resize, and SIGWINCH repaint. Any plan should measure which workaround is masking which root cause.
- WebGL should not be rejected permanently, but it must be tested behind a feature flag with `document.fonts.ready`, xterm open/load ordering, and visual checks across first attach, reconnect, mobile, and route restore.
- Deep raw history should probably not be replayed fully into xterm on every attach. A stronger design is live xterm tail plus a separate persisted transcript/search view, unless Gemma's experiments prove xterm can handle deeper replay without flicker.
- Rich HTML/media rendering should live in the ANT Terminal from structured events and trusted artifacts, not arbitrary terminal escape output.
- Structured prompt cards have at least two sources: high-trust hooks/JSON where CLIs expose them, and medium-trust terminal prompt detection as fallback.

## Decision Output

The final plan should include:

- Priority order for Track 1 and Track 2.
- Architecture proposal with data flow.
- Minimal first milestone and measurable acceptance criteria.
- Known risks and rollback paths.
- Concrete local tests that prove the raw terminal is stable.

---

## R1 Research — Track 1 (DeepSeek / @ocloudant): Rich ANT Terminal Layer

Date: 2026-05-02

### 1. Existing Data Model Audit (source-backed)

ANT already has a four-table event architecture that maps well to Track 1's ambitions. The gap is not missing tables — it's under-utilisation.

**`terminal_transcripts`** (`db.ts:208-240`): Raw PTY byte chunks. `session_id`, `chunk_index`, `raw_data` (BLOB), `ts_ms`, `byte_offset`. FTS5 mirror in `terminal_text_fts`. This is the ground-truth audit layer. Any rich block MUST carry a pointer back to the raw transcript range so users can toggle between "interpreted view" and "raw bytes."

**`command_events`** (`db.ts:352-366`): Shell-hook-populated command records. `command`, `cwd`, `exit_code`, `started_at`, `ended_at`, `duration_ms`, `output_snippet`, `meta` (JSON). Populated by `capture-ingest.ts` polling `~/.local/state/ant/capture/*.events` — NDJSON files written by `ant.zsh`/`ant.bash` shell hooks. Already has FTS5 index for search. The `output_snippet` is backfilled lazily from `terminal_transcripts` within a ~35s flush window.

**`run_events`** (`db.ts:336-350`): The key interpretative table. Explicitly described as "Unified append-only timeline for the ANT Terminal view… interpreted, trust-labelled stream that sits between linked chat and raw terminal." Schema: `session_id`, `ts_ms`, `source` (hook|json|terminal|status|tmux), `trust` (high|medium|raw), `kind`, `text`, `payload` (JSON), `raw_ref`. This is the right table to extend for rich blocks — it already has the trust model and the payload column.

**`terminal_events`** (`db.ts:322-330`): Tmux control-mode structured events (`%window-*`, `%session-*`, `%layout-change`, `%exit`). Separate concern — useful for layout/state tracking but not the primary rich-block store.

**Finding**: The `run_events` table IS the append-only event log the baseline doc proposes. It just isn't being rendered richly. The priority is not a new storage island — it's populating `run_events` with richer `kind` values and rendering them as typed blocks in the ANT Terminal view.

### 2. CommandBlock.svelte — Current Capability vs. Needed Capability

Current `CommandBlock.svelte` renders: command text, cwd (truncated), exit code (✓/✗), duration, timestamp, expandable output snippet. It's a simple display component — no toolbar, no sticky header, no rich content, no link to raw transcript.

What it needs for Track 1:
- **Sticky header**: CSS `position: sticky; top: 0` when block output exceeds viewport height. Already proposed in Warp brief Area 4b.
- **Per-block toolbar**: copy command, copy output, re-run (sends `command + \r` to PTY), bookmark (toggles SQLite flag).
- **Raw transcript link**: clickable link that scrolls the Raw Terminal view to the matching byte range.
- **Rich content slot**: a `<slot>` or conditional render path for structured artifacts (images, markdown, prompt cards) when `run_events` payload contains a `render_type` field.
- **Lifecycle states**: "running" (spinner), "completed" (✓/✗), "backgrounded" (clock icon), "killed" (signal number).

### 3. Security Boundary for Rich Rendering

The baseline doc correctly flags this as the #1 risk. Here's a concrete proposal:

**Trust tiers for rendered content**:
- `trust: 'high'` — hook-emitted or JSON-emitted events from registered agent drivers. Can render markdown, images from trusted sources, structured prompt cards. Origin is code ANT controls (shell hooks, driver specs).
- `trust: 'medium'` — prompt-bridge detected text, OSC 133 parsed output from unknown shells. Can render structured blocks (command header, exit code) but NOT arbitrary HTML/markdown. Text content is escaped.
- `trust: 'raw'` — everything from the PTY byte stream. Never rendered as rich content. Always shown as escaped text in xterm or a `<pre>` block.

**Sandbox for rich artifacts**:
- Images: only render `<img>` tags pointing to ANT's own `/api/artifacts/` endpoint, never arbitrary URLs from terminal output. Artifacts are uploaded via a separate trusted channel (agent tool call, file drop).
- Markdown: render via a sanitising markdown library (e.g., `marked` with `sanitize: true` or `dompurify` post-render). No raw HTML passthrough from terminal output.
- Screenshots: captured by Playwright/screenshot skills, stored as artifacts, referenced by ID in `run_events` payload — never embedded as base64 in the event stream.

### 4. Structured Agent Prompts — Architectural Options

The chat shows disagreement: Gemini says lowest priority (philosophical risk), Claude Opus and Codex are open. Here's my assessment:

**Two-source model (confirmed by local code)**:

1. **High-trust path**: Agent drivers declare `prompts[]` in `drivers/*/spec.json`. Each entry has a `pattern` (regex on PTY output), `choices` array (label + keystroke), and optional `description`. When `prompt-bridge.ts` detects a match, it emits a `run_event` with `kind: 'agent_prompt'`, `trust: 'high'`, and the parsed choices in `payload`. This is already partially wired — `prompt-bridge.ts` has the detector pipeline, just not the schema-driven prompt rendering.

2. **Medium-trust fallback**: Generic regex detection (existing `DEFAULT_PATTERNS` in `prompt-bridge.ts:58-62`). Catches prompts from non-registered agents. Renders as a simpler "this looks like a prompt" card with raw text and a text-input response field.

**Where prompts render**:
- Option A: In linked chat as rich buttons (current thinking in Warp brief). Pro: chat is already the coordination surface. Con: context switch away from terminal.
- Option B: Inline in ANT Terminal as overlay cards anchored to the prompt's position in the output stream. Pro: spatial context preserved. Con: more complex positioning, z-index wars with xterm.
- Option C: Both — chat gets a compact notification, terminal gets the interactive card. This is my recommendation.

**Risk Gemini flags**: "Schema tax" — if every agent needs a `spec.json` entry, it becomes a maintenance burden. Mitigation: the medium-trust fallback means unregistered agents still work; registration only improves the UX. Spec files are data, not code.

### 5. Event Model — Mapping Track 1 Ideas to Existing Tables

| Track 1 Concept | Where It Lives | Gap |
|---|---|---|
| Command lifecycle (start/running/done) | `command_events` (started_at, ended_at, exit_code, duration_ms) + backfill pipeline | Missing "running" state — command_events rows are only inserted on command_end. Need a command_start row that updates on command_end. |
| Structured prompt cards | `run_events` with `kind: 'agent_prompt'`, payload carries choices | `prompt-bridge.ts` already calls `appendRunEvent` — just needs schema-driven parsing alongside regex. |
| Rich artifacts (images, files, screenshots) | New: `artifacts` table + `run_events` with `kind: 'artifact'`, `raw_ref` pointing to artifact ID | No artifact storage yet. `file_refs` table exists but is for flagging, not rich content. |
| Tool calls / approvals | `run_events` with `kind: 'tool_call'` or `kind: 'approval'` | Claude Code hooks emit these; need a hook→run_event bridge in `pty-daemon.ts`. |
| Context cards (summarised output) | `run_events` with `kind: 'context_summary'`, payload carries summary + link to full transcript range | No summarisation pipeline yet. Could be an idle-tick agent task. |

### 6. Initial Pressure Points (Track 1 specific)

- **`run_events` is under-populated**: `prompt-bridge.ts` and `pty-daemon.ts` both call `appendRunEvent`, but the main command-output flow (raw PTY writes) does not produce run_events. This means the ANT Terminal view — designed to render run_events — has nothing to show for most terminal activity. OSC 133 hooks are the key to fixing this.
- **CommandBlock is disconnected from run_events**: `CommandBlock.svelte` receives props directly (command, cwd, exit_code) rather than reading from `run_events`. It should accept a `run_event` object and render different layouts based on `kind`.
- **No "currently running" visibility**: `command_events` is write-only on command_end. There's no way to query "what command is running right now in session X?" — needed for the spinner state in CommandBlock.
- **prompt-bridge detection is regex-only**: `feedPromptBridge` in `prompt-bridge.ts:267` uses `DEFAULT_PATTERNS` regexes against a rolling line buffer. It doesn't consult `drivers/*/spec.json` prompts schemas. The schema-driven path is designed but not wired.

### 7. Cat 1 Anchor Questions — Initial Answers

**Pinned input editor — extend or push back on CodeMirror 6?**
Stance: CodeMirror 6 is the right pick. Monaco is ~4× larger and oriented toward IDE use cases. CodeMirror 6's Lezer grammar for shell (`@codemirror/lang-shell`) is adequate, and the modular architecture means we only ship what we use. The ~120 KB gzipped is acceptable behind a dynamic import (same pattern as xterm at `Terminal.svelte:170`). Risk: mobile IME can be flaky on some CodeMirror versions — needs testing on iOS Safari + Android Chrome before committing.

**RichANT/freeform — what actually loses data today?**
Three loss vectors: (1) tmux scrollback truncation loses output beyond 1000 lines on reconnect, (2) command_events only persists a 500-char output_snippet — full output is only in terminal_transcripts which has no structured command linkage beyond timestamp range overlap, (3) agent re-summarisation is lossy by design — intermediate reasoning is not recoverable after compaction. Warp persists the full block output; ANT currently does not.

**Interactive prompt UX — beyond chat buttons?**
Inline overlays anchored to the prompt source position in the output stream is the unconventional angle. Instead of forwarding prompts to chat (context switch), render an overlay card directly in the ANT Terminal view at the scroll position where the prompt appeared. The user clicks a button, the response is injected as keystrokes via the existing `respondToPrompt` path. This keeps spatial context and avoids the chat-as-middleman feeling.

---

## R1 Research — Track 2 (Codex / @antcodex): RAW Browser Terminal Reliability

Date: 2026-05-02

### 1. Current Raw Terminal Data Flow

ANT currently has four overlapping raw-terminal flows:

1. **Live PTY bytes**: the browser opens a WebSocket, sends `join_session`, then receives `terminal_output` frames and writes them into xterm. `Terminal.svelte:332-345` buffers live frames until DB history is loaded, dedupes by `seq`, then calls `enqueueOutput`.
2. **Persisted DB history replay**: `Terminal.svelte:256-269` fetches `/api/sessions/:id/terminal/history?limit=1000&since=0&raw=1`, reverses newest-first rows, joins raw chunks, and writes them into xterm before flushing pending live output.
3. **tmux reconnect capture**: `pty-daemon.ts:203-214` uses `tmux capture-pane -p -e -J -S -1000` to get ANSI scrollback/current screen for reconnects. `pty-daemon.ts:677-683` sends that scrollback when the tmux session already exists.
4. **Control-mode text capture**: `pty-daemon.ts:37-45` and `pty-daemon.ts:173-191` debounce tmux `%output` and call `captureClean` to broadcast `terminal_line` for chat/text rendering. This is not byte-perfect raw terminal state; it is a filtered text view.

Finding: "Raw terminal reliability" cannot be fixed by tuning one buffer. The plan needs separate policies for live viewport, reconnect tail, persisted transcript/search, and interpreted text capture.

### 2. Renderer And Replay Pressure Points

`Terminal.svelte` is already carrying several defensive patches:

- Adaptive output buffering: tiny writes flush in a microtask; larger bursts coalesce for 2ms (`Terminal.svelte:71-122`).
- Sequential write queue: comments say interleaved chunked scrollback and SIGWINCH output can corrupt xterm ANSI state into blank screens (`Terminal.svelte:80-91`).
- Chunked writes at 6144 bytes: intended to avoid Safari/iPad main-thread stalls on large ANSI blobs (`Terminal.svelte:124-147`).
- Forced repaint after large writes and 600ms after connect because xterm may hold buffer content without painting during route transitions (`Terminal.svelte:140-144`, `Terminal.svelte:314-323`).
- ResizeObserver waits for real container height before spawn/replay because 0-row initial fit can cause mis-sized replay and blank paint (`Terminal.svelte:387-410`).
- Visibility restore does fit, refresh, and SIGWINCH to force the foreground shell/TUI to repaint (`Terminal.svelte:412-425`).

These are useful fixes, but they also prove the current architecture is fragile under replay, route navigation, resize, and hidden-tab cases. The next step should be measurement, not another unscoped tweak.

### 3. Scrollback Split: xterm Tail, SQLite Deep History, tmux Recovery

The three retention settings are currently inconsistent:

- xterm browser scrollback: `scrollback: 100_000` (`Terminal.svelte:181-190`).
- browser DB replay: max 1000 history rows because the API caps `limit` at 1000 (`terminal/history/+server.ts:20-21`) and the browser fetch uses `limit=1000` (`Terminal.svelte:258`).
- tmux reconnect capture: last 1000 tmux history lines (`pty-daemon.ts:213`), while local global tmux `history-limit` is 2000.

Recommendation for R2 pitch: treat xterm as the **live tail renderer**, not the full historical transcript. Keep enough raw tail in xterm for normal terminal use; put deep history in a separate virtualized transcript/search view backed by `terminal_transcripts` and `terminal_text_fts`. tmux remains the recovery/audit source for currently alive sessions, but not the UX surface for deep scroll.

Why: xterm is optimized to emulate a terminal viewport, including cursor movement and alt-screen state. SQLite is optimized to retain/search durable chunks. Forcing one to do both jobs is exactly where flicker and replay stalls appear.

### 4. tmux Constraints That Matter

tmux is still valuable: it survives server restarts, provides control-mode events, and can capture current screen/history. But it has sharp edges for browser-grade scroll:

- `capture-pane -e` preserves ANSI escapes and `-J` joins wrapped lines, which ANT already uses (`pty-daemon.ts:208-214`).
- tmux manual behavior around alternate screen matters: alternate-screen capture and history are not the same state. TUIs such as `less`, `vim`, `fzf`, and `htop` can redraw in alt-screen without producing linear scrollback suitable for browser history.
- Control mode can emit `%pause` and `%continue`; ANT persists selected pause/continue events (`pty-daemon.ts:317-355`) but does not use tmux flow control for browser backpressure. This is an opportunity: if WebSocket/xterm writes fall behind, control-mode pause/resume could become a bounded pressure valve.

Sources:

- https://manpages.debian.org/bookworm/tmux/tmux.1.en.html
- https://github.com/tmux/tmux/wiki/Control-Mode

### 5. xterm Options Worth Testing Before Replacing It

xterm's API and options give us several low-risk experiments before replacing the renderer:

- `smoothScrollDuration`: test whether controlled smooth scrolling improves perceived quality or creates lag on large outputs.
- `scrollOnUserInput`: ensure raw terminal snaps to bottom only when the user actually types, not when a replay finishes.
- `scrollOnEraseInDisplay`: test whether clearing commands/TUIs unexpectedly pull the viewport.
- explicit scroll APIs (`scrollToLine`, `scrollToBottom`, `scrollPages`): can drive a stable custom scrollbar without inferring too much from DOM.
- WebGL addon: already installed but disabled. Retest only behind a feature flag and after `document.fonts.ready`; verify first attach, reconnect, route restore, mobile Safari/Chrome, and alt-screen.

Sources:

- https://xtermjs.org/docs/api/terminal/classes/terminal/
- https://xtermjs.org/docs/api/terminal/interfaces/iterminaloptions/
- https://github.com/xtermjs/xterm.js/

### 6. Concrete Test Claims For Gemma

These are small, falsifiable claims for localANTtasks:

1. **Replay-size claim**: blank/flicker correlates more with replay size and resize timing than with live streaming. Test: compare fresh session, reconnect with 100 lines, reconnect with 1000+ lines, and route-away/route-back.
2. **Alt-screen claim**: scroll corruption reports are higher after `less`/`vim`/`fzf` than after equivalent plain output. Test: run a large plain loop, then `seq 1 5000 | less`, exit, reconnect, inspect viewport and scroll track.
3. **Renderer claim**: DOM renderer is stable but slower on bursts; WebGL after `document.fonts.ready` may improve burst output without the old glyph race. Test behind feature flag only; screenshot first paint and reconnect paint.
4. **History split claim**: loading deep raw history into a virtualized transcript view gives better UX than replaying all raw chunks into xterm. Test by increasing replay limit locally only for measurement and comparing attach time/paint stability.
5. **Scroll-anchor claim**: custom scrollbar needs explicit states: live-follow, user-scrolled, replaying, alt-screen. Test whether current `scrollRatio` jumps during replay and resize.

### 7. R1 Stance

Do not replace xterm or tmux first. The right first milestone is a measured hardening pass:

- Instrument attach/replay timings and write-queue depth.
- Make replay policy explicit: xterm receives a bounded tail; deep history opens in transcript/search.
- Add a browser-side raw terminal state machine: `replaying`, `following`, `user_scrolled`, `alt_screen`, `hidden`.
- Retest WebGL behind a feature flag with font readiness and screenshot checks.
- Use tmux control-mode pause/continue as a candidate backpressure path only after measuring browser write backlog.

Unconventional angle: the "raw terminal" should not try to be the full historical reader. It should be the faithful live pipe. The pleasant long-scroll reader belongs beside it as a virtualized transcript/audit surface powered by SQLite.

---

## R1 Research — Track 1 Support (@antclaude): Inline Graphics Survey & Architectural Implications

Date: 2026-05-02

Supporter contribution. Focus: pressure-test @ocloudant's `/api/artifacts/` proposal against the actual state of terminal inline-graphics protocols, and locate the few cases where inline graphics IS viable.

### 1. Protocol Survey (canonical-source-backed)

Three inline-graphics protocols dominate; each has different transmission, format, and terminal-support characteristics.

**Kitty graphics protocol** (modern reference standard):
- Transmission: APC sequences `ESC _ G <control_data>;<base64_payload> ESC \`. Control data is comma-separated `key=value` pairs. Payload is base64 to avoid control-byte conflicts.
- Formats: 24-bit RGB (`f=24`), 32-bit RGBA (`f=32`, default), PNG (`f=100`).
- Transmission media: direct embed (`t=d`), regular file (`t=f`), temp file (`t=t`), shared memory (`t=s`). The `t=f`/`t=s` paths optimise for same-host clients.
- Chunking: `m=1` for intermediate chunks (≤4096 bytes), `m=0` for final.
- Compression: deflate via `o=z`. Image IDs are 32-bit unsigned. Placement requires cursor position (`C=1` suppresses cursor movement).
- Detection: `a=q` query action followed by device attribute request.

**iTerm2 inline images (OSC 1337 File=...)**:
- Transmission: `ESC ] 1337 ; File=<key=value> : <base64> BEL`. Newer multipart variant for tmux compatibility (iTerm2 ≥3.5).
- Parameters: `name`, `size`, `width`/`height` (px / % / `auto`), `preserveAspectRatio`, `inline`.
- Formats: any macOS-decodable (PNG, GIF, JPEG, PDF, PICT). Animated GIFs since 2.9.20150512.
- Tmux constraints: 256-byte sequence cap on older tmux; 1,048,576-byte cap on newer tmux + iTerm2 multipart.

**Sixel** (legacy with broadest reach):
- DEC origin (1980s). 6-pixel vertical groups per cell. ~3-4× bandwidth of Kitty for equivalent images.
- Supported by 27+ terminals per the Are We Sixel Yet tracker, including iTerm2 (≥3.3), WezTerm, foot, mlterm, mintty, xterm, **xterm.js (via xterm-addon-image)**, Visual Studio Code (which uses xterm.js).

Sources:
- https://sw.kovidgoyal.net/kitty/graphics-protocol/
- https://iterm2.com/documentation-images.html
- https://www.arewesixelyet.com/

### 2. xterm.js Current State (verified 2026-05-02)

ANT runs `@xterm/xterm@6.0.0` per baseline §External Findings.

- **Sixel**: supported via `xterm-addon-image`. Mature, addon-installable. VS Code has shipped this since v1.80.
- **Kitty graphics protocol**: NOT yet supported. Open issue [xtermjs/xterm.js#5592](https://github.com/xtermjs/xterm.js/issues/5592), filed 6 January 2026, assigned to @anthonykim1, still open. Earlier WebSearch summaries claiming Feb-2026 ship are wrong — the canonical issue contradicts that, and the [Are We Sixel Yet site](https://www.arewesixelyet.com/) lists Kitty's protocol as Kitty-terminal-only with no mention of cross-implementation.
- **iTerm2 OSC 1337 images**: not natively handled by xterm.js core. Would need a custom OSC handler.

**Implication**: Sixel via `xterm-addon-image` is the only inline-graphics path immediately available without writing a new xterm.js addon.

Sources:
- https://github.com/xtermjs/xterm.js/issues/5592
- https://xtermjs.org/docs/api/terminal/classes/terminal/

### 3. The tmux Passthrough Constraint (Critical)

ANT's local tmux config (per baseline §External Findings, tmux 3.6a): `allow-passthrough off`.

Every inline-graphics protocol relies on the terminal emulator receiving the escape sequence intact. tmux strips or wraps unknown escape sequences unless `allow-passthrough on`. With passthrough off:
- Kitty APC sequences → stripped before reaching xterm.js.
- iTerm2 OSC 1337 → stripped or mangled.
- Sixel → tmux 3.0+ handles some cases natively, but inline-image rendering through tmux scrollback remains unreliable across resize and reattach.

**Implication**: Even with full Kitty graphics in xterm.js today, ANT's tmux-mediated PTY would still block it. Enabling passthrough is non-trivial — it lets arbitrary terminal output emit arbitrary escapes, with security and rendering-stability implications (WezTerm shell-integration docs flag this explicitly).

### 4. Why @ocloudant's `/api/artifacts/` Approach Is The Right Architecture

Restating from §R1 Track 1 point 3: images are referenced by ID in `run_events` payload, served via `/api/artifacts/`, never base64-embedded in the event stream.

This sidesteps every protocol constraint above:
- **No tmux passthrough required** — artifacts move over HTTP, not the PTY byte stream.
- **No xterm.js addon dependency** — the ANT Terminal layer is a Svelte component rendering native `<img>` tags; xterm is not sent artifact bytes. Any placeholder is either text emitted by the CLI itself or a UI annotation anchored outside the transcript stream.
- **No protocol fragility** — base64 size limits, sequence caps, and chunking races don't apply to HTTP.
- **Trust boundary clean** — `/api/artifacts/` enforces auth, content-type sniffing, and origin checks; arbitrary terminal bytes never become rich content. Maps cleanly onto the trust-tier model proposed at §R1 Track 1.3.

The Raw Terminal UI can degrade gracefully with an out-of-band annotation like `[image: id=xyz, name=plot.png]` at the artifact reference position, with a click-to-open into the ANT Terminal view. That annotation must not be appended to PTY bytes or canonical raw transcript chunks.

### 5. Where Inline Graphics Is Still Viable

Three cases where Sixel via xterm-addon-image earns its weight:

1. **CLI tools that emit images natively** (`img2sixel`, `viu`, `chafa`, `gnuplot --term sixel`, `mpv --vo=sixel`): users already use these workflows; ANT shouldn't block them. Cost: `allow-passthrough on` in tmux + loading the addon.
2. **Raw-Terminal review of agent output** that uses Sixel for diff visualisation, plot rendering, or progress UIs.
3. **Future Raw-Terminal feature flag** where users opt into "rich raw terminal" — not the default, but available.

These are NOT the path for the rich ANT Terminal view (artifacts + run_events stays right). They are Raw Terminal capability gains.

### 6. Recommendation For The Plan

- **Phase 1 (Track 1 architecture)**: Adopt @ocloudant's artifacts-via-API design. No inline graphics protocol enabled. Images, screenshots, charts arrive via tool-call pipelines, stored in a new `artifacts` table, referenced from `run_events`.
- **Phase 2 (Raw Terminal capability, opt-in)**: Enable Sixel via `xterm-addon-image` behind a feature flag. Switch tmux to `allow-passthrough on` with explicit security review (per WezTerm's caveats). Keep Kitty graphics as a stretch goal pending xterm.js#5592 landing.
- **Anti-recommendation**: Do NOT design the rich ANT Terminal around any inline-graphics protocol. The protocol space is fragmented (3 standards, partial overlap), the xterm.js addon path is incomplete (Kitty open, OSC 1337 absent), and tmux is hostile by default.

### 7. Open Questions For R3 Challenge

- @ocloudant: does artifact storage need to be content-addressable (hash-based dedup) or session-scoped? The `artifacts` table schema isn't yet defined.
- @antcodex: if Phase 2 enables tmux passthrough, what's the regression risk for the raw-terminal scroll reliability work? Passthrough opens arbitrary-escape paths that may interact with the flicker-mitigation patches at `Terminal.svelte:71-122`.
- @gemini (when she calls): does the artifacts approach reintroduce a different schema tax (artifact type registration / content-type registry)? Or is content-type sniffing enough?

---

## R2 Analysis — Track 2 (Gemini / @gemini): Raw Terminal Pressure Points

Date: 2026-05-02

### 1. Is xterm-as-live-tail plus SQLite transcript too conservative?

**No, it is structurally necessary.** 
Currently, xterm is configured with `scrollback: 100_000` (`Terminal.svelte:181`), but the API strictly caps history fetches to 1000 chunks (`history/+server.ts:46`), and tmux reconnect capture is limited to 1000 lines (`pty-daemon.ts:213`). Replaying tens of thousands of ANSI chunks into xterm on every page load would cause severe main thread blocking, even with the existing 6KB chunking workaround (`Terminal.svelte:124`). xterm is a terminal emulator, not a document viewer. 

Using xterm as a live tail (e.g., last 1000-2000 lines) and pushing deep scrollback to a virtualized SQLite transcript view avoids the impedance mismatch between ANSI replay and browser DOM performance. It's the most reliable path to a smooth UX.

### 2. Is tmux control-mode backpressure practical?

**Highly practical, but requires browser-to-server signaling.**
`pty-daemon.ts` currently parses `%pause` and `%continue` from tmux control mode (`pty-daemon.ts:317`), but only persists them as `terminal_events`. It does not actively apply backpressure. 

If the browser's WebSocket buffer or Svelte chunk queue (`Terminal.svelte:80`) starts falling behind, the browser could send a `terminal_throttle` message to the server. The server could then issue a `%pause` to tmux, freezing the PTY output until the browser catches up and sends `%continue`. This provides true end-to-end backpressure, preventing browser memory exhaustion or layout thrash during massive burst outputs.

### 3. Should WebGL-after-fonts-ready be an early test or deferred?

**It should be an early test.**
`Terminal.svelte:221` explicitly avoids WebGL because the glyph atlas builds before web fonts are fully loaded, causing garbled text on first render. However, the DOM renderer struggles with burst output, necessitating forced repaints and manual chunking (`Terminal.svelte:140`). 

Wrapping the WebGL initialization in `await document.fonts.ready` (behind a feature flag) is a low-effort, high-reward test. If successful, WebGL's superior throughput could eliminate the need for many of the current write-queue and chunking workarounds, simplifying the replay architecture significantly.

---

## R2 Pitch — Track 1 (DeepSeek / @ocloudant): Rich ANT Terminal Layer

Date: 2026-05-02

### Stance

The ANT Terminal's rich layer should distinguish itself from Warp by optimising for *agent observability*, not IDE features. Three pillars:

1. **JSONL canonical log per session on disk** — append-only typed events (command, prompt, artifact, exit) with byte offsets. SQL (`run_events`, `command_events`, FTS) is a derived index rebuilt from the log. Markdown is a derived view. No dual-write: the log is the only thing you can't lose.

2. **`run_events` as the primary interpretative projection** — already has the trust model (high/medium/raw), source labelling, and payload column. Enrich with richer `kind` values (`agent_prompt`, `tool_call`, `approval`, `artifact`, `context_summary`) and render CommandBlock from a run_event object rather than flat props.

3. **Artifacts via `/api/artifacts/` not PTY** — Claude Opus's protocol survey confirms: tmux `allow-passthrough off` kills inline graphics (Kitty APC, iTerm2 OSC 1337, Sixel) at the PTY layer. HTTP-side artifacts sidestep the entire problem. Raw Terminal can show an out-of-band `[screenshot attached]` annotation, but the raw byte stream remains untouched.

**Minimum first milestone**: CommandBlock enriched with sticky header, running/completed states, and one structured block type: inline prompt overlay cards (overlaying the raw `[y/n/a]` text in the ANT Terminal layer, never replacing it in the Raw Terminal). Measurable: within one session, a Claude Code approval prompt renders as three buttons; clicking one injects the correct keystroke; the raw terminal shows the same sequence for audit.

### Risks

1. **JSONL ↔ SQL divergence**: If the canonical log is the source of truth but browsers read from SQL projections, a write gap means stale reads. Mitigation: SQL projections are rebuilt from the log on server startup; runtime projections are written within the same tick as the log append via a single `writeLogAndProject()` function — never two separate code paths.

2. **Security boundary creep**: Once rich blocks render markdown/images from `trust: high` events, the temptation to relax the trust tier will be constant ("just this one case…"). Mitigation: hardcoded renderer rules — `trust: 'high'` renders markdown via sanitised library; `trust: 'medium'` renders structured blocks with escaped text only; `trust: 'raw'` is never rendered as rich content. No exceptions without a PR that changes the renderer rules file.

3. **Block-type proliferation**: Every new `kind` value needs a payload schema and a Svelte renderer branch. Three types is manageable; thirty is a maintenance burden. Mitigation: start with exactly three kinds (command_block, agent_prompt, artifact) and add a fourth only when the existing three provably can't cover the use case. Generic `data` payload field allows unstructured extension without schema changes.

### Unconventional Angle

ANT shouldn't chase Warp's IDE-terminal hybrid. Warp optimises for *human developers reading their own terminal output*. ANT should optimise for *humans observing agent activity*. This means:

- **Prioritise prompt visibility over input editor**: The #1 UX win isn't a fancy input box — it's making agent prompts readable, actionable, and auditable. Inline overlay cards that float above the prompt's position in the output stream, with clear "what the agent is asking" + "what each choice means" — that's the "cool AF" James wants.
- **Tool-call transparency as a first-class block type**: When Claude Code runs `bash("git diff")`, render a compact tool_call block showing tool name + arguments + duration, expandable to full output. This turns agent activity from a wall of text into a scannable timeline.
- **The raw terminal is the escape hatch, not the default**: Default view = clean blocks only. Raw terminal is one click/tab away for when you need the unfiltered truth. This is the opposite of Warp, which defaults to raw with block overlays.
- **Durable context survives compaction**: When an agent summarises its conversation, the ANT Terminal should show a "context compacted" card linking to both the pre-compaction transcript range and the summary. The human always has a trail back to what was lost.


## R3 Analysis — Track 2 (Gemini / @gemini): Artifacts and Passthrough

Date: 2026-05-02

### 1. Content-addressable vs. Session-scoped Artifacts

**Recommendation: Content-addressable (SHA-256) globally, referenced per-session.**
If multiple agents generate or reference the same file (e.g., a shared `logo.png` or an identical `vitest-error.md` summary), storing them by hash deduplicates storage. The `run_events` table already supports a JSON `payload` where we can store `{"artifact_hash": "abc123..."}`. The server can serve these via `/api/artifacts/:hash`. Session-scoping should be a relationship (e.g., a join table or `session_id` tagging on the artifact record) rather than the primary key, allowing cross-session reuse if necessary.

### 2. Artifact Retention and Indexing Policy

**Recommendation: TTL-based eviction for media, FTS5 indexing for text.**
- **Media (Images/Screenshots):** Keep for 7 days unless explicitly pinned. Large screenshots from automated tests will bloat the DB quickly.
- **Text (Markdown/JSON summaries):** Index via FTS5 alongside `terminal_text_fts`. Treat them as searchable evidence. These can follow the same 30-day pruning lifecycle as `digest/*` keys (`docs/LESSONS.md` 2.3).
- **Enforcement:** The `idle-tick.ts` script should sweep expired artifacts during its background polling to keep LLM-free zero-cost maintenance.

### 3. Does `allow-passthrough` break scroll/replay stability?

**Risk: High.**
Currently, `allow-passthrough off` is set (`docs/ANTstorm-terminal-research.md` tmux section). Enabling `allow-passthrough on` allows apps like WezTerm or Kitty to send inline images (Sixel, Kitty graphics protocol) directly through tmux to the emulator. 
- If xterm receives these, it attempts to render them (if the image addon is loaded), which drastically alters the line-height and scroll computations.
- If we fetch `raw=1` history via `capture-pane`, tmux may strip or mangle the escape sequences depending on its internal buffer limits.
- **Test:** Before relying on inline terminal graphics, we must test `capture-pane -e -J` with Sixel output. If tmux mangles the image payload in its scrollback buffer, then the "byte-faithful raw terminal" goal is broken for graphics. This strongly supports antclaude's Track 1 split: render images via HTTP/Svelte and keep the PTY text-only.

## R3 Pitch — Track 1/Track 2 Hybrid (Gemini / @gemini): Qwen, Pi, and Copilot Integration Context

Date: 2026-05-02

### Context from Local Drivers
The current landscape of local agent drivers provides strong evidence for how we should architect the ANT Terminal UI and Raw Terminal interaction.

1. **Qwen (`docs/agent-setup/QWEN.md` + `src/drivers/qwen-cli`)**: Operates via tmux fingerprinting and "YOLO" mode (no native hooks). This reinforces the need for Track 2's robust raw terminal and Track 1's `trust: medium` fallback. Unregistered agents or those without native hooks MUST still work seamlessly.
2. **Pi (`docs/agent-setup/PI.md` + `src/drivers/pi`)**: Represents the strongest structured path via JSONL/RPC. This proves that Track 1's `trust: high` path (where agents emit structured events like prompt cards or tool calls directly) is not just theoretical. We have agents capable of bypassing the PTY guessing game entirely.
3. **Copilot (`docs/agent-setup/COPILOT.md` + `src/drivers/copilot-cli/spec.json`)**: Uses shell hooks plus optional MCP via `ant-channel`. This sits between Qwen and Pi, using shell-level integration to provide structured boundaries (OSC 133) for a CLI tool.

### Implication for the "Cool AF" / "Noise-Free" Goal
James wants it "cool AF", easy to read, and not full of noise, while retaining a rock-solid raw terminal. 

The driver landscape dictates a **layered approach**:
- For agents like **Pi** (RPC/JSONL) and **Copilot** (Shell hooks/MCP), the ANT Terminal can confidently strip away the raw PTY noise and present clean, structured blocks (Command, Tool Call, Prompt, Artifact). We *know* the boundaries and intent.
- For agents like **Qwen** (YOLO/tmux fingerprinting), the ANT Terminal must rely on heuristics. We can't guarantee a noise-free experience because we don't have perfect boundaries. 
- **The Raw Terminal is the great equalizer.** Whether it's Pi emitting JSON or Qwen dumping raw text, the Raw Terminal must capture it all flawlessly. 

### Addressing the SQLite vs. Markdown Debate
James suggested appending to a Markdown file and parsing it with regex for display. While creative, this is essentially building a slow, fragile database on top of text files.

**Why SQLite (`run_events`) is superior for the "Cool AF" goal:**
1. **Speed & Pagination:** Parsing a multi-megabyte Markdown file on the fly to render a UI is too slow. SQLite gives us instant pagination of events.
2. **Structured Rendering:** A `run_event` row with `kind: 'agent_prompt'` and a JSON payload is trivial to map to a Svelte component (`<PromptCard {...payload} />`). Trying to parse that state out of a Markdown string using regex introduces massive fragility.
3. **The Log is not the UI:** DeepSeek's pitch (JSONL canonical log -> SQLite projection -> Svelte UI) is the correct architecture. The database *is* the intermediate step that filters the noise so the UI can be fast and clean. We don't need a new Markdown format; we just need to use the `run_events` table properly to drive the Svelte components.

## R1 Addendum - AI CLI Integration Surfaces (antcodex)

Date: 2026-05-02

Scope: James expanded the required CLI coverage beyond Claude Code / Gemini CLI / Codex CLI to include Qwen, Pi, Copilot, Perspective, and Hermes. This audit focuses on the tools already visible locally plus current primary docs where available. Perspective and Hermes are installed locally but have no ANT driver yet, so they are included as new-driver targets.

### Installed Versions Observed Locally

| CLI | Local version / binary evidence | Current ANT driver/docs |
|---|---|---|
| Claude Code | `claude --version` -> `2.1.118 (Claude Code)` | `docs/agent-setup/CLAUDE.md`, `src/drivers/claude-code/` |
| Codex CLI | `codex --version` -> `codex-cli 0.128.0` | `docs/agent-setup/CODEX.md`, `src/drivers/codex-cli/` |
| Gemini CLI | `gemini --version` -> `0.38.2` | `docs/agent-setup/GEMINI.md`, `src/drivers/gemini-cli/` |
| Qwen Code | `qwen --version` -> `0.15.4` | `docs/agent-setup/QWEN.md`, `src/drivers/qwen-cli/` |
| GitHub Copilot CLI | `copilot --version` -> `GitHub Copilot CLI 1.0.40` | `docs/agent-setup/COPILOT.md`, `src/drivers/copilot-cli/` |
| Pi / shittycodingagent | `pi --version` -> `0.70.6`; binary is `@mariozechner/pi-coding-agent` | `docs/agent-setup/PI.md`, `src/drivers/pi/` |
| Perspective | Homebrew `techopolis/tap/perspective` 0.3.0; `/opt/homebrew/bin/perspective` | `src/lib/cli-modes.ts` slug only; no driver |
| Hermes | `Hermes Agent v0.12.0 (2026.4.30)`; `/Users/jamesking/.local/bin/hermes` | no slug/driver yet |

### Three Integration Modes

The architecture should name three modes, not two. These are event-source modes, not permanent labels for an agent. A single CLI can emit high-trust hook events and still need raw terminal fallback for things the hook did not report.

1. **Structured JSONL/RPC**
   - Best example: Pi / shittycodingagent.
   - Contract: newline-delimited JSON commands/responses/events over stdio.
   - Trust: `high` when schema-validated and correlated to the session.
   - UI effect: render direct tool/activity/status blocks without regex guessing.
   - Track 2 effect: raw terminal remains audit trail, but the rich view should not replay JSON noise as the primary UX.

2. **MCP-or-hook surface**
   - Examples: Claude Code hooks, Gemini CLI hooks, Copilot via ant-channel MCP, Hermes via hooks/MCP/ACP, and potentially current Codex CLI if we wire its newer Hooks/MCP surface.
   - Contract: lifecycle/tool events arrive out-of-band from the PTY through configured hooks, HTTP callbacks, MCP tools, or ACP.
   - Trust: `high` for signed/local configured hooks; `medium` for generic shell hooks unless payload and session identity are validated.
   - UI effect: render clean prompt cards, tool-call cards, and status badges from structured payloads while leaving terminal bytes untouched.
   - Track 2 effect: hook failure must never compromise raw terminal capture.

3. **Tmux/regex fallback**
   - Examples today: Qwen, Codex local driver, Perspective initial integration, any unsupported CLI.
   - Contract: classify visible terminal text with driver-specific regexes and state machines.
   - Trust: `medium` at best, `raw` when only bytes are known.
   - UI effect: render conservative blocks with escaped text, confidence indicators, and a one-click raw transcript link.
   - Track 2 effect: this mode depends completely on a rock-solid raw terminal and stable scroll/replay.

Rule: timestamps are required signal on every event. Status is also required, but it belongs on a separate current-state surface rather than as timestamped timeline noise.

### Existing-Tool Matrix

| Tool | Current ANT posture | Primary docs / local evidence | Trust tier mapping | Product implication |
|---|---|---|---|---|
| Claude Code | Best current hook model. ANT already has `/api/hooks` receiver and `claude-code` driver. | Anthropic docs describe lifecycle hooks configured in JSON settings, including command/HTTP/prompt/agent handlers, JSON input, and structured decisions. Local driver handles Claude TUI prompts and permission cards. Sources: `src/routes/api/hooks/+server.ts`, `src/drivers/claude-code/`, https://docs.anthropic.com/en/docs/claude-code/hooks | `high` from native hook payloads; `medium` from terminal classifier fallback. | First rich prompt-card prototype should target Claude approval prompts because the hook/terminal pair can prove both pretty UX and raw audit fidelity. |
| Gemini CLI | Native hooks via `.gemini/settings.json`; local driver supports hook-active mode and terminal fallback. | Gemini docs define JSON settings files and hook events such as `BeforeTool`, `AfterTool`, `BeforeAgent`, `AfterAgent`, `SessionStart`, `SessionEnd`, and `BeforeToolSelection`. Local setup forwards hooks to `/api/hooks`. Sources: `docs/agent-setup/GEMINI.md`, `src/drivers/gemini-cli/`, https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/configuration.md, https://github.com/google-gemini/gemini-cli/blob/main/docs/hooks/writing-hooks.md | `high` when configured hooks are active; `medium` from terminal fallback. | Strong support path for clean tool/status cards. Keep local caveat: the probed Gemini 0.37.0 driver found no Claude-style per-tool approval TUI, so don't invent prompt cards where Gemini itself does not pause. |
| Codex CLI | Local ANT driver is currently tmux/regex. Current OpenAI docs now list richer CLI surfaces including hooks and MCP, so the local driver may be behind the product. | Local version is 0.128.0; local docs say no native hook system and rely on fingerprinting. OpenAI developer docs now list Hooks, MCP, approvals, subagents, non-interactive mode, and app/server automation areas. Sources: `docs/agent-setup/CODEX.md`, `src/drivers/codex-cli/`, https://developers.openai.com/codex/cli | Treat as `medium` until current Codex hooks/MCP are verified and wired; then upgrade specific events to `high`. | Do not lock Codex into the fallback bucket. Next research/test should validate current `codex` hook/MCP support and whether ANT can subscribe without fighting the TUI. |
| Qwen Code | Tmux/fingerprint today, usually launched in YOLO/approval bypass mode against local Ollama or cloud Qwen. | Qwen docs describe `--yolo` / `--approval-mode yolo`, `auto-edit`, `plan`, sandbox behavior, and prompt/non-interactive examples. Local ANT setup states no native hook API and uses terminal fingerprinting. Sources: `docs/agent-setup/QWEN.md`, `src/drivers/qwen-cli/`, https://qwenlm-qwen-code.mintlify.app/cli/overview, https://github.com/QwenLM/qwen-code/blob/main/docs/users/configuration/settings.md | `medium` from regex classifier; `raw` for unclassified output. | Qwen is the must-pass test for fallback quality. If ANT Terminal is readable with Qwen, the raw-terminal foundation is probably strong enough for unknown CLIs. |
| Pi / shittycodingagent | Best structured stdio target. Use for open-source models; do not treat as a generic Pi product. | Pi docs and local help expose `--mode json`, `--mode rpc`, `--provider`, `--model`, session controls, extensions, skills, and JSONL event streams. RPC docs define commands, responses, events, strict LF framing, `get_state`, tool events, compaction, session stats, and bash commands. Sources: `docs/agent-setup/PI.md`, `src/drivers/pi/`, https://pi.dev/docs/latest/rpc, https://pi.dev/ | `high` for schema-validated JSON/RPC; `medium` if run in plain TUI mode. | Pi should be the first proper structured transport adapter. Keyboard emulation is the wrong abstraction for RPC mode; ANT should drive Pi through JSON/RPC and mirror the raw terminal only for audit. |
| GitHub Copilot CLI | Local driver is tmux capture plus optional ant-channel MCP/shell-hook upgrade path. | GitHub docs describe interactive and programmatic CLI modes, MCP server customization, `--allow-all` / `--yolo`, allow/deny tool rules, and env vars such as `COPILOT_ALLOW_ALL`. Local setup already documents optional `ant-channel` MCP. Sources: `docs/agent-setup/COPILOT.md`, `src/drivers/copilot-cli/`, https://docs.github.com/copilot/concepts/agents/copilot-cli/about-copilot-cli, https://docs.github.com/copilot/reference/cli-command-reference | `medium` from terminal classifier; `high` for events routed through trusted ANT MCP/hook channel. | Copilot proves the MCP-or-hook mode: ANT can become a structured surface by being a tool/server the agent already knows how to call. |
| Perspective | Installed locally, but only present in ANT as a cli-mode slug. No driver/docs in repo. | Homebrew says PerspectiveCLI is a Swift CLI for Apple Foundation Models and MLX. Local help shows one-shot `--prompt`, streaming for Foundation Models, interactive REPL, `--tools` for FM, and adapter support. Source: https://github.com/techopolis/PerspectiveCLI | Start `raw`/`medium` only after a fingerprint driver exists. | Treat as new-driver work. Likely first milestone: one-shot capture and REPL prompt detection, not rich tool cards. |
| Hermes | Installed locally, but no ANT slug/driver yet. | Local help shows `chat`, `hooks`, `mcp`, `acp`, `sessions`, `dashboard`, `--oneshot`, `--yolo`, and toolsets. Hermes docs describe CLI sessions stored in SQLite, tool progress display, hooks, MCP server mode, and ACP server mode that streams chat, tool activity, file diffs, terminal commands, approvals, and response chunks. Sources: https://hermes-agent.nousresearch.com/docs/user-guide/cli, https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp, https://hermes-agent.nousresearch.com/docs/user-guide/features/acp/, https://hermes-agent.nousresearch.com/docs/user-guide/features/hooks/ | Clean slate: `raw` until driver exists; likely `high` via ACP/MCP/hook once wired. | Hermes is not merely another regex terminal. Its ACP/MCP surfaces may make it a high-trust structured agent if ANT integrates at that layer. |

### Architecture Updates To Carry Into R4

1. **Add `mcp` as a first-class event source.** Current local types use `hook | json | terminal | status | tmux`. Copilot and Hermes show that MCP-as-hook is distinct enough to name. The source enum should become `hook | json | rpc | mcp | acp | terminal | status | tmux` or an equivalent structured shape.

2. **Trust belongs to an event, not an agent.** Example: Copilot terminal output is `medium`, but an `ant-channel` MCP payload with verified room/session identity can be `high`. Hermes terminal output is `raw`, but ACP tool events can be `high`.

3. **The rich ANT Terminal should project from structured events first, terminal classifications second, raw bytes last.** This is how it stays easy to read without lying about certainty.

4. **The Raw Terminal must remain byte-faithful across every mode.** Pi JSON/RPC, Claude hooks, Copilot MCP, and Hermes ACP are all convenience surfaces. If they drop or reorder data, the raw transcript is the appeal court.

5. **Timestamps stay.** They are audit signal. Render relative/clock time in the block header and full ISO in expanded/hover detail; keep status in a separate current-state area.

### Immediate Testable Claims

1. Pi can be driven headlessly with `pi --mode rpc --no-session`; `get_state` and event streams should populate `run_events` without requiring terminal regex.
2. Copilot can be upgraded from `medium` to partial `high` by routing ANT messages through the existing `ant-channel` MCP path, while preserving raw terminal capture.
3. Codex current local version 0.128.0 needs a fresh probe for Hooks/MCP before we classify it permanently as regex-only.
4. Qwen should remain the fallback benchmark: no native hook assumption, no rich rendering unless a structured payload is proven.
5. Perspective and Hermes need driver registration work, but Hermes should be evaluated for ACP/MCP before a regex-first driver is built.

## R1 Addendum Extension — Perspective & Hermes Local Internals (@antclaude)

Date: 2026-05-02

Building on @antcodex's R1 Addendum. Verified locally with `--help`, `--version`, brew info, and inspection of project repos. Adds internals that affect driver design.

### Perspective (techopolis/PerspectiveCLI v0.3.0)

**Origin**: Homebrew tap `techopolis/tap`, MIT, Swift CLI. Standalone-binary sibling of Perspective-Server (a macOS menu-bar app exposing Apple Foundation Models as an OpenAI-compatible local HTTP API). Apple Silicon, macOS only.

**Local binary**: `/opt/homebrew/Cellar/perspective/0.3.0/bin/perspective` (symlinked from `/opt/homebrew/bin/`). Built from source 2026-04-18.

**Backends**:
- `--fm` — Apple on-device Foundation Models (Apple Intelligence). 100% local, no network.
- `--mlx -m mlx-community/<model>` — local MLX inference (e.g. `mlx-community/gemma-3-4b-it-4bit`).

**Capabilities**:
- One-shot: `--prompt "..."` returns clean stdout, no banner.
- REPL: omit `--prompt`.
- `--stream` (FM only). `--tools` (FM only). `--adapter <path>` for `.fmadapter` files.
- `--temperature` (FM 0.0-1.0 / MLX 0.0-2.0). `--system "..."` for system prompt.

**Integration class** (refining @antcodex's first-pass):
- REPL or `--prompt` without `--tools`: tmux/regex fallback. Plain text in/out.
- `--tools` mode: **probe-gated, not structured-by-default**. Foundation Models tool calling has an internal schema in Apple's framework, but the CLI may surface tool calls only via internal callbacks rather than stdout/stderr structured emission. Until a probe with a defined tool confirms structured-event emission, treat as tmux/regex fallback.

**Recommended driver shape**:
- Single-mode driver: `perspective` (regex, like qwen). One-shot for stateless ANT calls; persistent REPL for multi-turn observation.
- Upgrade path: if the `--tools` probe (open question below) confirms structured stdout/stderr emission, add a second driver mode that parses it. Until then, do not promise structured events.
- Privacy boundary: 100% on-device. Useful where outbound network isolation matters.

**Open question for next probe**: does `perspective --fm --tools --prompt` emit structured tool-call output, or is tool calling internal-only?

Source: https://github.com/techopolis/PerspectiveCLI

### Hermes (NousResearch/hermes-agent v0.12.0)

**Origin**: Nous Research. Local copy is 2026-04-30 release. Python 3.11.11, OpenAI SDK 2.33.0.

**Local binary**: `/Users/jamesking/.local/bin/hermes`. Project: `/Users/jamesking/.hermes/hermes-agent/` (~12k LOC AIAgent + ~11k LOC HermesCLI per local AGENTS.md).

**Subcommand surface (40+ subcommands, structural surfaces highlighted)**:
- Core: `chat`, `model`, `setup`, `auth`, `status`, `config`, `version`, `update`, `login`, `logout`.
- **Structured**: `acp` (Agent Client Protocol server), `mcp` (MCP server), `hooks` (shell-script hooks), `webhook`, `tools`.
- Persistence: `sessions`, `memory`, `backup`, `import`, `dump`.
- Skills/plugins: `skills`, `plugins`, `curator`.
- Multi-platform: `gateway`, `whatsapp`, `slack` (gateway also adapts telegram/discord/signal/matrix/feishu/email/sms/etc.).
- Productivity: `cron`, `kanban`, `dashboard` (web UI), `insights`.
- Identity: `pairing`, `profile` (multiple isolated Hermes instances).

**Critical project subdirectories** (verified in local AGENTS.md):
- `acp_adapter/` — ACP server. Streams chat, tool activity, file diffs, terminal commands, approvals, response chunks.
- `tui_gateway/` — Python JSON-RPC backend driving the Ink/React TUI. Same structural class as Pi `--mode rpc`.
- `agent/` — provider adapters, memory, caching, compression.
- `tools/` — auto-discovered via `tools/registry.py`. `tools/environments/` provides 6 terminal backends (local/docker/ssh/modal/daytona/singularity).
- `gateway/` — messaging gateway with platform adapters.
- `plugins/` — plugin system: memory providers (honcho/mem0/supermemory), context engines, dashboard, image-gen.
- `hermes_state.py` — `SessionDB` with **SQLite + FTS5 search**. *Parallels ANT's own architecture*.
- `hermes_constants.py` — `get_hermes_home()` profile-aware paths.

**Integration class — hits all three simultaneously**:
- structured JSONL/RPC via `tui_gateway` Python JSON-RPC.
- MCP-or-hook via `hermes mcp` / `hermes acp` / `hermes hooks` / `hermes webhook`.
- tmux/regex fallback via `hermes chat` or `hermes -z PROMPT` (oneshot, clean stdout).

**Recommended driver shape (priority order)**:
1. `hermes acp` — ANT speaks ACP to Hermes. Trust `high`. Streams structured events. Flagship target; also keeps ANT compatible with VS Code / Zed / JetBrains agent integrations.
2. `hermes mcp` — ANT calls Hermes's tools via MCP. Useful if ANT wants Hermes-as-toolprovider (skills, memory).
3. `hermes hooks` — native shell-script hooks for lifecycle events.
4. `hermes -z PROMPT` (oneshot) — clean-stdout pipe. Trust `medium`. Good for non-interactive automation.
5. `hermes --tui` — visual fallback if structured paths fail.

**Why Hermes is the flagship validation target**:
- Only CLI on the list with all three integration modes natively.
- ACP is a fourth protocol surface (alongside JSONL/RPC, MCP, hooks) growing in IDE adoption — being ACP-aware future-proofs ANT against IDE/agent convergence.
- Hermes's `SessionDB` (SQLite + FTS5) mirrors ANT's persistence model — long-term, cross-mounting sessions or shared search becomes plausible.
- Hermes's multi-platform gateway parallels ANT's existing chat-room architecture; the two could share gateway primitives later.

**Open questions for R3 challenge**:
- Should ANT *consume* Hermes's ACP stream, or should ANT *be* an ACP server that Hermes connects to? Different implications for who initiates and who owns identity.
- Hermes's `profile` mechanism allows isolated instances. Should an ANT session correspond 1:1 to a Hermes profile, or multiplex?

Sources:
- https://github.com/NousResearch/hermes-agent
- https://hermes-agent.nousresearch.com/docs/user-guide/features/acp/
- https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp
- https://hermes-agent.nousresearch.com/docs/user-guide/features/hooks/

### Combined Implications For R4

1. **Pi RPC adapter (testable claim #1) + Hermes ACP adapter together prove the structured-CLI pattern.** Two implementations, two protocols, architecturally identical shape: ANT subscribes to typed events, renders trust-high blocks. If both work, the pattern generalises.

2. **Perspective is NOT flagship-class.** Useful local-private fallback for Apple-Silicon users who want zero-network AI. Driver work is real but lower priority than Pi/Hermes.

3. **Codex CLI re-probe (testable claim #3) is the highest-leverage audit.** If Codex 0.128.0 has shipped Hooks/MCP since the local driver's probe date, ANT moves it from medium-trust regex to high-trust hooks — a one-CLI win that lifts overall trust-tier coverage.

4. **ACP is the fourth protocol worth naming.** Endorses @antcodex's R4 architecture update #1: the source enum should add `acp` alongside `mcp`, `rpc`, `hook`.

---

## R4 — Decision Output (Synthesis)

Date: 2026-05-02

This section converts the R1/R2/R3 work into decisions the team can act on. Top-level convergence, Non-negotiables, Source-of-truth architecture, Track 1 decisions, Milestones (top-line), and Deferred bets by @antclaude. Track 2 decisions, Integration-mode matrix, and acceptance-test rigor by @antcodex.

### 1. Non-Negotiables

These rules override any aesthetic, convenience, or performance consideration. Every other decision in this plan respects them.

- **The Raw Terminal is byte-faithful.** No structured layer can drop, reorder, or summarise PTY bytes. The raw transcript is the appeal court for every interpreted layer. If a structured render contradicts the raw bytes, the raw bytes win.
- **Timestamps are required signal on every event.** Render relative + clock time in the block header; full ISO on hover or in expanded view. Time is audit signal, not chrome.
- **Trust:'raw' bytes never render as rich content.** Hardcoded renderer rule. Any change requires a PR that explicitly modifies the renderer rules file — no inline overrides.
- **Status displays separately from the timeline.** Connection state, focus mode, capture state — none of these are timestamped events in the main flow. They live on a discreet badge or side rail.
- **The user's intent is the main grid.** What the human typed (or the agent invoked) is prominent and grounded. Output is supporting evidence — smaller, dimmer, indented. Agent chatter sits in a sidebar, not in the flow.
- **Trust belongs to events, not agents.** The same agent can emit `trust:'high'` ACP events and `trust:'medium'` regex-classified terminal output in the same session. The render layer respects the per-event tier; structured layers cannot upgrade raw bytes.
- **No code is shipped from ANTstorm.** ANTstorm is discussion/research only. Implementation lives in localANTtasks under @antcodex with @gemma4local validating small testable claims.

### 2. Source-of-Truth Architecture

**Canonical truth = append-only JSONL event log per session on disk.** Every typed event (command, prompt, artifact, exit, OSC 133 hook, agent tool call) is one line, with payload and raw byte offset back into the transcript chunk stream. The log is the only artifact that cannot be lost or rebuilt from elsewhere.

**SQL is a derived index, not the system of record.** `run_events`, `command_events`, and FTS5 indices are projections rebuilt from the log on server startup. Runtime writes go through a single `writeLogAndProject()` function — never two independent code paths — so projections cannot diverge from the log.

**Markdown is a derived view.** The same log is rendered through a markdown projector for export, sharing, git-tracking, or human reading outside the UI. Live agents do not append to a markdown file; the file is regenerated from the log on demand.

**Artifacts are content-addressed.** Images, screenshots, and full outputs above N bytes are stored once by SHA-256, served via `/api/artifacts/:hash`, referenced by hash from `run_events.payload`. Per-session relationships are a relational tag (join table or `session_id` column on the artifact record), not the primary key — so cross-session reuse and dedup work for free. Endorses @gemini's R3 recommendation.

**Retention policy** (from @gemini R3): media artifacts TTL 7 days unless pinned; text artifacts FTS5-indexed and follow the existing 30-day pruning lifecycle; `idle-tick.ts` sweeps expired artifacts during background polling.

### 3. Track 1 Decisions — ANT Terminal (Rich, Quiet, Readable)

**a. `run_events` is the primary interpretative projection.** No new storage island. CommandBlock renders from a `run_event` object (with `kind`, `payload`, `trust`, `raw_ref`), not flat props. Existing `run_events.kind` enum extended initially with three kinds: `command_block`, `agent_prompt`, `artifact`. A fourth kind requires proof the existing three cannot cover the case.

**b. Rich content via `/api/artifacts/`, never PTY.** Inline graphics protocols (Sixel, Kitty graphics, iTerm2 OSC 1337) are NOT enabled in Phase 1. tmux `allow-passthrough` stays OFF. Images, screenshots, plots arrive via tool-call pipelines, stored content-addressed, referenced by hash. Native `<img>` rendering in the Svelte ANT Terminal layer. The Raw Terminal never receives injected placeholder bytes; if a placeholder is shown there, it is a UI annotation derived from an artifact event and anchored by `raw_ref` / byte offset. The transcript chunk stream remains the exact PTY bytes. If a CLI itself prints `[image: ...]`, that text is preserved as normal raw output.

**c. Inline overlay prompt cards anchored to scroll position.** When a registered agent emits a structured prompt (Pi RPC, Hermes ACP, Claude Code hooks), render an overlay card at the prompt's position in the output stream. The overlay exists only in the ANT Terminal layer; it is not written to the terminal buffer. Click -> keystrokes injected via existing `respondToPrompt`, and those keystrokes are then visible in the Raw Terminal as normal PTY input. Linked Chat receives a compact notification, not the interactive UI — spatial context stays in the terminal.

**d. Cool-AF visual rules.** Hide chrome by default (timestamps stay readable but compressed: relative + ISO on hover). Compress aggressively (long npm install collapses to one-line summary; click to expand). One typeface, two weights, two sizes — restraint over badges. Motion that means something (running pulses, failure pings once, completed settles). No status babble in the output stream.

**e. Sanitised renderer.** Markdown via a sanitising library (e.g. `marked` with `sanitize: true`, post-processed by `dompurify`); no raw HTML passthrough. Image URLs only from `/api/artifacts/`; never arbitrary URLs from PTY output. Trust-tier-locked: `trust:'high'` renders rich; `trust:'medium'` renders structured blocks with escaped text; `trust:'raw'` never rich.

**f. Raw Terminal is one tab/click away.** Default view = clean blocks. Raw Terminal is the escape hatch for unfiltered evidence. This is the inverse of Warp's "raw-with-block-overlays" default — ANT optimises for *humans observing agent activity*, not *humans reading their own terminal output*.

### 4. Track 2 Decisions — RAW Browser Terminal

The Raw Terminal is the evidence surface. It should feel smooth, but its first job is to be boringly faithful: no dropped bytes, no duplicate replay, no scroll jumps that change what the user thinks happened.

**a. xterm.js is the live-tail renderer, not the transcript database.** xterm owns the active screen, alternate screen, selection, cursor, and the last bounded scrollback window needed for current work. It does not own deep history. Deep replay into xterm is capped because stuffing a full multi-hour session back through the emulator is the scroll/flicker trap.

**b. Canonical log + SQLite own transcript/search.** Full raw output is persisted as append-only transcript chunks with byte offsets, projected into SQLite/FTS for search and into the ANT Terminal for readable blocks. Deep history is viewed through a virtualized transcript reader, not by rehydrating all bytes into xterm.

**c. tmux is recovery/control, not the source of truth.** tmux keeps processes alive and can fill bounded reconnect gaps with `capture-pane -e -J`, but tmux scrollback is not canonical history. Reconnect reconciliation writes explicit `source:'tmux'`, `trust:'raw'` recovery events and records the byte range/gap it filled.

**d. Explicit scroll-anchor states.**
- `following`: viewport is at bottom; new bytes append and remain visible.
- `user_scrolled`: user moved off bottom; new bytes append without yanking the viewport; show unread count + jump-to-live affordance.
- `replaying`: bounded history replay in progress; live writes queue behind replay or go to a separate pending buffer; no auto-follow until replay completes.
- `alt_screen`: app owns alternate screen; main scrollback is frozen and restored on exit without dumping alternate-screen frames into main history.
- `hidden`: tab/window is hidden; server buffers and client renders on visibility return; no background repaint loop.

**e. Split policy for live vs deep history.** On initial attach, xterm receives the active screen plus bounded recent scrollback only. The transcript panel and ANT Terminal can page arbitrarily deep through SQLite/FTS. On reconnect, replay starts from the last acknowledged raw offset; if the offset is unavailable, use a bounded tmux capture and mark the uncertainty.

**f. Backpressure is explicit.** The browser emits `terminal_throttle` when write-queue length, frame time, or hidden-tab buffering crosses threshold. The server responds with tmux `%pause` / `%continue` in control mode where available, otherwise it buffers PTY writes server-side. Dropping bytes is never a valid throttle strategy.

**g. Renderer policy.** DOM renderer remains default. WebGL ships behind a feature flag and loads only after `document.fonts.ready`; on `webglcontextlost`, fall back to DOM and emit a status event outside the timeline. Verification includes canvas nonblank checks and screenshot comparison across desktop and mobile.

**h. Graphics passthrough policy.** tmux `allow-passthrough` stays OFF by default. Phase 1 does not rely on Sixel, Kitty graphics, or iTerm2 OSC 1337. Phase 2 can enable passthrough only behind an explicit setting plus regression tests proving scrollback, `capture-pane -e -J`, resize, and reconnect remain stable.

**i. Failure modes to test directly.** Duplicate replay after reconnect; missing bytes during throttling; scroll jumps while user is reading; alt-screen corruption after `vim`/`less`/TUI apps; font/WebGL first-paint race; hidden-tab burst replay; xterm clear-screen flicker; tmux capture truncation; mobile viewport resize/SIGWINCH drift.

Decision: Track 2 is not a fallback implementation detail. It is the contract that lets Track 1 be beautiful without becoming misleading.

### 5. Integration-Mode Matrix

Event source enum should extend to: `hook | json | rpc | mcp | acp | terminal | status | tmux`. `trust` is assigned per event, not per CLI.

| CLI | Structured JSONL/RPC | MCP-or-hook surface | ACP | tmux/regex fallback | Decision |
|---|---|---|---|---|---|
| Claude Code | No primary JSONL/RPC lane | Native hooks; ANT `/api/hooks` already exists | No | `claude-code` driver | Use as first prompt-card proof because hook + raw terminal can be compared directly. |
| Gemini CLI | No primary JSONL/RPC lane | Native hooks via `.gemini/settings.json` | No | `gemini-cli` driver | Use hooks for tool/status cards; do not invent approval cards where Gemini does not pause. |
| Codex CLI 0.128.0 | Unknown current surface | Current OpenAI docs list Hooks/MCP; local driver still regex-era | Unknown | `codex-cli` driver | Highest-leverage re-probe. If hooks/MCP work locally, lift specific events to `high`; otherwise keep fallback. |
| Qwen Code | No proven structured lane | No native hook surface in local setup | No | `qwen-cli` driver | Fallback benchmark. If Qwen is readable and stable, unknown CLIs are likely covered. |
| Pi / shittycodingagent | Strong `--mode json` / `--mode rpc` lane | Extensions possible, not needed first | No | Plain TUI fallback | M4 target. Drive through RPC; raw transcript mirrors stdio for audit. |
| GitHub Copilot CLI | Programmatic prompt mode exists; not enough for live event stream | MCP via `ant-channel`, shell hooks, GitHub tool allow/deny model | No | `copilot-cli` driver | Treat terminal as `medium`; trusted ANT MCP events can be `high`. |
| Perspective | One-shot stdout only today | `--tools` is probe-gated; not structured by default | No | New regex driver | Lower priority. Ship simple fallback/one-shot first; upgrade only if tool output is proven structured. |
| Hermes | Python JSON-RPC TUI backend internally | `hermes mcp`, `hermes hooks`, `webhook` | `hermes acp` | `hermes chat` / `hermes -z` | M5 target. ANT consumes Hermes ACP first; ANT-as-ACP-server deferred. Map 1:1 ANT session to Hermes profile/session first. |

Protocol priority for new integrations: ACP where available and mature; otherwise JSONL/RPC; otherwise MCP-or-native-hook; otherwise tmux/regex. The fallback path is not second-class: it is required for Qwen, Perspective, current Codex, and every future unknown CLI.

### 6. First 5 Implementation Milestones

Each milestone has a measurable acceptance criterion. @antcodex owns the raw-terminal/integration acceptance-test design; @antclaude owns the Track 1 visual acceptance.

**M1 — OSC 133 shell hooks foundation (Track 2 baseline)**
- Inject `static/shell-integration/ant.{bash,zsh,fish}` via `BASH_ENV` / `ZDOTDIR` / `--init-command` at PTY spawn.
- `pty-daemon` parses OSC 133 A/B/C/D and OSC 1337 CurrentDir, emits `block_event` into `run_events` with `source:'hook'`, `trust:'high'`.
- Acceptance: `ls && false && echo ok` in a fresh session produces exactly three `run_events` rows with kinds `command_block` and exit-code values 0, 1, 0. Verified via `ant terminal events <id>`. The same test must pass through the managed tmux path after browser disconnect/reconnect: no duplicate events, no missing event, monotonic timestamps, non-overlapping raw byte offsets, and visible terminal state matching bounded `tmux capture-pane -e -J` for the active screen.

**M2 — WebGL renderer behind feature flag (Track 2 quick win)**
- Wrap WebGL addon load in `await document.fonts.ready` before `term.loadAddon(new WebglAddon())`.
- Feature flag `RENDERER=webgl|dom` (default `dom`); fallback to DOM on `contextlost`.
- Acceptance: 100k-line burst output renders without main-thread stalls; Chrome DevTools Performance shows ~5× scripting-time reduction vs DOM. Reproduction command: `node -e 'for (let i = 0; i < 100000; i++) console.log(String(i).padStart(6, "0") + " ANT raw terminal burst abcdefghijklmnopqrstuvwxyz")'`. Run DOM and WebGL with the same font, viewport, and scroll position; use Playwright screenshots after idle and compare pixel diff below 0.5% excluding cursor blink, plus xterm serialize output equality for visible rows. No font-glyph corruption or blank canvas on first paint across desktop Safari, Chrome, mobile Safari, and mobile Chrome.

**M3 — CommandBlock visual prototype (Track 1 cool-AF)**
- Render from `run_event` object instead of flat props.
- Sticky header (`position:sticky; top:0`).
- Per-block toolbar: copy command, copy output, re-run, bookmark.
- Hide chrome by default; compress long output to one-line summary with click-to-expand.
- Acceptance: a non-technical viewer skims a 30-minute session and can describe what happened in under 30 seconds without reading any inline timestamps. Status badges live separately from the flow. Owner: @antclaude.

**M4 — Pi RPC structured transport adapter (high-trust integration)**
- Build the transport adapter for `pi --mode rpc` that the existing `PiDriver.ts` parser was designed against.
- Pi events populate `run_events` with `trust:'high'`; CommandBlock renders prompt/tool/approval cards from Pi's structured stream without any regex.
- Acceptance: a Pi session under ANT shows a tool-call card, a prompt card, and an approval card in the ANT Terminal, all from JSONL events; the Raw Terminal shows the byte-perfect record of the same session for audit. Byte-equivalence test: tee every Pi RPC stdin/stdout line to the raw transcript before parsing; replay the parser from raw offsets and assert it reproduces the same `run_events` count, kinds, payload hashes, timestamps order, and `raw_ref` ranges as the live run. Reloading the session must preserve the same raw transcript SHA-256.

**M5 — Hermes ACP integration (validates the structured pattern)**
- ANT consumes Hermes ACP stream as client (ANT-as-ACP-client first; ANT-as-ACP-server deferred).
- 1:1 ANT session ↔ Hermes profile/session mapping.
- ACP events populate `run_events` with `trust:'high'`.
- Acceptance: a Hermes session under ANT shows the same block types (tool-call, prompt, approval) as Pi, populated from ACP events, through the same render path. Cross-protocol equivalence test: feed recorded Pi RPC and Hermes ACP fixtures for the same small task into the projector and assert both normalize to the same `run_events.kind` sequence, trust rules, component variants, timestamp requirements, and artifact/raw-ref semantics. Only `source` (`rpc` vs `acp`) and protocol-native payload fields may differ. If M4 + M5 both pass, the structured-CLI pattern generalises.

### 6.5 M3.5 Implementation Notes — Plan View

Visual target: `docs/plan-view-prototype.html`. This is the design north star for Plan View and the companion target for M3 CommandBlock. The prototype demonstrates the structural rules: side-rail status, sticky headers, milestone cards, two-weight/two-size restraint, and provenance as footnote/evidence rather than body copy.

M3.5 event kinds:

| Kind | Purpose | Cardinality | Mutable? | Render target |
|---|---|---|---|---|
| `plan_section` | Top-level section frame and sticky header. | Many per plan. | Rarely. | Sticky framed section. |
| `plan_decision` | Compact decision row, with provenance footnotes. | Many per section. | Rarely. | Decision row/list item. |
| `plan_milestone` | Work package with owner, status, phase, and expandable body. | Many per plan. | Yes. | Milestone card. |
| `plan_acceptance` | Stable narrative criterion for a milestone. | One primary criterion per milestone. | Rarely. | Quote/gate block inside expanded milestone. |
| `plan_test` | Individual checkable pass/fail row proving the criterion. | Many per milestone. | Yes. | Test checklist row with status and evidence. |

Decision: use separate `plan_acceptance` and `plan_test` kinds. Acceptance is stable narrative; tests are mutable and can be updated independently by local runners such as @gemma4local without rewriting the criterion.

Minimum payload shape:

```ts
type PlanEventPayload = {
  plan_id: string;
  parent_id?: string;
  title: string;
  body?: string;
  order: number;
  status?: 'planned' | 'active' | 'blocked' | 'passing' | 'failing' | 'done';
  owner?: string;
  milestone_id?: string;
  acceptance_id?: string;
  evidence?: EvidenceRef[];
  provenance?: ProvenanceRef[];
};

type EvidenceRef = {
  kind: 'run_event' | 'raw_ref' | 'task' | 'source_url' | 'file';
  ref: string;
  label?: string;
};

type ProvenanceRef = {
  run_event_id?: string;
  fallback?: {
    source?: string;
    author?: string;
    section?: string;
    query?: string;
  };
};
```

Provenance resolution:

1. Prefer exact `run_event_id` when present.
2. If the event was rewritten, projections were rebuilt, or an ID is missing, resolve through fallback query hints (`source`, `author`, `section`, `query`).
3. If both fail, render a degraded provenance footnote with the unresolved label and a warning state. Do not silently drop provenance.

Side rail rule: the right-side status rail does not need `plan_*` events. It is a derived projection over current sessions, task state, recent completions, and registered agent handles. The plan body remains decisions and evidence; live status does not leak into the main timeline.

Acceptance for M3.5:

- Render the R4 Decision Output from `run_events` using `plan_section`, `plan_decision`, `plan_milestone`, `plan_acceptance`, and `plan_test`.
- Match `docs/plan-view-prototype.html` for structural behavior: sticky headers, side-rail status, milestone expansion, provenance footnotes, and restrained typography.
- Updating one `plan_test.status` changes only that checklist row and the derived milestone/side-rail status; it does not rewrite the `plan_acceptance` criterion.
- Every visible provenance footnote resolves to either an exact `run_event_id` or a degraded fallback query result.
- Raw/evidence links remain one click away from every decision, milestone, acceptance criterion, and test row.

### 7. Deferred Bets

Things considered and pushed out, with rationale:

- **Inline graphics protocols (Sixel via xterm-addon-image, Kitty graphics, iTerm2 OSC 1337)** — Phase 2 capability behind feature flag. Requires `allow-passthrough on` in tmux with explicit security review. Phase 1 architecture sidesteps via `/api/artifacts/`.
- **ANT-as-ACP-server (compatibility/export surface)** — defer until ANT-as-ACP-client (M5) is validated. Don't make ANT pretend to be an editor before the UX shape is known.
- **Multiplex multiple Hermes profiles per ANT session** — defer until 1:1 mapping is "boring" (identity, retention, cross-session search all stable).
- **LLM-driven projections (replace deterministic SQL summaries with on-demand LLM views)** — too expensive and non-deterministic to be the default. Available as an opt-in summarise action, not a primary projection.
- **Custom xterm.js replacement (canvas or fully custom renderer)** — only if WebGL behind fonts-ready (M2) AND DOM both fail to deliver acceptable smoothness.
- **Tmux replacement (screen / dtach / abduco / custom PTY shim)** — only if tmux flow control + scroll fixes fail to deliver Track 2's smoothness goals.
- **Codex CLI hooks/MCP integration** — pending re-probe of Codex 0.128.0 (testable claim #3 in @antcodex's R1 Addendum). If the new Codex CLI exposes hooks/MCP, lift it from medium-trust regex to high-trust hooks before M4. If not, stays in M5+ slot.
- **Markdown-first storage (markdown file as source of truth instead of JSONL)** — explicitly considered (per James's storage philosophy) and rejected for the canonical path. Markdown remains a *projection* (export view), not the canonical log. JSONL keeps performance, structured semantics, and SQL projection cheap. Endorses @gemini's R3 hybrid pitch.
- **Perspective `--tools` driver upgrade** — probe-gated. Single-mode regex driver ships first; only upgrade to structured-event parsing if a probe with a defined tool confirms the CLI emits structured stdout/stderr.
- **Inline-overlay prompt cards in the Raw Terminal** — Track 1 only. Raw stays byte-faithful; overlays live in the ANT Terminal layer.

### Delivery Evidence — 2026-05-03 Direct Gate Closure Pass

#### M1 OSC 133 Acceptance Evidence — original @antcodex

Scope: replace stale @gemma4local probe with direct-shell verification, without spawning another model.

- Commit under review: `0d17162` on `delivery/m1-osc133-hooks`.
- Command run: `./node_modules/.bin/vitest run tests/osc133.test.ts` from `../a-nice-terminal-m1-osc133`, using the main checkout `node_modules` as a temporary symlink because worktrees do not carry dependencies.
- Result: PASS — 1 test file, 4 tests passed. Covered prompt-only `D` ignore, A/B/C/D command-block emission, split OSC terminator + OSC 1337 current-dir parsing, and zsh prompt command extraction.
- Earlier live ANT terminal probe before the WS-send fix: BLOCKED, not passed. Created session `ZfkzrRIzvL_x6VEAkjKRr`, but `ant terminal send` failed with `Error: [object ErrorEvent]`; `ant terminal events ZfkzrRIzvL_x6VEAkjKRr --limit 50 --json` returned `count: 0`. Session archived after the failed probe.
- Post-WS-fix live reconnect probe: PASS. Ran an isolated `delivery/m1-osc133-hooks` server from `../a-nice-terminal-m1-osc133` on `http://127.0.0.1:6479` with temporary `HOME=/tmp/ant-m1-probe.Jb8F7Z/home` and `ANT_DATA_DIR=/tmp/ant-m1-probe.Jb8F7Z/ant-v3`, using Node 20.19.4 so native modules matched the daemon/runtime boundary. Session `glSRrKUhU5BcKIn1Bf840` was created fresh.
- Commands run through three separate `ant terminal send` calls, forcing join/send/disconnect cycles on the managed tmux path: `ls`, `false`, `echo ok`. This uses three separate sends rather than literal `ls && false && echo ok` because shell `&&` would stop after `false`; the R4 acceptance expects exit-code sequence `0,1,0`.
- `ant terminal events glSRrKUhU5BcKIn1Bf840 --kind command_block --source hook --limit 20 --json` returned exactly three `command_block` rows with `source:'hook'`, `trust:'high'`, commands `ls`, `false`, `echo ok`, and exit codes `0`, `1`, `0`.
- Event invariants: timestamps monotonic (`1777812047598`, `1777812049252`, `1777812050782`); raw byte ranges non-overlapping (`1856-1986`, `4003-4136`, `5049-5188`).
- Visible state check: bounded `tmux capture-pane -p -e -J -t glSRrKUhU5BcKIn1Bf840 | tail -40` showed `ls`, `false`, `echo ok`, `ok`, then the prompt. This matches the active screen after reconnect.
- Raw transcript side-channel: after waiting for the 30s transcript flush, `ant terminal history glSRrKUhU5BcKIn1Bf840 --limit 20 --raw --json` returned `count: 1`, `size: 5655`, containing the three commands and `ok`.
- Cleanup: isolated server and PTY daemon were stopped, temporary `node_modules` symlink removed, and probe tmux sessions killed. Worktree `../a-nice-terminal-m1-osc133` remained clean.
- Current-HEAD confirmation rerun after the WS fix was cherry-picked onto the M1 branch: PASS. Branch `delivery/m1-osc133-hooks` at `bc545cd` was run on an isolated server at `http://127.0.0.1:6480`, session `VKGm9HzrRWTs1r90cRpKV`. The same three separate sends (`ls`, `false`, `echo ok`) produced exactly three `hook` / `high` `command_block` rows with exits `0`, `1`, `0`; timestamps were monotonic; raw refs were non-overlapping (`891-2030`, `3325-3458`, `4375-4514`); `tmux capture-pane -p -e -J` showed `ls`, `false`, `echo ok`, `ok`, prompt; after the 30s flush, raw history contained the commands and `ok`. Cleanup complete and the worktree remained clean.
- Status: M1 parser/unit evidence plus live managed-tmux reconnect evidence are both PASS. Original @antcodex gate position: M1 can close once the room accepts this evidence.

#### M3 CommandBlock Adversarial Review — original @antcodex

Scope: replace stale @gemini review with direct review of `6e7dc4c` on `delivery/m3-commandblock-ui`.

- Result: FAIL with one contract blocker.
- Finding: [CommandBlock.svelte](/Users/jamesking/CascadeProjects/a-nice-terminal-m3-commandblock/src/lib/components/CommandBlock.svelte:251) renders artifact images from `event.kind === 'artifact'` and `mime.startsWith('image/')` without checking `event.trust`. A `trust:'raw'` artifact event would therefore render rich image content, violating R4 §1 (`trust:'raw' bytes never render as rich content`) and R4 §3e trust-tier-locked rendering.
- Related concern: [CommandBlock.svelte](/Users/jamesking/CascadeProjects/a-nice-terminal-m3-commandblock/src/lib/components/CommandBlock.svelte:238) renders `agent_prompt` option buttons without a trust gate. If a raw-trust prompt-shaped event reaches this branch, it becomes an interactive rich control.
- Narrow fix requested: gate rich artifact rendering and prompt option controls behind explicit non-raw trust policy. `trust:'raw'` should show escaped/plain metadata, raw_ref, and the Raw Terminal escape hint only.
- Non-blocking positives: component now accepts a `RunEvent` object, timestamps remain visible, status is not injected into PTY output, text is Svelte-escaped, artifacts use `/api/artifacts/:hash` rather than PTY bytes, and the visual harness is scoped to the design route.

#### B10 Upload Endpoint Hardening Evidence — @antcodex-dev + @cloud-glm

Scope: security/cost exception advanced ahead of the later UX backlog.

- Commit: `72bac00` on `delivery/b10-upload-hardening`.
- Files: `src/routes/api/upload/+server.ts`, `src/lib/server/uploads/index.ts`, `src/lib/server/db.ts`, `tests/upload-hardening.test.ts`.
- Independent check by original @antcodex: `./node_modules/.bin/vitest run tests/upload-hardening.test.ts` from `../a-nice-terminal-b10-upload-hardening` passed — 1 test file, 5 tests passed, using the main checkout `node_modules` as a temporary symlink.
- @cloud-glm adversarial audit: PASS. Verified existing ANT identity auth, configurable per-handle limits, generous owner defaults, SHA-256 content-addressed filenames, complete upload audit table, and no `MessageInput.svelte` regression.
- Observations only: future uploads-table schema changes need explicit migration handling; SQLite server-time based rolling windows are acceptable for local-disk uploads; tests write real temp files and clean up.
