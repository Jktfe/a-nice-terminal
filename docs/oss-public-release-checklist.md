# OSS Public Release Checklist

Use this checklist before publishing `a-nice-terminal` or flipping repository
visibility. It is intentionally operational: every item should have command
output, a reviewed diff, or an explicit human approval before the public gate.

## License And Source

- `LICENSE` is AGPL-3.0-or-later and `package.json` /
  `package-lock.json` declare `AGPL-3.0-or-later`.
- `README.md` states the AGPL network-source obligation in plain language.
- Hosted or shared deployments expose a source link for the exact deployed
  commit, branch, or release tag.
- `NOTICE.md`, `CONTRIBUTING.md`, and `SECURITY.md` are present at repo root.
- Contribution docs require same-license contributions and DCO sign-off.

## Public Surface Boundaries

- The public repo can run the self-hosted server, web UI, and CLI without
  premium native apps, hosted services, or private verification-policy code.
- Premium verification-policy files remain excluded from the OSS migration:
  `src/lib/server/policyStore.ts`, `src/lib/server/policyActor.ts`,
  `src/routes/api/policies/`, and `src/lib/server/featureGates.ts`.
- Native app, managed hosting, enterprise SSO, and premium verification
  workflows are described as separate offerings, not required dependencies.

## Secret And Local-State Scrub

Run:

```sh
node scripts/check-oss-migration-preflight.mjs \
  --root /Users/you/CascadeProjects/ant

node scripts/check-oss-migration-preflight.mjs \
  --root /Users/you/CascadeProjects/a-nice-terminal \
  --public-target \
  --require-clean
```

Required result:

- staging repo passes with only known private-doc warnings
- public target passes and is clean before any non-dry-run copy
- no `.env`, SQLite DB, `.mcp.json`, `.claude/`, runtime snapshot, screenshot,
  room artefact, or local agent state is staged

## Migration Gate

Run the protected migration runner only after the public target clean gate
passes:

```sh
node scripts/run-oss-migration.mjs \
  --target=/Users/you/CascadeProjects/a-nice-terminal \
  --dry-run

node scripts/run-oss-migration.mjs \
  --target=/Users/you/CascadeProjects/a-nice-terminal
```

The non-dry-run runner must abort on a dirty public target before writing.

## Build And Test Evidence

Run in the staged source repo:

```sh
npm run check
npm test
npm run build
```

If a full `npm test` is too broad for the immediate gate, record the focused
test suites that cover the touched surfaces and explain why full test execution
was deferred.

## Final Human Gates

- JWPK approves the public release posture and premium boundary wording.
- Security advisory link is valid:
  `https://github.com/Jktfe/a-nice-terminal/security/advisories/new`.
- The public target history scan has no reachable internal coordination,
  commercial planning, or private dated research docs.
- Repository visibility flip or push happens only after explicit approval.
