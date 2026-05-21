# DASH-POLISH delta — 2026-05-15

Author: @claude2 TTVPh3mnu8wERzALQLJO6
Gate: canonical @codex2 RQO32LuIK8xmcV7fq04Oq
Parent contract: dashboard-ia-design-contract-2026-05-14 (canonical-PASS,
base IA shipped: +page.svelte 4-section + DashboardSection.svelte).
This is a POLISH DELTA only — no new endpoints, no IA re-derivation.
Driver: JWPK dogfood directive (relayed via coordinator), lowest queue
priority. Cap ≤120L.

## JWPK directive (verbatim intent, 4 tweaks)

1. **Reorder** — "Open asks" ABOVE "Recent rooms" (decisions-awaiting is
   the higher-signal thing on a dashboard than a rooms preview).
2. **Remove the Quick-surfaces card-grid** — it duplicates the top-nav;
   the grid is visual noise on an overview page.
3. **Sticky header** — the eyebrow/title header stays pinned on scroll.
4. **Replace the "Server status" stub section** with a compact
   **Live / Offline pill** (not a full section) — the page is being
   served, so v1 the pill is statically "Live"; real health probe is a
   later slice (still NOT auto-boot per SURFACE-SIZE-ONLY).

## Touch points (precise)

- EDIT `src/routes/+page.svelte` (currently 159L, stays ≤180L):
  - Swap the two `<DashboardSection>` blocks so **Open asks** renders
    first, **Recent rooms** second (L57–80 block order).
  - DELETE the entire `Quick surfaces` `<DashboardSection>` (L82–93) +
    its `quickSurfaces` array (L33–41) + `.quick-grid` CSS (L140–158).
  - REPLACE the `Server status` `<DashboardSection>` (L95–97) with an
    inline `<span class="status-pill" data-state="live">Live</span>`
    rendered in the header area, not as a section.
- EDIT `src/lib/components/SimplePageShell.svelte` ONLY IF the sticky
  behaviour is approved as **shell-scoped** — see Open Question 1. If
  dashboard-scoped, the sticky wrapper lives in +page.svelte instead and
  SimplePageShell is untouched.
- NO change to +page.ts (data contract unchanged — asks + rooms still
  both fetched; only render order changes).
- NO new components. NO new endpoints. NO /rooms or /asks change.

## Locked acceptance

- Dashboard renders, top-to-bottom: Welcome header (with Live pill) →
  Open asks → Recent rooms. NO Quick-surfaces grid present in DOM.
- Header (eyebrow + title + Live pill) stays visible while the body
  scrolls (sticky), within the approved scope.
- Live pill visible, `data-state="live"`, accessible label.
- Empty states for asks/rooms preserved exactly as base contract.
- `bun run check` 0/0/0 + `bun run build` PASS.
- Browser-runtime on Tailscale host: DOM order asserted (asks before
  rooms), no `.quick-grid` node, pill present, header sticky on scroll.
- Plan event `dash-polish-delta` status=done AFTER canonical PASS.

## Do-not-use

| Rejected | Why |
|---|---|
| Silently make SimplePageShell sticky | Shell is shared by EVERY page; globalising a layout change without a scope ruling is the banked type-widening anti-pattern. Flag, don't assume. |
| Keep Quick-surfaces "just in case" | JWPK explicitly called it noise; top-nav already owns these links. |
| Real server-health probe in this slice | Out of scope; pill is static "Live" v1. Health widget = separate slice, no auto-boot (SURFACE-SIZE-ONLY). |
| Drop the asks/rooms data fetch | Only render ORDER changes; data contract is parent-contract-locked. |

## Open questions for JWPK / coordinator

1. **Sticky scope**: shell-wide (every page header sticky — likely the
   intent if JWPK wants persistent nav) OR dashboard-only? Default if
   unanswered: **dashboard-only** (safest — zero blast radius on other
   surfaces; a follow-up NAV-POLISH slice can globalise deliberately).
2. Live pill placement: inside SimplePageShell header slot vs top-right
   of dashboard body? Default: top-right of the Welcome header region,
   dashboard-scoped (consistent with sticky default).

## Ship order (post canonical design PASS + B2-2 gate clear)

1. DASH-POLISH-1: reorder + delete Quick-surfaces + dead CSS/array (~15min)
2. DASH-POLISH-2: Live pill + sticky header (approved scope) (~20min)
3. DASH-POLISH-3: browser-runtime acceptance on Tailscale host (~15min)
