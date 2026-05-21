# ANT Public Release Checklist

Date: 2026-05-18
Owner: @evolveantcodex
Scope: #34/#45 AGPL conversion + OSS hardening, before Monday public release.

This checklist is the operator gate before pushing or making
`Jktfe/a-nice-terminal` public. It complements
`docs/oss-migration-preflight-runbook-2026-05-16.md`; it does not replace the
migration runbook or authorize launchd/global-CLI cutover.

## Required Release Files

The staging repo and public target must both contain:

- `LICENSE` with AGPL-3.0-or-later text.
- `NOTICE.md` stating ANT's AGPL-3.0-or-later license and third-party license
  boundary.
- `README.md` with public posture, AGPL network-use note, development commands,
  configuration, and security link.
- `SECURITY.md` with private advisory reporting route.
- `CONTRIBUTING.md`.
- `.env.example` with placeholders only.
- `package.json` root license `AGPL-3.0-or-later`.
- `package-lock.json` root license `AGPL-3.0-or-later`.
- `.gitignore` excluding local state, SQLite DBs/WAL/SHM, runtime snapshots,
  local agent config, screenshots, and generated artefacts.

## Automated Gates

Run from `/Users/you/CascadeProjects/ant`:

```sh
node scripts/check-oss-migration-preflight.mjs \
  --root /Users/you/CascadeProjects/ant

node scripts/check-oss-migration-preflight.mjs \
  --root /Users/you/CascadeProjects/a-nice-terminal \
  --public-target
```

Required result:

- Staging repo: `PASS`; warnings about internal staging docs are acceptable
  only if the printed rsync excludes are used for public copy.
- Public target: `PASS`; no warnings.

Latest verification in this lane:

| Repo | Result |
|---|---|
| `/Users/you/CascadeProjects/ant` | PASS, with internal-doc exclusion warning |
| `/Users/you/CascadeProjects/a-nice-terminal` | PASS |

## Public-Target History Gate

Before push or visibility flip, run:

```sh
cd /Users/you/CascadeProjects/a-nice-terminal
git log --all --oneline --grep='meta-plan\|ios-native-research\|capability-negotiation\|internal coordination\|commercial'
find docs -maxdepth 1 -type f -name '*2026-05-*.md' -print | sort
```

Required result:

- No reachable internal coordination/commercial commits.
- No top-level dated internal docs in `docs/`.

If this fails, follow the history-scrub section in
`docs/oss-migration-preflight-runbook-2026-05-16.md` before any public action.

## Source/Build Gates

Run in staging before migration copy:

```sh
cd /Users/you/CascadeProjects/ant
npm run check
npm test
npm run build
curl -fsS http://127.0.0.1:6174/api/health
```

Run in public target after copy and before push:

```sh
cd /Users/you/CascadeProjects/a-nice-terminal
npm run check
npm test
npm run build
```

Abort on any failure unless the failure is explicitly documented as an
unrelated existing lane and JWPK accepts the risk.

## No-Go Conditions

Do not push, flip visibility, or announce a public release if any of these are
true:

- The public-target preflight scanner fails.
- Internal docs or commercial/native-only strategy notes are reachable in
  public-target HEAD or history.
- `.env`, `.mcp.json`, `.claude/`, SQLite DBs, runtime snapshots, screenshots,
  or generated artefacts are staged.
- `LICENSE`, `NOTICE.md`, `README.md`, `SECURITY.md`, or package license
  metadata are missing or inconsistent.
- The live service health check fails.
- The production DB must be moved or mutated as part of the repo copy.
- LaunchAgent or global `ant` binary/symlink changes are needed but JWPK has
  not explicitly approved that gate.

## Operator Sign-Off Record

Before final public action, paste a release note with:

- Staging scanner result.
- Public-target scanner result.
- `git status --short` for both repos.
- Public-target history scan output.
- Test/check/build summary.
- Live health URL and result.
- Explicit JWPK approval for any launchd, global CLI, push, or visibility
  action.
