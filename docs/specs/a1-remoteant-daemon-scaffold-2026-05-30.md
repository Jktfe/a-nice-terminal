# A1 — remoteant Daemon Scaffold

**Status**: ACTIVE (proposed 2026-05-30, awaiting plan-state flip by @homebrewmaincodex)
**Plan**: `remoteant-mac-delivery-2026-05-29`
**Milestone (canonical plan id)**: `a1-scaffold` (flipped active by @homebrewmaincodex on plan-state acceptance of this spec; spec title remains "A1 — remoteant Daemon Scaffold" for readability)
**Lead (logic/dev decisions)**: @homebrewmainclaude
**Plan momentum + acceptance gates**: @homebrewmaincodex
**Implementer**: @kimihomebrewwork
**Substrate dependency**: E1 spec ratified at `a-nice-terminal@d4b2b79` — `docs/specs/remoteant-mcp-stdio-adapter-e1-spec-2026-05-28.md`
**Anchoring user feedback**: JWPK msg_5if6my8fbl — remoteant is the user's "personal MCP gateway" with four surfaces (CLI installer / local terminal connect / personal remote MCP server / local daemon supervisor)

---

## 1. A1 Goal

Stand up the bun-native binary scaffold for `remoteant` with:

1. **One executable, four subcommand surfaces** (only one implemented in A1; others stubbed with `not-yet-implemented` exit codes):
   - `remoteant --mcp-stdio` — MCP stdio adapter (A1 ships this end-to-end)
   - `remoteant install` — stubbed (future A2.5 / D2)
   - `remoteant serve` — stubbed (future personal-remote-MCP scope)
   - `remoteant supervise` — stubbed (future local-daemon-supervisor scope)
2. **Stable version identity** via `remoteant --version` returning `remoteant <semver> (<git-sha-short>)` to stdout, exit 0.
3. **MCP `initialize` handshake** that names the implementation as `remoteant` with semver — gates the plan's M0 acceptance.

Out of scope for A1:
- WebSocket / SSE connection to ANT daemon (B1)
- Six JSON-RPC methods beyond `ant.ping` (B2)
- Auth nonces, audit logging (C1/C2)
- Code signing, notarization (D1)
- Homebrew distribution (D2)
- Antchat-Mac NSTask integration (E2 — already scaffolded, awaiting A1 binary)

---

## 2. File Paths

Create under `a-nice-terminal/packages/remoteant/`:

```
packages/remoteant/
├── package.json              # name=@jktfe/remoteant, bin={"remoteant": "dist/cli.js"}, type=module
├── tsconfig.json
├── bunfig.toml               # bun build target = node, format = esm
├── src/
│   ├── cli.ts                # entry point — subcommand router (--mcp-stdio / --version / install / serve / supervise)
│   ├── version.ts            # version string assembly + git sha at build time
│   ├── mcp-stdio/
│   │   ├── adapter.ts        # main loop: readline on stdin, JSON-RPC dispatch, write to stdout
│   │   ├── initialize.ts     # initialize handshake handler (returns { protocolVersion, serverInfo: { name: "remoteant", version } })
│   │   ├── ping.ts           # ant.ping handler (probes :6174/api/health, returns { ok, daemonReachable, daemonUrl })
│   │   ├── methods.ts        # method registry (Map<string, Handler>); A1 registers initialize + ant.ping + tools/list only
│   │   └── errors.ts         # error code map (-32700/-32600/-32601/-32602/-32603/-32001) per E1 §4.4
│   ├── env.ts                # parse ANT_ADMIN_TOKEN, ANT_SERVER_URL, ANT_AS_HANDLE per E1 §5
│   └── log.ts                # rotating file writer at ~/Library/Logs/antchat/remoteant.log per E1 §3.4 / E1-F
├── tests/
│   ├── initialize.test.ts    # spawn cli.ts --mcp-stdio, send `initialize` JSON-RPC, assert response shape
│   ├── ping.test.ts          # send `ant.ping`, assert { ok: true, daemonReachable: bool }
│   ├── version.test.ts       # spawn cli.ts --version, assert stdout matches /^remoteant \d+\.\d+\.\d+ \([a-f0-9]{7,40}\)$/
│   ├── subcommand-stubs.test.ts  # `remoteant install` / `serve` / `supervise` exit with code 64 and print "not yet implemented in A1"
│   └── error-codes.test.ts   # malformed JSON → -32700; unknown method → -32601; missing params → -32602
└── README.md                 # 2-3 paragraph "what is remoteant" + JWPK's personal-MCP-gateway framing
```

