# m6.1 macOS Homebrew rail — design contract — 2026-05-14

Author: @claude2 TTVPh3mnu8wERzALQLJO6
Gate: canonical @codex2 RQO32LuIK8xmcV7fq04Oq
Source: JWPK Phase 6 framing + DELIVERY-PLAN (m6.1 entry on canonical plan)

## Why

Phase 6 ships fresh-ANT as a distributable product across two install
rails: m6.1 macOS Homebrew (CLI), m6.2 Windows Scoop (CLI), m6.3-4
Tauri native app (GUI thin-client). m6.1 is the FIRST customer-facing
install surface — a single `brew install` should put `ant` on a
fresh Mac and connect to a remote fresh-ANT server. No Tauri, no
local fresh-ANT server in this slice.

## Scope

IN: Homebrew formula (Ruby) that installs the `ant` CLI binary +
its docs + brew test smoke check. Tap-repo decision. Single binary
distribution shape (preferred: bun-compiled single binary; fallback:
script-wrapper around Node).

OUT: Tauri native app (m6.4 lane), Windows Scoop (m6.2 lane), code
signing/notarisation (m6.4-followup-tauri-build-proof or m6.1b),
auto-update mechanism, local fresh-ANT server bundling (thin-client
per m6.3).

## Question locks (recommended defaults — REJECT to amend)

### Q1 Binary distribution shape
**Lock**: PREFERRED single-binary via `bun build --compile`. Targets:
`ant-aarch64-apple-darwin` + `ant-x86_64-apple-darwin`. Formula
downloads the architecture-matched binary from a GitHub Releases asset.
FALLBACK if bun-compile has runtime issues with better-sqlite3 native
binding: script-wrapper that bootstraps Node 20.19.4 via the formula's
`depends_on "node@20"` + symlinks `ant` to a launcher script that
runs `node $libexec/ant-cli.mjs`.

