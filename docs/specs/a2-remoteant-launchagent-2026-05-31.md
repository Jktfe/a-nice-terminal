# A2 — remoteant LaunchAgent (opt-in personal MCP gateway)

**Status**: PRE-STAGED (activates whenever team capacity allows after B2; not gating D1 build+sign+notarize)
**Plan**: `remoteant-mac-delivery-2026-05-29`
**Milestone**: `a2-launchagent` (currently `[planned]`)
**Lead**: @homebrewmainclaude
**Plan momentum**: @homebrewmaincodex
**Implementer**: @kimihomebrewwork
**Anchoring user feedback**: JWPK msg_5if6my8fbl — "[remoteant] needs to install the cli and a remote mcp server for the user… so they can access with claude desktop, chatgpt, claude on mobile etc"
**Source files**: `packages/remoteant/src/install/*` (new dir; `remoteant install` subcommand was stubbed in A1)

---

## 1. A2 Goal

Convert the A1 `remoteant install` exit-64 stub into a working subcommand that:

1. **Writes a LaunchAgent plist** to `~/Library/LaunchAgents/run.ant.remoteant.plist` configured to launch `remoteant --mcp-stdio` on user login.
2. **Loads the agent immediately** via `launchctl bootstrap gui/<uid> ~/Library/LaunchAgents/run.ant.remoteant.plist`.
3. **Verifies the agent is alive** by checking `launchctl print gui/<uid>/run.ant.remoteant` for `state = running`.
4. **Reports next-step config snippets** for Claude Desktop / Cursor / generic MCP clients so the user can wire them up to the now-globally-available remoteant.

