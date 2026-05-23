# Slice 1.5 — Stable Apple Development signing

**Status:** spec ready — Xcode UI step requires JWPK + an Apple Developer account
**Owners:** @antchatmacdev (build) · @antmacdevcodex (QA) · @antux (UX) · **JWPK (Apple Developer team selection)**
**Visual contract:** N/A — build-config slice, no UI changes
**Inheritance:** banked memory `project_slice_1_5_stable_signing_followup_2026_05_22`. Required before v0.2 ship.

---

## Problem

Each Xcode dev build re-signs antchat with a fresh ephemeral cert (or ad-hoc identifier). macOS Keychain ACLs **key on the signing certificate, not the bundle id**. So every rebuild = different cert = different "app" from Keychain's POV = re-prompt for access, regardless of how many times the user clicked "Always Allow" previously.

JWPK was prompted **10× during Slice 1 screenshot work**. The friction compounds with every new permission scope added in later slices (Calendar in Slice 5, Reminders in Slice 5, etc).

## Fix

Move from ad-hoc to **"Apple Development"** signing identity with a stable Apple Developer team. Every dev build then carries the same cert; Keychain treats successive builds as the same app; Always-Allow persists for real.

## Steps

### Xcode UI (JWPK — ~30 seconds)

1. Open antchat target in Xcode → **Signing & Capabilities**
2. **Automatically manage signing** → ON
3. **Team** → JWPK's Apple Developer team (the same one that signed the v0.1.4 DMG)
4. **Signing Certificate** → "Apple Development" (auto-selected once Team is set)
5. Bundle Identifier → confirm `dev.antonline.antchat` (or whatever the v0.1.4 cask uses — should not change)

### Project source-of-truth (@antchatmacdev)

If `project.yml` (XcodeGen) is the source of truth:

```yaml
targets:
  Antchat:
    settings:
      base:
        CODE_SIGN_STYLE: Automatic
        DEVELOPMENT_TEAM: <JWPK-team-id>      # 10-char alphanumeric
        CODE_SIGN_IDENTITY: "Apple Development"
        PRODUCT_BUNDLE_IDENTIFIER: dev.antonline.antchat
```

Then regenerate: `xcodegen generate`

If raw `.xcodeproj` is the source of truth: commit the post-Xcode-UI state of `project.pbxproj` after JWPK's selection.

### Entitlements file

Verify `antchat/Antchat/Antchat.entitlements` exists and is committed. Required entries for Slice 4 functionality (no new ones in this slice — just ensure existing ones survive the signing-style change):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.app-sandbox</key>     <true/>
  <key>com.apple.security.network.client</key>  <true/>
  <key>com.apple.security.files.user-selected.read-write</key>  <true/>
</dict>
</plist>
```

(Slice 5 will add Calendar, Reminders, Photos, Screen Recording entitlements + Info.plist `NSCalendarsUsageDescription` etc.)

---

## Verification (3-step probe)

1. `xcodebuild clean` — wipe DerivedData
2. `xcodebuild build` then run — Keychain prompts once for `"antchat wants to use the 'login' keychain"`. Click **Always Allow**.
3. Repeat `xcodebuild clean` + build + run **twice more**. Keychain must **NOT** re-prompt in steps 2-3.

If step 3 reprompts: signing identity isn't actually stable yet — check `codesign -dvv` on the resulting binary across runs; the `Identifier`, `TeamIdentifier`, and `Authority` lines should be identical across rebuilds. If they differ, the team selection didn't take.

---

## PASS gate (3 items — narrow by design)

| # | Criterion | Met by |
|---|---|---|
| 1 | `project.yml` (or `project.pbxproj`) committed with `CODE_SIGN_STYLE=Automatic` + `DEVELOPMENT_TEAM=<JWPK's team id>` + `CODE_SIGN_IDENTITY="Apple Development"` | PR diff |
| 2 | 3 consecutive clean builds → Keychain prompts at most **once** (the first); steps 2-3 of verification probe run silent | manual rebuild × 3 + screenshot of Keychain Access entry |
| 3 | `codesign -dvv <built>.app` shows identical `Identifier` + `TeamIdentifier` + `Authority` across consecutive rebuilds | terminal output captured in PR |

---

## Files touched

- `antchat/project.yml` (or equivalent build config)
- `antchat/Antchat/Antchat.entitlements` (verify presence; create if missing)
- **No source code changes** — pure build-config slice

## What JWPK does

Steps 1-5 of Xcode UI above. ~30 seconds. After that, all of build/QA can verify.

## What @antchatmacdev does

- Verify `project.yml` post-JWPK matches Xcode UI state
- Regenerate Xcode project if XcodeGen flow
- Smoke-test the 3-step verification probe
- Comment the team ID in `project.yml` (team IDs are not secret — public-ish identifiers)

## What @antmacdevcodex does

- Verify the 3-item PASS gate against the rebuild probe
- Note any **new** TCC prompts that arise (Keychain should be silent; Calendar / Files / etc may still prompt on first access — that's normal + correct, addressed in Slice 5 with usage strings)

---

## Why this sits between Slice 4 and v0.2 ship

Slice 4 lands the chat surface → app becomes usable. But every QA rebuild of Slice 4 → re-prompted Keychain → friction multiplied across iterations. Slice 1.5 lands once + saves time on every subsequent slice's rebuild loop, including the eventual DMG validation rebuilds.

Cannot ship v0.2 to brew without this — the released DMG would be Developer-ID-signed (which is fine for end users) but dev rebuilds in CI / on contributors' Macs would still re-prompt unless signing is stable.

## Open items

None for me. JWPK opens Xcode + selects team. @antchatmacdev commits the config diff. @antmacdevcodex verifies. Estimated total wall-clock: ~5 minutes once JWPK is at the keyboard.
