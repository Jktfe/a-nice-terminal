# ANT OSS Release Checklist

This checklist is the release gate for making `a-nice-terminal` public under
AGPL-3.0-or-later. It is operational, not legal advice.

## Release Posture

- License is declared as `AGPL-3.0-or-later` in `package.json`.
- Full AGPL text is present in `LICENSE`.
- `README.md` links to `LICENSE`, `CONTRIBUTING.md`, and `SECURITY.md`.
- `NOTICE.md` states the project license and points to dependency manifests.
- Public users can find source, issue reporting, and private vulnerability
  reporting before running the server.

## AGPL Network-Service Gate

ANT is a networked application. Before public release:

- Any deployed public instance must expose a clear source-code link for the
  running version.
- If a hosted instance carries local modifications, the corresponding modified
  source must be published from that instance or linked from its UI/docs.
- Release notes must identify the commit/tag being served.
- Premium/native clients may be separate products, but any AGPL-covered server
  changes they require must remain available in this repository or another
  public AGPL-compatible source location.
- Do not copy proprietary native-app code into this repo unless the intended
  license is also AGPL-compatible.

## Secret and Data Hygiene

Before pushing a public release branch:

- Run `git status --short` and stage explicit files only.
- Confirm `.env`, `.mcp.json`, `CLAUDE.md`, `.claude/settings.local.json`,
  local databases, screenshots, and personal artefacts are not staged.
- Search for obvious secrets:

```sh
rg -n "ANT_API_KEY|sk-[A-Za-z0-9]|ghp_|xox[baprs]-|BEGIN (RSA|OPENSSH|PRIVATE)" .
```

- Confirm generated uploads, screenshots, local decks, sheets, and runtime
  snapshots are either ignored or intentionally documented sample data.
- Confirm retention policy is enabled for high-volume event tables before
  publishing operational deployment guidance.

## Security Gate

- `SECURITY.md` points to GitHub private vulnerability reporting.
- Admin and room-token behavior is documented in `AGENTS.md` and
  `docs/security-model.md`.
- Routes that mutate data should validate JSON and reject malformed bodies
  with 400 responses rather than throwing raw exceptions.
- File-serving routes must keep path traversal tests and top-level allowlists.
- PTY injection must stay plain-text only. No ANSI control sequence injection.
- Tailscale-only or equivalent network isolation guidance must remain visible
  for users exposing the server beyond localhost.

## Dependency and License Gate

- Dependency manifests are current: `package.json`, lockfile, `cli/`, and
  `antchat/` manifests where relevant.
- Run a license/dependency review before tagging:

```sh
npm audit --omit=dev
npm ls --all --omit=dev
```

- Any new heavy editor/viewer dependency, such as Univer, must have a documented
  license posture and product boundary before becoming part of the default OSS
  install.

## CI and Verification Gate

Run these before tagging a public release:

```sh
npm run check
npm test
npm run build
bun run smoke:antchat
```

If any command is skipped, record why in the release notes.

## Release Notes Gate

Each public release should include:

- tag and commit hash
- notable features
- security fixes
- known limitations
- migration steps
- source-code link for the released commit
- premium/native-app compatibility notes, if applicable

## Premium Boundary

Keep the OSS and premium boundaries explicit:

- OSS: server, CLI, room orchestration, public web UI, artifact primitives,
  basic docs/decks/sheets integration, and source-available AGPL features.
- Premium: native apps, Chair-style verification workflows, paid policy
  enforcement, and app-store packaged convenience features.
- If premium features require server endpoints, document whether the endpoint is
  AGPL-covered OSS infrastructure or premium-gated policy behavior.

## Final Human Check

Before making the repository public, a maintainer should verify:

- The public README accurately describes what is already shipped.
- No personal room IDs, local hostnames, private customer data, or screenshots
  with sensitive content are part of the public-facing docs.
- The issue templates are acceptable for a public audience.
- The first-run path works from a clean clone on a fresh machine.
