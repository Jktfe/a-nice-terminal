# M3.6a-v0 Browser Session Identity Design Contract

Date: 2026-05-14
Status: IMPLEMENTED v0 through T3 canonical PASS. T4 closure pending.
Audience: @evolveantcodex, @evolveantclaude, @codex2 RQO, JWPK

## TLDR

Universal strict-403 for `POST /api/chat-rooms/:roomId/messages` is blocked
because browser posts do not have a Unix `pidChain`. CLI callers already
send `pidChain`; `ChatComposer.svelte` sends only `body + authorHandle`.

This contract adds a browser-session identity primitive that resolves to the
same downstream shape as pidChain identity: `terminal_id -> room_membership
-> handle`. Once browser identity exists, message POST can require a
server-resolved identity for every caller.

## Current Disk Facts

- `messages/+server.ts` is mixed/optional: browser cookie wins when present;
  invalid/malformed/mismatched cookie returns 403/no-write; missing cookie
  keeps pidChain/legacy fallback.
- `messages/server.test.ts` pins pidChain fallback plus browser valid,
  invalid, malformed, and mismatch cases.
- `scripts/ant-cli.mjs` `rooms post` sends `pidChain`.
- `scripts/ant-cli-chat.mjs` sends `pidChain` for break/read/typing/draft.
- `ChatComposer.svelte` calls the browser-session route on mount and before
  send through `browserSessionClient.ts`.
- `browserSessionStore.ts` and
  `/api/chat-rooms/:roomId/browser-session` exist; synthetic terminals use
  `pid=0` sentinel.

## Q1 — How Does The Browser Register A Synthetic Terminal?

Recommendation: explicit room-scoped browser session route.

`POST /api/chat-rooms/:roomId/browser-session`

Body: `{ authorHandle }`

Behaviour:

1. Load room; 404 if missing.
2. Require `authorHandle` to already be a member in the room UI/member
   model; 403 if not.
3. Mint opaque random `browser_session_secret`.
4. Store only its hash in a new `browser_sessions` table.
5. Create one synthetic terminal row and one room_membership row in the same
   transaction.
6. Return public metadata and set the browser-session cookie.

Security lock (B2): route accepts same-origin POST only; reject
cross-origin or missing/invalid Origin/Host in browser contexts. CSRF is
SameSite=Strict plus same-origin check in v0; no third-party POST path. The
proof that the browser is a room member is existing membership:
`authorHandle` must already be present in the room model AND
`room_memberships` for that room/handle. Do not auto-create room membership
from arbitrary posted handle.

## Q2 — What Is The Browser pidChain Equivalent?

Use an opaque signed-by-randomness cookie, not JWT and not fake pidChain.

Cookie lock (B3): `ant_browser_session=<secret>` with `HttpOnly`,
`SameSite=Strict`, `Secure` when the request is HTTPS,
`Path=/api/chat-rooms/{roomId}`, and `Max-Age` matching remaining TTL.
Secret is opaque random bytes, never JWT, never pidChain.

Server stores:

- `browser_sessions.id`
- `secret_hash`
- `room_id`
- `terminal_id`
- `handle`
- `created_at_ms`
- `expires_at_ms`
- `revoked_at_ms`
- `last_seen_at_ms`

The cookie proves possession of the browser session secret. The DB row proves
which room handle it maps to. Server stores only `secret_hash`; plaintext is
returned only as Set-Cookie. `expires_at_ms` enforces a 24h rolling TTL and
`last_seen_at_ms` bumps on successful browser-session message posts.

## Q3 — Synthetic Terminal Shape

Because `terminals.pid` is NOT NULL today, v1 uses a reserved sentinel:

- `id = browser-{browser_session_id}`
- `pid = 0`
- `pid_start = 'browser-session'`
- `name = browser:{short_session_id}`
- `source = 'browser-session'`
- `agent_kind = 'browser'`
- `pane_status = 'verified'`
- `expires_at = browser_sessions.expires_at_ms / 1000`
- `meta = { "browser_session_id": id, "room_id": roomId }`

