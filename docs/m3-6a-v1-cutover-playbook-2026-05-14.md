# M3.6a-v1 Strict-403 Cutover Playbook

Date: 2026-05-14
Owner lane: @evolveantcodex
Scope: operator prep only. No route changes, no manifest row, no plan event.

## What Is Shipping

M3.6a-v1 moves four chat-room write surfaces away from legacy
client-supplied identity:

- `POST /api/chat-rooms/:roomId/messages`
- `POST /api/chat-rooms/:roomId/discussions`
- `POST /api/chat-rooms/:roomId/members`
- `DELETE /api/chat-rooms/:roomId/members?globalHandle=...`

The server currently warns on legacy `messages` and `members` writes. It flips
to strict 403 after the configured cutover time. `discussions` is already
strict-only and should return 403 without a server-resolved identity.

## Cutover Control

Runtime switch:

```sh
ANT_AUTH_DEPRECATION_CUTOVER_MS
```

Default if unset:

```text
2026-05-28T00:00:00.000Z
```

Force strict immediately for a verification or rollback rehearsal:

```sh
ANT_AUTH_DEPRECATION_CUTOVER_MS=0
```

Extend warning mode temporarily:

```sh
ANT_AUTH_DEPRECATION_CUTOVER_MS=1799961600000
```

That example is 2027-01-15T00:00:00.000Z. Use an explicit timestamp for the
real extension window.

## Pre-Cutover Check

Run against the live server before changing launchd/env configuration:

```sh
bun run auth:cutover-check -- --server http://127.0.0.1:6461 --expect warning
```

Expected warning-mode output:

```text
auth cutover mode: warning
messages-post    201    warning
members-post     201    warning
members-delete   204    warning
discussions-post 403    strict-only
```

The script creates a disposable room and probes no-identity writes. In warning
mode, the legacy message write creates a parent message, so the script also
checks that discussion creation without identity returns strict-only 403. In
strict mode, no parent message is created, so the discussion probe is reported
as skipped; route tests cover the exact strict-only discussion path with a
parent. The script does not change the server cutover flag.

## Flip Procedure

1. Confirm current warning behaviour:

```sh
bun run auth:cutover-check -- --server http://127.0.0.1:6461 --expect warning
```

2. Set the launch environment so the server sees:

```sh
ANT_AUTH_DEPRECATION_CUTOVER_MS=0
```

3. Rebuild if code changed; otherwise restart the service only:

```sh
bun run build
launchctl kickstart -k gui/501/com.ant.fresh
```

4. Confirm strict behaviour:

```sh
bun run auth:cutover-check -- --server http://127.0.0.1:6461 --expect strict
```

Expected strict-mode output:

```text
auth cutover mode: strict
messages-post    403    strict
members-post     403    strict
members-delete   403    strict
discussions-post skipped strict-only
```

## Rollback

If a required caller still lacks browser-session or pidChain identity, restore a
future cutover timestamp and restart:

```sh
ANT_AUTH_DEPRECATION_CUTOVER_MS=1799961600000
launchctl kickstart -k gui/501/com.ant.fresh
bun run auth:cutover-check -- --server http://127.0.0.1:6461 --expect warning
```

This returns legacy `messages` and `members` calls to warning mode. It does not
relax `discussions`, which is intentionally strict-only.

## Evidence To Capture

For a clean cutover, paste these into the room:

- `bun run auth:cutover-check -- --server http://127.0.0.1:6461 --expect warning`
  output before the flip.
- The exact configured `ANT_AUTH_DEPRECATION_CUTOVER_MS` value.
- Restart command and timestamp.
- `bun run auth:cutover-check -- --server http://127.0.0.1:6461 --expect strict`
  output after the restart.
- Any rollback timestamp if warning mode is restored.

## Non-Goals

- No new manifest entry. Strict-403 is server behaviour, not an `ant` verb.
- No DB state. The cutover is stateless env/date configuration.
- No route edits in this prep slice.
- No changes to Phase 5.1 room persistence files.
