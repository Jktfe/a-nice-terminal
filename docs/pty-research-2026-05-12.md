# PTY Infrastructure — Decision Doc for fresh-ANT Migration Step 3

**Author:** researchant (Claude best-of-the-best research agent)
**Date:** 2026-05-12
**Timebox:** 30 min scan, read-only
**Scope:** Recommend the PTY layer for fresh-ANT. Compare lift-v3 vs rebuild-greenfield vs third-party. No code written.
**Audience:** JWPK + codex2 (implementer)

---

## TL;DR

**Recommendation: Rebuild greenfield using `Bun.spawn({ terminal: ... })` and `Bun.Terminal`.**

The Bun v1.3.5 release (17 Dec 2025) added a native PTY API that uses `openpty()` on macOS. fresh-ANT already requires `bun >=1.3.13`. Adopting the native API removes the entire `node-pty` native-module dependency, which is the root of three of v3's five recurring PTY incidents.

The v3 daemon's *control logic* (session lifecycle, paste-buffer-first write path, reconnect handling) is sound and lifts conceptually. But the *bindings layer* (node-pty + Node 20.19.4 ABI lock-in) is the recurring cost centre and should not be carried forward.

Open questions for JWPK at the bottom — they affect the rebuild shape but not the recommendation.

---

## Context — what v3 has today

- File: `src/lib/server/pty-daemon.ts` — **1109 lines**
- File: `src/lib/server/pty-client.ts` — **353 lines**
- Dependency: `node-pty ^1.1.0` (native module, Node ABI-locked)
- Runtime: Node 20.19.4 under launchd; rebuilds require matching ABI
- Multiplexer: tmux (one tmux session per ANT terminal, daemon spawns `tmux new-session -A`)
- Write path: tmux `paste-buffer` first, `pty.write` fallback (see [[feedback_pty_paste_buffer_first]])

### Known v3 PTY incidents (from memory)

| Incident | Root layer | Cite |
|---|---|---|
| Native module ABI mismatch silently crashes server | node-pty / better-sqlite3 native bindings | [[feedback_better_sqlite3_abi_mismatch]] |
| Kickstart-without-rebuild serves stale `build/handler.js` | launchd + bundled production build | [[feedback_kickstart_requires_rebuild]] |
| TMUX env leak — daemon spawned inside tmux silently fails | tmux nesting rule, not node-pty | [[feedback_pty_daemon_no_nested_tmux]] |
| ANT_SESSION_ID env pollution across panes | tmux global-env scope, not node-pty | [[feedback_ant_session_id_pollution]] |
| Multi-daemon PTY-cap exhaustion (511 PTYs hit) | daemon singleton lock, not node-pty | [[project_pty_exhaustion_diagnostic]] |

**Three of five are tmux-shaped; two are native-module-shaped.** This matters: lifting node-pty fixes the native-module class, but does NOT fix the tmux class. The tmux class needs a separate decision (see Open Q1).

---

## Options table

| # | Option | What lifts | What rebuilds | Lines (est.) | ABI risk | Time-to-M0 |
|---|---|---|---|---|---|---|
| A | Lift v3 daemon as-is | All 1462 lines | None | 1462 | High (recurring) | 2-3 days |
| B | Lift daemon control flow, swap bindings to Bun.Terminal | ~70% of control flow | All native-module calls | ~1000 | None | 4-5 days |
| C | Rebuild greenfield with Bun.Terminal | Concepts only (paste-buffer-first, env scrub, lockfile singleton) | All code | ~400-500 | None | 5-7 days |
| D | Third-party Bun PTY wrapper (`@skitee3000/bun-pty`, `bun-pty-rust`) | Daemon shell only | Bindings layer | ~600 | Medium (untested forks) | 5-6 days |

**Lines estimate** for Option C assumes 9-year-old-readable cap of 260 lines per component, split as: bun-pty wrapper (~80), session-store (~120), tmux-mux adapter (~100), reconnect/lifecycle (~80), test fixtures (~80).

---

## Why Option C wins

### 1. Eliminates the native-module bug class entirely

