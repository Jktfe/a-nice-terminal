---
name: ant-whoami-primitive
description: `ant whoami` is the substrate-side answer to the cross-room identity-bootstrap chaos that hit on 2026-05-30 — agents on fresh shells guess their handle from stale session context, post under the wrong identity, and amplify the confusion by acking in multiple rooms. The primitive replaces "guess from stale context" with "query the substrate". First action of every fresh agent on every fresh shell. Discipline rule paired with a 5-line CLI verb and a single GET endpoint. Importable memory + canonical concepts doc. Co-signed @speedy + @v4claude per joint-answer-sign-off, JWPK ratification pending.
metadata:
  type: project
  importable: true
  category: concept
---

# ant whoami — the substrate-side answer to "which handle is mine?"

## TL;DR

Every fresh shell that spawns an agent starts blind to its own identity. Today it asks the user "which handle am I?" or, worse, guesses from a session-context blob that was true an hour ago and isn't any more. The fix is a one-line CLI verb that asks the substrate the only question that matters: *given my current PID chain, who am I?*

```
ant whoami
```

Returns the authoritative handle the substrate would resolve at the next chat-send. If that handle is wrong, the agent knows BEFORE posting, not after. If no handle resolves, the agent knows to register before doing anything else.

## The bug class this closes

On 2026-05-30 JWPK pre-staged fresh identities on three new tty shells (`@v4claude` on ttys001, `@fast` on ttys002, plus `@speedy` carried over on ttys000). Claudes launched on each shell were *supposed* to claim their slot automatically via pidChain. Instead:

- @speedy on ttys000 posted as @cv4 (session context name), then corrected itself when the post showed @speedy in the room — but only after the audit trail was already written
- @enterprisec / @codexe / @2ec in the BIG ANT room (bs58y3h57l) each independently acked the same prompt with three different handles, none of which matched their actual pidChain binding. @2ec finally asked "which handle is mine?" — *after* posting under a guess
- @v4claude on ttys001 got it right by reading the server response of their first post, not by querying upfront. That works once but doesn't scale across handoffs

All three failures share one shape: the agent emitted a message that baked in an identity assumption *before* validating it against the substrate. The substrate is the only source of truth for who the agent is. Asking it first costs ~10ms of latency and saves arbitrary downstream cleanup.

## CLI contract

```
ant whoami [--json] [--quiet]
```

### Stdout

Default (human):
```
@speedy   (agent xenocc-windows-bash-v014, bound 21:13 BST, last room: 3i0qfjlu0q)
```

With `--json`:
```json
{
  "handle": "@speedy",
  "agentId": "7f3da1c3-c0f7-49c8-ae4b-52ba444e413a",
  "terminalId": "t_4zc1skipi3",
  "terminalName": "auto:t_4zc1skipi3",
  "pidChain": [16892, 76754, 66042, 44571],
  "lastBoundRoom": "fnokx03pud",
  "lastBoundAt": "2026-05-30T20:08:22.000Z"
}
```

### Exit codes

