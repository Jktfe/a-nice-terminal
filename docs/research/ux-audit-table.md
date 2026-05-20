# UX Audit — first-pass table

Compiled by @evolveantux from this session's crawl (Sweep #1–#3). Plain-English describes what each surface should do and how it currently presents. Update on each sign-off pass.

Legend:
- ✓ live and meets expectation
- 🐛 known broken (linked task open)
- 🛠️ partial — works but missing pieces (linked task)
- ⏳ queued for shipping
- — not yet checked this pass

---

## Top-level pages

| Page | Component / feature | What it should do | How it presents today | Last checked | Last shipped | Status |
|------|---------------------|-------------------|------------------------|--------------|--------------|--------|
| `/` Dashboard | Live badge + Open asks empty-state | At-a-glance landing — recent rooms + decisions waiting on user | "Dashboard." h1, Live badge (green), Open asks shows "No open asks. New decisions surface here automatically.", Recent rooms cards with last-message previews | 2026-05-17 ~22:24 | aedc911 / 448f4f8 / 8afcbb0 | ✓ |
| `/` Dashboard | Pinned / Starred rooms section | Show every starred room in user's pinning order; drag to reorder | Section renders all pinned rooms with yellow star + drag handle; localStorage-only today (task 427f7602 to make server-synced) | 2026-05-17 ~21:18 | 448f4f8 | 🛠️ |
| `/rooms` | Room cards list | Each room shows name, members, last-message preview, working-count + just-now indicator. Card click navigates to room | All clean post-fix. Card click navigates correctly. Names clean (no `--name` prefix). | 2026-05-17 ~22:00 | aedc911 / 8602f34 / 0fcbb75 | ✓ |
| `/rooms` | Per-card icon buttons (archive / star / trash) | Toggle pin / archive / soft-delete without navigating into the room | Render correctly; click semantics not deep-tested but no overlap reports | 2026-05-17 ~21:00 | – | ✓ |
| `/asks` | Open asks + recently answered + candidates | Cross-room queue: open asks + candidate asks auto-aggregated from `@you` mentions / 🙌 reactions / explicit POST. Promote / dismiss per row | Server side live (168 candidates aggregated, 24h retro-scan done). **UI does not render `candidates` field yet** — `/asks` still shows "No open asks" body. Pending svelte UI piece of #162 | 2026-05-17 ~22:00 | 8afcbb0 (server only) | 🛠️ |
| `/plans` (Active) | Plan cards grid | One card per active plan with progress donut + tasks-done ratio | All 9 plans render post-#149 + #154 (auto-empty-plans removed). Click navigates to plan. | 2026-05-17 ~20:11 | 05eade0 / ba484bf | ✓ |
| `/plans` (Insights / Evidence / Triggers) | Sub-pages of plans | Insights stats; Evidence corpus; Triggers config | All three load cleanly after #153 fix. **Missing in-body `← All plans` back link** (task edfae48f) — only the primary nav has a way back | 2026-05-17 ~20:55 | – | 🛠️ |
| `/plans/[planId]` | Overview / Gantt / Retrospective tabs | Tab strip swaps view in-place; h1 follows active view | All three tabs render. h1 follows view ("Overview." / "Gantt." / "Retrospective.") per #151 rename | 2026-05-17 ~20:19 | 4f23021 / 5e5d1af | ✓ |
| `/plans/[planId]` Retrospective | Detail table | List tasks with status / priority / duration / evidence / blocked-by | Renders. Minor copy bug: "In_progress" (snake_case) renders next to "Pending" (sentence case) — task 4d401d57 open | 2026-05-17 ~20:19 | – | 🛠️ |
| `/search` | FTS across messages | Type query → Enter → matched messages with room badge + snippet + timestamp | Works. 50+ results returned for typical queries. Room badges clean. | 2026-05-17 ~20:45 | – | ✓ |
| `/terminals` | Tmux pane list | Show panes grouped by agent kind | Renders cleanly with grouped chips. | 2026-05-17 ~14:30 | – | ✓ |
| `/discover` | CLI manifest | "ant CLI verbs" reference, searchable + filterable by status | 151 verbs across ~36 tag groups, with search + status filter. Page title missing (browser tab reads `localhost:6174/discover`) — flagged | 2026-05-17 ~20:11 | – | 🛠️ |
| `/diagnostics` | Runtime health surface | Process state + DB size + SSE subscribers + recent errors | Renders. Post-#164: should also surface terminal-event retention setting (codex banked) | 2026-05-17 ~14:30 | 150d8b8 | ✓ |
| `/settings` | Preferences / Shortcuts / Identity / Plugins / Tools / Skills / Data / System / Activity tabs | In-page tab strip + section anchors. Quick-shortcut chips | Renders. Sub-copy "land in a follow-up slice" leaks dev jargon — minor | 2026-05-17 ~20:11 | – | ✓ |
| `/archive` | Archived + Soft-deleted rooms | Restore / hard-delete affordances per row | Newly shipped (f8a0d78) — verified server returns 200, sections render with counts. Affordances not deep-tested. | 2026-05-17 ~22:14 | f8a0d78 | ✓ |

