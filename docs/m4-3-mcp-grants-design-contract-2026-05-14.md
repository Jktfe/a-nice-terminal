# M4.3 MCP grants — design contract

Date: 2026-05-14
Author: @evolveantcodex
Status: DESIGN-FIRST. No implementation until canonical @codex2 RQO gate PASS.
Cap: <=260L.

## TL;DR

M4.3 turns the manifest placeholder `mcp list|grant|revoke` into a bounded
operator surface for MCP adapter room access. It does NOT build an MCP server
and does NOT reuse consent-grant semantics. It manages room-scoped invite-token
credentials whose `kind` is exactly `mcp`.

The grant lifecycle is:

1. Admin creates a grant for room R + handle H.
2. Server mints a one-time `tokenSecret` for a `kind=mcp` token.
3. Operator gives that secret to the MCP adapter out-of-band.
4. List shows grant metadata only, never token bytes.
5. Revoke invalidates the token and its hidden backing invite.

## Q1 — What is an MCP grant?

An MCP grant is a room-scoped `chatInviteStore` token with `kind='mcp'`, a
claimed handle, and an operator-readable label. The token secret is returned
once on grant creation, matching invite exchange behavior.

It is NOT:
- a consent grant (`consent_grants` scope-of-answer safety gate);
- a Remote ANT mapping (`rbt_...` bridge-token machine identity);
- a browser session cookie;
- a per-process pidChain identity.

This distinction is load-bearing because all four surfaces have different
revocation and audit boundaries.

## Q2 — Storage and schema

No new DB table in v1. M4.3 is a thin lifecycle wrapper around
`chatInviteStore` because that store already supports:

- invite kind enum `cli|mcp|web`;
- hashed token secrets;
- token revoke;
- invite revoke cascading to derived tokens;
- one-time secret return.

Implementation adds MCP-specific helper functions in `chatInviteStore` or a
tiny wrapper module that delegates to it:

- `createMcpGrant({ roomId, handle, label, createdBy })`
- `listMcpGrantsForRoom(roomId, { includeRevoked })`
- `revokeMcpGrant(tokenId)`

The helper always creates a hidden backing invite with a random server-only
password and immediately exchanges it for a `kind=mcp` token. The random
password is never returned. One hidden invite backs exactly one MCP token, so
revoking the MCP grant always revokes both token and invite.

## Q3 — Auth policy

All MCP grant management routes require admin-bearer via
`chatInviteAuth.requireAdminAuth`:

- `GET /api/mcp/grants?roomId=R`
- `POST /api/mcp/grants`
- `POST /api/mcp/grants/:tokenId/revoke`

No route accepts room bearer, mcp token, web token, browser cookie, or pidChain
as management authority. This is an operator-only lifecycle surface.

The actual MCP adapter later presents the returned `tokenSecret` to existing
room-token flows. This contract only mints, lists, and revokes those tokens.

## Q4 — Route contract

### GET `/api/mcp/grants?roomId=R`

Admin-bearer required. Returns active MCP grants for the room, newest first.
Optional `includeRevoked=1` includes revoked rows.

Response shape:

```json
{ "grants": [{ "token_id": "tok_x", "room_id": "room_1", "handle": "@mcp", "label": "Claude Desktop", "created_at": "...", "last_seen_at": null, "revoked_at": null }] }
```

Never returns `tokenSecret`, token hash, password, or password hash.

### POST `/api/mcp/grants`

Admin-bearer required. Body:

```json
{ "roomId": "room_1", "handle": "@mcp", "label": "Claude Desktop" }
```

`handle` is required and normalized with a leading `@`. `label` defaults to the
handle. Returns:

```json
{ "grant": { "...": "metadata" }, "tokenSecret": "..." }
```

`tokenSecret` is returned exactly once and is never listable.

### POST `/api/mcp/grants/:tokenId/revoke`

Admin-bearer required. Idempotent: unknown token returns 404; already revoked
returns 200 with `revoked: true`. Successful revoke invalidates the token and
the hidden backing invite.

## Q5 — CLI contract