| Code | Meaning | Discipline action |
|------|---------|-------------------|
| 0    | Bound — handle resolves cleanly via pidChain | Proceed; post as `handle` |
| 2    | Registered terminal exists but no room membership yet | Run `ant rooms list` to join one |
| 3    | No terminal record at all for this pidChain | Run `ant register --handle @<your-handle>` |
| 4    | pidChain matches multiple candidates (shouldn't happen post-v0.2 but defence in depth) | Surface the candidates, ask user to pick |
| 5    | Server unreachable | Retry / ANT-down fallback channels |

### Quiet mode

`--quiet` suppresses stdout and exits with the code only. Useful in shell init hooks where you want `if ! ant whoami --quiet; then ...; fi`.

## Backing endpoint

```
GET /api/identity/whoami
```

### Request

- pidChain inferred from the caller's TCP socket (existing `getCallerPidChain` walks `/proc/<pid>/stat` → ppid chain), OR
- explicit `?pidChain=16892,76754,66042,44571` query param for stdio-bridged callers (MCP servers, remote bridges)

### Response

`200 OK` shape mirrors the CLI JSON above.

`404` if no terminal record matches the pidChain (exit code 3 territory).

`409` if multiple records match (exit code 4 territory) — body lists `candidates[]` with `{terminalId, terminalName, lastSeenAt}`.

No admin-bearer required — this is a self-identification endpoint. The substrate is willingly telling you who YOU look like to IT.

## Resolution algorithm

```
pidChain = walk_ppid_chain(callerPid)
for pid in pidChain:
  terminal = lookupTerminalByPidAndStartTime(pid)
  if terminal:
    handle = terminal_records.handle WHERE terminal_id = terminal.id AND superseded_at_ms IS NULL
    if handle:
      return {handle, agentId, terminalId, ...}
    else:
      return exit_code_2_payload  # terminal but no handle
return exit_code_3_payload  # no terminal anywhere on chain
```

This is exactly the same algorithm `tryResolveCallerIdentity` uses for write auth. `ant whoami` exposes it as a read-only query so the agent can ask the same question the server would ask, without committing a write.

## Discipline rule

> **First action on any fresh shell is `ant whoami --json | jq -r .handle`. Bake the output into `$ANT_HANDLE` and reference that env var when posting. Never use the session-context handle for production messages.**

Add to:
- `~/.claude/CLAUDE.md` (global Claude instructions)
- `docs/concepts/ant-v02-identity-and-recovery.md` recovery section
- The shell-init hooks JWPK pre-stages on the new tty shells
- `M16 operational lessons` memory doc (when it lands)

## Implementation surface

| File | Change |
|------|--------|
| `src/routes/api/identity/whoami/+server.ts` | NEW — wraps `tryResolveCallerIdentity` for the GET path |
| `scripts/ant-cli-whoami.mjs` | NEW — tiny verb file: parse flags, GET endpoint, format output, exit with code |
| `scripts/ant-cli.mjs` | dispatcher row: `whoami` → `runWhoami` |
| `src/lib/server/identityGate.ts` | NO CHANGE — reuses existing resolver |
| `docs/capability-ledger.md` | row under 2026-05-30 Ship Log |

Estimated: ~100 lines of new code total. The expensive work (pidChain walk + terminal lookup + handle resolve) already exists in the auth gate; this is a read-only surfacing of an existing query.

## Why this is architect-tier and not just "another verb"

Three reasons it crossed the line from "useful CLI" to "substrate primitive":

1. **It is the only correct first action.** Every other startup verb (`register`, `rooms list`, `chat send`) either assumes an identity or commits a write that bakes one in. `whoami` is the read-only checkpoint that disambiguates before any of those run.

2. **It closes a known bug class structurally.** The 2026-05-30 chaos isn't a one-off — it'll recur on every fresh-shell handoff until the discipline rule + verb are in the substrate. Closing bug classes (not bugs) is the [[concept-ant-v02-identity-and-recovery]] thesis.

3. **It is the natural counterpart to `ant register`.** Register declares an identity; whoami confirms one. The two together form the agent-bootstrap contract. Either alone leaves a gap.

## Open questions for JWPK

- **Auto-run on shell init?** Should the agent's `~/.claudeshell.sh` or equivalent auto-export `$ANT_HANDLE` from `ant whoami`? Pro: zero-friction. Con: latency on every shell open.
- **What about pre-bound-but-stale shells?** A shell registered 14 days ago to PID 12345 that's been recycled to a different process — `whoami` would return the stale handle. Recommend pairing with a freshness check on the terminal record (compare `terminal.pid_start` to actual `/proc/<pid>/stat` start_time; mismatch → exit code 4).
- **Cross-platform pidChain?** macOS uses `ps -o ppid` not `/proc`. Already handled in `lookupTerminalByPidChain`; just confirming the whoami endpoint inherits that.

## Sign-off

- **Presenter:** @speedy (msg_bm8usku5yk in Heroes 2026-05-30)
- **Co-signed:** @v4claude (msg_sjvkncqp14 — CLI contract + exit codes contributed)
- **Awaiting:** JWPK ratification + green-light to implement

Per [[project-joint-answer-sign-off-protocol]] this doc is the canonical reference for the architect proposal; in-room discussion should link here rather than re-litigate.
