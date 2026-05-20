# M3.2d — agent_kind validation + drift janitor — research doc

Date: 2026-05-14
Author: @researchant (research-only scout, no code changes)
Status: RESEARCH-DOC. Awaiting JWPK ACK + implementer claim.
Cap: ≤180L (research doc).

## TL;DR

Live disk has 1 terminal with `agent_kind = 'codex'` (id `73c4135a-...`,
name `codex2-overnight`, source `cli-register`) — should be `codex_cli`.
Root cause: `/api/identity/register` + `/api/sessions/add` accept ANY
string for `agent_kind` with NO enum validation
(identity/register/+server.ts:80-82). TWO-PART fix: (1) add validation
to PREVENT new drift; (2) ship a one-time janitor that maps known
aliases (`codex`→`codex_cli`) and flags the rest. Distinct from M3.2a
(operator detection) and M3.2c (poller auto-classify) — this fixes the
WRITE BOUNDARY so all three surfaces converge on the same enum.

## Q1 — Validation surface

Where should enum validation fire?

**Default proposal**: add to BOTH `/api/identity/register` and
`/api/sessions/add` (the only two surfaces that accept agent_kind from
client input). Use `isValidClientAgentKind` from the new
agentKindEnum.ts (Q3) — accepts only the client-input set, REJECTS
reserved kinds (per B1 lock).

## Q2 — Reject vs coerce on invalid input

Three options:
- **Option A (recommended)**: reject with 400 + error message listing
  valid values. Forces client to fix the call.
- **Option B**: coerce known aliases (`codex`→`codex_cli`) silently.
  Risk: hides client bugs; aliases proliferate.
- **Option C**: reject for unknowns, coerce known aliases. Hybrid.

**Default proposal**: A. Backwards-compat is preserved by the janitor
(Q4) cleaning existing drift; new writes must use canonical.

## Q3 — Enum source-of-truth + reserved-kind policy

The AgentKind enum currently lives in fingerprintDetector.ts. Should the
validation routes import from there, or extract to a neutral module?