The build target produces `dist/cli.js` as a single-file bundle suitable for shipping into the Antchat Mac bundle (`/Applications/Antchat.app/Contents/Resources/remoteant` per E1 §3.1 / E1-A) and for a future Homebrew formula.

---

## 3. Subcommand Surface (cli.ts)

```ts
// cli.ts — argv router
const args = process.argv.slice(2);

if (args.includes("--version") || args.includes("-v")) {
  process.stdout.write(VERSION_STRING + "\n");
  process.exit(0);
}

if (args.includes("--mcp-stdio")) {
  // A1 SHIPS THIS PATH
  return runMcpStdioAdapter();
}

const subcommand = args[0];
switch (subcommand) {
  case "install":
  case "serve":
  case "supervise":
    process.stderr.write(`${subcommand}: not yet implemented in A1\n`);
    process.exit(64); // EX_USAGE — POSIX "command line usage error"
  default:
    process.stderr.write(
      "usage: remoteant --mcp-stdio | remoteant --version | remoteant <install|serve|supervise>\n"
    );
    process.exit(64);
}
```

**Why exit code 64**: distinguishes "you asked for a not-yet-shipped subcommand" from generic failures. Tests assert exactly this code.

---

## 4. MCP `initialize` Handshake — A1 Acceptance Gate

The plan's only A1 acceptance criterion: *"MCP handshake completes; identifies as 'remoteant' with semver in initialize response"*.

### Request (sent by MCP client to remoteant via stdin)

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-06-18",
    "capabilities": { "tools": {} },
    "clientInfo": { "name": "antchat-mac", "version": "0.1.0" }
  }
}
```

### Response (written by remoteant to stdout)

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2025-06-18",
    "capabilities": { "tools": { "listChanged": false } },
    "serverInfo": { "name": "remoteant", "version": "0.1.0" }
  }
}
```

**A1 hard requirements on this response**:
- `result.serverInfo.name` MUST equal `"remoteant"` exactly (lowercase, no namespace prefix).
- `result.serverInfo.version` MUST be a parseable semver string (`X.Y.Z` or `X.Y.Z-pre`).
- `result.protocolVersion` MUST echo the client's `params.protocolVersion` (or negotiate to a compatible version per MCP spec).

After `initialize`, remoteant accepts the standard MCP `notifications/initialized` notification (no response). It also accepts `tools/list` and returns the A1 baseline tool: `ant.ping` only (per E1 §4.5; B2 expands).

---

## 5. Version Identity (--version)

Output format (single line to stdout):

```
remoteant 0.1.0 (1a2b3c4)
```

Where `0.1.0` is `packages/remoteant/package.json`'s `version` field and `1a2b3c4` is `git rev-parse --short HEAD` at build time, captured by the build script and inlined into `src/version.ts`.

**Build-time inlining** (not runtime `git` shell-out) so the binary works in environments without git on PATH (e.g. notarized Mac app bundle).

---

## 6. Env Contract (E1 §5 — locks all E1-B TODOs)

remoteant reads three env vars on startup; all optional with documented defaults:

| Env var            | Required | Default                       | Used for                                              |
|--------------------|----------|-------------------------------|-------------------------------------------------------|
| `ANT_ADMIN_TOKEN`  | A1: no   | (none — `ant.ping` works without it; B2 methods will require it) | Bearer auth on outbound HTTP to `:6174` (B2+) |
| `ANT_SERVER_URL`   | A1: no   | `http://127.0.0.1:6174`       | Base URL for daemon HTTP probes                       |
| `ANT_AS_HANDLE`    | A1: no   | (none — only used for session-cookie endpoints in B2+) | Handle to mint session cookies for           |

A1 does NOT require ANT_ADMIN_TOKEN because the only method A1 ships (`ant.ping`) hits `/api/health`, which is unauthenticated.

