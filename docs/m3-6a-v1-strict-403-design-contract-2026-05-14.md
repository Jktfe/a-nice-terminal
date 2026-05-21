# M3.6a-v1 Strict-403 Design Contract

**Author:** @claude2
**Date:** 2026-05-14
**Slice:** Phase 3a sub-slice M3.6a-v1 (strict-403 flip for chat-room write routes)
**Scope:** Lock contract + acceptance for the deprecation-window + strict-403 flip on /messages POST, /discussions POST, /members POST, /members DELETE (four write surfaces). NO code in this slice.
**Audience:** @evolveantcodex (gate), @evolveantclaude (coordinator), JWPK
**Constraint:** compact decision-doc shape; ≤260 lines.
**Depends on:** M3.b.4 mode + M3.b.5 responders + M3.4b discussions (write routes shipped), M3.6a-v0 browser-session identity (`browserSessionStore.resolveBrowserSessionSecret`, `POST /api/chat-rooms/:roomId/browser-session` route, optional `resolveMessageAuthorHandle` helper in the messages route, `identityGate.ts` shared helper for pidChain resolution). NOTE: `resolveByBearer` referenced earlier was M4 Remote-ANT mapping, not browser-session; this contract does NOT depend on it.

---

## TL;DR

Four chat-room write surfaces — `POST /api/chat-rooms/:roomId/messages`, `POST /api/chat-rooms/:roomId/discussions`, `POST /api/chat-rooms/:roomId/members`, `DELETE /api/chat-rooms/:roomId/members?globalHandle=` — currently accept client-supplied `authorHandle` / `agentHandle` without strict server-resolved identity for at least one caller path. Per JWPK 2026-05-14 lock, the strict-403 enforcement ships behind a **2-week deprecation window** (Q1=C), warning today and enforcing on the cutover date.

Locked JWPK answers:
- **Q1 timing**: C — deprecation window. Strict-flip off by default; X-Auth-Deprecation header + server-side warning log emit on every legacy-path 200/201. Strict-403 kicks in after a configurable cutover date (default = ship+14d).
- **Q2 legacy pidChain**: pidChain remains a valid server-resolved operator path when no browser cookie is present. CLI/operator callers do not need browser cookies. A PRESENT-BUT-INVALID/MALFORMED/MISMATCHED browser cookie still 403s BEFORE any pidChain fallback (cookie-present-fails invariant per B3 / M3.6a-v0). See Q2 precedence section below for the full 3-tier ordering.
- **Q3 error shape**: 403 body = `{ message: "Server-resolved identity required. POST /api/chat-rooms/{roomId}/browser-session first, or supply a valid pidChain." }`. Friendly hint, no internal-detail leak.
- **Q4 scope**: B — all four write surfaces (messages POST + discussions POST + members POST + members DELETE). /api/sessions/add stays open for bootstrap. Internal endpoints out of scope unless separately designed.
- **Q5 signalling**: X-Auth-Deprecation response header on every warning-phase success + server-side `console.warn` log per request. Operators can audit legacy traffic before strict flip.

Mechanism: a shared `authDeprecation.ts` helper exposes `evaluateDeprecation(routeLabel, now?)` returning `{strict, headerName, headerValue, hintBody}`. Cutover date default `2026-05-28T00:00:00Z`; override via `ANT_AUTH_DEPRECATION_CUTOVER_MS` env (tests use this to exercise both phases without time travel).

Cap-2 implementation discipline: ship under feature-flag-off-by-default; today's existing tests keep passing because the warning phase returns 200/201 unchanged for legacy callers. Strict-flip tests run with env-override pinning `cutoverMs = 0`.

---

## Q1 — Timing (LOCKED by JWPK 2026-05-14: option C)

Strict-403 flip behind deprecation window, not immediate.

| Option | Behaviour |
|---|---|
| a | Immediate flip — strict-403 today, breaks legacy callers |
| b | Version-bump-tied (next manifest cap bump triggers strict) |
| c (LOCKED) | 2-week deprecation window: warn today, enforce after cutover |

Cutover date: `2026-05-28T00:00:00Z` (ship date + 14 days). Tests override via `ANT_AUTH_DEPRECATION_CUTOVER_MS` env.

---

## Q2 — Legacy pidChain (LOCKED: pidChain stays a valid path)

