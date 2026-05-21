# OSS Migration Preflight + Rollback Runbook

Date: 2026-05-16
Owner: @evolveantcodex
Status: executable preflight, prep only

This runbook prepares the v4 -> `a-nice-terminal` migration. It is not
authorization to run the migration. Migration execution needs explicit JWPK
approval after the Phase 3 dogfood window.

## Scope

Move the verified v4 codebase from private staging repo:

```text
/Users/jamesking/CascadeProjects/ant
```

into the public OSS target repo:

```text
/Users/jamesking/CascadeProjects/a-nice-terminal
```

while preserving v3 as a reference, keeping `com.ant.fresh` recoverable, and
cutting over the global `ant` binary only after the new service location is
healthy.

## Hard Rules

1. Do not mutate the production DB during the repo move.
2. Do not rewrite or clean another lane's dirty files without owner approval.
3. Do not edit launchd or the global `ant` symlink without an explicit JWPK
   gate at that moment.
4. Do not push or make `a-nice-terminal` public while internal coordination
   docs are reachable from HEAD or git history.
5. Treat live facts at migration time as authoritative. Older plan files are
   context, not commands to follow blindly.

## Preflight Capture

Run these before any destructive step and paste the output into the migration
room.

```sh
date

cd /Users/jamesking/CascadeProjects/ant
git status --short
git log --oneline -8
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD

cd /Users/jamesking/CascadeProjects/a-nice-terminal
git status --short
git log --oneline -12
git remote -v
find docs -maxdepth 1 -type f -name '*2026-05-*.md' -print | sort
git log --all --oneline --grep='meta-plan\\|ios-native-research\\|capability-negotiation\\|internal coordination\\|commercial'

plutil -p ~/Library/LaunchAgents/com.ant.fresh.plist
launchctl print gui/$UID/com.ant.fresh | sed -n '1,120p'
curl -fsS http://127.0.0.1:6174/api/health

which ant
ls -l "$(which ant)"
ant --help | sed -n '1,40p'

ls -lh ~/.ant/fresh-ant.db ~/.ant/fresh-ant.db-wal ~/.ant/fresh-ant.db-shm 2>/dev/null
```

## Automated Preflight Scanner

Run the read-only scanner before any manual copy step. It checks the AGPL
release posture, package metadata, migration-safe ignore rules, and whether
the public target still exposes dated/internal docs.

```sh
cd /Users/jamesking/CascadeProjects/ant
node scripts/check-oss-migration-preflight.mjs \
  --root /Users/jamesking/CascadeProjects/ant

node scripts/check-oss-migration-preflight.mjs \
  --root /Users/jamesking/CascadeProjects/a-nice-terminal \
  --public-target

node scripts/check-oss-migration-preflight.mjs \
  --root /Users/jamesking/CascadeProjects/a-nice-terminal \
  --public-target \
  --require-clean
```

Current 2026-05-18T01:22Z result:

| Repo | Result | Notes |
|---|---|---|
| `/Users/jamesking/CascadeProjects/ant` | PASS | AGPL docs/package metadata present. Warning: 11 private staging docs must remain excluded from public target. |
| `/Users/jamesking/CascadeProjects/a-nice-terminal` | PASS without `--require-clean` | Public release posture passes after shared scanner excludes are applied. |
| `/Users/jamesking/CascadeProjects/a-nice-terminal` | FAIL with `--require-clean` | Expected current block: the target worktree has owner-lane dirty/untracked files. Do not run the real migration copy until those files are committed, stashed, or explicitly cleared by their owner. |

The scanner also prints the migration `rsync` exclude list. The protected
runner consumes the same list so local state, SQLite DBs, generated builds,
screenshots, room artefacts, and premium verification-policy files cannot leak
into the public target.

## Required Cleanliness Gates