**Antchat-Mac's E2 wiring should set ANT_ADMIN_TOKEN and ANT_SERVER_URL on NSTask spawn (per E1 §5.1) — but A1 must not crash if they are absent**, only fail-fast on methods that need them.

---

## 7. Readiness, Shutdown, Logging (locks E1-C / E1-D / E1-E / E1-F)

These are RESOLVED by the E1 spec; A1 just commits to them.

- **E1-C (readiness)**: NO HTTP server in remoteant. Readiness is the MCP `initialize` round-trip + `ant.ping` (stdio). `RemoteantSupervisor.swift` TODO at line 359 should remove the HTTP-port assumption.
- **E1-D (shutdown)**: NO `POST /shutdown` endpoint. Graceful shutdown is SIGTERM, with stdio EOF as the secondary signal. `RemoteantSupervisor.swift` TODO at line 366 should remove the POST-shutdown assumption.
- **E1-E (signal)**: SIGTERM (5s grace), then SIGKILL. Confirmed.
- **E1-F (log)**: remoteant writes its own log at `~/Library/Logs/antchat/remoteant.log`. Antchat-Mac does NOT manage the file; it reads it for diagnostics only (DiagnosticsTab already opens it via `NSWorkspace`). Rotation: 5MB per file, 3-file ring.

---

## 8. Test Shape (vitest in packages/remoteant/tests/)

Each test spawns the built `dist/cli.js` as a child process, exchanges JSON-RPC messages via stdio, and asserts. Pattern:

```ts
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("MCP initialize", () => {
  it("returns serverInfo.name === 'remoteant' with semver version", async () => {
    const child = spawn("node", ["dist/cli.js", "--mcp-stdio"], { stdio: ["pipe", "pipe", "pipe"] });
    const reqId = 1;
    child.stdin.write(JSON.stringify({
      jsonrpc: "2.0",
      id: reqId,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, clientInfo: { name: "test", version: "0.0.0" } }
    }) + "\n");
    const response = await readOneJsonLineFromStdout(child.stdout);
    expect(response.id).toBe(reqId);
    expect(response.result.serverInfo.name).toBe("remoteant");
    expect(response.result.serverInfo.version).toMatch(/^\d+\.\d+\.\d+(-\w+)?$/);
    child.kill("SIGTERM");
  });
});
```

A1 minimum test count: **5 tests** (one per file in `tests/`), all green via `bun test` or `vitest run`.

---

## 9. Acceptance Gates (verifiable, evidence-bearing)

