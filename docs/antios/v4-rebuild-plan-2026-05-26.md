# antios v4 Rebuild Plan — Walkthrough Collation

**Trigger:** JWPK walkthrough on 2026-05-26 evening (msg_kfq1q4w2m5 through msg_7iruzdz17k in `o1r1r3hcdu`). 12+ findings banked. JWPK directive msg_7iruzdz17k: "use ANT plan tools and divide up who needs to do what to get this to a usable tool."

**Walkthrough lead:** @antux (drove flowdeck + narration)
**Collation lead:** @antchatmacdev
**QC:** @antmacdevcodex
**ANT Cards visual lead:** @codexuxant

**Honest read:** build 82 is a visual scaffold across-the-board. Only `/api/chat-rooms` is consumed end-to-end. Every other tab + button is either visually rendered but functionally dead, or rendered with broken decode paths. v0.2.4 + v0.2.5 slices are no longer "polish" — they're **"make TestFlight functional"** blockers.

## Slice v0.2.4 — ANT Cards rebuild + cold-launch fixes (TOP BLOCKER)

| # | Finding | Lead | Reviewer | QC |
|---|---|---|---|---|
| #54 | ANT Cards broken — overlapping text + redundant list + wrong palette | @codexuxant | @antux | @antmacdevcodex |
| #54-a | Scrub-peek gesture: DragGesture(minimumDistance: 0) → per-card lift | @codexuxant | @antux | @antmacdevcodex |
| #54-b | Stop-and-tap spin-out: matchedGeometryEffect + .rotation3DEffect into Room view (spin INTO screen per JWPK msg_qf1bdm97m7) | @codexuxant | @antux | @antmacdevcodex |
| #54-c | Starred-first ordering — star glyph TOP-RIGHT per card (JWPK msg_qf1bdm97m7); needs server-side `room.user_starred` field (cross-team ask to Main) | @codexuxant | @antux | @antmacdevcodex |
| #54-d | Hero number per card: "problems solved this week" (ask-resolved + plan-step-completed + decision-landed counts). "Quiet" not "0" when empty | @antchatmacdev | @codexuxant | @antmacdevcodex |
| #54-e | 3 agent avatars per card + one-line "what they did" | @antchatmacdev | @codexuxant | @antmacdevcodex |
| #54-f | 7-day horizontal activity timeline strip across the bottom of lifted card | @antchatmacdev | @codexuxant | @antmacdevcodex |
| #54-g | Dark atmospheric background (Ink.s900 gradient) — replace the current light grey | @codexuxant | @antux | @antmacdevcodex |
| #54-h | Remove the redundant "Fast switch" flat list — the deck is the only switcher | @codexuxant | @antux | @antmacdevcodex |
| #52 | ServerConfigView reads as "Settings" not "Sign in / Welcome" — needs Concept-D visual treatment (warm `#FFF7ED`, brand wordmark up top, "Welcome to ANT" heading, primary "Sign in" CTA) | @antchatmacdev | @antux | @antmacdevcodex |
| #53 | "Get an API key" link missing on ServerConfigView — onboarding cliff | @antchatmacdev | @antux | @antmacdevcodex |

**v0.2.4 cross-team ask to Main team (room hyz00k0ibh):**
- Server-side `room.user_starred` field on `/api/chat-rooms` response + `POST /api/chat-rooms/:id/star` toggle for cross-device starred state sync.

## Slice v0.2.5 — make TestFlight functional

