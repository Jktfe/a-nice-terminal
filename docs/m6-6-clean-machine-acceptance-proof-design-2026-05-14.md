# M6.6 — Clean-machine acceptance proof — design contract

Date: 2026-05-14
Author: @researchant (research-only scout, no code changes)
Status: DESIGN-FIRST. No m6.6 implementation claim until canonical PASS.
Cap: ≤180L. Closes Phase 6 design surface.

## TL;DR

M6.6 is the end-to-end Phase 6 acceptance bar: prove that on a clean
Mac AND a clean Windows machine, an operator can install ANT from the
public rails (m6.1 brew + m6.2 scoop), authenticate to the operator's
ANT server, post + read messages, and (optionally) launch the m6.4
desktop app — with EVERY step captured to the m-shared-screenshots
index that claude2 shipped earlier today.

Two gates (per delta-3): **design-doc PASS** = doc shape only, NO
cert/runs needed; **implementation acceptance** = cert + runs +
screenshots, gates plan_milestone done. See L126 + L133.

## Q1 — Cross-machine ANT identity model

The clean-machine flow connects multiple devices to ONE operator-owned
ANT server (the JWPK Tailscale instance OR a self-hosted mirror).

**Default proposal**: single-server-multi-client. Each clean machine
registers as a separate terminal via /api/identity/register; the bridge
token (from m6.4 wizard) authorises the connection but DOES NOT make
the machine's local PTY visible to other agents unless m6.5 PTY bridge
is explicitly opted-in. Per-machine identity preserved via M3.2a
fingerprintDetector kind detection.

## Q2 — Acceptance bar shape

Three pass-paths, all must succeed:

**Mac path** (current CLI verb shapes verified on disk 2026-05-14):
1. Clean macOS install (no `~/.ant/`, no brew taps, no `ant` binary).
2. `brew tap Jktfe/antchat && brew install ant` — m6.1 rail.
3. `ant --version` prints non-zero version.
4. `ant register --handle @clean-mac --name clean-mac-shell` —
   pidChain identity (real verb signature; `--chain` was NOT a flag).
