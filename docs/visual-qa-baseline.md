# ANT Visual QA Baseline

> **Purpose** — define what "looks right" looks like, so a polish-track contributor can spot regressions without re-deriving the rules every time. Pairs with `docs/security-model.md` (auth) and the design-system tokens in `src/app.css`.

This is M6 #1: catch overflow, legibility, responsive issues, and design-system drift on the polish track without blocking pilots.

The baseline has four parts: **routes**, **viewports**, **checks**, and a **manual sweep protocol**. A scripted snapshot harness is a follow-on — first land the criteria, then automate.

---

## 1. Routes in scope

These are the user-visible surfaces. URL-equivalent routes (e.g. dashboard with/without filter) only count once unless layout differs.

| Route | Purpose | Owner concern |
|---|---|---|
| `/` | Dashboard (sessions list + activity rail) | Density, drag handles, agent-colour cues |
| `/session/<id>` | Terminal viewport + linked chat | xterm sizing, OSC title, scroll lock |
| `/r/<id>` | Public room viewer (read-only) | No admin chrome leaks; password gate visibility |
| `/plan?session_id=…&plan_id=…` | Plan view (milestones, tests, decisions) | Status pill colours, evidence link contrast |
| `/asks` | Asks queue | Threshold colour cues, empty state |
| `/archive` | Recoverable sessions | Empty state, restore button affordance |
| `/help` | Help page | Code block legibility, scroll behaviour |
| `/agentsetup` | Per-agent setup walkthroughs | Step indicators, copy-button affordances |
| `/design` | Design system reference | Token swatches, type scale |

Routes excluded for now: `/mcp/*` (machine-only), `/api/*` (machine-only), `/remote/*` (legacy).

---

## 2. Viewports

Test at three breakpoints. The middle one is the design target; the other two are stress tests.

| Name | Width | Height | Notes |
|---|---|---|---|
| Mobile | 390 | 844 | iPhone 15 Pro logical size |
| Desktop | 1440 | 900 | MacBook Air 13" target |
| Wide | 2560 | 1440 | External monitor stress; sidebar should not islanded |

Test in light **and** dark theme at desktop width. Mobile and Wide can pick whichever theme the running environment defaults to.

---

## 3. Checks

Apply these to every route × viewport cell. Fail = log a row in `docs/visual-qa-findings-<date>.md`; do not fix in the same pass — separate diagnosis from remediation so triage stays cheap.

### 3.1 Overflow
- No horizontal scrollbar on the body at any viewport.
- Long terminal session names truncate with ellipsis, do not wrap and shove icons.
- Chat messages with long URLs or code blocks wrap inside their bubble; do not push the bubble past its column.
- Drag handles, status pills, and pin/archive icons stay inside the row at Mobile width.

### 3.2 Legibility
- All visible text passes WCAG AA contrast: 4.5:1 for body, 3:1 for ≥18pt or bold ≥14pt.
- Disabled / muted text retains 3:1 contrast against its background.
- Status pills (planned / active / passing / failing / blocked / done) remain distinguishable in both themes; do not rely on hue alone.
- Monospace blocks (terminal output, code in chat) use `--font-mono` with explicit line-height ≥ 1.4.

### 3.3 Responsive
- Sidebar collapses or moves to a top sheet at Mobile; does not bleed into the main column.
- Main column uses the full remaining width — no centred ribbon at Wide.
- Drag-handle hit area is at least 32×32 logical px on Mobile.
- Scroll-locked panels (chat, terminal) trap their own scroll; outer body does not double-scroll.

### 3.4 Design-system drift
Tokens in `src/app.css` are the source of truth. Drift = ad-hoc hex values in component CSS instead of the token.
- Colour: only the named tokens (`--color-info`, `--color-success`, `--color-warning`, `--color-danger`, `--agent-*`, `--emerald-*`, `--blue-*`, `--amber-*`).
- Radius: `--radius-input` for form fields, `--radius-card` for list rows, `--radius-panel` for panels, `--radius-hero` for hero cards, `--radius-full` for pills/avatars.
- Type: `--font-sans` for UI, `--font-mono` for terminal/code. No third family.
- Tracking: display copy uses `--tracking-display`; body uses `--tracking-body`; mono uses `--tracking-mono`. No bespoke `letter-spacing` values.

---

## 4. Manual sweep protocol

Until the snapshot harness lands, this is the protocol a contributor follows.

1. Boot a clean prod server (`launchctl kickstart -k gui/501/com.ant.server`).
2. Open DevTools, set viewport to **Mobile** (390×844). Visit each route in §1; log overflow + legibility issues.
3. Switch to **Desktop** (1440×900). Visit each route in light theme; switch to dark; log issues.
4. Switch to **Wide** (2560×1440). Visit Dashboard, Plan, Session — these three are the most layout-sensitive. Log issues.
5. Open `/design`. Compare a Dashboard pill with a Plan pill of the same status — should be visually identical. Log mismatches as design-system drift.
6. Spot-check `:focus-visible` outlines on tab-key navigation through Dashboard and Plan. Missing focus rings are accessibility regressions.

---

## 5. Findings template

Each visual-QA pass creates `docs/visual-qa-findings-YYYY-MM-DD.md` with rows like:

```
| Route | Viewport | Theme | Category | Description | Repro |
|---|---|---|---|---|---|
| /asks | Mobile | dark | overflow | Threshold pill clips at 390 width | Open with 12+ asks |
| /plan | Wide | light | drift | M5 status pill uses #2EBD85 not --color-success | Inspect element |
```

This keeps triage one-shot diffable and lets us measure regression rate over time.

---

## 6. Automated harness (next)

Out-of-scope for this baseline doc; tracked as a follow-on:

- Capture HTML + a CSS-only screenshot diff at each route × viewport.
- Compare to a checked-in baseline in `tests/visual-qa/baselines/`.
- Run on PRs that touch `src/app.css`, `src/routes/**`, or `src/lib/components/**`.
- Headless tooling decision deferred — Bun does not yet ship a native browser; candidates are `playwright`, `puppeteer`, or a custom CDP client.

The harness is M6 follow-on, **not** M6 #1. Shipping the baseline doc unblocks pilot polish work today; the harness lands when there is a stable surface to snapshot.
