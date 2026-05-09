# Mobile ANT Recovery Evidence - 2026-05-09

Plan: `mobile-ant-recovery-2026-05-09`

Room: `O393IH1zFgd_nujpQgnof`

## User Report

James reported the mobile experience as a blocking failure, not polish:

- A chat room took roughly 15 seconds to load on phone over WiFi.
- Loading messages is slow on both mobile web/PWA and antios.
- antios crashes often.
- Too much screen space is spent on low-value information.
- Upload does not work.
- Mobile is missing desktop features.
- Messages are slow to send.
- Chat filtering is missing.
- Archived/zombie chats reappear.
- Pinning is not a decent mobile experience.
- Notifications are missing or not useful.
- There are no mobile-native wins.
- Terminal is slow and awkward.
- Shortcuts do not help.
- Visuals overlap.
- Settings are not explained well.
- The "Default Agent" affordance appears to do nothing.
- There is no usable mobile plan surface.
- Mobile cannot view plan progress or invite/manage agents.

## Reproduction

Live target: `https://mac.kingfisher-interval.ts.net/session/O393IH1zFgd_nujpQgnof`

Browser profile: Playwright Chromium with iPhone 15 viewport/user agent. The throttled profile used 80 ms latency and about 1.5 Mbps download to mimic a weak mobile path on WiFi or a busy local tunnel.

Evidence artifact:

- `output/playwright/mobile-ant-room-iphone15.png`

## Measurements

Server endpoint timings were not the main bottleneck once warm:

| Endpoint | Typical warm TTFB |
| --- | ---: |
| `/api/sessions/:id` | 6-8 ms |
| `/api/sessions/:id/messages?limit=60` | 7 ms |
| `/api/sessions/:id/participants` | 8 ms |
| `/api/sessions/:id/artefacts` | 21 ms |

Cold document or tunnel paths were much worse:

| Run | DOM/content time | Total wait | Notes |
| --- | ---: | ---: | --- |
| Direct curl first hit | 9.3 s TTFB | 9.3 s | Cold public document request reproduced multi-second wait. |
| Mobile emulation, unthrottled | 108 ms DOM | 10 s observation window | Page kept doing background work after initial render. |
| Mobile emulation, throttled | 5.7-7.1 s DOM | 13.7-19.1 s observation window | Reproduced the user-class 15 s experience. |

The key point: localhost/LAN endpoint timing made the earlier desktop perf win look better than the real mobile experience.

## Load Findings

1. Hidden mobile rail still did desktop work.

   `ActivityRail` is CSS-hidden at phone width, but still mounted, fetched `/api/sessions`, opened its WebSocket, and then fanned out per-terminal status requests.

2. Per-terminal status polling was too expensive on mobile.

   The mobile trace showed 28 `/api/sessions/:id/status` requests during room open. These drive desktop rail/footer affordances, not first message readability on phone.

3. The session list was fetched twice.

   The session page defers `/api/sessions` after paint, but the hidden `ActivityRail` also fetched it immediately. On a throttled trace each copy was about 74 KB and took about 2.1-2.2 s.

4. The full ANT wordmark was loaded even where mobile could not use it.

   `/ANTlogo-black-text.png` is about 152 KB. On the throttled trace it took about 2.6 s. The header is already too tight on phone, so the icon asset is enough for mobile.

5. The first mobile message payload and side-panel payloads competed for bandwidth.

   The initial message payload was about 50 KB for 50 rows. Tasks were another 37 KB. File refs and uploads were also started in the first batch even though the side panel is closed by default on phone.

6. Too much DOM/action chrome is rendered for the first mobile screen.

   The mobile run produced roughly 2,300-2,500 DOM nodes and more than 300 buttons. A lot of those controls are desktop actions attached to every message or hidden navigation.

7. PWA cache policy could serve stale session HTML.

   `static/sw.js` used cache-first for same-origin non-API requests and cached navigation responses such as `/session/:id`. That can leave installed PWAs on old shells after deploys and plausibly contributes to crash/stale-build reports.

## UX Findings

1. The screenshot shows real layout collision.

   Search/header controls overlap message content. The composer, shortcut row, and agent status strip consume a large amount of the bottom of the viewport.

2. The bottom `Agents` status strip is low-value on phone.

   It is useful desktop telemetry, but on phone it costs vertical space and triggers status polling. It should be hidden or moved behind a drawer.

3. The current mobile header is too dense.

   The session title truncates quickly, the back/share/search controls compete for the same row, and the current state is hard to read.

4. The plan/task workflow is not mobile-complete.

   ANT's main workflow today is plan/task/evidence coordination, but mobile cannot comfortably view plan progress or invite/manage agents.

5. Settings and "Default Agent" need a decision.

   The mobile recovery lane should either make the setting explanatory and functional, or remove/hide it on mobile. Dead-looking settings are trust-eroding.

## Patch Applied in M1

Commit candidate scope:

- `static/sw.js`
- `src/lib/components/ActivityRail.svelte`
- `src/lib/components/ChatMessages.svelte`
- `src/lib/components/ChatHeader.svelte`
- `src/routes/session/[id]/+page.svelte`

Changes:

- Service worker cache bumped to `ant-v3-cache-v2`.
- Service worker no longer cache-first serves navigation/session HTML.
- Hidden phone `ActivityRail` no longer fetches sessions/statuses or opens WS.
- Phone/touch `ChatMessages` suppresses per-terminal status polling.
- Phone/touch hides the bottom agent-status strip.
- Mobile initial message load reduced from 50 to 20 rows.
- Mobile side-panel payloads are deferred until after messages render.
- Header logo uses the smaller icon asset under mobile-ish widths.

Expected direct wins:

- Removes the duplicated `/api/sessions` fetch on phone.
- Removes the 28 status requests from the mobile open path.
- Cuts first message payload by roughly 60%.
- Moves tasks/file refs/uploads out of first-paint competition on phone.
- Reduces logo transfer from about 152 KB to the smaller icon path.
- Reduces stale PWA session-shell risk after deploys.

## Remaining Work

The M1 patch is only a first recovery cut. These still need separate acceptance:

- antios crash reproduction and crash log capture.
- Upload parity on mobile web and antios.
- Dashboard filtering and better pinning.
- Zombie chat root cause.
- Mobile plan/progress/invite surface.
- Notifications.
- Terminal and shortcuts strategy.
- Mobile-specific wins, such as share sheet, gestures, deep links, and compact plan/task cards.
- Visual overlap sweep after the M1 load fixes land.
- Settings copy and the Default Agent affordance decision.