| Gate | Required result | Abort condition |
|---|---|---|
| Private staging repo | `ant` is clean or contains only explicitly owned migration-prep docs | Any unexpected source changes |
| Public target repo | `check-oss-migration-preflight --public-target --require-clean` passes before any non-dry-run copy | Dirty PTY/TERM files, docs, or generated files without owner sign-off |
| Public docs scan | No internal `2026-05-*` docs in `a-nice-terminal/docs` | Any internal coordination or commercial doc at HEAD |
| Public history scan | No reachable internal-doc commits before visibility flip or push | Commits such as `meta-plan`, `ios-native-research`, `capability-negotiation`, or their revert remain reachable |
| Source of truth | `ant` HEAD includes Phase 1/2 commits plus dogfood hotfixes | Missing live fixes |

Known cleanup item before migration: the public target repo previously had
internal docs committed and reverted locally. Before any public flip or push,
drop those commits from history or reset to the pre-internal state, then apply
the final v4 migration content.

## Human Gates

| Gate | Action | Approval required |
|---|---|---|
| Gate 1 | Edit `com.ant.fresh` launchd WorkingDirectory and restart service | JWPK explicit approval |
| Gate 2 | Replace global `ant` binary/symlink | JWPK explicit approval |
| Gate 3 | Push or flip visibility of `a-nice-terminal` | JWPK explicit approval after OSS hardening review |

## Step 0: Stop If Dogfood Is Not Green

Do not begin migration if Phase 3 dogfood is actively broken.

Minimum checks:

```sh
curl -fsS http://127.0.0.1:6174/api/health
tail -200 /tmp/ant-fresh.log | rg ' 500 |ERR_|Error|Unhandled|Cannot find module'
```

If the failures are historical, record their timestamps. If failures are new,
stop and fix the operational issue first.

## Step 1: Archive v3 Before Overwriting

Create a reference archive outside both repos.

Planned action:

```sh
mkdir -p ~/ant-v3-reference
rsync -a --exclude='.git' \
  /Users/jamesking/CascadeProjects/a-nice-terminal/ \
  ~/ant-v3-reference/ant-v3-server/

if [ -d ~/.bun/install/global/node_modules/@ant/cli ]; then
  rsync -a ~/.bun/install/global/node_modules/@ant/cli/ \
    ~/ant-v3-reference/cli/
fi
```

Verification:

```sh
test -d ~/ant-v3-reference/ant-v3-server
find ~/ant-v3-reference -maxdepth 2 -type f | sed -n '1,40p'
```

Rollback:

```sh
rsync -a --delete ~/ant-v3-reference/ant-v3-server/ \
  /Users/jamesking/CascadeProjects/a-nice-terminal/
```

## Step 2: Scrub Public Target History Before Migration

This is required before any public flip or push. Use one of the two methods.

Preferred if the internal commits are only local:

```sh
cd /Users/jamesking/CascadeProjects/a-nice-terminal
git reset --hard 8633ede
```

Alternative if later public-safe commits must be preserved:

```sh
cd /Users/jamesking/CascadeProjects/a-nice-terminal
git rebase -i 8633ede
```

Drop internal coordination commits and their revert. The known local commits to
remove from the public-facing history are:

```text
2de6a47 docs(meta-plan): room state capture for v3-to-v4 + native apps commercial model
904372e docs(ios-native-research): Apple platform integrations that enforce native-only value
bbc4571 docs(capability-negotiation): tier API spec for oss/native/enterprise feature discovery
b7ac58c revert: remove internal coordination docs from public-facing repo
```

Verification:

```sh
git log --all --oneline --grep='meta-plan\\|ios-native-research\\|capability-negotiation\\|internal coordination\\|commercial'
find docs -maxdepth 1 -type f -name '*2026-05-*.md' -print | sort
```

Required result: both commands return no internal coordination docs or commits.

Rollback:

```sh
git reflog --date=iso | sed -n '1,20p'
# Choose the pre-reset/pre-rebase ref from reflog, then:
git reset --hard <reflog-ref>
```

## Step 3: Copy v4 Into Public Target Working Tree

Only after Step 2 is verified.

Planned action:

