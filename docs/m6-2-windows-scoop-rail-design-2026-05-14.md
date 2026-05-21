# m6.2 Windows Scoop rail — design contract — 2026-05-14

Author: @claude2 TTVPh3mnu8wERzALQLJO6
Gate: canonical @codex2 RQO32LuIK8xmcV7fq04Oq
Source: JWPK Phase 6 framing + DELIVERY-PLAN (m6.2 entry, sibling of m6.1)

## Why

Phase 6 ships fresh-ANT across two install rails: m6.1 macOS Homebrew
(closed end-to-end 2026-05-14) + m6.2 Windows Scoop. m6.2 closes the
Windows half: a single `scoop install ant` puts `ant.exe` on a fresh
Windows machine and points at a remote fresh-ANT server. Thin-client
shape mirrors m6.1.

## Scope

IN: Scoop manifest JSON, bucket-repo decision, bun-compile
windows-x64 binary build, Windows matrix entry in
release-ant.yml workflow, scoop test scope, release-time
bucket-update helper.

OUT: arm64 Windows (bun lacks bun-windows-arm64; defer until either
bun ships it or we add a separate Rust/Node toolchain — neither is
m6.2 scope), code signing (SmartScreen friction is a separate slice),
auto-update mechanism beyond Scoop's built-in checkver/autoupdate,
local fresh-ANT server bundling (thin-client per m6.3).

## Question locks (recommended defaults — REJECT to amend)

### Q1 Binary distribution shape
**Lock**: single-binary via
`bun build --compile --target=bun-windows-x64 ./scripts/ant-cli.mjs
--outfile dist/ant-x86_64-pc-windows-msvc.exe`. Bun emits a
self-contained Windows .exe — no Node runtime dependency on the
user's machine. Architecture: x64 only this slice (see OUT).
The build runs on the same macos-14 runner as m6.1 since
bun-windows-x64 cross-compiles cleanly.

### Q2 Bucket-repo location (JWPK pragmatic-v1)
**Lock**: REUSE existing `Jktfe/scoop-antchat` bucket. Manifest file
at `bucket/ant.json` in that bucket (alongside `bucket/antchat.json`).
Installation: `scoop bucket add antchat
https://github.com/Jktfe/scoop-antchat && scoop install ant`. Versioned
via Git tags `ant-v<semver>` on the release repo `Jktfe/a-nice-terminal`
(same tag namespace as m6.1).

**Why (JWPK direction 2026-05-14)**: pragmatic-v1 reuse of the
existing bucket rather than spinning a new `Jktfe/scoop-ant`. Brand
consolidation deferred.

### Q3 scoop test scope
**Lock**: Scoop manifests don't have a brew-test-equivalent block;
the `bin` entry + `checkver` + `autoupdate` provide most of the
validation surface Scoop itself can express. The release pipeline's
Windows smoke (Q5) is the bin-can-execute proof; manifest validity
is checked via `scoop install --no-cache jktfe/antchat/ant` against
the local bucket clone in CI when we add it.

No network calls in the manifest itself. No post-install hooks.

### Q4 Install path + post-install behaviour
**Lock**: standard Scoop layout —
`%USERPROFILE%\scoop\apps\ant\current\ant.exe` symlinked to
`%USERPROFILE%\scoop\shims\ant.exe`. NO post-install actions; no
auto-config; no daemon launch. User points the CLI at a server via
the existing `ANT_SERVER_URL` env var (matches m6.1 + matches
today's fresh-ANT CLI surface at `scripts/ant-cli.mjs`).

**Why**: scoop manifests shouldn't auto-launch anything or modify
the user's environment. Caveats text (in the release notes body)
surfaces the env-var setup hint to the user post-install.

### Q5 Release pipeline (extends m6.1)
**Lock**: ADD a Windows matrix entry to existing
`.github/workflows/release-ant.yml`:
```yaml
- script: win-x64
  os: windows
  arch: x64
  ext: zip
  bin_src: dist/ant-x86_64-pc-windows-msvc.exe
  bin_name: ant.exe
  smoke: false
```
Cross-compile on the same macos-14 runner (bun-windows-x64 output
is identical to what Windows users receive, so build-success alone
suffices). No native smoke (the macos runner cannot exec .exe; a
Windows-runner smoke is a future slice).

Package step picks `zip -j` for `ext: zip` (already handled in
release-antchat.yml — translate that branch into release-ant.yml).
SHA256SUMS aggregator picks up the new `.zip` artifact alongside
the macOS `.tar.gz`s.

### Q6 Out-of-bucket server dependency
**Lock**: scoop-installed `ant.exe` is a THIN CLIENT — needs a
fresh-ANT server URL (`ANT_SERVER_URL` env var). The CLI does NOT
bundle the server. Self-hosted server runs via `git clone + bun
install + bun run start` and is OUT of scope for this rail.

**Why**: matches m6.1 Q6 + m6.3 Q5 thin-client lock. Bundling a
Node server + better-sqlite3 binding into Scoop would 10x the slice
complexity for v1.

## Acceptance for m6.2 PASS

1. Doc under 180L, canonical RQO PASS.
2. Q1-Q6 locks ratified or amended.
3. T1-T3 chunk plan locked:
   - T1: `build:cli:win-x64` script in package.json wrapping the
     bun-windows-x64 build + bun-test asserting the .exe magic byte
     header on the compiled output (no Windows runner needed —
     header check is OS-agnostic).
   - T2: scoop manifest at `scoop/ant.json` (reference copy in
     fresh-ANT) + update-bucket.sh release-time helper mirroring
     v3 scoop/update-bucket.sh shape. Reuses
     `Jktfe/scoop-antchat` bucket per Q2.
   - T3: Windows matrix entry in `.github/workflows/release-ant.yml`
     + plan_milestone done event closes the m6.2 milestone.

## Open Q (resolution deferred to v2)

**Q7 v2**: SmartScreen / Authenticode signing. Unsigned binaries
trigger "Windows protected your PC" prompts on first run. Code-
signing costs ~£150-300/yr per cert + adds CI complexity. Defer to
m6.2-followup once Windows-user demand surfaces.
