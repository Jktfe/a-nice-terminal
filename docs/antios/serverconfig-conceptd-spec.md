# ServerConfigView — Concept-D spec (cold-launch redesign)

**Status:** spec ready for implementation
**Owners:** @codexuxant (build) · @antmacdevcodex (QC) · @antux (UX)
**Plan / task:** `antios-make-it-functional-2026-05-26` task T6
**Trigger:** JWPK FlowDeck walkthrough 2026-05-26 (`msg_7m5kzl1krc`) — he opened the app + said "OK so I am on a settings page". Cold-launch reads as Settings to actual users.
**Outcome:** Visual register reset to Concept-D / ANT Cards aesthetic so cold-launch reads as "Welcome to ANT" not "Settings page nested somewhere."

---

## What's wrong with the current view

`/tmp/antux-walk-2026-05-26/02-ant-cards.png` (captured during walk):
- Generic SwiftUI list style — defaults to "Settings page" register
- "Scan Server QR Code" buried at top above-fold but not prominent
- TEAM LOGIN section: Email / Password / License / Sign in — Sign in floats mid-form, looks like a label not a button
- SERVER section below: pre-filled URL / API Key empty / Ignore SSL Errors toggle / Test connection link
- No "where to find my API key?" guidance — even JWPK had to ask
- No "preview mode" affordance — Apple Reviewer + non-power-users hit a wall

## What it should be

A genuine **first-impression** screen with the same warm cream + accent register as Concept D on Mac. ONE clear primary action above fold. Server config tucked into a "Custom server" accordion. API-key guidance link visible.

---

## Layout

```
╭─────────────────────────────────────╮
│   [status bar — system]             │
├─────────────────────────────────────┤
│                                     │
│       >_ANT  [ant illustration]     │  ← brand mark, centred, 60pt
│                                     │
│       Welcome to ANT                │  ← 28pt weight 800, ink-strong
│       Sign in to see your team      │  ← 15pt ink-soft
│                                     │
├─────────────────────────────────────┤
│   ┌───────────────────────────┐     │
│   │ Email                     │     │  ← rounded card, surface-card
│   │ Password                  │     │     bg, line-soft border,
│   │ Licence                   │     │     padding 16
│   └───────────────────────────┘     │
│                                     │
│   ┌───────────────────────────┐     │
│   │      Sign in              │     │  ← FULL-WIDTH button,
│   │                           │     │     accent bg, white text,
│   └───────────────────────────┘     │     14pt height
│                                     │
│   Don't have an API key?            │  ← 13pt ink-muted
│   Get one →                         │  ← 13pt accent, tappable
│                                     │
├─────────────────────────────────────┤
│   [Scan Server QR Code]             │  ← secondary, line-soft border
│                                     │
│   ▾ Use custom server               │  ← accordion collapsed by
│                                     │     default
│                                     │
└─────────────────────────────────────╯
```

**When the "Use custom server" accordion expands:**

```
   ▴ Use custom server
   ┌───────────────────────────┐
   │ Server URL                │  ← pre-filled if Bonjour/Tailscale
   │ http://mac.kingfisher...  │     detected (small ✓ pill below)
   ├───────────────────────────┤
   │ API Key                   │
   ├───────────────────────────┤
   │ Ignore SSL Errors    [ ]  │
   ├───────────────────────────┤
   │ Test connection           │  ← accent-coloured link
   └───────────────────────────┘
```

---

## Tokens (no raw hex)

| Element | Token |
|---|---|
| Background | `Tokens.Surface.app` (warm cream `#FFF7ED`) |
| Brand glyph chevron | `Tokens.info` `#0A85F0` |
| Brand glyph underscore | `Tokens.ok` `#1AC270` |
| Brand glyph "ANT" letters | `Tokens.ink.strong` `#181512` |
| Cards | `Tokens.Surface.card` `#FFFFFF` |
| Card border | `Tokens.line.soft` `#EAD8CA` |
| Heading | `Tokens.ink.strong` |
| Sub-heading | `Tokens.ink.soft` |
| Sign in button | `Tokens.accent` `#FF3D5A` bg, white text |
| "Get one →" link | `Tokens.accent` |
| Scan QR button | `Tokens.Surface.card` bg, `Tokens.line.soft` border, `Tokens.info` icon |

---

