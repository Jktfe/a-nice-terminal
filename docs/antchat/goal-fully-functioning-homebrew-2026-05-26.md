# /goal — Fully functioning Antchat on Homebrew (2026-05-26)

**Set by:** JWPK in `o0jyrbot87` msg_w1avdtvj1j
**Owner build lane:** @antchatmacdev
**Status:** SLICE-0 (cask 4.0.1 install path) almost-green — waiting on antonline.dev Vercel deploy to propagate v4.0.1 DMG; rest of the goal sliced below.

---

## Goal text

> Right - set the /goal a full functioning antchat on homebrew - every screen and click tested on flowdeck for usability and UX optimisation to replicate the use in the desktop app

## Three acceptance criteria

Mirroring @antux's framing of the parallel antios /goal:

1. **Install path works end-to-end** — `brew install --cask antchat` (or `brew upgrade`) on a fresh machine produces a launchable, notarised app, no manual steps.
2. **Every screen flowdeck-captured** — `flowdeck ui mac screen --app Antchat --output …` lands a PNG + AX tree for every distinct view state. Screens covered: ServerConfig, AppShellView (3 col + 2 col layouts), Sidebar (Sources / Saved Rooms / On This Mac), Ops (asks / rooms / plans), Room column + Room shelf tabs (Plan / Asks / Memories / Artefacts / Bridges / Settings / Chair / Validation), Bridges strip, BringInAppRow, Settings, RemoteAgentInviteModal, AntToolbar overflow.
3. **Every button + function clickable + usable** — `flowdeck ui mac click` exercised against every interactive AX element. UX parity vs the web/desktop app (antv4 web) — gaps fixed or explicitly banked with reason.

GOAL NOT MET until all three are green.

---

## SLICE-0 — Install path proven (in flight)

Currently blocked on antonline.dev Vercel auto-deploy publishing the v4.0.1 DMG.

| Step | Status |
|------|--------|
| `release-dmg.yml` builds notarised + stapled DMG | ✅ run 26477147195 |
| `Publish DMG to antonline.dev` workflow step | ✅ DMG at `antonline-dev/static/releases/antchat/v4.0.1/` |
| Cask formula bumped to v4.0.1 + correct sha256 | ✅ dc83581 in homebrew-antchat |
| Cask URL points at antonline.dev | ✅ dc83581 |
| `https://www.antonline.dev/releases/antchat/v4.0.1/Antchat-4.0.1.dmg` returns 200 | ⏳ Polling in task `bjxlxc3ii` |
| `brew upgrade --cask antchat` succeeds + Gatekeeper accepts the notarised DMG | ⏳ |

When the 200 arrives — post in `o0jyrbot87` so JWPK can upgrade.

---

## SLICE-1 — ServerConfig / sign-in flow

Design intent: `docs/concept-d/slice-1-shell.md` (Cold-launch path)

### Captures to land

```bash
flowdeck ui mac screen --app Antchat --output docs/antchat/golden-walk/2026-05-26/01-serverconfig-cold.png
flowdeck ui mac screen --app Antchat --tree --output docs/antchat/golden-walk/2026-05-26/01-serverconfig-cold.tree.json
```

State variants to capture:
1. Cold launch (no server configured)
2. With API key field focused
3. With invalid key entered (error toast)
4. With valid key entered + Connect tapped (loading → main shell)

### Interactions to test

