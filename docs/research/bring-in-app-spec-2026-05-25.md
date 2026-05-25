---
doc_id: bring-in-app-spec-2026-05-25
title: "Premium Bring in App — spec DRAFT for JWPK ratification"
status: draft
parties: ["@you", "@speedyclaude", "@speedycodex", "@speedykimi", "@claudev4"]
linked_rooms: ["orsz2321qb"]
trigger: "JWPK msg_5sqkg46z9v 2026-05-25 — three-way split of 'Bring in an agent' surfaced. Premium tier needs its own spec."
banked_from: "project_bring_in_llm_buttons_2026_05_23"
audited_at: 2026-05-25 10:00 BST
---

# Premium "Bring in App" — DRAFT spec for ratification

## Problem statement

JWPK's "Bring in an agent" pitch is for premium-tier ANT users: one-tap launchers that open Claude Desktop / Claude Mobile / ChatGPT / Codex Desktop / Gemini with the current room's context pre-loaded + identity established + room membership granted.

Distinct from two adjacent affordances (per product call locked 2026-05-25 orsz msg_qpcmqnkeko):
- **Remote invite** (already shipped) — admit an already-running ANT participant/device into a room.
- **Local CLI bridge** (shipped, then removed from prominent placement) — dev/operator tool to spawn local `codex`/`pi` binaries. Hidden/admin/dev surface.

Without Bring-in-App, the operator's workflow today is:
1. Notice a question in room X that they'd want Claude Desktop to think about.
2. Open Claude Desktop manually.
3. Manually paste the room context / open the right project / re-orient Claude.
4. Iterate.

That's 4 surfaces + manual context transcription. Friction kills the use case.

## Proposed shape (v0)

One-tap surfaces in any client (web/Mac/Windows/iOS) labeled per target:
- "Bring in Claude Desktop"
- "Bring in Claude Mobile"
- "Bring in ChatGPT"
- "Bring in Codex Desktop"
- "Bring in Gemini"

Per click:
1. Mint a short-lived room-context payload (last N messages + room name/description + active asks/plans/tasks summary).
2. Launch the target app via platform-appropriate mechanism (see "Launch protocols" below).
3. Pre-load the payload as the operator's opening message OR as a starter prompt OR as a shared file (target-specific).
4. Record the launch in `cli_hook_events` so the operator sees "you brought in Claude Desktop at HH:MM" in /cli-hooks.
5. (V1 follow-up) Allow the launched app to post replies back to the room via the prompt-channel server endpoint + a return URL or webhook.

## Launch protocols (per target, per platform)

| Target | Mac | Windows | iOS |
|---|---|---|---|
| **Claude Desktop** | `claude://` URL scheme OR direct file open OR clipboard handoff to running instance via accessibility | `claude://` URL scheme | n/a |
| **Claude Mobile** | n/a | n/a | `claude://` Universal Link, fall back to App Store |
| **ChatGPT app** | `chatgpt://` URL scheme + clipboard fallback | TBD (Windows app does not currently exist as native) | `chatgpt://` Universal Link |
| **Codex Desktop** | `codex://` URL scheme (verify with Anthropic) | TBD | n/a |
| **Gemini** | Web-only via opening gemini.google.com in a new browser window | Web-only | Web-only |

Each target gets its own adapter under `src/lib/server/bringInApp/`:
- `claudeDesktopAdapter.ts`
- `chatgptAdapter.ts`
- `codexDesktopAdapter.ts`
- `geminiAdapter.ts`

Adapters expose a uniform interface:
```ts
type BringInAppAdapter = {
  isAvailable(platform: 'mac' | 'windows' | 'ios' | 'web'): Promise<boolean>;
  launch(input: {
    roomId: string;
    contextPayload: RoomContextPayload;
    platform: 'mac' | 'windows' | 'ios' | 'web';
  }): Promise<{ launchId: string; method: 'url-scheme' | 'clipboard' | 'share-sheet'; status: 'launched' | 'unavailable' }>;
};
```

## Room-context payload shape

