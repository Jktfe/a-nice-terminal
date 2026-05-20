# Settings Home — design contract

Date: 2026-05-14
Author: @researchant (research-only scout, no code changes here)
Status: DESIGN-FIRST. No impl claim until canonical PASS + JWPK ACK on Q1-Q7.
Cap: ≤180L. Replaces /ledger as canonical /settings home per JWPK D1.10 + D1.11.

## TL;DR

JWPK (D1.10): "Ledger which I hate as a name should be settings and be the
home." (D1.11): "It should also be where all the shared still lives,
plugins, tools, skills etc." Today on disk: `/settings` is a 43L
NAV-POLISH stub (claude2); `/ledger` is the real Capability Ledger
(81L, reads `firstCapabilityRows`). Slice converts /ledger content +
nav label into a tabbed Settings home covering 8 sections.

## Q1 — Tab structure

Eight canonical tabs per JWPK directive:
1. **Preferences** — theme, chat prefs, memory-recall toggle, room defaults
2. **Identity** — handle, fingerprint, registration status (M3.6a-v1 surface)
3. **Plugins** — M-PLUGINS ecosystem (banked initiative)
4. **Tools** — MCP tools inventory + custom
5. **Skills** — agent skills (Claude Code skills + plugin skills)
6. **Data** — export, backup, prune
7. **System** — server status, version, certs (post-m6.6)
8. **Activity** — legacy /ledger capability table content

**Default proposal**: single-page-with-section-anchors v1 (each tab is
an `<section id="preferences">` etc). `/settings#plugins` deep-links.
Migrate to per-route sub-pages (`/settings/plugins`) in a follow-up
slice once any tab needs heavy state/load function.

## Q2 — Routing pattern

**Default proposal**: keep `/settings` single-route v1. Add
`/ledger` → 301 redirect to `/settings#activity` (back-compat for any
linked references in docs/scripts). No `/settings/*` sub-routes in v1.

## Q3 — Plugins data source (M-PLUGINS dependency)

M-PLUGINS is banked-but-not-shipped per memory `project_ant_plugin_ecosystem_and_fingerprinting`. v1 of Plugins tab MUST be stub-with-empty-state ("no plugins discovered yet — see /discover"). Real wiring deferred to M-PLUGINS slice.

## Q4 — Tools data source (MCP) — delta-2 correction

ORIGINAL Q4 assumed `/api/mcp/grants` was a global tool inventory. Disk
verification proved otherwise: handler at src/routes/api/mcp/grants/+server.ts
GET requires `requireAdminAuth(request)` + `?roomId=` query param, returning
PER-ROOM agent grants (not a global tool list). Wrong shape for a
Settings Tools tab without significant scaffolding (room picker + admin
token UX). v1 of Tools tab is therefore a STUB pointing to `ant skill mcp`
CLI verb. Real wiring deferred to a future Tools tab slice that lands
together with a global `/api/mcp/tools` endpoint OR a per-room Tools
sub-view inside the room view (not Settings).

## Q5 — Skills data source

Skills inventory is currently CLI-side (`ant skill <name>` /
`ant skill show <name>` per `ant --help`). v1 of Skills tab calls a NEW
`GET /api/skills` (returns `{name, description}[]` from a server-side
manifest at `static/skills.json` OR a directory scan). Stub-with-
empty-state if endpoint not yet wired.

## Q6 — /ledger back-compat

**Default proposal**: `/ledger/+page.svelte` becomes a 5-line redirect
component (`onMount(() => location.replace('/settings#activity'))`).
Keeps any external links working. NO server-side 301 (would require
hooks.server.ts add).

## Q7 — Stub-vs-real-data per tab (v1 ship gate)

| Tab | v1 status | Rationale |
|---|---|---|
| Preferences | REAL (theme via existing store, others stubbed) | claude2 theme store landed; defer rest to Preferences-detail slice |
| Identity | REAL (`GET /api/identity/me` if exists, else stub) | Surfacing pidChain handle is JWPK-visible value |
| Plugins | STUB | M-PLUGINS not shipped |
| Tools | STUB (delta-2: endpoint admin+room-scoped, not global) | See Q4 delta-2 |
| Skills | STUB | New endpoint deferred |
| Data | STUB | Export/prune is its own slice |
| System | REAL (server-status widget if claude2 ships separately, else stub) | Cross-lane dep |
| Activity | REAL (lift `firstCapabilityRows` from /ledger) | Trivial port |

## Touch points (for impl)

- EDIT src/routes/settings/+page.svelte ≤200L: tabbed Settings home
  with 8 `<section>` anchors + intro + section contents per Q7 table.
- NEW src/lib/components/SettingsTabs.svelte ≤120L: scroll-to-anchor
  nav strip + active-section indicator (intersection-observer).
- EDIT src/routes/ledger/+page.svelte → 5L redirect component.
- EDIT src/lib/components/SimplePageShell.svelte: nav label "Ledger"
  → "Settings", href `/ledger` → `/settings`. (NO file rename.)
- EDIT src/lib/components/CockpitTopBar.svelte (orphan): same rename
  defensive.
- NO new server routes in v1 (per Q3-Q5 stub-first).

## Locked acceptance

- All 8 tab sections render (real OR stub per Q7).
- `/ledger` redirects to `/settings#activity`.
- Top-nav "Settings" label replaces "Ledger".
- svelte-check 723/723 PASS, 0 errors, 0 warnings.
- Plan event `settings-home-rename-ia` status=done after canonical PASS.

## Do-not-use

| Rejected | Why |
|---|---|
| Per-tab sub-routes in v1 | Premature scope; adds 7 routes for static stubs. |
| Server-side /ledger 301 | Requires hooks.server.ts; client-side redirect is enough. |
| Reset claude2's /settings stub | Replaces it (already a placeholder) — no churn. |
| Bundle GAP-11 Dashboard IA | Different concern; both can ship independent. |

## Open questions for JWPK

1. Tabs as anchors v1 vs sub-routes? Default: anchors v1.
2. Plugins/Skills stubs acceptable for v1, or block on M-PLUGINS landing? Default: stubs.
3. /ledger keep or hard-remove the redirect once dogfood ratifies? Default: keep 30 days.

## What I did NOT verify

- Did NOT confirm `/api/identity/me` exists (Q7 Identity tab assumption).
- Did NOT scope M-PLUGINS impl scope.
- Did NOT measure intersection-observer cost on 8-section page.

## Next step

Awaiting canonical RQO PASS + JWPK ACK on Q1-Q7 defaults. Impl claim-
first (single slice or partial-framed per tab) once both land.