**Default proposal**: extract to NEW `src/lib/server/agentKindEnum.ts`
(≤40L) — exports:
- `AgentKind` type
- `AGENT_KINDS_CLIENT_INPUT: ReadonlySet` = { claude_code, codex_cli,
  cursor, gemini, aider, generic-shell } — exactly 6 values, EXCLUDES
  `unknown` (delta-2 fix: unknown is a detector-output sentinel, not a
  legitimate client-asserted kind; clients should not register an agent
  whose identity they don't know).
- `AGENT_KINDS_SERVER_RESERVED: ReadonlySet` = { remote, browser }
- `AGENT_KINDS_ALL: ReadonlySet` = client + reserved + { unknown } —
  union used by detector for Q2 preservation + DB-validity checks.
- `isValidClientAgentKind(s: unknown): s is AgentKind` — accepts only
  the 6 client-input kinds. REJECTS `unknown`, `remote`, `browser`,
  and any unrecognised string.
- `isValidAnyAgentKind(s: unknown): s is AgentKind` — accepts the full
  9-value AGENT_KINDS_ALL set; used by detector + janitor preservation.

**RESERVED-KIND + UNKNOWN POLICY (B1 lock + delta-2 sharpen 2026-05-14)**:
`/api/identity/register` and `/api/sessions/add` REJECT `unknown`,
`remote`, AND `browser` from client input via `isValidClientAgentKind`.
Returns 400 with error message naming the 6 valid client values.

Why each rejection:
- `remote` / `browser`: written ONLY via server-internal stores that
  bypass registration: `remoteMappingStore.ts:108` + `browserSessionStore.ts:93`
  (verified on disk — INSERT INTO terminals direct, neither routes via
  the registration paths). Zero blast-radius on existing flows.
- `unknown`: the detector emits this server-side when no agent pattern
  matches (sourceDefault). Client always knows what kind they are
  claiming to be, so accepting `unknown` from client input is incoherent.

Detector + janitor consume `AGENT_KINDS_ALL` (9-value superset) so
unknown/remote/browser stay valid at the DB/detector layer. Janitor
treats `unknown` rows as FLAGGED no-mutate (operator review). Same
precondition shape as M3.2c B1 (tmuxCapture.ts) — no circular-dep risk.

## Q4 — Janitor scope + execution

**Default proposal**: NEW `scripts/agent-kind-janitor.mjs` (≤80L):
- Reads all terminals from the live db; maps known aliases (initially
  `codex`→`codex_cli`).
- For unknown invalid values, logs to stderr but does NOT mutate.
- Writes a one-line summary: `migrated N rows, flagged M unknowns`.
- Idempotent: --apply twice produces same final state.
- Runnable: `bun scripts/agent-kind-janitor.mjs --dry-run|--apply`.
- NOT a CLI verb; one-time migration tool. No manifest entry.

## Q5 — M3.2a/M3.2c writeback path

`applyFingerprintWriteBack` + M3.2c `classifyIfUnknown` already produce
only canonical kinds (AgentKind enum drives detection). Validation
fires on the client-input write boundary only, NOT on detector writes.

## Touch points (for implementer)

- NEW `src/lib/server/agentKindEnum.ts` ≤40L (cycle-break)
- EDIT `src/lib/server/fingerprintDetector.ts` ≤180L: re-import AgentKind
  from agentKindEnum.ts
- EDIT `src/routes/api/identity/register/+server.ts`: add validation
  before line 82's bare assignment; throw `error(400, ...)` on invalid.
- EDIT `src/routes/api/sessions/add/+server.ts`: same validation.
- NEW `scripts/agent-kind-janitor.mjs` ≤80L
- NEW `scripts/agent-kind-janitor.test.mjs` ≤80L (bun-test, validates
  alias map + dry-run safety + apply mutation + idempotence)
- EDIT route tests to add 400 case for unknown agent_kind value.

## Live evidence (read-only probe, 2026-05-14)

Drift sighting:
```
$ sqlite3 ~/.ant/fresh-ant.db "SELECT id, name, source, agent_kind
   FROM terminals WHERE agent_kind = 'codex'"
73c4135a-daea-4233-817a-a73fcb9977ea|codex2-overnight|cli-register|codex
```

Source code: identity/register/+server.ts:80-82 stores agent_kind
verbatim from `rawBody.agent_kind` when it's a non-empty string. No
validation. Same shape on sessions/add/+server.ts:69.

## Locked acceptance (after PASS + JWPK ACK)

- B1 PRECONDITION FIRST: NEW agentKindEnum.ts ≤40L exporting the dual
  sets (AGENT_KINDS_CLIENT_INPUT 6 values + AGENT_KINDS_SERVER_RESERVED
  2 values + AGENT_KINDS_ALL 9-value superset including `unknown` +
  isValidClientAgentKind + isValidAnyAgentKind). fingerprintDetector.ts
  re-imports AgentKind + AGENT_KINDS_ALL for Q2 preservation. No
  behaviour change, cap-aware.
- VALIDATION: both registration routes return 400 on invalid agent_kind
  via isValidClientAgentKind. Error message names the 6 valid client
  values explicitly.
- LOCKED TESTS:
  (a) `identity/register` route test: 400 on `unknown`, 400 on `remote`,
      400 on `browser`, 400 on `bogus` (any unrecognised string).
  (b) `sessions/add` route test: same 4 rejection cases.
  (c) Janitor test: rows with `agent_kind='unknown'` are FLAGGED in the
      report but NOT mutated; rows with `agent_kind='remote'` or
      `'browser'` are PRESERVED untouched (no flag, no mutate); rows
      with the known alias `'codex'` are migrated to `'codex_cli'`.
  (d) Janitor idempotence test: --apply twice produces same final state.
- JANITOR: dry-run lists drift rows + planned mutations; --apply
  performs the migration; idempotent.
- NO CLI surface for the janitor (one-time tool); NO manifest entry.
- Plan_milestone event: post m3-2d-agent-kind-validation-janitor
  status=done via Tailscale path AFTER canonical PASS.

## Do-not-use

| Rejected approach | Why |
|---|---|
| Silent coerce only (no rejection) | Hides client bugs; future aliases proliferate. |
| DB-level CHECK constraint on agent_kind | Adds schema migration risk; route validation is sufficient + reversible. |
| Auto-run janitor on server start | Dangerous coupling; should be operator-triggered. |
| Janitor as `ant` CLI verb | One-time migration tool, not a customer-facing surface. |

## Open questions for JWPK

1. Should the alias map include guesses for OTHER known aliases (e.g.
   `claude`→`claude_code`, `cur`→`cursor`)? Default: only `codex`
   initially; add to map as future drift is observed.
2. Should the janitor delete rows with truly-unknown agent_kind, or
   leave them as-is for operator review? Default: leave (log to stderr).

## What I did NOT verify

- Did NOT enumerate ALL writers of agent_kind across v3 + fresh-ANT
  (focus is fresh-ANT only); v3 routes may have separate paths.
- Did NOT prototype agentKindEnum.ts or the janitor script.
- Did NOT measure janitor runtime on a 100k-row terminals table; live
  has 131 rows so this is a non-concern for v1.

## Next step

Awaiting canonical RQO PASS + JWPK ACK on Q1-Q5 defaults. Implementer
claim-first proceeds under Locked Acceptance once both land.
