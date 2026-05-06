# M6 #2 — PWA Cockpit: Acceptance Evidence

> **Acceptance test** — "ANT installs as a PWA on supported browsers, the shell works offline-first for static assets, and live API traffic always hits the network."

Companions: `docs/m6-1-visual-qa-evidence.md`, `static/manifest.webmanifest`.

---

## What landed

Three UI / static pieces plus the layout wiring.

- **Service worker** — `static/sw.js` (commit `8ee3637`).
  - **Install** — caches a minimal static shell (`/`, manifest, favicon variants, ANT icon-192/512) under `ant-v3-cache-v1`. `self.skipWaiting()` so a fresh SW takes over immediately.
  - **Activate** — purges any cache that is not the current `CACHE_NAME`, then `clients.claim()`.
  - **Fetch strategy**:
    - `network-only` for any request whose URL contains `/api/` — guarantees the SW never serves a stale chat/session/plan response.
    - `cache-first` for the seeded static assets.
    - `stale-while-revalidate` for everything else same-origin, so the app boots fast offline but updates in the background when the network is available.
- **Install prompt component** — `src/lib/components/PwaInstallPrompt.svelte`.
  - Listens for `beforeinstallprompt`, holds the deferred event in component state, renders Install / Dismiss buttons.
  - Tracks `appinstalled` to hide the prompt once the user has accepted.
- **Layout wiring** — `src/routes/+layout.svelte` registers `/sw.js` on mount and slots `<PwaInstallPrompt />` into the shell.
- **Manifest** — `static/manifest.webmanifest` (already in repo; SW pre-caches it).

Authored by @kimiant; cherry-picked to `main` as `8ee3637`. A single follow-up commit `557ebfc` re-chained the screenshot hasher to match the chainable interface kimiant widened in the same PR.

---

## How a contributor verifies it

Because this is a UI / browser-runtime feature, type-checking and unit tests are necessary but not sufficient. To accept:

1. Run the dev server (`launchctl kickstart -k gui/501/com.ant.server` after a `bun run build`).
2. Open the app in Chrome or Edge.
3. **Install affordance** — the install bar should appear once the browser has decided the app is installable. Click Install; verify a chrome-less window launches and that `appinstalled` fires (the prompt disappears).
4. **Offline shell** — open DevTools → Application → Service Workers, confirm `sw.js` is activated. Toggle Network → Offline; reload the page. Static shell still loads from cache.
5. **API isolation** — with offline still toggled, attempt any chat send. The request should fail at the network layer (the SW does not serve cached `/api/*`), so the UI surfaces the failure rather than a stale response.

This walk-through is the canonical browser-test for the slice; it is **not yet in `docs/visual-qa-baseline.json`** and not driven by `scripts/visual-qa-capture.mjs`. A future M6 #2 follow-up should add the install/offline states to that capture so we can regression-test them.

---

## Tests at the time of landing

- **Total** — 428 pass / 1 skip / 0 fail.
- **svelte-check** — 807 files / 0 errors / 0 warnings.
- **Browser-tested** — confirmed by James 2026-05-06 19:00: "PWA works" (install affordance + service-worker activation + offline shell). The capture still has not been driven by `scripts/visual-qa-capture.mjs`; that remains a follow-on.

---

## What this gives us

- ANT can be installed as a desktop app on any Chromium-family browser, no app-store roundtrip.
- The cache split (network-only for API, cache-first for shell) means a flaky network never serves stale chat data — only stale paint.
- The PWA shell is the first piece of the M6 cockpit; the visual-QA pipeline (M6 #1) can now be retargeted at the installed app to verify the chrome-less window matches the in-tab render.

---

## Open

- Browser-test in Chrome + Edge + Safari and capture the install state into `scripts/visual-qa-capture.mjs`.
- Add a notification permission flow once the cockpit needs alerting.
