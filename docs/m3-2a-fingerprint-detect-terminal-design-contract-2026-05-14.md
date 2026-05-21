# M3.2a — fingerprint detect terminal — design contract

Date: 2026-05-14
Author: @researchant
Status: DESIGN-FIRST. No implementation claims until canonical @codex2 RQO PASS.
Cap: ≤260L (mirrors M4 + M3.4a-v2 + M3.6a-v0 contract shape).

## TL;DR

`ant fingerprint detect <terminal-id>` returns the detected agent identity for
a terminal: `kind` (claude_code | codex_cli | cursor | gemini | aider |
generic-shell | unknown), `driver` (binary path + version when knowable),
`confidence` (high/medium/low), and `fallback` (the next-best signal that
backed up the primary detection). The detection sources cascade in priority
order: process-tree match (PRIMARY) → tmux-pane title (SECONDARY) →
captureFn output pattern (TERTIARY) → terminal name string (LAST-RESORT).
Detection result is WRITTEN BACK to terminals.agent_kind when confidence is
high so future polls (M3.4a-v2 agentStatusPoller) work without re-detecting.

Distinct from M3.4a-v2 fingerprintHasher: that module decides CURRENT
ACTIVITY STATE (idle/thinking/working/response-required); this slice
decides AGENT KIND IDENTITY (which agent runs in this terminal).

## Q1 — Detection sources cascade

| Order | Source | Confidence | Why |
|---|---|---|---|
| 1 | Process-tree match: SERVER-SIDE processTreeFn walks ps -o pid,ppid,comm from terminal.pid (B3 fix: NEW server helper, NOT the CLI-side scripts/ant-cli-identity-chain.mjs which is process.ppid-relative; new helper uses spawnSync execFile-style array args, no shell, 2s timeout, injectable for deterministic tests). | HIGH if claude/codex/cursor/etc. found in chain | Most reliable — actual running process. |
| 2 | tmux pane_title: `tmux display-message -p -t pane '#{pane_title}'` | MEDIUM if matches known agent titlebar patterns | OSC-set titles (claude_code sets "Claude Code"). |
| 3 | captureFn output pattern (reuses M3.4a-v2 default tmux capture-pane -S -10) | MEDIUM if matches agent-specific prompt or banner | Last-10-lines often contain identifying text. |
| 4 | terminals.name string match | LOW heuristic only | If operator named the terminal "claude2", that's a hint. |
| 5 | Default | LOW | `kind=unknown, driver=null, confidence=low, fallback=name-only`. |

