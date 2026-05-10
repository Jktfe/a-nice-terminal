# Runtime And Grid Dashboard Audit — 2026-05-10

Context: James reported the system feeling slow, asked how many terminals were
running, and reported that a six-screen grid dashboard constantly flashed
`Loading`.

## Live Counts

Measured on James's Mac mini at roughly 17:45 Europe/London.

| Surface | Count / Reading | Notes |
| --- | ---: | --- |
| Active terminal sessions in ANT DB | 25 | `sessions.type='terminal'`, unarchived, not deleted |
| Active chat sessions in ANT DB | 62 | Unarchived, not deleted |
| Running tmux sessions | 29 | 12 codex panes, 11 claude panes, 5 zsh panes, 1 node pane |
| Total ANT sessions in DB | 112 | 32 live terminals, 63 live chats, plus archived rows |
| Exact agent CLI processes | 24 | 13 `codex`, 11 `claude`; helper-process greps overcount badly |
| Total OS processes | 1,388 | `top -l 1`; 10 running at sample time |
| Total OS threads | 10,343 | `top -l 1` |
| Load average | 29.10 / 30.80 / 19.26 | High for interactive feel |
| CPU | 40% user / 30% system / 30% idle | Busy but not fully pegged |
| Physical memory | 63 GB used / 201 MB unused | 30 GB compressor |
| Process limit | 16,000 kernel max, 10,666 user soft limit | Current process count is not close |
| File descriptor limit | 245,760 per process | Not close based on observed workload |
| ANT DB size | 8.8 GB | Heavy but row counts are not near SQLite limits |

## Findings

The number of tmux sessions is not itself the limiting factor. 29 tmux sessions
is small relative to macOS process limits and tmux's practical capacity. The
heavier signal is whole-machine pressure: high load average, high process/thread
count, and heavy memory compression. That can make the local browser and mobile
client feel sticky even when individual ANT endpoints are fast.

The dashboard flashing had a direct client-side bug:

- `GridSlot.svelte` polled every 5 seconds per populated grid tile.
- Each poll called `loadContent()`.
- `loadContent()` set `loadingContent = true` every time, even when there was
  already content and even when the response was unchanged.
- Six populated grid slots therefore created repeated visible blanking/spinner
  flashes, around 1.2 content fetches per second.

## Patch Applied

`src/lib/components/GridSlot.svelte`

- Initial load still shows `Loading`.
- Background poll no longer toggles `loadingContent`.
- Poll cadence changed from 5 seconds to 10 seconds.
- Polling skips while `document.hidden`.
- Chat preview fetches now request 20 messages instead of 50.
- Chat and terminal preview arrays only update when a lightweight fingerprint
  changes, so identical responses do not re-render a tile.
- Chat/linked-chat grid cells now fetch room participants in the background and
  show compact agent chips directly in the card header.
- Participant refresh is a separate 30-second background poll and never blanks
  the card.

`tests/grid-dashboard-refresh.test.ts`

- Static guard that grid tile polling is background-only.
- Static guard that previews are light and update only on change.
- Static guard that room agent chips are rendered from the participants
  endpoint.

## Limits

Current state is nowhere near SQLite row limits, process limits, file descriptor
limits, or tmux session limits.

The practical ceiling being approached is interactive machine pressure:

- memory compression is already very high;
- load average is high;
- 24 active agent CLI processes plus their helpers are materially heavier than
  the 29 tmux wrappers;
- Docker/VM/`smbd`/WindowServer were also significant at sample time.

## Follow-Ups

1. Add an admin diagnostics page that records process count, tmux count, agent
   CLI count, DB size, and endpoint timings without shelling into the machine.
2. Add a safe "stale terminal audit" that reports orphan tmux sessions and
   archived/deleted-session tmux mismatches before offering cleanup.
3. Add DB retention/VACUUM tooling for old `run_events` and terminal transcript
   data. Do not run this automatically until the retention policy is explicit.
4. Consider a grid-level shared poller or WebSocket-driven updates so six cells
   do not independently poll their own content endpoints.