**Why**: single-binary is the simpler user experience (no Node
runtime dependency on the user's machine). bun-compile may have ABI
edge-cases with better-sqlite3 — fallback path is documented but the
slice ships the single-binary first.

### Q2 Tap-repo location (delta-3 JWPK pragmatic-v1)
**Lock**: REUSE existing `Jktfe/homebrew-antchat` tap. Formula file at
`Formula/ant.rb` in that tap (alongside `Formula/antchat.rb`).
Installation: `brew tap jktfe/antchat && brew install ant` or directly
`brew install jktfe/antchat/ant`. Versioned via Git tags `ant-v<semver>`
on the release repo `Jktfe/a-nice-terminal` (mirroring the antchat
release-tag pattern in the same repo).

**Why (delta-3 JWPK direction 2026-05-14)**: JWPK ratified pragmatic-v1
reuse of the existing tap rather than spinning a new
`newmodel-vc/homebrew-ant`. The antchat tap already ships through
`Jktfe/homebrew-antchat`; adding `Formula/ant.rb` alongside is the
zero-friction path. Brand consolidation (rename to a fresh-ANT-only
tap) is deferred to a future slice once branding settles.

### Q3 brew test scope (delta-2 amendment, delta-3 string-align)
**Lock**: minimal smoke check:
```ruby
test do
  assert_match version.to_s, shell_output("#{bin}/ant --version")
  assert_match "fresh-ant CLI", shell_output("#{bin}/ant --help")
end
```
**Delta-3 note**: prior wording asserted `"Usage:"` but the actual
`ant --help` output prints `ant — fresh-ant CLI ...` as the first
banner line (no `Usage:` token). Both formula and doc now assert
`"fresh-ant CLI"`, the stable string the help banner emits.

T1 implementation requirement (delta-2 lock): add `--version` to
`scripts/ant-cli.mjs` BEFORE brew formula smoke. `ant --version`
prints the CLI semver matching the GitHub Release tag the formula
references. `--help` already works on the current disk surface (no
change needed there).

**Delta-2 rationale**: prior Q3 wording assumed `ant --version`
existed on disk; verification shows scripts/ant-cli.mjs only handles
help/--help. PATH A (add --version in T1) preferred over PATH B (drop
--version from brew test) because Homebrew formulae SHOULD assert the
installed binary's version matches the release asset — this is a
real bug-catcher for stale-cache install issues.

No network calls in `brew test` (would fail in CI sandboxes). The
binary's actual functionality is verified by the existing vitest +
bun-test suites; brew test only confirms the binary executes.

### Q4 Install path + post-install behaviour (delta-1 amendment)
**Lock**: standard Homebrew layout — `ant` lands at
`/opt/homebrew/bin/ant` (Apple Silicon) or `/usr/local/bin/ant`
(Intel). NO post-install actions; no auto-config; no daemon launch.
User points the CLI at a server via the existing `ANT_SERVER_URL`
env var (matches today's fresh-ANT CLI surface at `scripts/ant-cli.mjs`
L26: `const DEFAULT_SERVER_URL = process.env.ANT_SERVER_URL ??
'http://127.0.0.1:6460'`). Brew formula caveats block surfaces the
env-var setup hint to the user post-install.

**Delta-1 rationale**: prior Q4 wording cited `ant config set --url`
but fresh-ANT CLI has NO `config` verb (verified on disk: dispatch
map at `scripts/ant-cli.mjs` has no `config` entry). PATH A per
canonical recommendation: amend the doc to the env-var pattern that
matches the actual CLI surface. PATH B (add `ant config` to T1
scope) is scope creep — defer to a future M-config slice if customer
demand surfaces.

**Why**: brew formulae shouldn't auto-launch anything or modify the
user's shell config. Caveats-only post-install matches the m6.4
first-run wizard pattern from the GUI side, where the GUI prompts
the user for server URL on first launch.

### Q5 GitHub Release asset publish flow
**Lock**: `bun build --compile --target=bun-darwin-arm64 ./scripts/ant-cli.mjs --outfile dist/ant-aarch64-apple-darwin` (+ x86_64 variant). Both binaries
uploaded to a GitHub Release tag with SHA256 sums. Formula references
the release URL + SHA256. Release pipeline lives in main fresh-ANT
repo; tap repo just consumes published assets.

**Why**: separates build-pipeline (fresh-ANT repo, Bun toolchain) from
distribution (tap repo, brew formula). Tap repo doesn't need to know
how the binary is built.

### Q6 Out-of-tap server dependency
**Lock**: brew-installed `ant` CLI is a THIN CLIENT — needs a
fresh-ANT server URL (default `https://<ANT_SERVER_HOST>`
or user-supplied). The CLI does NOT bundle the server. If a user
wants self-hosted server, that's a separate install path (e.g.
`git clone + bun install + bun run start`), not via brew.

**Why**: matches m6.3 Q5 thin-client lock. Bundling a Node server +
better-sqlite3 binding into brew would 10x the slice complexity for
v1; defer to a future slice if customer demand surfaces.

## Acceptance for m6.1 PASS

1. Doc under 180L, canonical RQO PASS.
2. Q1-Q6 locks ratified or amended.
3. T1-T3 chunk plan locked:
   - T1 (DONE): scripts/ant-cli.mjs --version + ant-cli-version-helper +
     prebuild:cli script + bun-compile build:cli:darwin targets.
   - T2 (THIS SLICE): formula file at homebrew/ant.rb in fresh-ANT
     (reference copy) + update-tap.sh release-time push helper
     mirroring v3 antchat pattern. Targets existing
     `Jktfe/homebrew-antchat` tap per delta-3. Formula `version` is a
     placeholder that update-tap.sh substitutes at release time; until
     the first ant-v<version> release lands, `brew test`'s version
     assertion is documented-skipped (no published binary to install).
   - T3: release pipeline `.github/workflows/release-ant.yml` (mirror
     of release-antchat.yml) emitting darwin-arm64 + darwin-x64
     tarballs + SHA256SUMS + plan_milestone done event. Once T3 ships
     a real release tag, `update-tap.sh <version>` opens the tap PR
     and `brew install jktfe/antchat/ant` resolves end-to-end.

## Open Q (delta-3 resolution)

**Q7 RESOLVED**: tap-repo name = `Jktfe/homebrew-antchat` (reuse
existing) per JWPK pragmatic-v1 direction 2026-05-14. The earlier
recommendation of `newmodel-vc/homebrew-ant` is superseded.