```ts
type RoomContextPayload = {
  roomId: string;
  roomName: string;
  roomDescription: string | null;     // a19a496 description field
  recentMessagesMarkdown: string;      // last N messages, max 8KB
  openAsksMarkdown: string | null;
  attachedPlansMarkdown: string | null;
  generatedAtMs: number;
};
```

N depends on target's context-window-tolerance (default 30 messages; configurable per-adapter).

## Consent flow

1. First time the operator clicks "Bring in Claude Desktop" on a room, surface a consent dialog:
   > "Send this room's context to Claude Desktop?"
   > • Last 30 messages
   > • Room description + open asks + active plans
   > • Tracked in /cli-hooks; you can revoke at any time
   >
   > [Cancel] [Bring in once] [Bring in + remember this room]

2. "Remember" stores `bring_in_consent_grants` keyed by `(operatorHandle, roomId, targetApp)`. Subsequent clicks bypass the dialog.
3. Grants revocable from a settings panel + per-room consent strip.

## Surfaces

- **Web** (`a-nice-terminal`): button row in `RoomNameHeader.svelte` or `RoomShelf` — "Bring in Claude Desktop · ChatGPT · Codex Desktop · Gemini" pills. Per-platform availability hides unavailable targets (e.g. Claude Mobile pill hidden on web).
- **Mac** (`antchat`): same shape via SwiftUI button row in the room shell. Each adapter calls `NSWorkspace.shared.open(url:)` or `UIPasteboard.general` per target.
- **Windows** (`antchat-windows`): SvelteKit + Tauri shell-open for URL schemes. Same button row UI.
- **iOS** (`ant-native-ios` when built): SwiftUI button row, `UIApplication.shared.open(_:)` per URL scheme.

## Tier gating

Premium-tier ONLY. Free tier shows the button row but each pill is disabled with a "Premium feature — learn more" tooltip linking to the upgrade page.

Detection: feature flag `bring_in_app` resolved server-side per `getFeatureFlagsForTier(tier)` in `featureGates.ts`. Existing pattern; mirrors `verification_ux` + `policy_controls` gating.

## Build order

1. **Spec ratification** (this doc) — JWPK ✓ or amend
2. **Server contract** — `POST /api/chat-rooms/:roomId/bring-in-app` minting the context payload + recording in `cli_hook_events`. Returns `{launchId, method, status}` for the client to use.
3. **Web v0** — one adapter (Claude Desktop, since Anthropic-first), one button, one consent flow, one platform (web).
4. **Web v0.5** — second adapter (ChatGPT or Gemini).
5. **Mac mirror** — three adapters working on Mac.
6. **Windows mirror** — same.
7. **iOS slice** — when the iOS app is real.
8. **Premium tier gating** — enforced at endpoint + UI.

Each step is independently shippable. Spec ratification is the only gate.

## Open questions for JWPK

1. **Adapter ownership**: should each target adapter live in this repo (`src/lib/server/bringInApp/`) or in a separate `ant-bring-in-app` repo to keep upstream changes from churning core? Lean: same repo first, extract later if churn becomes painful.
2. **Context-window-tolerance defaults**: 30 messages is a guess. Should we tune per-target (Claude 30, ChatGPT 50, Gemini 100k+)?
3. **Consent expiry**: do grants expire after N days or persist until manually revoked? Lean: persist until revoked; per-target/per-room granularity is enough.
4. **Premium gating override**: should the free tier see ANY of these buttons even as disabled-with-tooltip, or hide entirely? Visible-but-locked is the standard upgrade-prompt pattern.
5. **CLI bridge rename**: separate doc / decision needed — what's the canonical label for the now-renamed/gated dev CLI bridge so it doesn't conflict with this premium feature's vocabulary?

## What this spec does NOT cover

- Tarballing room artefacts for handoff (deck, screenshots, docs) — separate slice if needed.
- Bidirectional sync (app's reply → room) — V1 follow-up, depends on the launched app's API surface per target.
- Cost/usage tracking when the operator brings in a paid LLM session — separate slice.
- Multi-room handoffs (bring in Claude Desktop with context from rooms A + B) — out of v0 scope.

---

**Next action**: JWPK ratifies or amends. Once ratified, step 2 (server contract) is shovel-ready for one of @speedyclaude / @speedycodex / @claudev4 to cut.