```sh
cd /Users/jamesking/CascadeProjects/ant
node scripts/check-oss-migration-preflight.mjs \
  --root /Users/jamesking/CascadeProjects/ant

node scripts/run-oss-migration.mjs \
  --target=/Users/jamesking/CascadeProjects/a-nice-terminal \
  --dry-run

node scripts/check-oss-migration-preflight.mjs \
  --root /Users/jamesking/CascadeProjects/a-nice-terminal \
  --public-target \
  --require-clean

node scripts/run-oss-migration.mjs \
  --target=/Users/jamesking/CascadeProjects/a-nice-terminal
```

The dry-run evaluates the target write-safety gate and prints any failures, but
it does not abort or write to the target. This lets the planned copy and target
blockers be inspected together. The non-dry-run runner always executes the
public-target `--require-clean` preflight before `rsync`; if the target is
dirty, it aborts before writing.

Verification:

```sh
cd /Users/jamesking/CascadeProjects/a-nice-terminal
git status --short
node /Users/jamesking/CascadeProjects/ant/scripts/check-oss-migration-preflight.mjs \
  --root /Users/jamesking/CascadeProjects/a-nice-terminal \
  --public-target \
  --require-clean
test -f package.json
test -f src/lib/server/db.ts
test -f docs/capability-ledger.md
```

Rollback:

```sh
rsync -a --delete ~/ant-v3-reference/ant-v3-server/ \
  /Users/jamesking/CascadeProjects/a-nice-terminal/
```

## Step 4: Build From New Location Before Service Edit

This catches path-sensitive build issues before launchd is touched.

```sh
cd /Users/jamesking/CascadeProjects/a-nice-terminal
PATH=/Users/jamesking/.nvm/versions/node/v22.22.1/bin:$PATH bun run check
PATH=/Users/jamesking/.nvm/versions/node/v22.22.1/bin:$PATH bun run build
```

Abort if either command fails.

## Step 5: Commit Public Migration Content

Commit only after history scrub, copy, and build pass.

```sh
cd /Users/jamesking/CascadeProjects/a-nice-terminal
git add .
git diff --cached --stat
git commit -m "consolidate: bring v4 codebase into canonical repo"
```

Do not push yet. Do not flip visibility yet.

Rollback before push:

```sh
git reset --hard HEAD~1
```

## Step 6: JWPK Gate 1 - Service WorkingDirectory Cut-Over

Stop here and ask for explicit approval.

Planned action after approval:

1. Capture current plist:

```sh
cp ~/Library/LaunchAgents/com.ant.fresh.plist \
  ~/Library/LaunchAgents/com.ant.fresh.plist.pre-v4-migration.bak
```

2. Change WorkingDirectory from:

```text
/Users/jamesking/CascadeProjects/ant
```

to:

```text
/Users/jamesking/CascadeProjects/a-nice-terminal
```

3. Restart using the proven path:

```sh
launchctl kickstart -k gui/$UID/com.ant.fresh
```

Verification:

```sh
launchctl print gui/$UID/com.ant.fresh | sed -n '1,120p'
curl -fsS http://127.0.0.1:6174/api/health
tail -120 /tmp/ant-fresh.log
```

Rollback:

```sh
cp ~/Library/LaunchAgents/com.ant.fresh.plist.pre-v4-migration.bak \
  ~/Library/LaunchAgents/com.ant.fresh.plist
launchctl kickstart -k gui/$UID/com.ant.fresh
curl -fsS http://127.0.0.1:6174/api/health
```

## Step 7: Post-Service Smoke

Run before touching the global CLI.

```sh
curl -fsS http://127.0.0.1:6174/api/health
curl -i http://127.0.0.1:6174/safety | sed -n '1,20p'
curl -i http://127.0.0.1:6174/api/chat-rooms/recovery | sed -n '1,20p'
curl -i http://127.0.0.1:6174/api/diagnostics/summary | sed -n '1,20p'
curl -i http://127.0.0.1:6174/api/mcp/cli-verbs | sed -n '1,20p'
curl -fsS http://127.0.0.1:6174/api/capabilities
curl -i -X OPTIONS \
  -H 'Origin: http://localhost:1420' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: Ant-Client-Version,Content-Type' \
  http://127.0.0.1:6174/api/capabilities | sed -n '1,40p'
```

