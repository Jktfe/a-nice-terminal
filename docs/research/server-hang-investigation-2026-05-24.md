---
doc_id: server-hang-investigation-2026-05-24
title: "Server event-loop-hang investigation — first-pass findings"
status: in-progress
visibility: oss
auditor: "@speedyclaude"
audited_at: 2026-05-24
linked_rooms: ["yz4clwzvbm", "orsz2321qb"]
---

# Server event-loop-hang investigation — first-pass findings

Banking what I found in a partial investigation before pivoting to the Stage delivery task (JWPK msg_cy8olp2r9x). Returns to this once the Stage deck ships.

## Symptom (per @claudev4 yz4clwzvbm 2026-05-23 + my probes 2026-05-24)

- ant-server proc holds :6174 (port bound, sockets ESTABLISHED)
- HTTP requests don't return (event loop blocked)
- SIGTERM ignored; only `kill -9` lets launchd respawn
- Occurs intermittently; band-aided by `scripts/server-watchdog.sh` (claudev4 d81a9ac)

## DISTINCT from the Node-ABI 500 class

Separate failure mode banked in `feedback_native_module_rebuild_node_version_2026_05_24`. That manifests as 500s on every DB call, not as a hang. Health endpoint returns 200 in the ABI class (no DB) but EVERY OTHER endpoint 500. The hang shape is "no response at all".

## What I've verified IS working

- `journal_mode = WAL` ✓ (`db.ts:1538`)
- `busy_timeout = 5000` ✓ (`db.ts:1547`)
- No SQLITE_BUSY entries in /tmp/ant-server.log → contention is being absorbed by busy_timeout when it occurs
- Server uptime at investigation time: ~2h with the watchdog band-aid running

## Suspect ruled out

- **DROP TABLE migration** (my `5aad8bf`): IF EXISTS + idempotent + SQLite uses schema lock not row lock + busy_timeout absorbs contention. Per claudev4's analysis: worst case is a 5s pause, not a hang.

## Suspect still open (most plausible root cause)

**SSE broadcaster has no backpressure check.**

`broadcastToRoom` in `src/lib/server/eventBroadcast.ts:60-80` calls `controller.enqueue(bytes)` synchronously for each subscriber, with no check on `controller.desiredSize`:

```typescript
for (const controller of roomSet) {
  try {
    controller.enqueue(bytes);
  } catch {
    roomSet.delete(controller);
  }
}
```

If a subscriber is slow or dead (browser tab in background, paused JS, slow network, hung consumer), the controller's internal queue fills up. Node's ReadableStream **does NOT throw on enqueue past the high-water mark** — it just grows the internal buffer.

Compound effect:
1. Slow/dead client keeps SSE connection open
2. Every broadcast (chat message, agent_activity, message_read, ask_resolved...) enqueues to the dead controller's buffer
3. With high-traffic rooms (orsz2321qb seq advanced from 0 to ~40 in a few minutes during my SSE testing yesterday) the buffer grows quickly
4. Eventually: GC pressure → long pauses → looks like a hang

The `try/catch` only catches if enqueue throws (which it does for CLOSED controllers, but NOT for full buffers). Dead-but-not-closed controllers leak.

## Proposed fix shape (not built yet)

Add `desiredSize` check before enqueue. If `desiredSize <= 0`, the buffer is at/past high-water mark; either skip the broadcast for that subscriber OR force-close the controller to force a reconnect.

```typescript
for (const controller of roomSet) {
  try {
    if (typeof controller.desiredSize === 'number' && controller.desiredSize <= 0) {
      // Buffer full — likely dead consumer. Close to force reconnect.
      try { controller.close(); } catch { /* already closed */ }
      roomSet.delete(controller);
      continue;
    }
    controller.enqueue(bytes);
  } catch {
    roomSet.delete(controller);
  }
}
```

## Other suspects worth investigating

- **cronJobTicker iteration with PER_TICK_LIMIT=50** sync inner actions: 50 jobs × ~10ms each = 500ms event-loop block per tick. Not a hang, but a sustained latency spike.
- **agentStatusPoller** does sync DB reads + writes for up to 5 terminals per tick. Tmux capture is the slow part; DB ops are fast.
- **transcriptToChatFanout** has a multi-step DB transaction per message (reserve → insert → broadcast). Could contend with chat POSTs.

## What I haven't probed

- Memory growth over time (would confirm the SSE buffer hypothesis)
- File descriptor count (lsof against the server PID)
- Actual `controller.desiredSize` values for live subscribers

## Followup work

- **Add desiredSize check to broadcastToRoom** — single-line fix, candidate worktree slice
- **Memory probe**: `ps -o rss,vsz -p $PID` every minute, plot growth
- **FD probe**: `lsof -p $PID | wc -l` periodically
- **Banked**: `boundary_surface_invisible_upstream_constraints_2026_05_23` overlap — the hang is a boundary that isn't visible at write time

## Status

Partial. Returning to the Stage delivery task per JWPK msg_cy8olp2r9x. Investigation resumes after that ships. Watchdog band-aid (claudev4's d81a9ac) catches the hang shape at 60s + force-kills, so production isn't blocked.