| # | Finding | Lead | Reviewer | QC |
|---|---|---|---|---|
| #56/#57 | Plans + Inbox can't load — server data confirmed via curl (antux msg_i9zv5xoryt). iOS-side consumption fails. Root cause TBD: auth-scope mismatch / JSON shape mismatch / Codable decode exception. Step 1: flowdeck logs --device to capture response payload + decode error | @antchatmacdev | @antux | @antmacdevcodex |
| #58 | Add (Plus) tab — buttons not clickable + "Comic Sans"-type font. Likely .buttonStyle(.plain) without .contentShape(Rectangle()) + design:.rounded misperceived OR custom font registration failed | @antchatmacdev | @antux | @antmacdevcodex |
| #59 | Settings page — nothing clickable. Linter-edited SettingsHomeView stripped Button + NavigationLink wrappers from rows. Restore proper nav + .contentShape full-row tap targets | @antchatmacdev | @antux | @antmacdevcodex |
| #55 | Room view — 10 sub-findings from msg_jr4okt38b5: (1) remove Yes/No shortcut chips; (2) attachment + table OK; (3) message box auto-expand as user types; (4) Reply chip OK as-is; (5) Reply bigger; (6) React bigger (match Mac antchat); (7) Threads + filtering must work (parity with Mac); (8) Infinity sign too prominent — demote; (9) "More" button = participants + artefacts + screenshots list (like desktop RoomShelf), NOT just "share room"; (10) "share room" currently wrong | @antchatmacdev | @antux | @antmacdevcodex |

## Slice v0.3 — future polish

| # | Finding | Lead | Reviewer | QC |
|---|---|---|---|---|
| #60 | Settings — add Terminals section. List terminal_records for the user (handle / status / linked-chat / actions). Mirrors Mac antchat terminals | @antchatmacdev | @antux | @antmacdevcodex |
| — | ANT Cards motion polish v2 — ambient parallax (CoreMotion), shimmer pass, sound design (Apple Notes / Things 3 idiom), problem-solved flare + haptic | @codexuxant | @antux | @antmacdevcodex |
| — | starred-state cross-device sync — depends on Main team shipping `room.user_starred` field | @antchatmacdev | @antux | @antmacdevcodex |

## Sequencing

1. **NOW**: @antchatmacdev runs `flowdeck logs --device` to diagnose #56/#57 root cause (~5 min diagnose, ~30 min fix). Unblocks Plans + Inbox.
2. **THIS SESSION**: @antchatmacdev fixes Settings click wiring (#59) + Add typography + click wiring (#58). Both are simple SwiftUI fixes (Button wrappers, .contentShape, design:.default). ~1 hour.
3. **THIS SESSION**: @antchatmacdev fixes ServerConfigView visual (#52) + Get-API-key link (#53). ~2 hours.
4. **NEXT SESSION (codexuxant lead)**: @codexuxant scaffolds the ANT Cards rebuild — gesture + spin-out + starred-first. @antchatmacdev provides build feasibility review + hero number / avatars / timeline (depends on Main team's new `/api/activity?roomId&since` endpoint per the original cross-team coords; or use existing /api/asks + /api/plans aggregated client-side).
5. **NEXT SESSION**: Room view 10 fixes (#55) — distributed across @antchatmacdev + @antux for the UX rewrite per item.
6. **AFTER**: Slice v0.3 items.

## Build cadence

- Build 86 = v0.2.4 candidate (ANT Cards rebuild + cold-launch fixes). Target: tomorrow EOD.
- Build 87 = v0.2.5 candidate (functional bar). Target: ~3 days out.
- v0.3 ships when slice v0.3 items land — open timing.

## Cross-team coordination (hyz00k0ibh room with Main team)

@antchatmacdev to post:
- `room.user_starred` field on `/api/chat-rooms` (starred cross-device sync)
- `/api/activity?roomId&since` endpoint (ANT Cards hero number + agent attribution + timeline data)
- Chair/EXPLAIN-THIS endpoint (deferred per Chair strategy session — not blocking v0.2.4 or v0.2.5)

## Open from JWPK

- Cross-team starred sync — JWPK approval to proceed with Main team ask?
- ANT Cards motion prototype — codexuxant builds in SwiftUI Preview-first OR straight in-app? (per project_antios_ant_cards_2026_05_24 memory the design loop was code-first via SwiftUI Preview)
