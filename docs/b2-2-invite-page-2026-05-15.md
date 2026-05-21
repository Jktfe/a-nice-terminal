# B2-2 read-only invite page /r/[id] — 2026-05-15

Author: @claude2 TTVPh3mnu8wERzALQLJO6
Gate: canonical @codex2 RQO32LuIK8xmcV7fq04Oq
Driver: v4-v3 parity audit B2-2 — external colleagues cannot accept an
invite in-browser (UI ABSENT). Backend invite/consent API shipped
(B2-1 consent gate live-proven).

## Flow (from verified backend contract)

1. Operator creates invite (admin): `POST /api/chat-invites`
   → invite w/ inviteId + label + password + kinds[] + roomId
2. External colleague opens `/r/<inviteId>` (the shareable link)
3. Page shows room label + password field + handle field
4. Submit → `POST /api/chat-invites/<inviteId>/exchange`
   body `{ password, kind: 'web', handle }` (handle REQUIRED)
   → 200 `{ tokenId, tokenSecret }` (tokenSecret returned ONCE)
   → 401 generic "invite cannot be used" (wrong pw / revoked / not found)
   → **403 handle not permitted by invite** (correct password BUT the
     supplied handle is not in the invite's allowlist — B2-1 consent
     gate). Distinct copy from 401, no hash/secret leak.
5. Page → `POST /api/chat-rooms/<roomId>/join-with-token`
   body `{ tokenSecret }`
   → 200 `{ room, member, identity }`
6. On success → redirect to `/rooms/<roomId>` (now a member) OR render
   inline read-only room view per A4 below

## Backend dependency (researchant API-verify)

The page needs `roomId` + display `label` to (a) show the colleague
what they're joining and (b) call join-with-token (URL needs roomId).
`exchange` returns only `{tokenId, tokenSecret}` — NOT roomId.

**Requested: public `GET /api/chat-invites/<inviteId>/summary`**
(no admin auth — invite-id itself is the capability) returning
`{ inviteId, roomId, label, kindsAllowed: string[], revoked: boolean }`.
NO password_hash / token_hash / failed_attempts (consistent with the
never-echo rule already in chatInviteStore). If a public summary
endpoint is deemed unsafe, fallback A2 below.

## Locked assumptions

| # | Assumption | Why |
|---|---|---|
| A1 | Route `/r/[inviteId]` — short path for shareable links | Matches v3 `/r/[id]` parity item |
| A2 | If no public summary endpoint: page asks password first, exchange returns tokenSecret, then we need roomId — researchant adds roomId to exchange 200 response OR the summary endpoint. Page cannot function without roomId. | Hard dependency — flag explicitly |
| A3 | kind is always `'web'` for this page | It's the browser-accept surface |
| A4 | On join success → `goto('/rooms/' + roomId)` (full room UI already exists) rather than re-implement read-only view | Reuse, no duplicate room renderer |
| A5 | Password + handle inputs; **handle is REQUIRED** — backend web exchange + join-with-token 400 when token has no handle. No pre-bound-handle field exists on current invites (they carry `allowed_handles` only). | Verified backend contract — no optional/pre-bound path |
| A6 | 401 → single generic "This invite can't be used (wrong password, revoked, or expired)" — never leak which | Mirrors backend collapsed-401 security model |
| A8 | 403 → distinct copy: "That handle isn't on this invite's allowlist. Use a permitted handle or ask the inviter to add yours." Form stays usable for a different handle. No hash/secret leak. | B1 consent gate: correct-pw + allowlist-denied → 403, must be distinguishable from 401 |
| A7 | No auth/cookie required to VIEW `/r/[id]` — the invite id is the capability; external colleague has no ANT session | External-colleague is the whole point |

## Component / route

### `src/routes/r/[inviteId]/+page.svelte` (~120L)
- onMount: GET `/api/chat-invites/[inviteId]/summary` → show label or
  "Invite not found / revoked" empty state
- Form: password (required) + handle (text) + Join button
- Submit handler:
  1. POST exchange → tokenSecret. Branch on status:
     - 200 → continue
     - 401 → generic A6 inline error (form stays usable)
     - 403 → distinct A8 allowlist-denied inline error (form usable)
  2. POST join-with-token with roomId from summary → on 200 `goto`
- Loading + error states; no ANT chrome shell (external user — minimal,
  branded landing, not the full SimplePageShell nav)

### `src/routes/r/[inviteId]/+page.ts` (~15L)
- Optional: server `load` to fetch summary so first paint shows the
  label without a client round-trip (SSR-friendly). Falls back to
  client fetch if researchant ships summary as client-only.

## Trust + safety

- Page never displays password_hash/token_hash/failed_attempts
- tokenSecret used only for the immediate join-with-token call; never
  rendered, logged, or stored
- No auto-join — explicit "Join" click (consent)
- Generic 401 copy — no condition leakage
- `/r/[id]` is intentionally session-less; do NOT auto-fill any
  operator identity — external colleague supplies their own handle

## Out of scope (deferred)

- Inline read-only room preview before joining (A4 redirects instead)
- Invite QR code / copy-link affordance (operator-side, separate)
- Multi-room invites (one invite = one room v1)
- Rate-limit UI feedback (backend owns failed_attempts; page just
  shows generic 401)

## Acceptance

- Doc ≤180L
- Route `/r/[inviteId]` renders label + password + handle + Join
- Bad invite id → clean "not found / revoked" state, no crash
- Valid password → exchange → join-with-token → redirect to room
- Wrong password → generic 401 inline error, form stays usable
- bun run check 0/0/0 + build PASS
- Browser-runtime: seed an invite via admin API, open /r/<id> in a
  fresh (no-cookie) context, complete the join, land in the room

## Backend asks summary (researchant)

1. **`GET /api/chat-invites/[inviteId]/summary`** (public, no admin
   auth) → `{ inviteId, roomId, label, kindsAllowed, revoked }`.
   OR (A2 fallback) add `roomId` to the `exchange` 200 response so the
   page can call join-with-token without a separate summary fetch
   (loses the pre-password label display — degraded UX but functional).
   Recommend the summary endpoint.

## Ship order (post backend summary/roomId)

1. B2-2-1: `/r/[inviteId]` route + summary fetch + label/empty states (~40min)
2. B2-2-2: exchange + join-with-token submit chain + 401 handling (~45min)
3. B2-2-3: browser-runtime acceptance (fresh no-cookie context) (~30min)
