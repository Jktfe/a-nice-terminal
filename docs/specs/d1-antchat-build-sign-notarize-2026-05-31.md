# D1 — antchat-Mac Build + Sign + Notarize (with remoteant bundled)

**Status**: PRE-STAGED (activates after B2 closes; the final gate before "fully wired native app installable")
**Plan**: `remoteant-mac-delivery-2026-05-29`
**Milestone**: `d1-build-sign-notarize` (currently `[planned]`)
**Lead**: @homebrewmainclaude
**Plan momentum**: @homebrewmaincodex
**Implementer**: @kimihomebrewwork (with @homebrewmainclaude on Developer ID / entitlement contract clarifications)
**Source repo**: `antchat/` (Xcode project) + `a-nice-terminal/packages/remoteant/dist/cli.js` (bundled binary)

---

## 1. D1 Goal

Produce a notarized, Developer-ID-signed `Antchat.app` with `remoteant` bundled at `Contents/Resources/remoteant` that JWPK can:

1. Download from a `.dmg` or `.zip` artefact.
2. Drag to `/Applications/`.
3. Launch without a Gatekeeper warning (no "unidentified developer" sheet).
4. Have it auto-spawn remoteant, connect to the local ANT daemon, and show "connected" in DiagnosticsTab.

Plan's D1 acceptance: *"Notarized binary opens without Gatekeeper warning on a fresh macOS install"*. That's the unblocker — once D1 passes, the chain to "JWPK uses it" is complete.

---

## 2. Required Infrastructure (verify exists BEFORE coding)

Before scoping, kimi runs this checklist and posts findings to the room. Several of these may already be in place; just need to confirm.

| Check                                                                      | Command                                                              | Expected             |
|----------------------------------------------------------------------------|----------------------------------------------------------------------|----------------------|
| Apple Developer ID Application certificate is installed                    | `security find-identity -v -p codesigning \| grep "Developer ID"`     | At least one match    |
| Notarization credentials stored in Keychain (or App Store Connect API key) | `xcrun notarytool store-credentials --list` / check `~/.zshenv`      | At least one profile |
| `Antchat.xcodeproj` has a Release scheme that signs with Developer ID       | Open Xcode → Antchat target → Signing & Capabilities                 | "Developer ID" selected |
| Entitlements file exists at `antchat/Antchat/Antchat.entitlements`         | `ls antchat/Antchat/*.entitlements`                                  | File exists           |
| Hardened Runtime enabled in Release configuration                          | Build Settings → Enable Hardened Runtime                              | YES                   |
| Keychain item `run.ant.antchat.admin-token` exists (needed by E2 at runtime, not D1 itself, but verify before D1 closes) | `security find-generic-password -s "run.ant.antchat.admin-token"` | Item found |

**2026-05-31 pre-flight infra check results** (run from @homebrewmainclaude):

- ✅ Developer ID certificate present: `E1A759A36F8CC8AA74987404688E8D5071642920 "Developer ID Application: JAMES WILLIAM PETER KING (54D7S73Y9F)"`.
- ❌ **Notarytool profile `antchat-notarize` NOT FOUND.** JWPK must run `xcrun notarytool store-credentials antchat-notarize --apple-id <email> --team-id 54D7S73Y9F --password <app-specific-pwd>` before D1 can produce notarized DMGs. Without this, D1-G4 fails.
- ✅ Antchat.xcodeproj has Antchat scheme + xcshareddata.
- ✅ Entitlements file at `Antchat/Antchat.entitlements`.
- ✅ ENABLE_HARDENED_RUNTIME = YES in both Debug and Release configs.
- ⚠️ **CODE_SIGN_IDENTITY = "Apple Development"** in Release config — D1 script overrides via xcodebuild flag (see updated archive step).
- ❌ **Info.plist path correction**: real path is `Antchat/GeneratedInfo.plist` (Xcode generates), not `Antchat/Info.plist`. D1 script reads version from xcodebuild build settings, not plutil on the plist file.
- ❌ **Keychain item `run.ant.antchat.admin-token` NOT SEEDED yet.** E2 at runtime will get a nil token and either fail-fast or operate in degraded mode. JWPK must seed it (one-time): `security add-generic-password -s "run.ant.antchat.admin-token" -a "antchat" -w "$(grep ANT_ADMIN_TOKEN ~/.ant/secrets.env | cut -d= -f2)"`. Not strictly D1's job, but should be done before D1's manual smoke walk-through (§7) so the launched app actually connects.