Expected:

- `/api/health`: 200
- `/safety`: 200
- `/api/chat-rooms/recovery`: 200
- `/api/diagnostics/summary`: 200
- `/api/mcp/cli-verbs`: 200
- `/api/capabilities`: 200 with `tier: "oss"` by default, `serverVersion`,
  `buildChannel`, and no route-enforcement side effects
- `/api/capabilities` CORS preflight from Tauri dev origin: 204 with
  `access-control-allow-origin: http://localhost:1420`,
  `access-control-allow-methods: GET, HEAD, OPTIONS`, and
  `Ant-Client-Version` allowed in request headers

For admin-gated endpoints, 401 can be correct if no admin token is sent.

## Step 8: JWPK Gate 2 - Global ant Binary Cut-Over

Stop here and ask for explicit approval.

Pre-capture:

```sh
which ant
ls -l "$(which ant)"
```

Planned action:

```sh
cd /Users/jamesking/CascadeProjects/a-nice-terminal
bun run build:cli:arm64-darwin

mkdir -p ~/.ant-migration-backups
cp -P ~/.bun/bin/ant ~/.ant-migration-backups/ant-symlink.pre-v4-migration
ln -sfn /Users/jamesking/CascadeProjects/a-nice-terminal/dist/ant-aarch64-apple-darwin ~/.bun/bin/ant
```

Verification:

```sh
which ant
ls -l "$(which ant)"
ant --help | sed -n '1,60p'
```

Rollback:

```sh
cp -P ~/.ant-migration-backups/ant-symlink.pre-v4-migration ~/.bun/bin/ant
which ant
ls -l "$(which ant)"
```

## Step 9: Identity / Self-Post Regression Check

The migration is not done until the original self-post path remains healthy.

Minimum checks:

```sh
ant whoami
ant chat send <dogfood-room-id> --msg "post-migration ant CLI smoke"
```

If testing from T1, verify the post resolves to `@t1` and not an anonymous or
wrong terminal identity.

Rollback if this fails after binary cut-over:

1. Restore old `ant` symlink.
2. If needed, restore old launchd WorkingDirectory.
3. Re-test `/api/health`.

## Step 10: JWPK Gate 3 - Push / Visibility Flip

Only after:

- Service health is green from the new repo location.
- Global `ant` binary works.
- T1 self-post works.
- AGPL, CONTRIBUTING, README, and OSS hardening review are complete.
- Public history scan is clean.

Final verification before push or visibility flip:

```sh
cd /Users/jamesking/CascadeProjects/a-nice-terminal
git status --short
git log --all --oneline --grep='meta-plan\\|ios-native-research\\|capability-negotiation\\|internal coordination\\|commercial'
find docs -maxdepth 1 -type f -name '*2026-05-*.md' -print | sort
```

Required result:

- clean status
- no internal coordination/commercial commits
- no internal dated docs

## Known Open Items

| Item | Owner | Handling |
|---|---|---|
| AGPL/CONTRIBUTING/README drafts | @evolveantcodex | Done in staging commit `8cd38f8`; scanner now enforces required files and package metadata |
| PTY/TERM dirty files in `a-nice-terminal` | prior TERM/tmux lane owner | Must be committed, stashed, or explicitly excluded before migration |
| Public target clean gate | migration owner + dirty-file owners | `check-oss-migration-preflight --public-target` passes; `--require-clean` currently fails until owner-lane dirty files are resolved |
| Public target internal docs/history | migration owner | Scanner blocks top-level dated docs at HEAD; still run the history scan before public push/visibility flip |
| cli_hook_lag investigation | post-Phase-3 workstream | Not part of migration unless it blocks dogfood |
| ant-native | native lane | External consumer only; not part of repo move |

## Abort Summary

Abort before rsync if either repo is unexpectedly dirty.

Abort before launchd edit if the new location does not build.

Abort before symlink cut-over if the service is not healthy from the new
location.

Abort before public push/visibility flip if internal docs are reachable from
HEAD or history.
