# M3.2b — auto-classify on terminal create — research doc

Date: 2026-05-14
Author: @researchant (research-only scout, no code changes)
Status: RESEARCH-DOC. Awaiting JWPK ACK + implementer claim.
Cap: ≤180L (research doc).

## TL;DR

When `/api/identity/register` or `/api/sessions/add` creates a NEW
terminal row WITH a tmux pane but WITHOUT an explicit `agent_kind`, this
slice runs `classifyIfUnknown` (from M3.2c) once at the write boundary.
HIGH-confidence detections pin `agent_kind` immediately rather than
waiting for the (currently non-running) poller to tick. Closes the
M3.2a/M3.2c/M3.2d trilogy: detect / poll-classify / validate-write —
this adds creation-time-classify so `agent_kind` lands as early as
possible without breaking the write-boundary discipline.

## Q1 — When does auto-classify fire?

Three triggers possible:
- (a) ALWAYS on terminal create (every register/sessions-add call).
- (b) ONLY when `agent_kind` is omitted by the caller AND a `pane` IS
  provided (no kind to override; capture-fn has a pane to read).
- (c) ONLY when an env flag `ANT_AUTO_CLASSIFY_ON_CREATE` is set.

**Default proposal**: (b). Operators who EXPLICITLY pass `agent_kind`
get exactly that (post M3.2d validation). Operators who omit kind get
best-effort detection at creation time. No env flag needed — the
omission IS the opt-in signal.

## Q2 — Race conditions with existing flows

remoteMappingStore + browserSessionStore INSERT terminals with
`agent_kind='remote'/'browser'` directly, bypassing the registration
routes. Auto-classify only fires inside register/sessions-add, so those
internal flows are untouched. The Q5 preservation guard from M3.2a/M3.2d
(`applyFingerprintWriteBack` skips remote/browser) is a defence-in-depth
backstop — but should never trigger for M3.2b since auto-classify only
runs when `agentKindValue === null` post-validation.

## Q3 — M3.2c parity (poller-driven classify)

M3.2c runs `classifyIfUnknown(terminal, captureFn)` on each pollable tick
for NULL-kind terminals. M3.2b runs the SAME helper at the write
boundary. Same B2 content-hash debounce applies — second
classify attempt with unchanged evidence is a no-op. Same B3 isolation
matters less here (single terminal in scope), but a try/catch keeps the
registration response stable on classify failure.

## Q4 — Write-boundary placement + INSERT-new detection (B1 lock 2026-05-14)

`upsertTerminal` hides created-vs-updated state, so "INSERT-new only"
needs an explicit pre-read. Order inside the route handler:
1. M3.2d validation: reject invalid `agent_kind` BEFORE upsertTerminal
   (already shipped 2026-05-14).
2. **NEW pre-read**: `const existed = getTerminalByName(name) !== null`.
   This is the INSERT-new probe — if existed, skip auto-classify entirely.
3. upsertTerminal: create or upsert the terminal row.
4. updatePaneTarget if pane is set.
5. **NEW M3.2b classify**: if `existed === false` AND `agentKindValue
   === null` AND pane was set, call `classifyIfUnknown(terminal,
   undefined)` — uses default captureFn (real tmux). Wrap in try/catch
   so detection failure NEVER blocks the 201 response.
6. **Re-fetch ONLY when classify ran** — if step 5 fired, re-fetch the
   row (classify may have populated meta) so the response reflects the
   write-back. Otherwise return the original upsert result unchanged.

Best-effort: classify failure returns the unchanged 201. The pre-read
+ existed-flag pattern keeps INSERT-new-only honest under the hood.

## Q5 — Test coverage shape

Per route (identity/register + sessions/add), 5 cases each (10 total):
- INSERT-new omit agent_kind + provide pane → 201 with classified meta
  (mock detector via injection or spy; assert classifyIfUnknown CALLED).
- INSERT-new omit agent_kind WITHOUT pane → 201 with no classification.
- INSERT-new explicit `agent_kind='claude_code'` + pane → 201, no auto-
  classify (caller-provided wins).
- Classify-throw isolation: detector throws → 201 still returned with
  agent_kind=null (mocked failure).
- **B1 LOCK**: same-name re-register (UPDATE-by-name) with omitted
  agent_kind + pane → 201 BUT classifyIfUnknown NOT called (existed=true
  short-circuits). Assert no classification meta on the row.

## Touch points (for implementer)

- EDIT `src/routes/api/identity/register/+server.ts` ≤120L: add post-
  upsert classify step (~10L).
- EDIT `src/routes/api/sessions/add/+server.ts` ≤120L: same.
- EDIT route tests: 10 new test cases (5 each).
- M3.2c `classifyIfUnknown` already exists at `agentStatusPoller.ts` —
  re-import from there. (Note: currently exported from poller; consider
  a future move to a `classifyIfUnknown.ts` module if a third caller
  appears.)

## Live evidence (read-only probe, 2026-05-14)

`sqlite3 ~/.ant/fresh-ant.db "SELECT COUNT(*) FROM terminals WHERE
agent_kind IS NULL AND tmux_target_pane IS NOT NULL"` → reveals how
many terminals would benefit from creation-time classify (skipped here
to keep doc read-only; implementer can probe).

## Locked acceptance (after PASS + JWPK ACK)

- EDIT both registration routes ≤120L: pre-read getTerminalByName for
  wasCreated detection (B1 lock); post-upsert classify step gated by
  `wasCreated && agentKindValue === null && pane !== null`; best-effort
  try/catch wrapping classifyIfUnknown.
- Response re-fetch ONLY when classify ran (no extra read otherwise).
- 10 NEW test cases (5 per route): happy classify on INSERT-new,
  no-pane no-op, caller-kind-wins, classify-throw isolation, AND
  same-name re-register does NOT classify (B1 lock proof).
- NO new files; NO terminalsStore API change; NO schema; NO manifest;
  NO new CLI verb.
- Plan_milestone event: post m3-2b-auto-classify-on-create status=done
  via Tailscale path AFTER canonical PASS.

## Do-not-use

| Rejected approach | Why |
|---|---|
| Fire classify on EVERY register call regardless | Wastes ps/tmux calls; explicit `agent_kind` is operator intent. |
| Block 201 response on classify failure | Detection is best-effort; registration must always succeed when validation passes. |
| Auto-classify in remoteMappingStore/browserSessionStore | Out of scope — those bypass registration; their kinds are reserved. |
| Add an env flag opt-in | Omission of `agent_kind` is the opt-in signal. |

## Open questions for JWPK

1. Should classify fire on UPDATE-by-name? **LOCKED INSERT-new only**
   per canonical RQO B1 (2026-05-14): pre-read `getTerminalByName(name)`
   before upsert; if existed, skip classify entirely. Avoids late re-
   classification surprising operators who set kind earlier. PATH B
   (pre-read) chosen over PATH A (store-API change) for lowest blast
   radius — no other surfaces touched, terminalsStore unchanged.
2. Should the response body include the just-classified `agent_kind`?
   Default: yes — re-fetch ONLY when classify actually ran (existed=false
   AND classify did not throw). Otherwise return original upsert result.

## What I did NOT verify

- Did NOT measure register-route latency impact of inline detectFingerprint
  (~100ms typical, 2s timeout cap). Likely acceptable for one-shot calls.
- Did NOT enumerate every register/sessions-add caller — only verified the
  routes themselves on disk.
- Did NOT prototype the post-upsert classify call.

## Next step

Awaiting canonical RQO PASS + JWPK ACK on Q1-Q5 defaults. Implementer
claim-first proceeds under Locked Acceptance once both land.