`scripts/ant-cli-mcp.mjs` owns a new top-level verb:

- `ant mcp list --room R [--include-revoked] [--json] [--admin-token T]`
- `ant mcp grant --room R --handle @h [--label L] [--json] [--admin-token T]`
- `ant mcp revoke --token-id tok_x [--json] [--admin-token T]`

Admin token resolution matches invite/remote wrappers:
`--admin-token` first, then `ANT_ADMIN_TOKEN`. Missing token fails before
fetch. Text output for grant creation may print the token secret once; list and
revoke output must never print token bytes.

## Q6 — Security invariants

- MCP grant list is admin-only because handles + labels reveal integration
  state.
- Duplicate handles are allowed intentionally: one room can have multiple MCP
  adapter clients for the same logical handle, distinguished by label and
  token_id for device-level revocation.
- `web` tokens remain read-only by kind; M4.3 never widens them.
- `mcp` tokens are not admin tokens and cannot manage other grants.
- Revoke is token-id based, not handle based, because multiple MCP clients can
  intentionally share a room with distinct handles or labels.
- All error messages collapse wrong/missing token internals; no hash prefixes.
- No shell execution and no argv token leaks in CLI tests.

## Q7 — Relationship to existing invite verbs

Operators can still manually do `invite create` + `invite exchange --kind mcp`.
M4.3 is the ergonomic lifecycle surface for MCP adapters:

- direct admin grant creates a usable MCP token in one command;
- list is filtered to MCP tokens only;
- revoke targets one MCP token and its hidden backing invite.

The generic invite surface remains broader and password-gated. M4.3 does not
remove or reinterpret it.

## Q8 — Manifest and plan discipline

The current manifest row is planned:

`pl('mcp', 'mcp', undefined, 'mcp list|grant|revoke', ...)`

Implementation flips it to available only after routes + CLI tests pass, with
source_refs to `scripts/ant-cli-mcp.mjs` and route/store files. Plan milestone
`m4.3-ant-mcp-list-grant-revoke` becomes done only after canonical RQO PASS and
plan-events infra is available.

## Locked acceptance

T1 store/helper:
- helper creates one hidden backing invite + one `kind=mcp` token;
- token secret returned once;
- list returns metadata without secret/hash;
- revoke invalidates token + backing invite;
- focused tests cover create/list/revoke, duplicate handles allowed with
  distinct labels/token ids, no-secret list, and revoked-token verification
  fails.

T2 routes:
- three `/api/mcp/grants` routes;
- admin-bearer required on all;
- 400 malformed body, 404 unknown room/token, 200 idempotent already-revoked;
- route tests prove no token bytes in list/revoke responses.

T3 CLI + manifest:
- `scripts/ant-cli-mcp.mjs` with list/grant/revoke;
- `scripts/ant-cli-mcp.test.mjs` direct harness;
- dispatch entry in `scripts/ant-cli.mjs`;
- manifest row flips planned -> available with grep-valid source_refs.

T4 live:
- against :6461 create disposable room;
- `ant mcp grant` prints a token once;
- `ant mcp list` shows metadata only;
- token can join/use existing room-token path as `kind=mcp`;
- `ant mcp revoke` invalidates the token;
- plan close waits for canonical PASS and working plan-events.

## Do-not-use

| Rejected approach | Why |
|---|---|
| Reuse consent grants | Consent grants answer/file scope; MCP grants are room token lifecycle. |
| New table in v1 | Existing invite token store already owns kind/token/revoke semantics. |
| Return tokenSecret from list/show | Secret is creation-only. |
| Let MCP token self-revoke/admin grants | MCP token is room access, not operator authority. |
| Use Remote ANT mappings | `rbt_...` bridges instances; MCP grants authorize local adapter clients. |

## Deferred

- Token TTL/rotation. v1 grants are revoke-only, matching current invite-token
  semantics.
- MCP protocol server/adapter implementation. This slice only manages token
  lifecycle.
- Persisting invites/tokens beyond the existing store behavior. If invite
  persistence lands later, MCP grants inherit it from `chatInviteStore`.