If ANY of these are missing at D1 activation time, the kimi PR description must call out what's needed; @homebrewmainclaude or JWPK provides the missing config.

---

## 3. The Build Pipeline (new script: `antchat/Scripts/build-release.sh`)

```bash
#!/usr/bin/env bash
# build-release.sh — builds a notarized Antchat.app with remoteant bundled
# Usage: ./Scripts/build-release.sh [--notarize] [--output-dir OUTPUT_DIR]
#
# Steps:
#  1. Build remoteant in sibling a-nice-terminal repo.
#  2. xcodebuild archive Antchat.
#  3. Embed remoteant into the .app bundle.
#  4. Re-sign the bundle (so the embedded binary is signed by the same identity).
#  5. Export the .app as a Developer-ID-signed .app.
#  6. If --notarize: notarytool submit, wait, staple.
#  7. Output: <OUTPUT_DIR>/Antchat-<version>-<sha>.dmg
set -euo pipefail

ANTCHAT_REPO="$(git rev-parse --show-toplevel)"
NICE_TERMINAL_REPO="${ANTCHAT_REPO}/../a-nice-terminal"
OUTPUT_DIR="${OUTPUT_DIR:-${ANTCHAT_REPO}/dist}"
SHA=$(git rev-parse --short HEAD)
# Per 2026-05-31 infra check: Info.plist is GENERATED by Xcode at build time
# (GENERATE_INFOPLIST_FILE = YES per project.pbxproj), with a fallback file at
# Antchat/GeneratedInfo.plist. Version + build come from xcconfig build settings.
VERSION=$(xcodebuild -project "${ANTCHAT_REPO}/Antchat.xcodeproj" -showBuildSettings -configuration Release | awk '/MARKETING_VERSION/ {print $3}' | head -1)

# Step 1 — build remoteant
echo "==> Building remoteant"
(cd "${NICE_TERMINAL_REPO}/packages/remoteant" && bun run build)
REMOTEANT_BIN="${NICE_TERMINAL_REPO}/packages/remoteant/dist/cli.js"
test -f "${REMOTEANT_BIN}" || { echo "remoteant build failed"; exit 1; }

# Step 2 — xcodebuild archive
echo "==> Building Antchat archive"
ARCHIVE_PATH="${OUTPUT_DIR}/Antchat.xcarchive"
# Per 2026-05-31 infra check: project.pbxproj has CODE_SIGN_IDENTITY="Apple
# Development" for BOTH Debug and Release configs (likely was added during
# dev/automatic-signing setup). For shippable Release builds we MUST override
# to "Developer ID Application" + Manual style, otherwise notarization will
# reject the archive as dev-signed. The DEVELOPMENT_TEAM=54D7S73Y9F is correct.
xcodebuild archive \
  -project "${ANTCHAT_REPO}/Antchat.xcodeproj" \
  -scheme Antchat \
  -configuration Release \
  -archivePath "${ARCHIVE_PATH}" \
  CODE_SIGN_IDENTITY="Developer ID Application" \
  CODE_SIGN_STYLE=Manual \
  DEVELOPMENT_TEAM=54D7S73Y9F

# Step 3 — embed remoteant
APP_PATH="${ARCHIVE_PATH}/Products/Applications/Antchat.app"
echo "==> Embedding remoteant into ${APP_PATH}"
cp "${REMOTEANT_BIN}" "${APP_PATH}/Contents/Resources/remoteant"
chmod +x "${APP_PATH}/Contents/Resources/remoteant"

# Step 4 — re-sign the bundle (deep re-sign because we added a binary AFTER archive)
echo "==> Re-signing bundle"
codesign --force --options runtime --deep \
  --sign "Developer ID Application" \
  --entitlements "${ANTCHAT_REPO}/Antchat/Antchat.entitlements" \
  "${APP_PATH}"
codesign --verify --deep --strict --verbose=2 "${APP_PATH}"

# Step 5 — export as .app + .dmg
echo "==> Exporting"
mkdir -p "${OUTPUT_DIR}"
DMG_PATH="${OUTPUT_DIR}/Antchat-${VERSION}-${SHA}.dmg"
hdiutil create -volname "Antchat" -srcfolder "${APP_PATH}" -ov -format UDZO "${DMG_PATH}"

# Step 6 — notarize (optional)
if [[ "${1:-}" == "--notarize" ]]; then
  echo "==> Notarizing"
  xcrun notarytool submit "${DMG_PATH}" --keychain-profile "antchat-notarize" --wait
  xcrun stapler staple "${DMG_PATH}"
  xcrun stapler validate "${DMG_PATH}"
fi

echo "==> Done: ${DMG_PATH}"
```

