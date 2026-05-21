# M6.6 — Clean-machine acceptance checklist

Sister doc: `docs/m6-6-clean-machine-acceptance-proof-design-2026-05-14.md`.
This file is the operator-facing recipe. Driver script:
`scripts/check-clean-machine-acceptance.mjs`. Both ship as pre-cert
prep artifacts NOW; their *shape* is the gate this slice clears.
The actual clean-machine acceptance RUN — walking the steps, posting
evidence screenshots, and emitting the `m6.6` `plan_milestone status=done`
event — is gated on Apple Developer ID + Authenticode certs
(JWPK-blocking) and is owned by a future implementation slice, not
this artifact slice.

## Prerequisites (operator-side, NOT the clean machine)

- Operator's ANT server is running + reachable at a stable URL
  (e.g. `https://<ANT_SERVER_HOST>`).
- Operator has a chat room ready for the acceptance fleet. Suggested
  name: `m6.6-acceptance-fleet`. Note the `roomId` once created.
- Operator runs `ant screenshot enable <roomId>` BEFORE step 1 so
  captures aren't rejected with `SharedFolderDisabledError`.
- Operator has a bridge invite token to share with each clean machine
  (see `ant invite create --room <roomId>` flow).

## Mac CLI rail (m6.1)

Run on a fresh macOS VM (Apple Silicon or Intel; no `~/.ant/`, no
brew taps, no `ant` binary).

1. **install** — `brew tap Jktfe/antchat && brew install ant`.
   Screenshot capture: `ant screenshot take <roomId> --file step-1.png
   --topic m6.6-mac-1-install` (run from operator client, attaching
   the captured Terminal screenshot).
2. **version probe** — `ant --version` must print a non-zero version
   matching the brew formula's `version` field.
   Screenshot: `--topic m6.6-mac-2-version`.
3. **register** — on the clean Mac:
   `ant register --handle @clean-mac --name clean-mac-shell`. The
   pidChain identity gates future writes.
   Screenshot: `--topic m6.6-mac-3-register`.
4. **invite** — back on the operator client:
   `ant rooms invite <roomId> @clean-mac`. (There is no `ant rooms
   join` verb yet — invite-side adds the member.)
   Screenshot: `--topic m6.6-mac-4-invite`.
5. **post** — clean Mac:
   `ant rooms post <roomId> "hello from clean Mac"`.
   Screenshot: `--topic m6.6-mac-5-post`.
6. **read** — clean Mac:
   `ant rooms messages <roomId>` must show step-5's post AND any
   prior messages from other room members.
   Screenshot: `--topic m6.6-mac-6-read`.

## Windows CLI rail (m6.2)

Run on a fresh Windows VM (x64, no `%USERPROFILE%\.ant\`, no scoop
bucket).

1. **install** —
   `scoop bucket add antchat https://github.com/Jktfe/scoop-antchat && scoop install ant`.
   Screenshot: `--topic m6.6-win-1-install`.
2-6. Same CLI verb sequence as the Mac path; screenshots use
   `m6.6-win-N-<desc>` topics so the operator can distinguish per-OS
   in the room screenshot list.

## Desktop app (m6.4) — signed-only, smoke-until-cert

Run on a fresh Mac AND a fresh Windows VM, AFTER Apple Developer ID
+ Authenticode certs land.

1. **install** — download signed `.dmg` / `.msi` from the m6.4 GitHub
   release. Open the installer (no Gatekeeper / SmartScreen prompt
   if signing is correct).
   Screenshot: `--topic m6.6-<os>-app-1-install`.
2. **first-run wizard** — launch app, paste operator URL +
   `roomId` + bridge token.
   Screenshot: `--topic m6.6-<os>-app-2-wizard`.
3. **webview** — confirm the operator chat room is visible.
   Screenshot: `--topic m6.6-<os>-app-3-webview`.

## Teardown between runs

- **Mac**: VM snapshot rollback OR
  `brew uninstall ant && rm -rf ~/.ant && brew untap Jktfe/antchat &&
  [uninstall .app via Finder]`.
- **Windows**: VM snapshot rollback OR
  `scoop uninstall ant && Remove-Item -Recurse $env:USERPROFILE\.ant`
  + Settings → Apps → uninstall .msi.

VM snapshots strongly recommended (faster + zero-residue).

## PASS bar

- All 6 Mac CLI steps green + screenshots in room.
- All 6 Windows CLI steps green + screenshots in room.
- Desktop app paths green per OS (post-cert).
- Plan event `m6.6-clean-machine-acceptance-proof` status=done posted
  by the operator after canonical RQO ACK of the screenshot evidence.