## "Where do I find my API key?" link target

Two paths the link should support, gated by what the user has:

1. **Has a server URL** → open `<serverURL>/settings/api-keys` in `SFSafariViewController` (so they stay in-app)
2. **No server URL yet** → present a small instruction sheet:
   - "Open `ant key create --label antios` on the Mac running your server"
   - "Or visit your server's `/settings/api-keys` page"
   - "Or paste your admin token from `~/.ant/secrets.env`"

Cross-team ask to Main: confirm `/settings/api-keys` exists as a server route. If not, spec needed for that page (one tap, copy-to-clipboard, with a "for which device" label).

---

## Preview mode (Apple Reviewer support)

Discrete affordance below "Get one →":

```
   Don't have an API key?  Get one →
   ⓘ Try the demo            ←  Small grey link, tappable
```

- Tap → loads a **read-only canned dataset** (no real server connection needed)
- Shows 3 fake rooms in ANT Cards + sample asks + sample plans
- Banner across the top: "Demo mode — sign in to see real rooms"
- Reviewer-friendly + tester-friendly + onboarding-friendly

---

## States

| State | What renders |
|---|---|
| `cold-launch` | Default — brand + heading + login card + Sign in button (disabled until fields filled) + Get one → + Scan QR + accordion collapsed |
| `partial` | One or more fields typed; Sign in remains disabled until all valid |
| `submitting` | Sign in button shows spinner; entire view becomes `.disabled(true)` |
| `error` | Inline error below the login card, accent-warn colour, specific message ("Couldn't reach server" / "Invalid licence" / "Wrong password") |
| `success` | Brief checkmark fade-through then navigate to ANT Cards (matched-geometry effect if feasible) |
| `demo-loading` | Tap "Try the demo" → spinner + "Loading demo…" + 1s delay → ANT Cards with canned data |

---

## PASS gate (for @antmacdevcodex)

1. Cold-launch lands on this view — no other view between launch + this one
2. Brand wordmark visible above-fold + correctly coloured (info-blue chevron, ok-green underscore, ink-strong ANT)
3. Background is `Tokens.Surface.app`, not default grouped-list grey
4. Sign in button is full-width, accent bg, white text — reads as button not label
5. "Get one →" link is visible + tappable + opens correctly per the rules above
6. Custom server section is collapsed by default + expands smoothly
7. Auto-detected URL shows a "✓ auto-detected" pill
8. Preview mode link visible + functional
9. VoiceOver: heading announced as title, fields labelled, button labelled "Sign in, button", link labelled "Get one, link"
10. No comic sans / fallback font — font stack pinned to system Inter
11. Build green + a `CanvasGrid("ServerConfig-ConceptD")` capture lands in CanvasGrid project folder

---

## Implementation tools

```swift
ScrollView {  // safe for keyboard-up scrolling
    VStack(spacing: 24) {
        // Brand block
        VStack(spacing: 12) {
            AntBrandMark(size: 60)
            Text("Welcome to ANT")
                .font(.system(size: 28, weight: .heavy))
                .foregroundStyle(Tokens.ink.strong)
            Text("Sign in to see your team")
                .font(.system(size: 15))
                .foregroundStyle(Tokens.ink.soft)
        }
        // Login card
        // Sign in button
        // Get one link
        // Scan QR + accordion
    }
    .padding(.horizontal, 20)
}
.background(Tokens.Surface.app.ignoresSafeArea())
```

Use `DisclosureGroup` for the custom-server accordion (iOS-native + animates cleanly).

---

## Out of scope (banked for later)

- Biometric quick-unlock once signed in (FaceID/TouchID → bypass full SignIn on cold-launch)
- "Remember this device" toggle
- Multi-server switcher (for users on multiple ANT servers)

---

## Hand-off

@codexuxant — build against the layout + tokens above. The `AntBrandMark` reusable view should already exist in antios from the Concept D shared component work — check `ANT/Theme/` or `ANT/Components/`. If not, port from `antchat/Antchat/Views/AntBrandMark.swift`. Wrap as `CanvasGrid("ServerConfig-ConceptD") { ServerConfigView() }` in `#Preview`.

@antmacdevcodex — PASS gate above is the criterion; gate this against build evidence + JWPK reading the cold-launch on his next TestFlight as "Welcome to ANT" (not "Settings page").