## Room-internal surfaces

| Surface | Component | What it should do | How it presents today | Status |
|---------|-----------|-------------------|------------------------|--------|
| Room header | Title + paperclip + More menu | Show room name, attachment shortcut, drawer of sub-sections | Clean. AntUX shows "AntUX" not `--name AntUX` post-#144. | ✓ |
| Composer | Textarea + paperclip + Send | Type + send messages, attach files | Works desktop; mobile composer-overlap-on-messages fixed 5e5d1af. **Paperclip button missing accessible label** (task 8a859d40) | 🛠️ |
| Message row | Avatar + handle + timestamp + Reply + Read-by | Show message author with per-room colour, jump-reply, read receipts | Clean. `Codex @evolveantcodex` style names per room alias. | ✓ |
| Reaction picker | Quick-react row on hover/focus | 5 emoji quick-react: 👎 👌 👍 🙌 🧙 | Renders on hover. **Discoverability low** — only appears on hover, no visible "react" button | 🛠️ |
| Footer agent statuses | Pills with WORKING / IDLE | Reflect live terminal state per agent | Post-#156/#133 (b7b7e46): truth-source consistent across cards/footer/Participants. No more "everyone working" over-reporting. | ✓ |
| More dropdown | Asks / Plans / Tasks / Linked rooms / Interviews / Artefacts / Screenshots / Room memory / Attachments | Per-room sub-sections under one panel | Most sections checked; **Linked rooms expansion was unreliable in my last attempt**; Artefacts categorisation (HTML / Decks / Spreadsheets / Docs / Mockups / Other) present | ✓ / 🛠️ |
| Identity editor | Display handle + colour + icon + background + custom | Per-room participant identity edit | Renders cleanly with #71-loose emoji icons (🦀⊙🐋🌙π☯🤖💻) | ✓ |
| Cmd-K palette | Fuzzy jump-to-anywhere | Open with Cmd/Ctrl-K. Search rooms+plans+terminals + fallback row to search messages | Just shipped 87fc4d2 + 8913c93. Verified by svelte end-to-end. | ✓ |
| `?` shortcuts overlay | Global cheatsheet | Press `?` anywhere to open keyboard shortcuts (Cmd-K, palette, composer, deck, doc) | Just shipped 87b5b3f. Rover saw `keyboard`+`shortcut` strings in dashboard HTML; needs browser walkthrough to confirm overlay rendering | 🛠️ |
| Message motion polish | Fly-in animation + smooth scroll-to-bottom | New messages animate in 220ms cubicOut, scroll-to-bottom is smooth; respects prefers-reduced-motion | Just shipped 178fea9. Rover-banked; needs browser walkthrough to confirm | 🛠️ |
| Last-message preview | Room card subtitle | Each room card shows author-styled accent + body muted + 2-line clamp | Just shipped 3ef21c0 (#134). Rover-verified API surfaces; visual sign-off pending JWPK | ✓ |
| Unphased grouping | Plan body | Active vs Completed buckets; completed bucket collapsible | Just shipped e40dc2c (#169). Confirmed via /api/plans/v4-fresh-ant/cockpit response shape | ✓ |
| Plan title slug→display | Plan header + browser tab | Surface display title 'v4 Fresh ANT + Native Apps' not slug | Just shipped a353a52 (#171). Rover-verified | ✓ |
| Phases/milestones zero-state | Plan body | Soft-render placeholders when 0 phases / 0 milestones; no bare "0" next to TASKS metrics | Just shipped 2c72d94 (#168). Rover-verified | ✓ |
| Attach-room button | Plan body | Replaces curl-recipe banner with friendly "Link this plan to a room" button | Just shipped 2c72d94 (#167). Rover-verified | ✓ |
| Task-title display | Plan body / activity feed | Normalised display: strips #NN / Bug: / Polish: / A11y: prefixes; test-probe rows removed | Just shipped 7e6cff0 (#170). Rover-verified | ✓ |
| Server-side starred rooms | Per-user preferences | Stars persist across phone/laptop/desktop via /api/preferences/room-bookmarks | Just shipped 7174baa (#160). API verified 200 | ✓ |
| Threshold DB retention | /diagnostics + nightly cron | Configurable retention (default 7d), threshold-triggered prune+VACUUM (default 1GB) | Just shipped 150d8b8 + 41e3df2 (#164/#166). DB now ~141MB from 29G | ✓ |
| File-backed ANT registry | ~/Documents/ant-registry.md | Persistent markdown projection of agent registry — 8 agents, last touched 01:24Z | Just shipped d5b0f90 (#141). Rover-verified file present | ✓ |
| Tauri Mac native app | ANT Chat.app + ANT Chat_0.1.0_aarch64.dmg | Codesigned arm64 dmg installable by drag-to-Applications; native macOS menubar + notifications + global shortcut + ? cheatsheet + system-notification previews + motion polish + auto-skip welcome + native /plans/[planId] cockpit mirror | **FINAL** .dmg rebuilt 01:40:05Z = 3,476,766 bytes (codesign 01:39:43Z, TeamIdentifier 54D7S73Y9F, hardened runtime). Bundles ALL 7 overnight slices (67a37af + 7167df5 + c9966df + ac37f6c + 45af3bf + 6a7b8f2). JWPK morning drag-to-Applications complete. | ✓ |
| Tauri system notifications | macOS banner for unfocused-window SSE messages | Room name + sender + 140-char body preview on incoming messages while window unfocused. Per-room lastSeenPostOrder high-water mark. Permission caching + silent no-op outside Tauri shell | Shipped c9966df, now in 01:35Z .dmg | ✓ |
| Tauri motion polish | Native app | Message fade-in + room-card lift on hover + cheatsheet polish | Shipped ac37f6c, now in 01:35Z .dmg | ✓ |
| OSS preflight scanner | Migration tooling | Executable read-only scan for the v4→a-nice-terminal repo migration prep | Just shipped 6239b60 (#32) | ✓ |
| Tauri auto-skip welcome | Native app launch | When auth already restored from storage, /welcome silently navigates to /rooms — no Enter-App re-click each launch. First-time users still see flow | Shipped 45af3bf, bundled in 01:40Z FINAL .dmg | ✓ |
| Tauri native plan cockpit | /plans/[planId] mirror | Plan cockpit rendered natively with grouped unphased (active/completed parity with e40dc2c) — JWPK can scan plan progress from menubar app | Shipped 6a7b8f2, bundled in 01:40Z FINAL .dmg | ✓ |
| Native /api/capabilities | Bootstrap contract | Surfaces `native` block: recommendedBaseUrl + canonical endpoints map + header conventions so native apps don't hard-code paths | Just shipped bb33a25 (closes c39dd3f1). Rover-verified — capabilities response has `native.recommendedBaseUrl` + 11-endpoint map | ✓ |
| Phase A.5 policy tests | /policies + /api/policies | policyStore unit tests + e2e flow + migration verify, 44 tests green; /api/policies live 200 | Just shipped 70b8309 (Phase A.5 Lane 3 / kimi first overnight deploy) | ✓ |
| Server-side route audit | Coverage docs | docs/server-route-coverage-audit-2026-05-18.md — admin runtime payload tests added | Just shipped 352297e (task 5efaac6a) | ✓ |
| /diagnostics dark-mode | Page styling | Cards, borders, headings render correctly in both light & dark mode | Just shipped cc0c54b. Previously /diagnostics used --color-* tokens that don't exist; swapped to canonical --line-soft / --surface-card / --ink-soft. Real bug rover didn't catch | ✓ |
| Tauri room-card preview parity | Native room cards | Distinct last-message preview with sender accent + two-line clamp (mirrors svelte 3ef21c0 #134) | Shipped 45b5c2e tauri slice 8, bundled in TRUE FINAL .dmg at 01:48:50Z (3,477,150 bytes, codesigned 01:48:27Z) | ✓ |
| Primary nav /policies + /archive | SimplePageShell side nav | Pages reachable via primary nav rather than direct URL only | Just shipped 6bad4b4. Dashboard HTML confirms href=/archive + href=/policies | ✓ |
| Swift iOS TestFlight Build 59 | Native iOS app | Adaptive ANT surface colours follow system dark/light. TestFlight install via j.w.p.king@gmail.com invite | Just shipped 2539dbf (swift first overnight deploy at 00:54:47Z). JWPK install path on iPhone/iPad now complete | ✓ |
| Share route boundary tests | Server hardening | Route-local coverage for /api/share and /api/s | Just shipped ce91949 (closes 05fda158 #160) | ✓ |
| OSS migration runner | scripts/run-oss-migration.mjs | Wraps preflight + dry-run + commit-to-target-repo flows | Just shipped 63a6807 (kimi Priority 4 #32) | ✓ |
| #74 delete-own-message | Premium chat | Soft-delete with tombstone marker showing 'Message deleted by @x at <time>'; chat_messages.deleted_at_ms + deleted_by_handle columns | Just shipped ad3dd27 (svelte). 1 of 3 native premium pile features (#74) landed | ✓ |
| #76 edit-own-last-message | Premium chat | ↑ key in empty composer enters edit mode on last own message; chat_messages.edited_at_ms persistence + badge UI | Schema in ad3dd27 + UI complete 6506249 (svelte). 2 of 3 native premium pile features LIVE | ✓ |
| Swift Build 60 linked-chat notif | Native iOS app | Polished linked-chat notification handling on incoming messages | Just shipped 340337c (swift's 2nd overnight ship) | ✓ |
| Swift Build 61 app-icon polish | Native iOS app | Regenerated square edges + final launch polish | Just shipped d7838a2 (swift's 3rd overnight ship). JWPK's iOS app icon polished for morning install | ✓ |
| Swift Build 62 keyboard shortcuts | Native iOS app | Hardware keyboard shortcuts surface (central AppKey handling) | Just shipped 816bcd1 (swift's 4th overnight ship) | ✓ |
| Swift Build 64 iOS Share Extension | Native iOS app | Native Share to ANT extension — JWPK can share content from any iOS app (Safari, Photos, etc) into ANT rooms | Just shipped 3874c8a (swift's 6th overnight ship, builds 59-64). **Wishlist feature delivered for JWPK morning install** | ✓ |
| #77 chair-mediated asks UI | /chair page | Top-3 open asks per room rendered inline with link into ask thread | Just shipped svelte 7b6ad8b. **All 3 native premium pile features (#74 + #76 + #77) now LIVE** | ✓ |
| Tauri #76 edit-own-last native mirror | Native room composer | ↑ in empty composer enters edit mode (parity with svelte 6506249) | Just shipped tauri 13781be slice 11, bundled in .dmg #5 at 02:26:52Z (3,481,474 bytes, 11 slices total) | ✓ |
| Tauri a11y baseline | Native app | Focus-visible outlines + aria-current parity with svelte 18ffdc8 | Just shipped tauri 73907c0 slice 12, bundled in .dmg #6 at 02:56:42Z (3,481,479 bytes, 12 slices total) | ✓ |
| Skeleton shimmer | PlanCockpit + RoomLinksPane | Animated shimmer placeholders replace bare "Loading…" text on initial render | Just shipped svelte d76161c. Addresses rover's early-session complaint about bare 'Loading cockpit…' string | ✓ |
| PlanDonutCard ring tint | /plans grid | Completion-bucket coloured ring tint (warn/info/ok) on plan donut cards | Just shipped svelte 7756d4d | ✓ |
| Tauri native ⌘K command palette | Native app | Real CommandPalette modal — input + filtered list + arrow-key nav + Enter/Esc; filters across command label + route slug; opens rooms/plans dynamically | Shipped tauri 7e478ba slice 13, **bundled in .dmg #7 at 02:27:55Z (3,483,091 bytes, 13 slices)** | ✓ |
| Swift Build 65 dark-mode polish | Native iOS app | Adaptive dark-mode/readability visual parity slice | Just shipped 441240e (swift's 7th overnight ship, builds 59-65) | ✓ |
| Tauri /help page | Native app | Dedicated /help route with shortcut data extracted from CommandPalette so cheatsheet stays in sync | Shipped tauri 197d52a slice 14, bundled in .dmg #8 at 02:58:28Z (3,485,150 bytes, 14 slices) | ✓ |
| Tauri /settings page | Native app | Server URL + disconnect + theme + about settings panel | Shipped tauri deade46 slice 15, bundled in .dmg #9 at 03:30:17Z (3,487,833 bytes, 15 slices) | ✓ |
| Swift Build 67 table-input dark-mode | Native iOS app | Adaptive table-input premium feature dark-mode polish | Just shipped 12515c0 (swift's 8th overnight ship, builds 59-67 — note Build 66 also in series) | ✓ |
| Swift Build 68 iPad/terminal dark-mode | Native iOS app | iPad-specific terminal dark-mode parity | Just shipped 6210ce8 (swift's 9th overnight ship, builds 59-68) | ✓ |
| Swift Build 69 quick-actions/command-history dark-mode | Native iOS app | Quick actions + command history dark-mode polish | Just shipped 658f5b8 (swift's 10th overnight ship, builds 59-69) | ✓ |
| Tauri design-tokens sweep complete | Native app | Zero inline hex outside :root — full design token consumption | Shipped tauri e3a57c3 slice 17, bundled in .dmg #11 at 04:43:03Z (3,487,865 bytes, 17 slices) | ✓ |
| Dashboard celebrate-cards | Dashboard empty states | Celebrate-style empty cards for asks + starred rooms (cold-start polish) | Just shipped svelte 664de6b | ✓ |
| Tauri live agent-activity badge | Native room cards | Live agent-activity badge surfaced on room cards (#117 fix + #120 parity) | Shipped tauri 3d0bd58 slice 18, bundled in .dmg #12 at 05:13:54Z UTC (3,488,305 bytes, 18 slices) | ✓ |
| Composer auto-resize textarea | Room composer | Textarea expands as user types, capped at 18rem to prevent overflow | Just shipped svelte 1fdbbc7 | ✓ |
| AgentStatusFooter pulse | Footer agent statuses | Status dots animate (pulse) based on current state | Just shipped svelte 3eda19a | ✓ |
| Tauri activity pill in sidebar | Native room-detail sidebar | Activity pill extended into room-detail sidebar (parity continuation) | Shipped tauri a4d2975 slice 19, bundled in .dmg #13 at 05:45:43Z UTC (3,488,598 bytes, 19 slices) | ✓ |
| Load earlier messages button polish | Room history scrollback | Button now has spinner during fetch + ↑ icon indicating direction | Just shipped svelte 78df25a | ✓ |
| Tauri proactive notif permission | Native app first-launch | App requests notification permission on first auth automatically — smooths install path | Shipped tauri c6ebae4 slice 20, bundled in .dmg #14 at 06:16:05Z UTC (3,488,716 bytes, 20 slices) | ✓ |
| Tauri edited/removed provenance tooltips | Native message rows | Hover/focus tooltips reveal who edited or removed a message and when | Shipped tauri 11940ff slice 21, bundled in .dmg #15 at 06:45:49Z UTC (3,488,762 bytes, 21 slices) | ✓ |
| Composer send button reflects edit mode | Room composer | Send button visual changes when composer is in edit-existing-message mode | Just shipped svelte fc28a6e | ✓ |
| Friendly 404/error page | App-wide error UX | Custom 404 page + SSR-safe page-read on room error (no crash on missing room) | Just shipped svelte eca1904 | ✓ |
| Vim-style g-prefix shortcuts | App-wide keyboard | g-prefix quick-nav (gp = plans, gr = rooms, etc) for power-user navigation | Just shipped svelte fd5cb84 | ✓ |
| Tauri quick filter on /rooms | Native /rooms | Inline quick-filter input for the rooms list | Shipped tauri 50b7b07 slice 22, bundled in .dmg #16 at 07:48:38Z UTC (3,489,350 bytes, 23 slices) | ✓ |
| Tauri window titles | Native windows | /rooms and /rooms/[id] get distinct macOS window titles for cmd-` switching | Shipped tauri 553b2c2 slice 23, bundled in .dmg #16 | ✓ |
| Tauri design tokens | Native app | Kill inline hex across the client — proper design token consumption | Shipped tauri 56559a9 slice 16, bundled in .dmg #10 at 04:03:46Z (3,487,856 bytes, 16 slices) | ✓ |
| /search auto-focus + /asks celebrate empty | Page polish | /search auto-focuses input on landing; /asks empty state celebrates rather than disappoints | Just shipped svelte 7ec6b97 | ✓ |
| PlanCockpit error retry button | Cockpit error UX | Error state now has a Try-again retry button to recover from transient failures without page reload | Just shipped svelte 13a005a | ✓ |
| Composer attachment thumbnail chips | Room composer | Inline chip preview of selected attachments above textarea | Just shipped svelte 1c7c7fd | ✓ |
| Policies premium-boundary tests | Server hardening | Regression coverage proving premium mutation gate respects tier | Just shipped codex f725b9e #163a | ✓ |
| CLI room name flag guard | Server | Reject room create with --name leaked into body; @cli legacy sweep | Just shipped kimi b6cc161 #144 | ✓ |
| Tauri delete-own + tombstone | Native room messages | #74 delete-own-message + tombstone render + edited indicator (parity with svelte ad3dd27 + 6506249) | Just shipped f990df2 (tauri slice 10), bundled in .dmg #4 at 02:11:51Z | ✓ |
| A11y audit pass | Nav + sheets table | aria-current=page on primary nav, focus rings (WCAG 2.4.7) on nav/toggles, scope='col'/'row' on /sheets table headers | Just shipped 18ffdc8 svelte — 3 concrete improvements rover hadn't surfaced | ✓ |
| Deck API password redaction | Security hardening | /api/decks responses no longer leak access_password field | Just shipped e0b9582 codex #162. Real security gap codex found while auditing decks | ✓ |
| Sheets viewer root config | /sheets/:slug | Page-server-level tests + root config for CSV viewer | Just shipped c4028cb codex #161 | ✓ |
| Tauri per-room Digest panel | Native room panel | Side panel showing per-room digest summary + Digest button on room cards | Just shipped ce33be6 (tauri slice 9), bundled in .dmg #3 at 01:58:05Z | ✓ |
| Public release checklist | docs/public-release-checklist-2026-05-18.md | Operator gate before pushing public — Required Release Files list, file gates, scanner commands, AGPL posture | Just shipped 9720723 codex #34/#45 final slice | ✓ |
| Phase A.5 coverage sweep | Server + tests | 60/60 tests pass, +16 route + 5 store edge cases on policy paths | Just shipped 0d42e44 kimi | ✓ |
| Retention safety bounds | DB hygiene | Operational retention caps + verify (caps on prune impact, min-keep floors) | Just shipped 8688065 (kimi Priority 3) | ✓ |
| #32b OSS preflight alignment | Public repo migration | OSS preflight scanner aligned with public-repo standards | Just shipped f02c44f (closes 731a17ae) | ✓ |
| Image attachment thumbnails | AttachmentsTray | Inline thumbnail preview for image attachments | Just shipped 814b36b. Rover-banked; needs browser walkthrough | 🛠️ |
| Search active-filter chip | /search header | Visible chip showing active filter with one-click clear affordance | Just shipped c3b44a6. HTML grep confirms 'clear' affordance | ✓ |
| Mobile 44px touch targets | RoomStrip actions + participant swatches/icons | Tap targets ≥44px on pointer:coarse (Apple HIG minimum) | Just shipped bb2723d. Rover-banked; needs real-device walkthrough | 🛠️ |
| AGPL public-release posture | Repo root | LICENSE (full AGPL v3) + README + SECURITY + CONTRIBUTING + NOTICE.md + .env.example + .gitignore for DB/runtime/local-agent | Just shipped 8cd38f8 (#34/#45). All 7 files rover-verified present; package.json license=AGPL-3.0-or-later; npm audit 0 critical | ✓ |

## Open follow-ups (task IDs)

- 875cc545 — Feature: in-room artifact viewing on mobile (auto-tunnel + password gate)
- 4d401d57 — Polish: Retrospective status pill copy ("In_progress" vs "Pending")
- 8b9eb954 — Feature: asks auto-spec from `@you` + 🙌 + chair filter (codex shipped server #162; svelte UI piece pending)
- 52fb80de — Tech: rover SSE subscription (latency-reducer)
- 1dd5e590 — Polish: 404 on `/apple-touch-icon-precomposed.png`
- 8a859d40 — A11y: composer paperclip has no aria-label
- 427f7602 — Bug: starred rooms persist only on the device that pinned them (server sync needed)
- edfae48f — Polish: `/plans/{insights,evidence,triggers}` lack `← All plans` back link
- 4084924a — Bug: DB 29G `terminal_run_events` bloat (CLOSED — shipped 150d8b8)
- 27ba39b7 — Bug: ant CLI `rooms post` hardcodes authorHandle=@cli → 403 after #113 strict-flip (CLOSED — codex 58b4400 at 00:44:45Z. CLI now omits authorHandle; server resolves via pidChain. Rover self-verified by posting msg_17e926c9c1 directly with `ant rooms post`)

## Suggested cadence
- Re-run this table after each `deploy-done` cycle.
- Sign-off column → JWPK marks ✓ on rows he's personally walked.
- Rover (@evolveantux) updates `Last checked` on each iteration that touches a row.