The browser resolver does NOT use `lookupTerminalByPidChain`; it resolves
cookie -> browser_sessions -> terminal_id.

## Q4 — How Does authorHandle Flow Through?

Browser message POST sends both:

- `authorHandle` from UI state.
- `ant_browser_session` cookie automatically.

Server order:

1. Resolve browser cookie to `{ roomId, terminalId, handle }`.
2. Require cookie roomId matches route roomId.
3. Require body `authorHandle` normalises to resolved handle.
4. Store message as resolved handle.

Mismatch is 403. Missing cookie is 401/403 (gate can pick exact status), not
fallback, once universal strict ships.

## Q5 — Lifecycle / Revocation

Recommendation:

- Default browser session TTL: 24h rolling on activity.
- Browser identity is per browser profile, not per tab; same cookie reused
  across tabs in that profile for that room.
- Session creation is explicit route call, expected on room load before first
  browser post.
- `last_seen_at_ms` touches on successful browser message POST and extends
  `expires_at_ms` by 24h from that activity, capped only by revocation.
- Room remove-member revokes every browser_session for that room+handle and
  marks synthetic room_memberships `revoked_at_ms`.
- Explicit browser logout/leave-room route can revoke the session.
- Expired browser sessions do not resolve and are swept later.

## Q6 — Identity Resolver Shape

Add a shared resolver rather than spreading logic in the messages route:

`resolveMessagePostIdentity({ roomId, rawBody, request })`

Return:

- `{ mode: 'pidChain', handle }`
- `{ mode: 'browserSession', handle }`
- `{ mode: 'legacyNoIdentity' }` only in mixed-strict interim
- `null` / throw for invalid proof

Universal strict allows only pidChain or browserSession modes.

## Q7 — Message POST Rollout

Phase v1 mixed strict (optional):

- pidChain supplied + unresolved -> 403.
- no pidChain and no browser cookie -> legacy fallback remains.

Phase v2 universal strict:

- valid pidChain -> use resolved handle.
- valid browser session -> use resolved handle.
- missing/invalid proof -> reject.
- client `authorHandle` is never proof; it is only checked against resolved
  identity for browser UX sanity.

## Q8 — API / Test Surface

New files expected:

- `src/lib/server/browserSessionStore.ts`
- `src/lib/server/messagePostIdentity.ts`
- `src/routes/api/chat-rooms/[roomId]/browser-session/+server.ts`
- tests for store, route, resolver, message-post mixed hook,
  same-origin/CSRF, and cookie attributes

Existing files changed later:

- `messages/+server.ts`
- `ChatComposer.svelte`
- `messages/server.test.ts`

## Q9 — Manifest / Plan Naming

This precursor should be tracked separately from M3.6a strict-403.

No CLI manifest row is expected for this internal browser identity primitive;
the visible behaviour is browser posting identity, not an `ant` verb.

Plan row:

- `m3.6a-v0-browser-session-identity` planned -> done after this ships.

M3.6a strict-403 remains planned until universal strict lands.

## Locked Acceptance

- Browser identity does not fake pidChain.
- Browser session route never creates a membership for a non-member handle.
- Browser session route requires same-origin POST and SameSite=Strict cookie
  posture; no cross-origin mint.
- Cookie is HttpOnly, SameSite=Strict, Path-scoped to the room API, Secure on
  HTTPS, Max-Age tied to remaining TTL; DB stores hash only.
- `browser_sessions` row + synthetic terminal (`pid=0`) + room_membership
  write are one transaction; failure leaves no orphan session/terminal/
  membership.
- Browser message POST verifies body `authorHandle` against resolved cookie
  handle before storing.
- v0 may add mixed/optional browser resolver hook, but MUST NOT flip
  universal strict-403.
- Universal strict-403 remains M3.6a-v1 and is blocked until browser session
  identity exists.

## Open Questions For JWPK / Gate — LOCKED via coordinator delegation 2026-05-14

JWPK delegated minor decisions to coordinator: go with recommendations and
document decisions until check-in. Defaults below are locked for v0; JWPK can
override with a one-line delta.

