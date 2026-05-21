# M3.2c — fingerprint × agentStatusPoller integration — research doc

Date: 2026-05-14
Author: @researchant (research-only scout, no code changes)
Status: RESEARCH-DOC. Awaiting JWPK ACK + implementer claim.
Cap: ≤180L (research doc).

## TL;DR

`agentStatusPoller` today skips terminals where `agent_kind IS NULL`
(isPollableTerminal at agentStatusPoller.ts:73-81). Live disk shows 17
such terminals on :6461 — never classified. This doc proposes the poller
calls `detectFingerprint` + write-back on each tick for NULL-kind
terminals, then re-evaluates pollability in the same tick. Distinct from
M3.2a (operator on-demand): this automates the SAME call inside the
poller's existing tick.

## Q1 — Auto-classify scope

Should the poller auto-classify ALL NULL-kind terminals, or only those
matching a per-terminal opt-in flag?

**Default proposal**: auto-classify ALL NULL-kind terminals on every tick
they appear NULL. HIGH-confidence write-back is the existing M3.2a Q5
guard — only HIGH writes; MED/LOW persist meta only. Operator-set kinds
are never overwritten because writeback skips MED/LOW.

## Q2 — When does fingerprint run inside the tick?

Two integration points possible:
- **Option A (recommended)**: ADD a pre-pollability `classifyIfUnknown`
  step that runs `detectFingerprint` + write-back BEFORE
  `isPollableTerminal` filter. NULL-kind terminals get classified, then
  re-evaluated for pollability in the same tick.
- **Option B**: separate "fingerprint pass" that runs on a different
  cadence (less frequent). More complex; deferred to v2.

## Q3 — Write-back posture in poller context

The poller is a server-internal caller (no admin-bearer surface). Should
poller-driven write-back skip the admin-bearer check that
applyFingerprintWriteBack assumes was already done at the route level?

**Default proposal**: yes — applyFingerprintWriteBack itself doesn't
check auth (the route does). The poller is trusted server code; calling
applyFingerprintWriteBack directly is correct. Q2 preservation
(remote/browser stays) is enforced inside applyFingerprintWriteBack and
covers the remote synthetic terminal case.

## Q4 — Retry/cycle semantics + B2 debounce lock

If a NULL-kind terminal returns LOW or MEDIUM confidence (no write-back
to agent_kind), the next tick will re-run detectFingerprint. The
detection itself is cheap (<100ms typical, 2s timeout cap). The CONCERN
is meta+updated_at WRITES every tick on stable terminals.

**Default proposal (B2 lock per canonical RQO 2026-05-14)**:
applyFingerprintWriteBack adds a content-hash debounce. Hash =
SHA256(`${evidence.source}:${evidence.detail}`). Compare against
terminals.meta.fingerprint_evidence_hash; SKIP the write entirely when
hash matches. Detection still runs every tick (cheap); only persisted
state changes when something actually changed. Avoids hot-loop DB churn
on stable NULL-kind terminals.

## Q5 — Pollability invariant after classification

Once a terminal is classified `claude_code` (or any non-remote/browser
agent kind), `isPollableTerminal` returns true ONLY if
`tmux_target_pane !== null`. So fingerprint write-back alone doesn't
guarantee pollability — terminals without a tmux pane still skip state
polling. Worth documenting in the slice contract.

**Default proposal**: classify-and-meta-trace is an end in itself even
when state polling is skipped. Operator-visible `agent_kind` improves
audit/permission visibility and informs the future M3.2d auto-spawn
proposal.

## Touch points (for implementer)

- `src/lib/server/agentStatusPoller.ts:73-81` — `isPollableTerminal`
- `src/lib/server/agentStatusPoller.ts:135-140` — `runOnce` filter +
  `pollOneTerminal` invocation
- `src/lib/server/fingerprintDetector.ts` — `detectFingerprint` (no opts
  for read-only) + `applyFingerprintWriteBack` (write-back)
- NEW helper proposed: `classifyIfUnknown(terminal)` that wraps the
  detect+writeBack idempotently (only fires when `terminal.agent_kind
  === null`).

## B1 PRECONDITION — extract shared captureFn module (cycle break)

CURRENT cycle risk: fingerprintDetector.ts:6 imports `defaultTmuxCaptureFn`
+ `CaptureFn` FROM agentStatusPoller.ts. Adding agentStatusPoller →
fingerprintDetector for M3.2c would create a bidirectional import cycle.