CLI callers using pidChain (M3.7b invite revoke, M3.b.4 mode set, M3.b.5 responders, M3.4b discussions, etc.) remain unaffected. Deprecation/strict rejection happens when no proof resolves, EXCEPT a present-but-invalid/malformed/mismatched browser cookie always fails 403 immediately and never falls through to pidChain or legacy (preserves M3.6a-v0 cookie-present-fails invariant). **Precedence (B3 lock per canonical RQO HOLD 2026-05-14):**

1. **Browser-session cookie FIRST.** If `ant_browser_session` cookie is present, attempt `browserSessionStore.resolveBrowserSessionSecret(secret, roomId)`. If the cookie is present-but-INVALID/MALFORMED/MISMATCHED → throw 403 immediately (preserves M3.6a-v0 strict cookie semantic — NO fallback to pidChain or legacy). If cookie resolves → use that handle.
2. **pidChain SECOND.** If no cookie was supplied (cookie ABSENT, not invalid), attempt pidChain via `identityGate.resolveServerSideHandle(roomId, pidChain)`. If resolves → use that handle.
3. **Deprecation gate THIRD.** If neither cookie nor pidChain resolved (both absent OR pidChain absent and no cookie), evaluate the deprecation window — warning phase today (200/201 + header + log + clientAuthorHandle fallback), strict phase after cutover (403 + hint).

Key invariant: a PRESENT-BUT-INVALID cookie ALWAYS 403s. A PRESENT-BUT-UNRESOLVED pidChain (no terminal/no membership match) DOES fall through to the deprecation gate — pidChain is mixed-mode per Q2, browser-cookie is strict per M3.6a-v0.

---

## Q3 — 403 error shape (LOCKED: friendly hint)

When the cutover has elapsed AND no identity resolves, the route throws SvelteKit `error(403, ...)` with body `{ message: "Server-resolved identity required. POST /api/chat-rooms/{roomId}/browser-session first, or supply a valid pidChain." }`. Hint is route-agnostic; the same body shape applies to /messages, /discussions, /members.

---

## Q4 — Scope (LOCKED by JWPK: option B)

Four chat-room write surfaces gated by deprecation window (POST + DELETE on members both in scope per B1):

| Route | Current state | Strict-flip behaviour |
|---|---|---|
| POST /api/chat-rooms/:roomId/messages | Transition-mode fallback to clientAuthorHandle | Cookie-strict via M3.6a-v0 T3; after cutover, no-identity fallback path → 403 instead of using clientAuthorHandle |
| POST /api/chat-rooms/:roomId/discussions | 400 when pidChain missing; 403 when pidChain present-but-unresolved | NORMALISE per B2: missing-pidChain becomes 403+hint (same shape as v1 deprecation 403). Already-403 cases keep the new hint body. Behaviour stays strict (no warning phase here — discussions has no legacy clientAuthorHandle fallback to deprecate). |
| POST /api/chat-rooms/:roomId/members | No identity-gate today; reads agentHandle from body | NEW: install deprecation-window check + after cutover require cookie-or-pidChain or 403. |
| DELETE /api/chat-rooms/:roomId/members?globalHandle=@x | No identity-gate today; removes by query-string handle | NEW per B1: install deprecation-window check + after cutover require cookie-or-pidChain or 403. Same helper, same precedence as POST /members. |

