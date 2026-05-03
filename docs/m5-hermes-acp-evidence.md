# M5 Hermes ACP Evidence

Branch: `delivery/m5-hermes-acp`  
Worktree: `../a-nice-terminal-m5-hermes-acp`

## Scope

- Added a Hermes ACP projector/client helper that treats `hermes acp` as a stdio JSON-RPC agent, matching ACP's newline-delimited JSON-RPC transport.
- Added explicit `hermes-acp` CLI mode. Plain Hermes TUI output is not upgraded to high trust.
- Added ACP raw byte references in the form `acp:bytes=start-end;line=n;sha256=line_sha256`.
- Added replay helpers for count, kind, payload-hash, timestamp, and raw-range equivalence from the raw transcript.
- Extended `run_events.source` to include `acp` via the existing copy/drop/rename CHECK-constraint migration pattern.
- Extended ANT Terminal rich cards to allow the existing structured tool/prompt/approval variants for `source: "acp"` only when `trust: "high"`.

## Acceptance Checks

- ACP client posture: `buildHermesAcpClientConfig` launches `hermes acp` and maps each ANT session to a stable per-session Hermes profile through `HERMES_HOME`.
- ACP events: `projectAcpTranscript` parses JSON-RPC records with `JSON.parse`; malformed/non-ACP lines only produce warnings and no high-trust events.
- Trust boundary: live ingest is gated behind `cli_flag === "hermes-acp"` and appends `source: "acp"`, `trust: "high"`.
- Single write: live ingest reuses the existing `appendRunEvent` path; the ACP projector remains read-only.
- Byte equivalence: raw transcript SHA-256 is computed from exact UTF-8 bytes; each `raw_ref` is verified by slicing the original transcript and checking line SHA-256.
- Cross-protocol equivalence: Pi RPC fixture and Hermes ACP fixture normalize to the same kind/trust/component sequence: `tool_call`, `agent_prompt`, `approval`; only `source` differs (`rpc` vs `acp`).

## Verification

Commands run from the M5 worktree:

```bash
./node_modules/.bin/vitest run tests/pi-rpc-projection.test.ts tests/hermes-acp-projection.test.ts
# PASS: 2 files / 10 tests

env PATH=/Users/jamesking/.nvm/versions/node/v22.22.1/bin:$PATH ./node_modules/.bin/vitest run
# PASS: 12 files passed / 1 skipped, 77 tests passed / 1 skipped

env PATH=/Users/jamesking/.nvm/versions/node/v22.22.1/bin:$PATH npx --yes svelte-check
# PASS: 0 errors / 0 warnings

env PATH=/Users/jamesking/.nvm/versions/node/v22.22.1/bin:$PATH ./node_modules/.bin/vite build
# PASS

env PATH=/Users/jamesking/.nvm/versions/node/v20.19.5/bin:$PATH ANT_DATA_DIR=$(mktemp -d) node --import ./node_modules/tsx/dist/esm/index.mjs -e 'const { queries } = await import("./src/lib/server/db.js"); queries.createSession("m5-test","m5-test","terminal","15m",null,null,"{}"); const row = queries.appendRunEvent("m5-test", Date.now(), "acp", "high", "tool_call", "Hermes ACP tool", JSON.stringify({ ok: true }), "acp:bytes=0-2;line=1;sha256=test"); console.log(row.source + ":" + row.trust + ":" + row.kind);'
# PASS: inserted row returned acp:high:tool_call

git diff --check
# PASS
```