After A2, JWPK can run `remoteant install` once (from antchat's Settings UI button OR from a terminal after `brew install remoteant`) and have remoteant available to every MCP client on the system, not just antchat.

Plan's A2 acceptance: *"launchctl load/unload works; daemon respawns on user-login when KeepAlive flag set"*. That's the unblocker.

---

## 2. The Install Subcommand (`remoteant install`)

```bash
# Usage
remoteant install [--launch-agent] [--cli-path /usr/local/bin/remoteant] [--print-mcp-config]
remoteant uninstall [--launch-agent] [--cli-path]
```

`--launch-agent` is the default (A2's main scope). `--cli-path` is a follow-up (symlinks the binary onto PATH; future milestone D2 covers Homebrew which does this automatically). `--print-mcp-config` emits the JSON snippets for popular MCP clients.

The output of a successful `remoteant install` (default flags):

```
✓ LaunchAgent installed at ~/Library/LaunchAgents/run.ant.remoteant.plist
✓ Loaded via launchctl (state: running, pid: 12345)
✓ remoteant is now available to MCP clients globally.

Wire-up snippets:

  Claude Desktop (~/Library/Application Support/Claude/claude_desktop_config.json):
  {
    "mcpServers": {
      "ant": {
        "command": "/path/to/remoteant",
        "args": ["--mcp-stdio"]
      }
    }
  }

  Cursor (~/.cursor/mcp.json):
  { ... same shape ... }

  ChatGPT / Claude mobile: connect via Claude.ai's MCP UI;
  point to the remoteant binary at /path/to/remoteant.

To uninstall: remoteant uninstall --launch-agent
```

---

## 3. The LaunchAgent plist

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>run.ant.remoteant</string>

    <key>ProgramArguments</key>
    <array>
        <string>/path/to/remoteant</string>
        <string>--mcp-stdio</string>
    </array>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
        <key>Crashed</key>
        <true/>
    </dict>

    <key>EnvironmentVariables</key>
    <dict>
        <key>ANT_SERVER_URL</key>
        <string>http://127.0.0.1:6174</string>
    </dict>

    <key>StandardOutPath</key>
    <string>/Users/<UID>/Library/Logs/antchat/remoteant.out</string>

    <key>StandardErrorPath</key>
    <string>/Users/<UID>/Library/Logs/antchat/remoteant.err</string>

    <key>ThrottleInterval</key>
    <integer>10</integer>
</dict>
</plist>
```

Notes:

- The `ProgramArguments` path is the live remoteant binary location at install time (resolved via `which remoteant` OR via the binary's own `process.argv[0]` if invoked directly).
- `KeepAlive` is selective: respawn on crash but NOT on clean exit (otherwise `remoteant uninstall` would race against launchd respawn).
- `ANT_ADMIN_TOKEN` is intentionally NOT set in `EnvironmentVariables` — too sensitive to write to disk in plist. remoteant must read it from the user's Keychain at startup (the same item antchat uses: `run.ant.antchat.admin-token`). This is the cleanest cross-app sharing pattern.
- `ThrottleInterval: 10` prevents respawn storms (max one respawn per 10s).
- `StandardOutPath` / `StandardErrorPath` need to use absolute paths; we substitute `<UID>` at install time.

---

## 4. File Paths

```
packages/remoteant/src/install/
├── index.ts                # Dispatch --launch-agent / --cli-path / --print-mcp-config
├── launch-agent.ts         # Generate + write plist, launchctl bootstrap, verify
├── plist-template.ts       # XML template with substitution placeholders
├── mcp-config-snippets.ts  # Generate Claude Desktop / Cursor / ChatGPT snippets
└── uninstall.ts            # launchctl bootout + rm plist

packages/remoteant/tests/install/
├── launch-agent.test.ts    # Generate plist, write to tmp, assert content
├── plist-template.test.ts  # Snapshot test on rendered XML
└── uninstall.test.ts       # Symmetric undo path
```

---

## 5. launchctl Discipline (per macOS version)

macOS 10.10+ (basically every Mac alive) uses `launchctl bootstrap` / `bootout` (NOT the older `launchctl load` / `unload` which is deprecated but still works on intel).

```ts
import { execFileSync } from "node:child_process";

export function loadAgent(plistPath: string): void {
  const uid = process.getuid?.();
  if (typeof uid !== "number") throw new Error("Cannot resolve uid for launchctl");
  execFileSync("launchctl", ["bootstrap", `gui/${uid}`, plistPath], { stdio: "inherit" });
}

export function unloadAgent(plistPath: string): void {
  const uid = process.getuid?.();
  if (typeof uid !== "number") throw new Error("Cannot resolve uid for launchctl");
  // `bootout` succeeds even if the service is already gone; suppress the
  // exit code via the `|| true` shell pattern OR catch in JS.
  try {
    execFileSync("launchctl", ["bootout", `gui/${uid}`, plistPath], { stdio: "inherit" });
  } catch {
    // already-not-loaded is fine
  }
}

export function isAgentRunning(): boolean {
  const uid = process.getuid?.();
  if (typeof uid !== "number") return false;
  try {
    const out = execFileSync("launchctl", ["print", `gui/${uid}/run.ant.remoteant`], { encoding: "utf8" });
    return out.includes("state = running");
  } catch {
    return false;
  }
}
```

---

## 6. Acceptance Gates (A2-G1..G7)

| Gate    | Verification                                                                                                            | Evidence                                              |
|---------|-------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------|
| A2-G1   | `remoteant install` (default flags) on a clean machine writes a valid plist to `~/Library/LaunchAgents/run.ant.remoteant.plist` | `cat plist` output, `plutil -lint` pass     |
| A2-G2   | After install, `launchctl print gui/<uid>/run.ant.remoteant` shows `state = running`                                    | `launchctl print` output                              |
| A2-G3   | `ps aux | grep remoteant` shows the launch-agent-spawned remoteant process (not the install subcommand's own process)   | `ps aux` output                                       |
| A2-G4   | Log out + log back in: the remoteant process is automatically respawned by launchd (`RunAtLoad` works)                  | post-relogin `ps aux` capture                         |
| A2-G5   | `kill -9 <remoteant-pid>`: launchd respawns the process within 10s + ThrottleInterval (`KeepAlive Crashed = true`)      | timed ps capture before + 10s + 15s after kill        |
| A2-G6   | `remoteant uninstall` removes the plist + boots out the agent; `launchctl print` returns "could not find service"       | uninstall output + verification command              |
| A2-G7   | `remoteant install --print-mcp-config` outputs valid JSON for at least 2 MCP clients (Claude Desktop, Cursor) — pipe through `jq` and verify | `remoteant install --print-mcp-config | jq .` |

---

## 7. Out of Scope for A2

- The `--cli-path /usr/local/bin/remoteant` symlink (deferred to D2 / Homebrew which handles this for you).
- A2 from inside antchat-Mac's Settings UI (a button that calls the subcommand). Easy follow-up — a few lines of Swift to spawn `remoteant install --launch-agent` and surface the result; not part of A2 spec scope.
- Multi-user / multi-handle: V1 ships ONE LaunchAgent per user account. Multiple identities on one machine = V2.
- Linux SystemD unit / Windows Service equivalents — Mac-first per the original plan.

---

## 8. Risk Notes

**R1 — uid resolution under bun**. `process.getuid()` is Node-standard; bun mirrors it. If `getuid` returns undefined for any reason, the install fails loudly with a clear message — DO NOT fall back to `gui/0` (would install as system-level agent, very wrong).

**R2 — plist absolute path requirement**. launchd requires absolute paths in `ProgramArguments` and `Standard*Path`. The install code must resolve the live remoteant binary to its absolute path BEFORE writing the plist. Use `which remoteant` (from the binary's own `argv[0]` after `realpath`).

**R3 — Keychain access from launchd-spawned process**. When launchd spawns remoteant, it inherits the user's Keychain session — but the access prompts behaviour differs from manually-spawned processes. Verify that remoteant can read `run.ant.antchat.admin-token` from the user's login keychain when launched by launchd. If it can't, the spawn fails 401 (per B1's failure modes). Document the verification step in the PR.

**R4 — Concurrent agent + antchat-spawned remoteant**. If user runs `remoteant install` AND launches antchat-Mac, there are now TWO remoteant processes (LaunchAgent's + antchat's NSTask-spawned). The B1 transport's "single-instance invariant" test (mentioned in the wider E1 spec §"Tests required" item 5) handles this — the second process detects an existing healthy one and exits 0 with a log line. Verify this works under A2.

---

## 9. Handoff Sequence

A2 is NOT on the critical path to "fully wired Mac app". Drop-into-flow whenever team capacity allows:

1. A1 ✓.
2. After B2 closes (so the install subcommand has methods to expose to other clients), @homebrewmaincodex flips `a2-launchagent` → active when capacity allows.
3. @kimihomebrewwork implements `packages/remoteant/src/install/` per §4 + tests per §6.
4. @homebrewmaincodex review + accept + flip done.
5. (Optional follow-up) @homebrewmainclaude posts a small Swift PR adding the "Install LaunchAgent" button to antchat-Mac Settings.

---

**Spec status when this lands**: pre-staged for opportunistic execution. Doesn't gate D1; lights up the third surface of JWPK's personal-MCP-gateway vision once shipped.
