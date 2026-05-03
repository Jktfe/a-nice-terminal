# M4 Pi RPC Evidence

Branch: `delivery/m4-pi-rpc`  
Worktree: `../a-nice-terminal-m4-pi-rpc`

## Scope

- Added a Pi RPC/JSONL projection adapter that maps schema JSON records, not terminal regexes, into `run_events` with `source: "rpc"` and `trust: "high"`.
- Added byte-range `raw_ref` values in the form `pi-rpc:bytes=start-end;line=n;sha256=line_sha256`.
- Added replay helpers that project from raw transcript bytes and compare count, kinds, payload hashes, timestamp order, and raw ranges.
- Added high-trust RPC-only card rendering in ANT Terminal for tool call/result, prompt, and approval events.
- Raw Terminal bytes are not rewritten; the live hook reads raw PTY chunks and appends interpreted events alongside the existing transcript path.

## Acceptance Checks

- Tool/prompt/approval cards: covered by `tests/pi-rpc-projection.test.ts`, which projects Pi JSONL records into `tool_call`, `agent_prompt`, and `approval`.
- Byte equivalence: raw transcript SHA-256 is computed from the exact UTF-8 bytes; each `raw_ref` is verified by slicing the original byte buffer and checking line SHA-256.
- Replay equivalence: `checkPiRpcReplay` reprojects raw bytes and verifies event count, kinds, payload hashes, timestamps, and raw ranges match the live projection.
- Reload preservation: test reloads the transcript from a string/Buffer and confirms the same transcript SHA-256 and replay signatures.
- Trust boundary: rich card branches in `RunView.svelte` require `event.source === "rpc"` and `event.trust === "high"`.

## Verification

Commands run from the M4 worktree:

```bash
./node_modules/.bin/vitest run tests/pi-rpc-projection.test.ts
# PASS: 1 file / 4 tests

env PATH=/Users/jamesking/.nvm/versions/node/v22.22.1/bin:$PATH ./node_modules/.bin/vitest run
# PASS: 11 files passed / 1 skipped, 71 tests passed / 1 skipped

env PATH=/Users/jamesking/.nvm/versions/node/v22.22.1/bin:$PATH npx --yes svelte-check
# PASS: 0 errors / 0 warnings

env PATH=/Users/jamesking/.nvm/versions/node/v22.22.1/bin:$PATH ./node_modules/.bin/vite build
# PASS

env PATH=/Users/jamesking/.nvm/versions/node/v20.19.5/bin:$PATH ANT_DATA_DIR=$(mktemp -d) node --import ./node_modules/tsx/dist/esm/index.mjs -e 'const { queries } = await import("./src/lib/server/db.js"); queries.createSession("m4-test","m4-test","terminal","15m",null,null,"{}"); const row = queries.appendRunEvent("m4-test", Date.now(), "rpc", "high", "tool_call", "bash started", JSON.stringify({ ok: true }), "pi-rpc:bytes=0-2;line=1;sha256=test"); console.log(row.source + ":" + row.trust + ":" + row.kind);'
# PASS: inserted row returned rpc:high:tool_call
```