1. Browser identity scope — LOCKED: per browser profile, not per tab. Reason:
   one cookie per profile is simple and matches normal web session semantics.
2. TTL — LOCKED: 24h rolling TTL, independent of invite lifetime. Reason:
   browser session is a local UI auth proof, not an admission invite.
3. Creation timing — LOCKED: route called on room load before first browser
   post. Reason: avoids first-send failure and surfaces auth errors early.
4. Remove-member revocation — LOCKED: revoke every browser session for that
   room+handle. Reason: membership removal ends browser posting rights.
5. Terminal pid shape — LOCKED: `pid=0` sentinel, no nullable-pid schema
   migration in v0. Reason: preserves existing terminal schema; browser
   sessions never use lookupTerminalByPidChain.

## Do Not Use

- Do not send fake PID chains from browser JS.
- Do not treat `authorHandle` as authentication.
- Do not silently allow cookie handle mismatch.
- Do not mark IDENTITY-GATE-POSTS complete while browser remains legacy.

## What I Did Not Verify

- I did not live-test browser posting in a real browser.
- I did not inspect v3 cookie/session auth for liftable code.
- I did not live-test same-origin/CSRF checks in a browser; implementation
  tests cover Origin/Host handling and cookie attributes.

## Next Step

T4 closure may mark the v0 browser-session-identity plan row done only after
canonical final PASS. Do not flip M3.6a strict-403; that remains M3.6a-v1.

## M3.6a-v1 Strict-403 Flip — JWPK Option B Locked 2026-05-14

**Scope**: All chat-room write endpoints require server-resolved identity
(pidChain or browser-session). Missing/invalid/spoofed → 403. Bootstrap path
`/api/sessions/add` stays open. Internal endpoints out of v1 scope.

**Route inventory** (all require server-resolved identity in v1):
- `POST /api/chat-rooms/:roomId/messages` — message post
- `POST /api/chat-rooms/:roomId/messages/:messageId/reactions` — reaction add/remove
- `POST /api/chat-rooms/:roomId/members` — membership add
- `PUT /api/chat-rooms/:roomId/members/:id` — membership update
- `DELETE /api/chat-rooms/:roomId/members/:id` — membership remove
- `POST /api/chat-rooms/:roomId/invites` — invite create
- `PUT /api/chat-rooms/:roomId/mode` — room mode update
- `POST /api/chat-rooms/:roomId/discussions` — discussion create
- `PUT /api/chat-rooms/:roomId/discussions/:id` — discussion update
- `DELETE /api/chat-rooms/:roomId/discussions/:id` — discussion close

**Bootstrap exceptions** (stay open, no strict-403 in v1):
- `POST /api/sessions/add` — terminal registration (bootstrap entry point)
- Internal health/diagnostic endpoints (e.g., `/api/health`, `/api/diagnostics/*`)

**Auth semantics**:
- CLI callers: must send valid `pidChain` (pid + pid_start) → resolve via `lookupTerminalByPidChain`
- Browser callers: must send valid `ant_browser_session` cookie → resolve via `browserSessionStore`
- Missing proof → 403 (not fallback)
- Invalid proof (malformed, expired, revoked, non-member) → 403
- Spoofed proof (handle mismatch, cross-room, cross-origin mint) → 403

**Migration/rollback plan**:
- v0 → v1 flip: single commit that changes `resolveMessagePostIdentity` to reject `legacyNoIdentity` mode with 403
- v1 → v0 rollback (if needed): revert the commit, restore mixed-strict mode
- No schema migration required; v0 already has browser_sessions + synthetic terminals
- Test coverage must prove 403 on all routes for: missing proof, invalid proof, spoofed proof

**Test coverage requirements** (per route above):
- 403 on missing identity (no pidChain, no cookie)
- 403 on invalid pidChain (non-existent terminal, expired, revoked)
- 403 on invalid cookie (malformed, expired, revoked, non-member handle)
- 403 on handle mismatch (body authorHandle ≠ resolved handle)
- 403 on cross-room attempt (cookie room_id ≠ route room_id)
- 200 on valid identity (pidChain or cookie) with matching handle
