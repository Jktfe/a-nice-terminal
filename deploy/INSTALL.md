# fresh-ant tailscale-live install runbook

This installs fresh-ant as a user LaunchAgent named `com.ant.fresh`. v3
(`com.ant.server`) is untouched throughout.

## Endpoint

- Listens on `0.0.0.0:6461` (tailnet-reachable; not Funneled).
- JWPK phone/iPad on the tailnet reaches it at
  `http://<ANT_SERVER_HOST>:6461` directly.

## Install

Run from this repo root (`/Users/you/CascadeProjects/ant`):

```sh
bun run build
cp deploy/com.ant.fresh.plist /Users/you/Library/LaunchAgents/com.ant.fresh.plist
launchctl bootstrap "gui/$(id -u)" /Users/you/Library/LaunchAgents/com.ant.fresh.plist
launchctl kickstart -k "gui/$(id -u)/com.ant.fresh"
sleep 3
curl -sS -o /dev/null -w 'HTTP %{http_code}\n' \
  http://<ANT_SERVER_HOST>:6461/plan-mode/ant-vnext-plan-mode-build
```

The `bun run build` step is REQUIRED before bootstrap; the launchd service
runs `/Users/you/.nvm/versions/node/v22.22.1/bin/node
scripts/start-snapshot.mjs` directly, which snapshots and serves the built
adapter output. Running Node directly is intentional: launchd must supervise
the actual long-lived server process, not a package-manager wrapper that can
leave orphan child servers behind after a kickstart. The pinned Node path must
match the ABI used to build `better-sqlite3`.

If you prune dependencies for a source production deploy, do it only after this
build step. UI-only packages live in `devDependencies`; `npm ci --omit=dev` can
run an already-built adapter, but it cannot create the UI build.

## Optional re-seed (in-memory store is wiped on restart)

```sh
ANT_SERVER_URL=http://<ANT_SERVER_HOST>:6461 \
  node scripts/seed-ant-vnext-plan-mode-build.mjs
```

## Verify v3 still works

```sh
curl -ksS -o /dev/null -w 'HTTP %{http_code}\n' https://<ANT_SERVER_HOST>/ant
# Expect: HTTP 200 — v3 com.ant.server on port 6458 unchanged
```

## Rollback

```sh
launchctl bootout "gui/$(id -u)/com.ant.fresh"
rm /Users/you/Library/LaunchAgents/com.ant.fresh.plist
```

The `git checkout` of the three files in this slice removes all repo
changes; v3 stays running throughout.

## Logs

`/tmp/ant-fresh.log` — combined stdout + stderr.
