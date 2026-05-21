# M3.3a Linkedchat Design Contract

**Author:** @evolveantcodex
**Date:** 2026-05-14
**Slice:** Phase 3a M3.3a (`ant linkedchat allow|deny|list <terminal-id>`)
**Scope:** Lock the design for terminal-scoped linked-chat permissions. NO code in this slice.
**Audience:** @codex2 RQO, @evolveantclaude, JWPK
**Constraint:** compact decision-doc shape; <=260 lines.
**Depends on:** PTY/terminal registry (`terminalsStore`, `roomMembershipsStore`), M3.6a-v1 strict identity gate for read/write routes, manifest placeholder `linkedchat`.

---

## TL;DR

Linkedchat is NOT a new chat room. It is permission state that lets a caller view
and interact with the chat facet attached to a terminal surface. This preserves
the D9 product direction: agent-to-agent conversation defaults to the terminal
viewport, with linked chat, ANT terminal, and raw terminal shown together.

M3.3a ships:

- a terminal-scoped allow/deny store;
- pidChain-gated read/list and write routes;
- `ant linkedchat list|allow|deny`;
- manifest flip from `pl` to `av` only after store + route + CLI + tests land.

It does NOT resurrect legacy separate-room linked-chat adapters.

---

## Source Facts

- `src/lib/cli-manifest/manifest.ts` has only a placeholder row:
  `linkedchat allow|deny|list <terminal-id>`.
- `docs/PROGRAMME.md` says linked chat should live in the terminal viewport,
  not in separate 1:1 rooms.
- `docs/current-ant-capability-audit.md` says legacy linked-chat internals are
  dedupe/private, not a user-facing room model.
- `src/lib/domain/capabilityLedger.ts` says expose linked chat, ANT terminal,
  and raw terminal without making them separate rooms.

---

## Q1 - What Is The Entity?

Recommendation: terminal-scoped permission rows.

```
linked_chat_permissions(
  id              TEXT PRIMARY KEY,
  terminal_id     TEXT NOT NULL,
  subject_handle  TEXT NOT NULL,
  state           TEXT NOT NULL CHECK (state IN ('allow','deny')),
  set_by          TEXT NOT NULL,
  set_at_ms       INTEGER NOT NULL,
  reason          TEXT,
  UNIQUE(terminal_id, subject_handle)
)
INDEX idx_linked_chat_permissions_terminal ON linked_chat_permissions(terminal_id)
```

`subject_handle` is a room/global handle, not a terminal id. That keeps the CLI
human-readable and matches existing room membership surfaces. A future slice can
add terminal-id subjects if needed; v1 does not.

---

## Q2 - Default Policy

Recommendation:

1. Terminal owner/self is implicitly allowed.
2. Explicit `deny` beats implicit self only if an operator writes such a row;
   implementation may reject self-deny if it is simpler.
3. Explicit `deny` beats explicit `allow`.
4. No row means denied for non-owner viewers.

This is conservative and avoids leaking terminal-local conversation to every
room member by default.

---

## Q3 - Route Shape

Use terminal routes, not chat-room routes.

```
GET /api/terminals/:terminalId/linkedchat
  Query: ?pidChain=<urlencoded JSON pidChain>
  -> 200 { terminal_id, permissions: [{ subject_handle, state, set_by, set_at_ms, reason }] }
  -> 403 pidChain not allowed to administer this terminal
  -> 404 terminal not found

PUT /api/terminals/:terminalId/linkedchat
  Body: { subjectHandle, state: 'allow'|'deny', reason?, pidChain }
  -> 200 { permission }
  -> 400 malformed body
  -> 403 pidChain not allowed to administer this terminal
  -> 404 terminal not found
```

No DELETE route in v1. `state='deny'` is the reversible remove path and keeps
the audit row.

---

## Q4 - Who Can Read Or Change Permissions?

Reads and writes are identity-gated via pidChain. Permission rows expose
`subject_handle` allow/deny state and are not public-by-terminal-id.

Default: v1 uses self-or-room-owner.

Algorithm:

1. Load `listMembershipsForTerminal(targetTerminalId)`.
2. For each membership row, resolve the supplied pidChain in that row's
   `room_id` with `identityGate.resolveServerSideHandle`.