---

## 4. Entitlements (Antchat.entitlements — verify or add)

Required entitlements (must be in Antchat.entitlements; if missing, kimi adds):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <!-- Hardened runtime is mandatory for notarization. -->
  <key>com.apple.security.app-sandbox</key>
  <false/>
  <!-- We spawn a child process (remoteant) — Hardened Runtime requires explicit allow. -->
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <false/>
  <key>com.apple.security.cs.allow-jit</key>
  <false/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
  <!-- Outbound network access to local ANT daemon. -->
  <key>com.apple.security.network.client</key>
  <true/>
  <!-- Read remoteant log + write antchat preferences. -->
  <key>com.apple.security.files.user-selected.read-write</key>
  <true/>
</dict>
</plist>
```

**Why `app-sandbox = false`**: spawning a child process from a sandboxed app is hairy — would require the child also being sandboxed and inheriting the parent's entitlements. For V1 we ship outside the sandbox; the Hardened Runtime + notarization still provides the Gatekeeper acceptance. Future hardening: sandbox + child temporary exception.

**Why `disable-library-validation = true`**: remoteant is signed by us, but bun's bundled binary may contain dyld dependencies that the validator would otherwise reject. This is the standard pattern for shipping a child process inside a Mac app.

---

## 5. Notarization Setup (one-time, ahead of D1)

Before D1 implementation can run end-to-end, the notarization keychain profile must exist. JWPK / @homebrewmainclaude one-time setup:

```bash
xcrun notarytool store-credentials antchat-notarize \
  --apple-id "<apple-id-email>" \
  --team-id "<team-id>" \
  --password "<app-specific-password>"