5. Operator-side: `ant rooms invite <roomId> @clean-mac` (existing
   verb on the operator's existing client). PREREQUISITE: there is no
   `ant rooms join` verb in current CLI — invite-side adds the member.
6. `ant rooms post <roomId> "hello from clean Mac"` + `ant rooms
   messages <roomId>` shows post + others' posts.

**Windows path**:
1. Clean Windows install (no `%USERPROFILE%\.ant\`, no scoop bucket).
2. `scoop bucket add antchat https://github.com/Jktfe/scoop-antchat`
   `&& scoop install ant`.
3-6. Same CLI verb sequence as Mac path.

**Desktop app path (optional, both OS)**:
1. Install signed .dmg (Mac) / signed .msi (Windows) from m6.4 release.
2. Launch app → first-run wizard → enter operator URL + roomId + token.
3. Webview navigates to the operator ANT URL; chat-room visible.

## Q3 — Desktop app verification (m6.4 dependency)

The .app/.msi must be SIGNED for clean-machine acceptance — Gatekeeper
on macOS quarantines unsigned downloads + Windows SmartScreen flags.
Unsigned-via-Internet-Quarantine workaround is acceptable for SMOKE but
not for v1 release. Hence Q4 cert blocker.

## Q4 — Release-cert provisioning blocker

**JWPK-blocking**: provision certs before M6.6 land:
- Apple Developer ID Application + Apple Notarisation profile
  (notarytool API key + team-id).
- Windows Authenticode cert (Sectigo / DigiCert / etc).
- Both certs signed with the same operator identity for trust-chain.

Without certs, m6.6 ships only the CLI-rail acceptance paths; desktop
app paths get marked "smoke-only" until cert lands.

## Q5 — v3 + v4 coexistence on clean machine

m6.3 design contract Q3 already locked: v3 (a-nice-terminal) and v4
(fresh-ANT) ship as SEPARATE apps until a future merge slice. Clean
machine acceptance proves either OR both depending on operator choice.
Default test fleet: v4 only for m6.6 v1; v3+v4 cross-validation in a
follow-up.

## Q6 — Evidence capture per step (delta-1: actual M-SHARED-SCREENSHOTS impl)

Per claude2's shipped M-SHARED-SCREENSHOTS impl (CLI shape verified
on disk 2026-05-14): `ant screenshot take --room <roomId> --file
<path-to-png> --topic <slug-or-desc>`. Stored via POST
/api/chat-rooms/:roomId/screenshots into
`static/uploads/rooms/<roomId>/screenshots/<sha>.png` (sha256-named
content-addressed; topic/slug lives in the index store as metadata
NOT in filename).

For m6.6: per step, capture a PNG of the relevant CLI output (or
desktop window) THEN call `ant screenshot take --room <m6.6-acceptance-
room-id> --file step-N.png --topic m6.6-<machine>-step-N-<short-desc>`.
The room becomes the de-facto acceptance fleet log.

## Q7 — Retry/teardown protocol

A "clean machine" must be reset between runs:
- Mac: VM snapshot rollback OR `brew uninstall ant && rm -rf ~/.ant
  && brew untap Jktfe/antchat && [uninstall .app]`.
- Windows: VM snapshot rollback OR `scoop uninstall ant && Remove-Item
  -Recurse $env:USERPROFILE\.ant + uninstall .msi via Settings`.

VM snapshots strongly recommended for reliability + retry speed.

## Touch points (for m6.6 implementer)

- NEW docs/m6-6-acceptance-checklist.md ≤120L: step-by-step recipe per
  OS path + per desktop path + screenshot capture commands.
- NEW scripts/check-clean-machine-acceptance.mjs ≤80L: optional
  automation that emits the required screenshot slugs per step (driver
  for the human operator to follow on the clean machine).
- NO src/ changes (this is acceptance, not feature work).
- Plan event m6.6-clean-machine-acceptance status=done after canonical
  PASS + JWPK-supplied cert + actual clean-machine run evidence.

## Design-doc PASS criteria (THIS gate — doc shape only)

- Q1-Q7 are coherent + actionable.
- Touch points list real files at sizes within stated caps.
- Do-not-use rationale aligns with locked options.
- NO cert / NO clean-machine run / NO impl artefacts required.

## Implementation acceptance (separate gate, gates plan_milestone done)

- JWPK-supplied Apple Developer ID + Authenticode certs landed.
- Acceptance checklist ships at docs/m6-6-acceptance-checklist.md.
- Optional driver script at scripts/check-clean-machine-acceptance.mjs.
- Mac CLI rail acceptance run posts screenshots via `ant screenshot take
  --room <m6.6-room> --file <png> --topic m6.6-mac-step-N-<desc>` for
  steps 1-6 (storage paths per Q6).
- Windows CLI rail acceptance run posts equivalent `m6.6-win-*` topics.
- Desktop app acceptance (signed) posts `m6.6-mac-app-*` + `m6.6-win-app-*`.
- "Add `ant rooms join` verb" called out as IMPL prerequisite — operator-
  side `rooms invite` is the v1 add path.
- Plan event m6.6-clean-machine-acceptance-proof status=done after
  cert+runs evidence lands.

## Do-not-use

| Rejected | Why |
|---|---|
| Skip clean-machine + use developer-machine | Defeats the proof — dev machines have residual config that masks install bugs. |
| Ship unsigned desktop apps as v1 | Gatekeeper / SmartScreen friction is unacceptable for a public install path. |
| Single-OS proof | Phase 6 promises Mac AND Windows (Linux later). |
| Skip evidence capture | Screenshots index is the audit surface — without it acceptance is unverifiable. |

## Open questions for JWPK

1. Cert provisioning ETA — unblocks M6.6 land. Default: BLOCK m6.6
   land until certs land.
2. VM snapshot infra — local UTM/Parallels vs cloud (Github Actions
   macOS/Windows runners + clean-VM each job)? Default: local first;
   cloud-CI follow-up.
3. Operator handle for the clean-machine fleet — `@clean-mac` /
   `@clean-win` literal vs OS-prefixed convention? Default: literal
   for v1; convention in a follow-up if fleet grows.

## What I did NOT verify

- Did NOT prototype the acceptance checklist on a real clean machine.
- Did NOT verify Apple notarisation API shape; assumes notarytool
  current docs accurate.
- Did NOT enumerate Windows SmartScreen behaviour for unsigned binaries
  beyond the headline "warns user, requires unblock click".

## Next step

**Design-doc gate (THIS doc)**: awaiting canonical RQO PASS on doc
shape + JWPK ACK on Q1-Q3 defaults. NO cert dependency.

**Implementation gate (separate, post-design-PASS)**: implementer
claim-first under Implementation acceptance once design-doc PASSes,
JWPK provisions certs, and clean-machine runs produce evidence.
