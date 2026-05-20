# FINGERPRINT-MANIFEST — Design Slice 1: Canonical ANT status/state schema + pi state-emission proof

Status: DECISION-DOC (design slice, NOT impl). Parallel-design — NOT P0.
Author: researchant · 2026-05-15 · For canonical review before any impl.
Lifts: banked `project_fingerprint_manifest_2026_05_15`, `project_status_line_architecture`; v4 `agentStateReader.ts`; disk tour inputs JWPK already supplied.

---

## 1. Decision: the canonical schema ALREADY EXISTS — formalise it, don't invent

v4 `src/lib/server/agentStateReader.ts` (a v3-LIFT) already reads + normalises a
per-session state file. The canonical ANT status/state schema **is the on-disk
JSON shape it consumes**. We formalise that shape as the contract; we do not
design a parallel model (v3-LIFT discipline).

**Canonical location:** `~/.ant/state/<cli>/<sessionId>.json`
(`<cli>` ∈ `claude-code | codex-cli | gemini-cli | qwen-cli | pi | copilot-cli`,
the `AgentCli` union; join key = CLI sessionId per the manifest memory.)

**Canonical schema (raw JSON the emitter writes — field names are the contract):**

| JWPK sketch term | schema key (raw) | type | agentStateReader field |
|---|---|---|---|
| `launch` | `session_start` | ISO-8601 string | `sessionStartedAt` |
| `sent`   | `last_user_ts`  | ISO-8601 string | `timestamps.sentAt` |
| `resp`   | `last_resp_ts`  | ISO-8601 string | `timestamps.respAt` |
| `edit`   | `last_edit_ts`  | ISO-8601 string | `timestamps.editAt` |
| `folder` | `cwd`           | string | `cwd` |
| `state`  | `state`         | string label | `stateLabel` |
| (extra)  | `project_dir`   | string | `projectDir` |
| (extra)  | `menu_kind`     | string\|null | `menuKind` |
| (extra)  | `permission_mode` | string | `permissionMode` |
| (extra)  | `remote_control_active` | boolean | `remoteControlActive` |

Verified against a live `~/.claude/state/<sid>.json` (2026-05-15): fields present
= `state, session_start, cwd, project_dir, last_user_ts, last_edit_ts,
last_resp_ts, menu_kind` — exact match. claude-code is the reference emitter
(hook plugin, `project_status_line_architecture`).

**`state` label vocabulary (canonical enum, from the claude state machine):**
`Available | Working | Waiting | Response needed | Menu | Permission`.
Per-CLI emitters MAP their native lifecycle onto this enum (not free-form).

## 2. The "documented setup step" = per-CLI status-emitter contract

A CLI is FINGERPRINT-MANIFEST-complete for state when it emits the schema above
to `~/.ant/state/<cli>/<sessionId>.json`, atomically, on lifecycle transitions.
This is config-driven, not hardcoded (manifest memory): the per-CLI manifest
row declares the emitter mechanism (hook / extension / wrapper) and which
optional keys it can populate. Status-line-parsing is just ONE legacy column;
the state file is the structured replacement.

Open decision **D1 (for canonical review):** native-path vs ant-path. claude
writes `~/.claude/state/<sid>.json`; agentStateReader reads
`~/.ant/state/claude-code/<sid>.json`. Options:
- **D1-A (recommended):** each emitter writes the ANT-canonical path directly
  (`~/.ant/state/<cli>/`). One reader path, no native-format coupling, matches
  agentStateReader v1 as-shipped. claude hook adds a second write (cheap).
- D1-B: agentStateReader also reads native locations per the manifest table.
  More reader complexity + per-CLI format coupling. Rejected unless a CLI
  cannot be made to write the ANT path.

## 3. First concrete per-CLI deliverable: pi state-emission (schema proof)

pi has **no native state file** (manifest: "in-session"). JWPK: *"for pi can we
get it to output a state?"* — pi proves the schema because it has zero native
state, so success = the schema standing entirely on its own.