3. Allow if the resolved handle equals the target terminal membership handle.
4. Else load `findChatRoomById(room_id)` and allow if resolved handle equals
   `room.whoCreatedIt`.
5. Otherwise reject 403.

Browser-session cookie auth is out of scope for v1 CLI writes. UI writes can be
a follow-up after the server route exists.

---

## Q5 - CLI Shape

```
ant linkedchat list <terminal-id> [--json]
ant linkedchat allow <terminal-id> --handle @x [--reason "..."] [--json]
ant linkedchat deny <terminal-id> --handle @x [--reason "..."] [--json]
```

All three commands send `pidChain`; `list` is read-only but still gated to avoid
leaking terminal-scoped permission rows.

Human output:

- list: `@handle<TAB>allow|deny<TAB>set_by<TAB>relative_time`
- allow/deny: `Linked chat allow for @x on term_...`

---

## Q6 - UI Integration Boundary

The terminal page consumes permission state later to decide whether to show the
linked-chat facet next to ANT terminal and raw terminal. M3.3a does not need to
build the UI.

The UI must not navigate users into a hidden separate chat room for 1:1 linked
chat. That is the old model this slice replaces.

---

## Q7 - Implementation Plan

T1 - store + schema:

1. Append `linked_chat_permissions` table + index to `db.ts`.
2. Add `linkedChatPermissionStore.ts` with upsert/list/resolve helpers.
3. Add focused store tests: allow, deny override, upsert replaces state,
   terminal isolation, unknown terminal no-write.

T2 - route:

4. Add `src/routes/api/terminals/[terminalId]/linkedchat/+server.ts`.
5. Add route tests for GET list, PUT allow, PUT deny, bad state 400, terminal
   not found 404, terminal-self allow, room-creator allow, ordinary other
   member 403, unresolved pidChain 403, multi-room terminal isolation.

T3 - CLI + manifest:

6. Add `scripts/ant-cli-linkedchat.mjs`.
7. Add CLI tests for list/allow/deny, pidChain on all commands, no fetch on
   invalid state or missing handle.
8. Dispatch from `scripts/ant-cli.mjs`.
9. Flip manifest placeholder to `av` with grep-valid source refs.

T4 - live verify + plan:

10. Live `:6461` check: allow then list then deny for one terminal.
11. Post plan_milestone done only after canonical RQO PASS.

---

## Locked Acceptance

1. No separate chat-room creation or hidden room id is introduced.
2. DDL is append-only and idempotent.
3. Store is terminal-scoped and preserves one row per `(terminal_id, subject_handle)`.
4. Reads and writes require pidChain and reject unresolved callers.
5. `deny` overrides `allow` in effective permission resolution.
6. CLI sends pidChain for list/allow/deny.
7. Manifest flips only after CLI + route + tests are green.
8. Existing chat-room message, room-mode, responders, and browser-session tests
   remain green.

---

## Do Not Use

| Choice | Reason |
|---|---|
| Separate 1:1 chat rooms | Contradicts D9 terminal-viewport direction and current audit dedupe note. |
| Global allowlist per handle | Permission must be terminal-scoped; one terminal may be sensitive while another is open. |
| Public list by terminal id | Permission rows leak subject handles; list must be pidChain-gated. |
| Browser-only cookie auth for CLI writes | CLI already has pidChain identity; keep v1 operator path consistent. |
| Hard delete rows for deny/remove | `deny` keeps audit and is reversible. |
| Manifest `av` before implementation | Placeholder is correct until CLI/route/store tests land. |

---

## Open Questions Locked By Recommendation

JWPK can override any of these with a one-line answer before implementation:

1. Subject type: handle, not terminal id.
2. Default for non-owner: denied.
3. Remove semantics: deny row, not DELETE.
4. UI: consume permission later; no UI build in M3.3a.
5. Admin breadth: self-or-room-owner, using `listMembershipsForTerminal` plus
   `findChatRoomById(room_id).whoCreatedIt`.

---

## Next Step

If canonical RQO gates this PASS, implementation can proceed T1 store/schema
first. If HOLD, patch this doc only; do not start code.
