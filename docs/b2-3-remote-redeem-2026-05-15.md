# B2-3 remote-bridge redeem landing /remote/[admissionId] — 2026-05-15

Author: @claude2 TTVPh3mnu8wERzALQLJO6
Gate: canonical @codex2 RQO32LuIK8xmcV7fq04Oq
Scope: **scope-A only** (coordinator-approved). Remote-operator REDEEM
landing. Scope-B (operator mappings-management console) DEFERRED — needs
an in-browser admin-auth architecture decision, NOT in this slice.
Driver: v4-v3 parity audit B2-3 — `remote-ant` API complete on disk but
the multi-machine bridge is unusable in-browser (UI ABSENT).

## Flow (from verified backend contract)

1. Local operator mints an admission (admin CLI/API `POST
   /api/remote-ant/admit`) → gets `admissionId` + a one-time
   `code` (`ANT-XXX-YYYY`). They send the remote colleague the link
   `/remote/<admissionId>` + the code out-of-band.
2. Remote operator opens `/remote/<admissionId>` in a browser on the
   remote machine.
3. Page shows: code field + remote-instance-label field + direction
   selector (in / out / both, default both).
4. Submit → `POST /api/remote-ant/admissions/<admissionId>/redeem`
   body `{ code, remoteInstanceLabel, direction }` (no auth — the code
   IS the auth, single-use hashed-compare).
   - 201 `{ mapping:{id,room_id,remote_instance_label,direction,
     lifetime_preset,expires_at_ms}, bridge_token:'rbt_...' }`
   - 410 collapsed "admission not found, revoked, expired, or already
     redeemed" (covers wrong code too — never leaks which)
   - 400 missing/blank field
5. On 201 → render the **bridge-token reveal screen**: show
   `bridge_token` ONCE with a copy affordance + the mapping summary +
   an explicit "this is shown once — save it into your remote ANT
   instance now" warning. No redirect (the secret must be copied first).

## Backend dependency

NONE blocking. Unlike B2-2 (which needed a `/summary` endpoint because
`roomId` gated the follow-on join-with-token), B2-3's redeem returns
`mapping.room_id` in the 201 and the browser makes **no follow-on call**.
So the landing is fully functional preview-less. A public
admission-preview endpoint (room label before code entry) is an OPTIONAL
low-pri UX follow-on, explicitly NOT requested as a blocker here.

## Locked assumptions

| # | Assumption | Why |
|---|---|---|
| A1 | Route `/remote/[admissionId]` — admissionId in path, code typed | Mirrors B2-2 `/r/[inviteId]` parity shape; code is the secret, never in URL |
| A2 | No `+page.ts` server load (no preview endpoint, nothing to prefetch) | Pure client form → POST; differs from B2-2 deliberately |
| A3 | direction default `'both'`; selector offers in/out/both | Backend enum; both is the common bridge case |
| A4 | 410 → single collapsed copy, never leaks which condition | Mirrors backend collapse + B2-2 A6 security model |
| A5 | bridge_token shown ONCE on success, copy-to-clipboard, never persisted/logged/stored/in-URL, never re-fetchable | secret-never-leaks discipline; the rbt_ token is the remote instance's long-lived bridge credential |
| A6 | No auth/cookie to view `/remote/[id]` — admissionId+code are the capability; remote operator has no ANT session | External-operator is the whole point (same as B2-2 A7) |
| A7 | No redirect after success — page stays so the token can be copied; a "Done" affordance returns to `/` | Redirecting would destroy the one-time secret before it's saved |
| A8 | Single-use: after a successful redeem, re-submitting the same code → 410. Page shows the collapsed error if user resubmits. | Backend marks accepted_at_ms in-tx; no client-side guard needed |

## Component / route

### `src/routes/remote/[admissionId]/+page.svelte` (~180L)
- Two render states driven by `$state` (no shell — root layout already
  bare, mirrors B2-2):
  - **form state**: code (required) + remoteInstanceLabel (required) +
    direction `<select>` + Redeem button; inline collapsed error on
    400/410; form stays usable after error.
  - **success state**: bridge_token in a readonly field + Copy button
    (navigator.clipboard, graceful fallback to select-text) + mapping
    summary (room_id, label, direction, lifetime_preset, expires) + a
    prominent "shown once — save it now" callout + a "Done" link to `/`.
- Submit handler: POST redeem, branch 201 → success state (capture
  bridge_token in a local — NOT logged, NOT in any store); 400/410 →
  collapsed inline error; network throw → generic retry copy.

## Trust + safety

- bridge_token: rendered once, copy affordance only, never written to
  localStorage / any store / console / URL / analytics. Lives only in a
  component-local until the page unloads.
- Collapsed 410 — no condition disclosure (revoked vs expired vs wrong
  code vs already-redeemed all identical copy).
- Page is intentionally session-less; never auto-fills operator
  identity — the remote operator supplies label themselves.
- code typed into a field, never placed in the URL or a query param.

## Out of scope (deferred)

- Scope-B operator mappings-management console (list/mint/status/
  revoke/quarantine) — needs in-browser admin-auth architecture, separate
  slice, NOT mine to invent.
- Public admission-preview endpoint + pre-redeem room label — optional
  low-pri UX follow-on, not load-bearing.
- Auto-configuring the remote instance with the token (CLI/agent job).
- Multi-admission / batch redeem.

## Acceptance

- Doc ≤180L.
- `/remote/[admissionId]` renders code + label + direction + Redeem.
- Bad/blank field → 400 collapsed inline error, form usable.
- Wrong/expired/revoked/used code → 410 collapsed copy, form usable,
  never leaks which.
- Valid code → success screen shows bridge_token (once) + copy works +
  mapping summary + save-now warning; no redirect; token never logged.
- `bun run check` 0/0/0 + `bun run build` PASS.
- Browser-runtime on Tailscale host: seed admission via admin
  `POST /api/remote-ant/admit`, open `/remote/<id>` in a fresh no-cookie
  context, redeem with the real code, assert bridge_token rendered +
  copy + collapsed-error path on a second (now-used) submit.

## Ship order (design-ready now, no backend dep)

1. B2-3-1: `/remote/[admissionId]` route + form state + 400/410 (~40min)
2. B2-3-2: redeem POST + one-time bridge_token reveal + copy (~40min)
3. B2-3-3: browser-runtime acceptance, fresh no-cookie context (~30min)