Each source returns `{ kind, driver, confidence, evidence }`. Detector walks
sources in order, returns FIRST result with confidence ≥ medium AND ALSO
runs the next-priority source ONCE to populate `fallback` (B4 fix: lock
fallback to mean "next source's result, regardless of whether it would
have been used"). When confidence=HIGH from source 1, fallback runs
source 2 once and reports its result. When all sources fail, returns
default LOW with fallback="" (no later source available).

## Q2 — Agent-kind taxonomy

Locked enum (matches existing terminals.agent_kind use):
- `claude_code` — Anthropic Claude Code CLI
- `codex_cli` — OpenAI Codex CLI
- `cursor` — Cursor IDE terminal
- `gemini` — Google Gemini CLI
- `aider` — aider AI pair-programmer
- `generic-shell` — bash/zsh/fish, no detected agent wrapping
- `unknown` — detection inconclusive
- `remote` — RESERVED, set by remoteMappingStore (M4), not by this slice
- `browser` — RESERVED, set by browser-session flow (M3.6a-v0), not by
  this slice (B2 fix: actual browser-session terminals use
  agent_kind=`browser` on disk; the originally-listed `human` was wrong
  — removed.)

Detection NEVER overwrites `remote` or `browser` — those are owned by
other slices and this detection only fires on terminals where agent_kind
is NULL or already in the agent enum (claude_code/codex_cli/etc.).
Tests must pin: a `browser` terminal stays `browser` even on writeBack=1.

## Q3 — Driver detection

`driver` field captures the concrete binary backing the agent:
- `{ binary: '/usr/local/bin/claude', version: '0.42.1' }` for claude_code
- `{ binary: 'codex', version: 'unknown' }` if --version not parseable
- `null` if process-tree match failed (kind from titlebar/captureFn only)

Version detection: spawnSync `<binary> --version` with 2s timeout, parse
first line for semver. Best-effort — null on failure. NEVER blocks
detection result.

## Q4 — Confidence scoring

| Confidence | Required signals | Example |
|---|---|---|
| HIGH | Source 1 PROCESS-TREE match | `claude` process in pid chain |
| MEDIUM | Source 2 or 3 alone | tmux title says "Claude Code" but ps shows only zsh |
| LOW | Source 4 only OR no match | terminal named "claude2" with no other signal |

`fallback` field is ALWAYS populated (per B4 fix) — names which NEXT
source was checked and what it found, regardless of primary confidence.
Empty string only when there is no next source (e.g. default-source
hit at the bottom).

## Q5 — Storage write-back (B1 LOCK: explicit-opt-in only)

NO mutation occurs unless the caller EXPLICITLY opts in. Two opt-in
surfaces, both default off:
- HTTP: `GET /api/terminals/:id/fingerprint?writeBack=1` (default off).
- CLI: `ant fingerprint detect <id> --write-back` (default off).

When writeBack is ON AND confidence is HIGH: UPDATE terminals.agent_kind
= detected.kind + terminals.meta JSON += `{ fingerprint_at_ms,
fingerprint_driver, fingerprint_confidence: 'high' }`.

When writeBack is ON AND confidence is MEDIUM/LOW: NO agent_kind change
+ meta gets `fingerprint_evidence: <source+detail>` only (audit trail).

When writeBack is OFF: response shape unchanged, ZERO mutation. Default
posture preserves operator-set agent_kind.

Write-back is BEST-EFFORT — failure does not block detection result return.

## Q6 — REST surface

`GET /api/terminals/:id/fingerprint[?writeBack=1]` — detection on demand.
Default read-only (no mutation). When `?writeBack=1` query present, the
HIGH-confidence write-back path from Q5 runs (still best-effort). Auth:
NONE for read-only in v1 (matches /agent-status global-read pattern);
admin-bearer required when writeBack=1 to prevent unauthenticated
agent_kind mutation. Response 200:
```
{ terminal_id, kind, driver: { binary, version } | null,
  confidence: 'high'|'medium'|'low',
  fallback: string,
  evidence: { source: 'process-tree'|'tmux-title'|'capture-fn'|'name'|'default',
              detail: string } }
```
404 unknown terminal. 500 if detection itself crashes (rare; defensive).

## Q7 — CLI verb shape (DELIVERY-PLAN.md M3.2a)

`ant fingerprint detect <terminal-id> [--json] [--write-back]`

- Positional `terminal-id` required.
- `--json` prints raw response unchanged.
- `--write-back` flag opt-in: when set + confidence=HIGH, calls a separate
  PUT/route OR re-runs server-side write. When absent: read-only, no
  terminals.agent_kind mutation.

Default text output: `terminal_id  kind=X  driver=BIN@VERSION  confidence=HIGH  fallback=`

## Q8 — Integration with M3.4a-v2 fingerprintHasher

Two distinct concerns kept separate:
- `fingerprintHasher` (M3.4a-v2): WHAT IS THIS AGENT DOING RIGHT NOW (state).
  Inputs = pane-capture text + prev-hash. Output = idle/thinking/working/
  response-required.
- `fingerprintDetect` (M3.2a, this slice): WHICH AGENT IS THIS (kind).
  Inputs = process tree + pane title + capture text + name. Output =
  kind + driver + confidence.

Shared: both may use the same default tmux capture-pane reader. To avoid
duplication, the M3.2a captureFn-based source REUSES the M3.4a-v2
defaultTmuxCaptureFn. No new shell-out helpers needed.

## Locked acceptance (implementation slice, AFTER this contract PASS + JWPK ACK)

- NEW src/lib/server/fingerprintDetector.ts ≤180L: detectFingerprint(terminal)
  walks the 5-source cascade, returns the FingerprintResult object.
- NEW src/lib/server/fingerprintDetector.test.ts ≤180L: 12+ tests covering
  each source path (process-tree HIGH, tmux-title MEDIUM, captureFn MEDIUM,
  name LOW, default fallback), confidence scoring, fallback string,
  write-back guard (writeBack OFF zero mutation; writeBack ON HIGH updates
  agent_kind+meta; writeBack ON MED/LOW meta-only), `remote`/`browser`
  agent_kind preserved (never overwritten).
- NEW src/routes/api/terminals/[id]/fingerprint/+server.ts ≤80L: GET handler.
- NEW src/routes/api/terminals/[id]/fingerprint/server.test.ts ≤120L: 5
  tests (200 happy, 404 unknown, JSON shape, write-back-flag honoured,
  remote/browser preserved).
- NEW scripts/ant-cli-fingerprint.mjs ≤120L: handleFingerprintVerb dispatch
  + runDetect + --write-back + --json. Reuses requireAdminAuth NONE in v1
  (read-only).
- EDIT scripts/ant-cli.mjs DISPATCH: add `fingerprint: './ant-cli-fingerprint.mjs'`
  + 1L help line. Cap-aware (current 259L → +2L = 261L → MUST compress 1L).
- EDIT manifest.ts: flip `fingerprint-detect` row from planned to available
  with full source_refs after canonical PASS.
- Plan_milestone event: post m3.2a-ant-fingerprint-detect-terminal status=done
  via V3 endpoint AFTER canonical PASS, not before.

## Do-not-use

| Rejected approach | Why |
|---|---|
| Auto-detect on every terminal create | Detection is shell-out-heavy; on-demand only via `ant fingerprint detect` or future poller integration. |
| Overwrite remote/browser agent_kind | Other slices own those; detection MUST preserve. |
| Block detection on driver --version timeout | Best-effort; null version is acceptable. |
| Mutate agent_kind/meta on every detection | writeBack OFF → ZERO mutation (Q5 lock). writeBack ON + HIGH → updates agent_kind+meta. writeBack ON + MED/LOW → meta-only, agent_kind unchanged. |

## Open questions for JWPK

1. Should detection POLL on a cadence (like M3.4a-v2 agentStatusPoller) OR
   stay strictly on-demand? Default proposal: on-demand only. Polling
   added in v2 if needed.
2. Confidence-tier wording: HIGH/MEDIUM/LOW vs verified/probable/possible?
   Default proposal: HIGH/MEDIUM/LOW (matches existing pane_status enum
   verified/stale/unknown 3-state shape).
3. Driver `--version` timeout (default 2s) — too aggressive or too patient?
   Default: 2s.
4. Should `gemini`/`aider` be in the v1 enum or deferred to v2? Default:
   include in v1 enum for forward-compat; detection patterns can be empty
   and just fall through to other sources.

## What I did NOT verify

- Did NOT prototype any detection code; cap-aware design only.
- Did NOT measure ps walk perf on terminals with deep PID trees; assumes
  the NEW server-side processTreeFn helper (spawnSync execFile, no shell,
  2s timeout) is fast enough.
- Did NOT survey what tmux titles each agent CLI sets in practice; the
  contract assumes claude_code sets "Claude Code", codex_cli sets
  "Codex CLI", etc. — actual patterns to be verified at impl.
- Did NOT design the v2 polling integration; on-demand v1 only.

## Next step

1. Post slice-ready in antDevTeam for canonical @codex2 RQO + 4INRH gate.
2. Surface 5 open questions to JWPK in EvoluteAnt for sign-off.
3. After PASS + JWPK ACK: implementation claim-first by future researchant
   or whoever picks. Cap-2 discipline applies. Contract is the contract.

End of contract.