@homebrewmaincodex preloads these as failing tests on plan-state flip. Each must produce diff-evidence (Kim's PR) + smoke-evidence (CI/local run output) before A1 closes:

| Gate  | Verification                                                                                          | Evidence file/output                                  |
|-------|-------------------------------------------------------------------------------------------------------|-------------------------------------------------------|
| A1-G1 | `packages/remoteant/dist/cli.js` exists after `bun run build`                                         | `ls -la packages/remoteant/dist/cli.js` in PR comment |
| A1-G2 | `node dist/cli.js --version` exits 0 with output matching `/^remoteant \d+\.\d+\.\d+ \([a-f0-9]+\)$/` | terminal capture                                      |
| A1-G3 | `node dist/cli.js --mcp-stdio` + initialize JSON-RPC → response has `serverInfo.name === "remoteant"` and semver `serverInfo.version` | vitest output |
| A1-G4 | `node dist/cli.js --mcp-stdio` + `ant.ping` JSON-RPC → response shape `{ ok: true, daemonReachable: bool, daemonUrl: string }` | vitest output |
| A1-G5 | `node dist/cli.js install` exits 64 with stderr `"install: not yet implemented in A1"`                | vitest output                                         |
| A1-G6 | All 5 tests in `packages/remoteant/tests/` pass — zero skipped, zero failing                          | `bun test` final tally                                |
| A1-G7 | Malformed JSON on stdin → error response with `code: -32700`                                          | vitest output                                         |

---

## 10. E2 Follow-Up Once A1 Lands

After A1 closes, @homebrewmainclaude posts the E2 TODO closure spec (a separate doc) that flips:

- `RemoteantSupervisor.swift:114` (E1-B): set env = `ANT_ADMIN_TOKEN` (from Keychain) + `ANT_SERVER_URL = http://127.0.0.1:6174` + `ANT_AS_HANDLE` (active user handle).
- `RemoteantSupervisor.swift:115` (E1-A): change binary path from `Resources/cli/remoteant` to `Resources/remoteant` (per E1 §3.1). One-line change.
- `RemoteantSupervisor.swift:139` (E1-D): DELETE the POST /shutdown logic — replace with stdio-EOF + SIGTERM only.
- `RemoteantSupervisor.swift:146` (E1-E): SIGTERM confirmed (no change needed).
- `RemoteantSupervisor.swift:288–291` (E1-B/E1-C): no `ANT_HTTP_PORT`; remove that env var.
- `RemoteantSupervisor.swift:298` (E1-F): DELETE log-management code (remoteant writes its own log).
- `RemoteantSupervisor.swift:359` (E1-C): replace HTTP `/health` probe with stdio `ant.ping` round-trip.
- `RemoteantSupervisor.swift:366` (E1-D): delete the POST /shutdown probe.

That's roughly a 30-line diff in the supervisor, plus updated tests.

---

## 11. Handoff Sequence

1. **@homebrewmainclaude** (now): publishes this spec (this file) and posts a summary to room g6s4bwanvh.
2. **@homebrewmaincodex** (next): flips `a1-scaffold` → active/claimed in canonical plan; preloads A1-G1..G7 as failing acceptance gates; posts a tight implementation brief to @kimihomebrewwork referencing this doc.
3. **@kimihomebrewwork** (then): creates `packages/remoteant/` skeleton, implements `cli.ts` + `mcp-stdio/adapter.ts` + `mcp-stdio/initialize.ts` + `mcp-stdio/ping.ts` + tests; opens PR with G1..G7 evidence inline; tags @homebrewmaincodex for acceptance review.
4. **@homebrewmaincodex** (review): runs `bun test`, walks G1..G7 evidence, signs off and flips `a1-scaffold` → done.
5. **@homebrewmainclaude** (E2 follow-up): publishes the E2 TODO closure spec; @kimihomebrewwork executes; @homebrewmaincodex accepts; E2 closes.

---

## 12. Non-Goals / Explicit Deferrals

- **Personal remote MCP server** (JWPK msg_5if6my8fbl, surface 3): scaffolded as `remoteant serve` stub returning exit 64. Real implementation is a future milestone — likely after Phase B (transport) so it can reuse the WebSocket layer.
- **CLI installer** (JWPK msg_5if6my8fbl, surface 1): scaffolded as `remoteant install` stub. Real implementation likely intersects D2 (Homebrew formula).
- **Local daemon supervisor** (JWPK msg_5if6my8fbl, surface 4): the supervisor is the antchat-Mac side (RemoteantSupervisor.swift in E2), not a remoteant subcommand. The `remoteant supervise` stub is reserved for a future "supervise other ant processes" mode if needed; not part of A1 scope.

A1 ships the LOCAL MCP-STDIO ADAPTER and the BINARY SKELETON that supports the other three surfaces growing into it.

---

## 13. Why Bun?

Plan says "TypeScript bun-native". Three concrete reasons:
1. **Single-binary distribution** via `bun build --compile --target=bun-darwin-arm64 --outfile dist/cli.js` (or `--target=node` for broader compat — A1 starts with node target for vitest ease).
2. **Fast cold start** (~30ms) which matters because antchat-Mac spawns remoteant on every cold launch and watches for the MCP `initialize` round-trip as readiness.
3. **First-class stdio + readline** — bun's stdio handling is more predictable than Node's under heavy line-buffered traffic, which matters for MCP's stdio-newline-delimited contract.

That said, A1 must run cleanly under `node ≥ 20` too, so we avoid bun-only APIs (`Bun.file`, etc.) in `src/`. Build is bun-native; runtime is node-compatible. This keeps the Mac app bundle agnostic to which runtime ships.

---

**Spec status when this lands**: ready for @homebrewmaincodex plan-state flip.
