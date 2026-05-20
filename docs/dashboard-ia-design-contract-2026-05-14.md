# Dashboard IA — design contract (PATH-IA-B reshape)

Date: 2026-05-14
Author: @researchant (impl follows immediately under locked acceptance)
Status: DESIGN-FIRST. Coordinator-pre-ratified PATH-IA-B per JWPK D1.x dogfood.
Cap: ≤180L. Replaces "Rooms-list dominates the Dashboard" structural gap (GAP-11).

## TL;DR

JWPK D1.x verbatim: "if that is the Dashboard why a big element saying ROOMS".
Today `/` is `<SimplePageShell title="Rooms." eyebrow="Live">` over `<RoomStrip>`
— functionally a Rooms list, not a Dashboard. PATH-IA-B reshape per coordinator:
multi-section overview combining recent rooms preview + recent asks +
quick-links to the deep surfaces. Per-section preview bounded (top-N) so
the page stays scannable.

## Q1 — Available data sources (probe-verified 2026-05-14)

| Source | Endpoint | Status | Use |
|---|---|---|---|
| Rooms | `/api/chat-rooms` | 200 | Recent rooms widget (top 5 by lastUpdate) |
| Asks | `/api/asks` | 200 | Open asks widget (top 5, status≠resolved) |
| Plans | `/api/plan/[planId]` per-plan | n/a global | Stub — needs `/api/plan` list endpoint |
| Terminals | `/api/terminals/[id]` per-id | n/a global | Stub — needs global list endpoint |
| Sessions | `/api/sessions/add` write-only | n/a read | Stub |
| Identity | `/api/identity/me` | 404 | Stub — same as Settings Identity tab |

## Q2 — Widget structure

Four sections, equal-weight visual treatment, rendered top-to-bottom in this order:
1. **Welcome** — eyebrow + title + summary intro (uses SimplePageShell as today)
2. **Recent rooms** — top 5 from /api/chat-rooms (newest first), each a card
   linking to `/rooms/[id]`. "View all" link → `/rooms`.
3. **Open asks** — top 5 unresolved from /api/asks, each linking to `/asks`.
   "View all" link → `/asks`.
4. **Quick surfaces** — flat link grid: Rooms / Terminals / Plans / Search
   / CLI / Settings (mirrors top-nav but with descriptive subtitles per link).
5. **Server status (stub)** — placeholder for the future widget per JWPK D1.x
   GAP-7. Coordinator+claude2 own the actual widget; Dashboard reserves the
   slot now to avoid future re-shuffling.

## Q3 — Title / eyebrow / summary copy

- Title: **"Dashboard."** (matches Settings nav-rename pattern)
- Eyebrow: **"Overview"**
- Summary: "Recent rooms, open asks, and quick links to the deep surfaces."

## Q4 — Top-N bound + empty states

Top-N = 5 per widget. Empty state per widget shows a single nudge sentence
("No rooms yet. <a href='/rooms'>Create one</a>" / "No open asks. ...").
This keeps the Dashboard scannable + still useful when the system is fresh.

## Q5 — Touch points

- EDIT src/routes/+page.svelte ≤180L: 4-section Dashboard layout.
- EDIT src/routes/+page.ts ≤30L: parallel-fetch `/api/chat-rooms` + `/api/asks`,
  return `{ chatRoomsFromServer, asksFromServer, serverRoomListFailed }`.
- NEW src/lib/components/DashboardSection.svelte ≤80L: reusable section
  shell (eyebrow + title + view-all link + body slot).
- NO new server routes (per Q1 stub-first for missing endpoints).
- NO change to /rooms (full list view stays as-is).

## Locked acceptance

- Dashboard renders all 5 sections (real OR stub per Q1).
- Recent rooms shows top-5 cards each linking to `/rooms/[id]`.
- Open asks shows top-5 unresolved or empty-state nudge.
- Quick surfaces grid links to all top-nav targets + descriptions.
- Server-status section placeholder visible (no widget yet).
- svelte-check passes 0 errors 0 warnings.
- Plan event `dashboard-ia-path-b-overview` status=done after canonical PASS.

## Do-not-use

| Rejected | Why |
|---|---|
| Drop /rooms full-list page | Coordinator PATH-IA-A would replace. PATH-IA-B keeps both. |
| Keep "Rooms." H1 | The whole point is it ISN'T a Rooms-list-titled page anymore. |
| Add new endpoints in this slice | Out of scope; stubs reference future endpoints. |
| Real-time WS hooks | Audit M13 WS port is a separate slice; refresh on navigation v1. |
| Recent-terminals real data | No global terminals endpoint; would block this slice. |

## Open questions for JWPK

1. Top-N=5 acceptable per widget vs different counts? Default: 5/5.
2. Server-status placement: top-of-Dashboard vs bottom-of-Dashboard vs in nav? Default: bottom of Dashboard for now; top-nav move is claude2 NAV-POLISH followup.
3. Recent-terminals + pinned-plans deferred until endpoints land — confirm OK? Default: yes.

## What I did NOT verify

- Did NOT verify /api/asks response shape beyond `{asks:[]}` empty array.
- Did NOT prototype IntersectionObserver-driven lazy load (each widget renders eagerly v1).
- Did NOT measure render cost of all-eager-fetch on cold load.

## Next step

Implementation proceeds claim-first under THIS doc Locked Acceptance.
Single slice (no partial-framing needed; all widgets fit in scope).