```

(App-specific password generated at appleid.apple.com → Sign-In and Security → App-Specific Passwords.)

If JWPK hasn't set this up, the build script falls back to `--no-notarize` and produces an unsigned-DMG for local testing only. The plan acceptance gate (G4 below) only counts if notarization actually ran.

---

## 6. Acceptance Gates (D1-G1..G7)

| Gate    | Verification                                                                                                          | Evidence                                                |
|---------|-----------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------|
| D1-G1   | `Scripts/build-release.sh` completes without error on a clean clone (no remnants from previous build)                 | terminal capture of `./Scripts/build-release.sh`        |
| D1-G2   | Output DMG exists at `dist/Antchat-<version>-<sha>.dmg` and mounts cleanly                                            | `ls -la dist/` + `hdiutil verify` output                |
| D1-G3   | `codesign --verify --deep --strict --verbose=2 dist/Antchat.app` passes                                               | codesign output                                         |
| D1-G4   | `spctl --assess --type execute --verbose dist/Antchat.app` returns "accepted" with "source=Notarized Developer ID"    | spctl output                                            |
| D1-G5   | The bundled `Contents/Resources/remoteant` runs end-to-end: `./Antchat.app/Contents/Resources/remoteant --version` produces a valid version string | terminal capture |
| D1-G6   | Launching `Antchat.app` on a clean macOS user account (or with quarantine xattr stripped) does NOT show a Gatekeeper warning sheet | manual launch screenshot                |
| D1-G7   | After launch, DiagnosticsTab status pill flips to "live" within 10s and the remoteant child process appears in `Activity Monitor` | screenshot + Activity Monitor capture   |

---

## 7. Manual Smoke Walk-Through (G6+G7)

After `./Scripts/build-release.sh --notarize`:

1. Move `dist/Antchat.app` to `/Applications/`.
2. Right-click → Show Package Contents → Contents/Resources → confirm `remoteant` present + executable.
3. Quit any existing Antchat instance.
4. Strip quarantine to simulate a fresh download: `xattr -dr com.apple.quarantine /Applications/Antchat.app`.
5. Launch via Spotlight / Dock / `open`.
6. Verify: NO Gatekeeper warning. App opens to its main window.
7. Open Settings → Diagnostics tab. Within 10s, status pill should flip to "live".
8. Run `ps aux | grep remoteant` — confirm one `Antchat.app/Contents/Resources/remoteant --mcp-stdio` child process visible.
9. Cmd-Q antchat. Within 6s, remoteant disappears from process list (E2 reap gate).

---

## 8. Out of Scope for D1

- Homebrew formula / cask distribution — that's D2.
- Auto-update mechanism (Sparkle / built-in) — V2.
- Universal binary (Intel + Apple Silicon) — V2 (Apple Silicon-only for now matches the project's hardware target).
- DMG background graphic / EULA — V2 cosmetic.

---

## 9. Risk Notes

**R1 — Bun bundle dyld dependencies**. `bun build --target=node` produces a single file but it requires Node at runtime. To ship a truly standalone binary, switch to `bun build --compile --target=bun-darwin-arm64` (produces a self-contained executable). The A1 spec defaulted to `--target=node` for vitest ease — D1 may need to switch to `--compile` for shipping. Flag in PR if so.

**R2 — Re-signing inside the archive vs export**. `xcodebuild archive` produces a Code Sign-blessed archive. Adding remoteant AFTER archive invalidates the signature, requiring `--deep` re-sign. This is supported but each level (Antchat.app, embedded frameworks, remoteant) must be signed in the right order. The script's `codesign --force --options runtime --deep` handles this — but if remoteant itself has its OWN child binaries (e.g. bun's runtime), each needs `codesign` too. Verify with `codesign --verify --deep --strict` after build.

**R3 — First-launch quarantine on user's machine**. Even with notarization, Safari attaches `com.apple.quarantine` xattr to downloaded files. Gatekeeper checks the notarization ticket stapled to the DMG — if stapling succeeded (`stapler validate` passes), the first-launch path is clean. If not, user sees "Apple verifying this..." spinner for a few seconds. We want stapled tickets.

**R4 — Build time + machine cost**. xcodebuild archive of antchat (~50k LoC Swift) + bun build + notarize round-trip is ~5–10 min wall clock. Run on the M4 Pro mac mini per JWPK's setup; not on a junior dev's laptop. Document in PR.

---

## 10. Handoff Sequence

1. B2 closes (the last functional milestone before D1 is meaningful).
2. @homebrewmainclaude verifies infra checklist (§2) is green — escalate to JWPK if any missing.
3. @homebrewmaincodex flips `d1-build-sign-notarize` → active/claimed; preloads D1-G1..G7.
4. @kimihomebrewwork creates `Scripts/build-release.sh` per §3 + verifies/adds entitlements per §4 + runs the manual smoke walk-through.
5. @homebrewmaincodex review + accept + flip done.
6. @homebrewmainclaude posts a "fully wired" summary to room g6s4bwanvh with download link to the DMG so JWPK can install + smoke test on a separate mac.

---

**Spec status when this lands**: ready for plan-state flip once B2 closes. This is the final gate before "JWPK can install antchat and it just works".