**Locked precondition** (do this BEFORE the integration impl):
- NEW `src/lib/server/tmuxCapture.ts` ≤40L: re-exports `CaptureFn` type +
  `defaultTmuxCaptureFn` implementation lifted verbatim from
  agentStatusPoller.ts:35,86-97.
- EDIT fingerprintDetector.ts: import from `./tmuxCapture` instead of
  `./agentStatusPoller`.
- EDIT agentStatusPoller.ts: re-export `defaultTmuxCaptureFn` from
  tmuxCapture.ts (preserve external import path) OR import inline.
- Net: agentStatusPoller → fingerprintDetector becomes unidirectional.

## Live evidence (read-only probe, 2026-05-14)

`sqlite3 ~/.ant/fresh-ant.db "SELECT agent_kind, COUNT(*) FROM terminals
GROUP BY agent_kind"`:

| agent_kind | count |
|---|---|
| (NULL) | 17 |
| browser | 106 |
| claude_code | 7 |
| codex | 1 |

The 17 NULL rows are the immediate target population for v1 of M3.2c.
(Side note: `codex` row is data drift — should be `codex_kind=codex_cli`
per M3.2a Q2 enum; out of scope for this slice but worth a follow-up
janitor.)

## Locked acceptance (after PASS + JWPK ACK)

- B1 PRECONDITION FIRST: NEW src/lib/server/tmuxCapture.ts ≤40L +
  detector/poller import-path swap (cycle break).
- EDIT src/lib/server/fingerprintDetector.ts: extend
  applyFingerprintWriteBack with content-hash debounce (B2 lock).
  Compute SHA256 of `${result.evidence.source}:${result.evidence.detail}`,
  read previous hash from terminals.meta.fingerprint_evidence_hash, SKIP
  the meta+updated_at write entirely when hash matches. Cap remains 180L.
- EDIT src/lib/server/agentStatusPoller.ts ≤220L: add
  `classifyIfUnknown` helper + invocation in runOnce loop. Per-terminal
  try/catch around classifyIfUnknown so detect/writeBack failure for
  terminal X is logged + isolated and does NOT block siblings (B3 lock).
  Mirrors existing per-terminal try/catch on pollOneTerminal at line 138.
- EDIT src/lib/server/agentStatusPoller.test.ts ≤220L: 6+ tests:
  (a) NULL-kind terminal gets classified + written back on HIGH;
  (b) NULL-kind terminal stays NULL on MED/LOW (meta-only with debounce);
  (c) remote/browser preservation still holds;
  (d) classify-then-poll happens in same tick;
  (e) B2 debounce: same-evidence second tick does NOT trigger meta write;
  (f) B3 isolation: terminal X classify-throw does not block terminal Y
      classify-or-poll.
- EDIT src/lib/server/fingerprintDetector.test.ts: add 1 test for B2
  content-hash debounce (no-op when evidence unchanged).
- No schema changes; no manifest change (M3.2a verb unchanged); no CLI
  surface (this is internal poller wiring).
- Plan_milestone event: post m3-2c-fingerprint-poller-integration
  status=done via Tailscale path AFTER canonical PASS.

## Do-not-use

| Rejected approach | Why |
|---|---|
| Auto-classify on terminal CREATE (M3.2b idea) | Out of scope — that's a separate slice with race-condition concerns. |
| Per-tick fingerprint regardless of agent_kind | Wasteful; only NULL-kind terminals need classification. |
| Inline fingerprintDetect call without `classifyIfUnknown` wrapper | Adds 5+L per-tick noise to runOnce; helper preserves 9-year-old-readable shape. |

## Open questions for JWPK

1. Should classify-on-poll be opt-in via env flag (`ANT_AUTO_CLASSIFY`) or
   always-on? Default proposal: always-on (write-back is already opt-in
   at the M3.2a layer; no new opt-in needed).
2. Should the 1 `codex` data-drift row be auto-fixed by this slice's
   write-back, or left for a separate janitor? Default proposal: leave —
   M3.2c only operates on NULL-kind rows per Q5 invariant.

## What I did NOT verify

- Did NOT measure poller-loop latency impact at scale (17×100ms = 1.7s
  per tick; acceptable given POLL_DEFAULT_MS = 10_000).
- Did NOT design M3.2b (auto-classify on terminal create) — separate slice.
- Did NOT prototype classifyIfUnknown — implementer writes from contract.

## Next step

Awaiting canonical RQO PASS + JWPK ACK on Q1-Q5 defaults. Implementer
claim-first proceeds under Locked Acceptance once both land.