Mechanism: extend the existing `~/.pi/custom-extensions/status-line.ts` (event
extension, `export default (pi: ExtensionAPI) => …`, hooks
`session_start | turn_start | turn_end`, has `ctx.ui.setStatus`). Add an atomic
write of the canonical JSON alongside the existing UI status.

**Event → schema mapping (pi):**

| pi event | writes |
|---|---|
| `session_start` | `{ state:"Available", session_start:<nowIso>, cwd:<cwd> }` (new file) |
| `turn_start` | merge `{ state:"Working", last_user_ts:<nowIso> }` |
| `turn_end` | merge `{ state:"Waiting", last_resp_ts:<nowIso> }` (see D3) |

Write = serialise full object + `writeFileSync(tmp)` + `renameSync` (atomic;
agentStateReader mtime-caches, partial reads must never happen).

**Open decisions for canonical review:**
- **D2 — pi sessionId + cwd source.** pi's `ExtensionAPI` ctx shape is not
  extractable from disk (wrapped binary; package types absent). Do NOT
  re-questionnaire JWPK. Recommended: derive `sessionId` + `cwd` from pi's own
  transcript path the manifest already maps —
  `~/.pi/agent/sessions/--<enc-cwd>--/<ts>_<sid>.jsonl` (newest for this
  process's `process.cwd()`); fall back to `process.cwd()` for `cwd`. Confirm
  ctx exposes them at impl time by reading the installed package then; this is
  an impl-time lookup, not a JWPK question.
  - **D2 RESOLVED (2026-05-15, researchant, disk-verified):** the pi
    `ExtensionAPI` ctx is NOT needed. Each pi session file's FIRST JSONL line
    is a meta record with top-level keys `type, version, id, timestamp, cwd`
    — i.e. `id` = pi sessionId, `cwd` = cwd, `timestamp` = session_start, all
    directly available. Emitter approach: on `session_start` resolve the
    current session = newest `*.jsonl` under
    `~/.pi/agent/sessions/--<enc(process.cwd())>--/`, read its first line for
    `{id,cwd,timestamp}`, write `~/.ant/state/pi/<id>.json`. enc-cwd =
    `process.cwd()` with `/`→`-` wrapped in leading+trailing `--`. This
    removes the only real unknown; consumer-side read path is pinned green
    (agentStateReader pi contract tests, 14/14).
- **D3 — `turn_end` → `Waiting` vs `Response needed`.** claude classifies via a
  local model (`project_status_line_architecture`); pi extension must stay
  cheap (no LLM in-extension). Recommended v1: emit `Waiting` unconditionally
  at `turn_end`; defer response-vs-waiting classification to a later slice
  (ANT-side, off the transcript). Flag as known-gap, not blocker.

## 4. Scope boundary / sequencing

- This slice = **decision-doc only** (per ANT research-agent directive).
- Impl slices AFTER canonical sign-off + AFTER dogfood-critical lane
  (FINDING-1 claude2). Two impl sub-slices: (S1) ratify schema + D1; (S2) pi
  extension emitter + live-verify a `~/.ant/state/pi/<sid>.json` appears and
  agentStateReader `findStateForSessionId('pi', …)` returns a populated
  snapshot.
- Downstream consumers unchanged here: B-HARDEN-sessionid-pk (keying), B2-7
  tasks-board (hybrid), agent-status enrichment — all read this schema; none
  designed in this slice.
- Out of scope: tasks/todos harvest, EMOJI-TRIM flag derivation, Gantt render.

## 5. Asks of canonical review

1. Ratify §1 schema (field names + state enum) as the FINGERPRINT-MANIFEST
   state contract.
2. Decide **D1** (recommend D1-A: emitters write `~/.ant/state/<cli>/`).
3. Accept **D2**/**D3** recommendations or redirect.
4. Confirm pi as the proving CLI + decision-doc-then-impl sequencing.