| AX element | Action | Expected |
|-----------|--------|----------|
| `Server URL` text field | `flowdeck ui mac type "https://accounts.antonline.dev"` | Field accepts input |
| `API key` secure text field | `flowdeck ui mac type --secure "ak_..."` | Field masks input |
| `Connect` button | `flowdeck ui mac click "Connect"` | Loads main shell when key valid; shows error when invalid |
| `Get an API key` link (current bug: missing per task #53) | `flowdeck ui mac click "Get an API key"` | Opens antonline.dev/keys in browser |
| `?` / Help icon | TBD | Should reveal onboarding guidance |

### Known v0.2.x bugs to verify-or-fix

- Task #52 (currently `pending`): ServerConfigView reads as "Settings" not "Sign in / Welcome". Header copy fix.
- Task #53 (currently `pending`): "Get an API key" link missing on cold-launch ServerConfigView.

### UX-parity check vs antv4 web

- Web `/sign-in` shows brand mark + onboarding context + sign-in form. Mac equivalent should mirror the IA, not just be a "settings page on cold launch".

### PASS gate

- All 4 state captures saved
- All AX interactions return success
- Tasks #52 + #53 closed
- JWPK eyeball-pass on the visual

---

## SLICE-2 — AppShellView main shell

Design intent: `docs/concept-d/slice-1-shell.md` (2-col NavSplitView + HStack-in-detail per memory `project_mac_app_2col_navsplitview_2026_05_22`)

### Captures
- 3-col layout (sidebar + ops + room column)
- 2-col layout (sidebar collapsed)
- Single-col layout (room column full bleed)
- All 3 detail-column slot states: Today / Room / Empty-state

### Interactions
- Sidebar collapse / expand
- Sidebar resize
- Room column open / close
- Toolbar buttons (Share, Settings, Status)

### UX parity vs antv4 web
- Web has tabs (Inbox / Rooms / Plans / Settings); Mac has sidebar+ops+room column. Map equivalence: web Inbox ≈ Mac OpsColumn `Asks` section; web Rooms ≈ Mac Sidebar Saved Rooms; web Plans ≈ Mac OpsColumn `Plan progress` section.

---

## SLICE-3 — SidebarColumn

Design intent: `docs/concept-d/slice-2-sidebar.md` (Sources / Saved Rooms / On This Mac)

(audit details TBD when SLICE-2 lands)

---

## SLICE-4 — OpsColumn

Design intent: `docs/concept-d/slice-3-ops-today.md`

---

## SLICE-5 — RoomColumn + RoomShelf tabs

Design intent: `docs/concept-d/slice-4-room-view.md`

---

## SLICE-6 — BridgesStrip + BringInAppRow + BringInReviewTab

Design intent: `docs/concept-d/slice-5-bridges-dragdrop.md` + `project_premium_contract_fan_out_pattern_2026_05_25`

---

## SLICE-7 — Settings + AntToolbar

(reach via toolbar; covers all Slice-8 user-status + Slice-1.5 signing surfaces)

---

## SLICE-8 — Asks + Invite + RemoteAgentInviteModal

Design intent: `docs/concept-d/slice-2.5-invite-modal.md` if it exists; otherwise from-scratch.

---

## SLICE-9 — End-to-end GOLDEN walk

A single uninterrupted flowdeck session that exercises every flow:
1. Cold install (`brew install --cask antchat` on a clean machine)
2. Launch + ServerConfig + sign-in
3. Land on main shell
4. Walk every sidebar source
5. Walk every saved room
6. Open one room, exercise every shelf tab
7. Send + receive a message
8. Invite an agent via RemoteAgentInviteModal
9. Bring-in flow (BringInAppRow)
10. Bridges drag-drop
11. Settings sweep
12. Exit + relaunch (cold + warm)

Capture: continuous session via `flowdeck ui mac session …`.
Verdict per step: PASS / FAIL with bug ID.
**Goal is met when SLICE-9 ends green.**

---

## Cross-cutting concerns

| Concern | Where it lives | Status |
|---------|---------------|--------|
| Cask install path automation | release-dmg.yml + cask-bump.yml | Manual cask bump in dc83581; cask-bump.yml workflow broken (task #36) |
| antonline.dev publication chain | release-dmg.yml `Publish DMG to antonline.dev` step | Works server-side; Vercel deploy timing variable |
| Notarisation + stapling | release-dmg.yml | Working |
| Stable signing for dev builds | slice-1.5-signing.md | ✅ shipped |
| Logo / brand-mark consistency | AntBrandMark.swift | ⚠ JWPK flagged "logo getting worse" — diagnose in SLICE-2 |

---

## Open coordinations

- @codexuxant — when ANTCardsContainer + ChatView WIP commits land on antios, I can swap to Mac lane fully.
- @antux — Mac antchat doesn't have a parallel `mobile-redesign-spec` doc; this audit doc fills that gap pending @antux's review.