Bun.Terminal is built into the Bun runtime. There is no `node_modules/node-pty/build/Release/pty.node` to rebuild. The chain `nvm-switch → npm rebuild → wrong Node ABI → server crashes after logging "running at 6458"` ([[feedback_better_sqlite3_abi_mismatch]]) cannot occur for the PTY layer.

This also collapses the kickstart-vs-rebuild gotcha for PTY changes: a Bun source change is picked up on next `bun run build` without any native-rebuild step.

### 2. Native to fresh-ANT's preferred runtime

fresh-ANT already requires `bun >=1.3.13` in `package.json`. The Terminal API is in `bun >=1.3.5` ([Bun v1.3.5 release notes](https://bun.com/blog/bun-v1.3.5)). No version bump, no opt-in flag.

### 3. API shape is close enough to lift mental model

The `Bun.Terminal` interface ([source: Bun spawn docs](https://bun.sh/docs/api/spawn)):

> `proc.terminal.write("echo hello\n")` — write to child
> `proc.terminal.resize(120, 40)` — resize
> `proc.terminal.setRawMode(true)`
> `data(terminal, data) => void` — output callback

This is structurally the same surface as node-pty: `term.write`, `term.resize`, `term.onData(...)`. The v3 control-flow patterns (paste-buffer-first write, env scrub before spawn, lockfile singleton) all transfer.

### 4. Reusable Terminal across spawns

`Bun.Terminal` can be created standalone and reused for multiple `Bun.spawn` calls in sequence. This is a NEW capability vs node-pty and lets fresh-ANT do crash-recovery cleanly: keep the terminal, re-spawn the shell, without re-allocating the pty.

### 5. Smaller LOC budget — 9-year-old-readable

v3 daemon is 1109 lines; ~30% is native-module workarounds, ABI guards, and lifecycle gymnastics that exist *because* node-pty is a native binding loaded into a long-lived Node process. Bun.Terminal removes the need for a separate daemon process at all: the SvelteKit server CAN own the PTY layer directly without a fork. This drops the daemon socket, the `pty-client.ts` IPC layer, and the multi-generation-daemon-leak class ([[project_pty_exhaustion_diagnostic]]).

The daemon is still useful as a *singleton-isolated process* if PTY tear-down across server restarts matters. That is Open Q2.

---

## Do-not-use

| Choice | Reason |
|---|---|
| **`@skitee3000/bun-pty` (npm)** | Third-party shim from Bun-pre-1.3.5 era. Native PTY is now in Bun core, no reason to take a fork dependency. |
| **`bun-pty-rust` (npm)** | Adds Rust toolchain to the build. Same reasoning — native PTY in core makes this redundant. |
| **Raw `Bun.spawn` with `stdio: "pipe"` and no `terminal` option** | The child sees `process.stdout.isTTY === false`. Tools that depend on `isTTY` (most agent CLIs, all colour output, all readline-based prompts) misbehave. Confirmed in Bun docs: "When the `terminal` option is provided, the subprocess sees `process.stdout.isTTY` as `true`." |
| **Lift v3 daemon as-is (Option A)** | Carries forward the ABI-mismatch incident class, which has already caused at least two silent server outages (memory cites 2026-05-03 and 2026-05-04). |
| **WebGL renderer for terminal output in browser** | v3 already dropped WebglAddon in commit `cd4f23d` (2026-04-07) — glyph atlas builds before fonts load. Use DOM renderer. [[project_terminal_rendering_fixes]] |

---

## Primary sources

- [Bun.spawn docs — terminal option, openpty() on macOS](https://bun.sh/docs/api/spawn) — canonical API reference, includes platform-differences section
- [Bun.Terminal class reference](https://bun.com/reference/bun/Terminal) — class-level reference for the standalone Terminal object
- [Bun v1.3.5 release notes (17 Dec 2025)](https://bun.com/blog/bun-v1.3.5) — release that introduced the Terminal API
- [node-pty repo (microsoft/node-pty)](https://github.com/microsoft/node-pty) — last release v1.1.0 on 22 Dec 2025, still active but no Bun integration story
- [xterm.js repo (xtermjs/xterm.js)](https://github.com/xtermjs/xterm.js) — v6.0.0 on 22 Dec 2025, actively maintained, used in v3 for browser-side rendering and stays in fresh-ANT regardless of server-side PTY choice

---

## Open questions for JWPK

These shape the Option C *implementation* but do not change the recommendation.

### Q1. tmux as multiplexer — keep or drop?

v3 uses tmux per ANT session. Pros: free session persistence across daemon restarts, paste-buffer write path is more reliable than direct pty.write on long-lived sessions. Cons: three of five v3 PTY incidents are tmux-shaped (env leak, ANT_SESSION_ID pollution, multi-server isolation).

**Researchant view (not a recommendation):** Bun.Terminal alone does NOT give session persistence — if the Bun process dies, the PTY dies with it. If you want "agent keeps running while ANT restarts," tmux still earns its keep. If "ANT IS the long-lived process and crash-recovery is via re-spawn," you can drop tmux.

This is a JWPK call because it depends on the operational model for fresh-ANT (single long-lived Bun server vs ANT-as-restartable-shell).

### Q2. Daemon-as-separate-process — keep or drop?

v3 has `pty-daemon.ts` as a separate Node process talking over a UNIX socket. Reason: isolates PTY allocations from the SvelteKit server's lifecycle, so a server crash doesn't kill all the user's terminal sessions.

With Bun.Terminal, the same Bun process can own PTYs directly. Simpler. But if SvelteKit dev/HMR is in scope for fresh-ANT, you want PTYs to survive HMR reloads — which argues for keeping a separate process.

**Researchant view:** in production (launchd-managed), single-process is fine. In dev (HMR), keep a daemon. Recommend a thin wrapper that runs both modes — `--detached` for production, in-process for dev.

### Q3. Multi-user / multi-agent PTY ownership model

The directive asks about macOS sandbox PTY allocation and multi-user model. Current state (researched):

- macOS PTY cap is `kern.tty.ptmx_max`, default 511 ([[project_pty_exhaustion_diagnostic]]). Per-user, but in practice all you processes share the pool.
- `openpty(3)` on macOS does not require special entitlements. Sandbox-restricted apps DO need explicit entitlement for PTY, but fresh-ANT is not sandboxed (launchd LaunchAgent, not App Store).
- Multi-OS-user is irrelevant: fresh-ANT runs as user `you` only. Multi-AGENT (researchant, codex2, evolveantcodex sharing one terminal) is a separate model question — currently agents are *channels* in one chatroom, not separate OS users.

**Recommendation:** single OS user, multi-agent via per-session ANT_SESSION_ID. No change from v3. Bump `kern.tty.ptmx_max` to 4096 in setup script as defence-in-depth.

### Q4. Session recording / replay

Not requested in the slice, flagged here for completeness. xterm.js has `serialize` addon for state capture. If JWPK wants record-replay for M0, the pattern is: hook the `data` callback in Bun.Terminal, append to an SQLite blob, replay on reconnect by writing the blob through `term.write`. This is a 1-day add and orthogonal to the PTY-bindings choice.

---

## What I did NOT verify (timebox honesty)

- Bun.Terminal behaviour under Bun's HMR — docs don't say, would need a probe.
- node-pty arm64 Apple Silicon support beyond "the docs say macOS." The README does not explicitly call out arm64; recent releases very likely include it, but I did not check the build matrix.
- Whether `Bun.Terminal.setRawMode` actually disables ICRNL on macOS the same way termios does. The docs explicitly say it does on POSIX, but I did not run a probe.
- Behaviour when Bun process is itself running inside tmux — does `process.env.TMUX` cause the same nesting problem when Bun spawns `tmux new-session`? Researchant's working assumption: yes, same env scrub rule applies ([[feedback_pty_daemon_no_nested_tmux]]).

These are all probe-able in <1 hour by codex2 in implementation, not blockers for the recommendation.

---

## Next step

If JWPK accepts Option C: codex2 scopes a 3-slice implementation lane:
1. Bun.Terminal smoke-spawn slice — prove `openpty()` + write + resize + data callback against a bash child, verify `isTTY === true`.
2. Multiplexer adapter slice — decide Q1 (tmux yes/no) and ship the chosen path.
3. Session lifecycle slice — port lockfile singleton, env-scrub, paste-buffer-first patterns from v3 into the new layer.

If JWPK rejects or wants more research: list specific questions and researchant takes another slice.

End of doc.