/api/sessions/add stays open per JWPK direction. Internal admin routes (/api/chat-invites, /api/remote-ant/*) stay admin-bearer-gated; not in this slice.

---

## Q5 — Signalling (LOCKED: header + log)

On every WARNING-phase success (200/201 returned with legacy fallback path):
- `X-Auth-Deprecation: warning;route=<route-label>;cutover=2026-05-28T00:00:00.000Z` response header
- `console.warn("[auth-deprecation] <route-label> accepted a request without server-resolved identity; strict flip at <cutoverISO>")` server-side log

On STRICT-phase rejection (403):
- No header (error response by SvelteKit conventions)
- Server log of the rejection is optional for v1; not required

---

## Q6 — Deprecation-window mechanism

```ts
// src/lib/server/authDeprecation.ts (NEW, ~50L)
export type DeprecationVerdict = {
  strict: boolean;          // true → caller should throw 403 with hintBody
  headerName: string;       // 'x-auth-deprecation'
  headerValue: string;      // warning;route=X;cutover=ISO  OR  enforced;route=X
  hintBody: string;         // 403 body string per Q3
};

export function evaluateDeprecation(routeLabel: string, now?: number): DeprecationVerdict;
```

Route call-site pattern (NEW per route, ~+10L each):
```ts
// after attempting both pidChain + cookie resolution and getting null:
const verdict = evaluateDeprecation('messages-post');
if (verdict.strict) throw error(403, verdict.hintBody);
// else continue with clientAuthorHandle BUT attach X-Auth-Deprecation header to response
```

Header attachment: SvelteKit's `json(body, { headers: { [verdict.headerName]: verdict.headerValue } })`.

---

## Q7 — Implementation file plan (T1 + T2 + T3)

T1 — auth-deprecation helper + /messages route flip:
1. `src/lib/server/authDeprecation.ts` (NEW, ~50L): helper per Q6.
2. `src/lib/server/authDeprecation.test.ts` (NEW, ~80L): test BOTH phases via env override (`ANT_AUTH_DEPRECATION_CUTOVER_MS = 0` → strict; `= Date.now() + 86400000` → warning).
3. `src/routes/api/chat-rooms/[roomId]/messages/+server.ts` (EDIT, ~+10L): detect "fallback to clientAuthorHandle" case (both pidChain + cookie returned null); call evaluateDeprecation; either throw 403 OR attach warning header to success response.
4. `src/routes/api/chat-rooms/[roomId]/messages/server.test.ts` (EDIT, +~30L): new describe — strict-403 phase rejects without identity; warning phase 201 + header.
5. `src/routes/api/chat-rooms/[roomId]/messages/closed-guard.test.ts` (EDIT, ~+10L): add pidChain to test POST bodies so the existing 201 assertions don't accidentally hit the deprecation path (closed-guard pre-empts deprecation but explicit pidChain is cleaner per discipline).

T2 — /members POST + DELETE flip (B1 expanded scope):
6. `src/routes/api/chat-rooms/[roomId]/members/+server.ts` (EDIT, ~+25L): install identity-resolver helper call (cookie-first per B3 precedence, then pidChain) on BOTH POST and DELETE handlers; evaluateDeprecation when both fail; 403 or warning per phase. **DELETE transport (R3 lock per 4INRH 2026-05-14)**: DELETE accepts an OPTIONAL JSON body carrying `{ pidChain }` (matching the M3.7b revoke-route DELETE-with-body precedent); `globalHandle` stays in the query string for backwards-compat. Cookie comes from request headers (`ant_browser_session`) as today. CLI `ant room remove-member` updates to send pidChain via DELETE body; existing query-only callers keep working in the warning phase (no body = falls through to deprecation gate).
7. `src/routes/api/chat-rooms/[roomId]/members/server.test.ts` (EDIT, ~+50L): mirror messages test shape for both phases × both verbs (POST + DELETE).
6b. `src/routes/api/chat-rooms/[roomId]/discussions/+server.ts` (EDIT, ~+5L per B2): change 400 "pidChain is required" to 403 with same hintBody shape as v1 deprecation. Mirror cookie-first precedence per B3 — if cookie resolves, accept and bypass pidChain check.
6c. `src/routes/api/chat-rooms/[roomId]/discussions/server.test.ts` (EDIT, ~+10L): replace existing missing-pidChain 400 assertion with 403; add cookie-resolves path test.

T3 — CLI + manifest:
8. `scripts/ant-cli-room.mjs` (EDIT, ~+18L): runAddMember sends pidChain in POST body (matches mode/responders/discussions CLI pattern); runRemoveMember sends pidChain via DELETE JSON body while keeping `globalHandle` in the query string (R3 transport lock).
9. `scripts/ant-cli-room.test.mjs` (EDIT, ~+18L): assert pidChain in add-member POST body AND pidChain in remove-member DELETE body (globalHandle stays in query).
10. NO new manifest entry — strict-403 is server-side behaviour, not a new CLI verb.
11. Live :6461 verification: POST without pidChain or cookie → today: 201 + header; after env-override cutover: 403 + hint.

NO cross-lane FK or schema changes. NO new tables. NO breaking change today (warning phase is fully backwards-compatible). Plan_milestone done after canonical PASS on full slice.

---

## Locked acceptance — M3.6a-v1 implementation slice

1. authDeprecation.ts ships + 4-8 unit tests covering both phases via env override.
2. /messages POST: warning phase keeps existing 201 behaviour + adds header; strict phase returns 403 with hint when both pidChain + cookie fail.
3. /members POST: same warning + strict gate via same helper.
4. /discussions POST: NORMALISATION per B2 — missing-pidChain returns 403 with the new friendly hint body (was 400). Cookie-first precedence per B3 (if cookie resolves, accept; bypass pidChain check). Tests cover missing-pidChain → 403 and cookie-resolves path. Behaviour stays strict (no warning phase — discussions has no legacy clientAuthorHandle fallback).
5. closed-guard.test.ts + messages/server.test.ts existing transition-mode tests keep PASSING in warning phase (zero-drift).
6. New tests prove strict phase via `ANT_AUTH_DEPRECATION_CUTOVER_MS=0` env override; warning phase via default (cutover in future).
7. ant-cli-room.mjs add-member sends pidChain in POST body AND remove-member sends pidChain via DELETE body (globalHandle stays in query). Existing add-member + remove-member tests + new pidChain assertions pass.
8. Live :6461 verification: 201+header today via curl without pidChain; 403+hint with env override.
9. Cross-lane regression: M4 remote-ant routes (admin-bearer), M3.7b invite revoke (admin-bearer), M3.b.4/5/M3.4b CLI verbs (pidChain), M3.6a-v0 browser-cookie flow all PASS without change.
10. Plan_milestone done AFTER canonical RQO PASS on full T1+T2+T3 — NO premature flip.

---

## Do-not-use

| Choice | Reason |
|---|---|
| Immediate strict-flip today | Breaks every UI caller that posts without browser-session-cookie OR pidChain. Deprecation window is exactly what JWPK Q1=C asks for. |
| Re-gating /modes/responders/invites/M4-remote routes | Already canonical-strict; re-gating adds nothing. (Discussions IS in scope per B2 for the narrow missing-pidChain-becomes-403-with-hint normalisation only — not a full re-gate.) |
| Hard-coded cutover date with no env override | Tests need both phases; env override is mandatory for strict-phase test without time travel. |
| Adding a NEW manifest entry for strict-403 | Strict-403 is server-side behaviour, not a user-facing CLI verb. No manifest row. |
| Storing strict-mode state in the DB | Stateless feature-flag via env + cutover-date suffices. No new schema. |
| Wrapping VALID pidChain callers in the deprecation gate | Per Q2 lock: pidChain stays mixed-mode permanently. CLI callers with a VALID pidChain (registered terminal + room membership) are unaffected. After cutover, CLI callers with MISSING/INVALID/UNREGISTERED pidChain CAN 403 — that is the intended behaviour. |

---

## Open questions for JWPK / team sign-off

All locked by JWPK 2026-05-14 + coordinator-applied defaults per standing-go-with-recommendations delegation. No remaining JWPK opens. Standing future questions tracked separately:

- M3.6a-v2 (out of scope here): when to flip /members admin-flag-gated routes to strict, and whether to extend deprecation infrastructure to other surfaces.
- Whether warning-phase log volume becomes problematic at scale (revisit post 2026-05-28 if logs flood).

---

## What I did NOT verify (timebox honesty)

- Whether SvelteKit's `json(body, { headers })` form correctly merges with the default response-shape headers (Content-Type etc.) — assumed yes based on framework docs; implementation slice confirms via test.
- Whether resolveBrowserSessionSecret returns a usable handle for non-member-of-room cookies — assumed M3.6a-v0 already handles that (cookie scoped to room).
- Whether existing /members POST callers in src/lib/server/* (chairStore, remoteMappingStore, browserSessionStore synthetic membership) go through the HTTP route or call addMembership directly. Implementation slice scouts; if all internal callers bypass the route (direct addMembership call), the /members route flip is a smaller blast radius than naively assumed.

---

## Next step

If @evolveantcodex (canonical RQO32LuIK8xmcV7fq04Oq) gates this contract PASS, I claim-first T1 implementation per the Locked Acceptance. Otherwise: list specific revisions and I take a tightening pass.

End of contract.
