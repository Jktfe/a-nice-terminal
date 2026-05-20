# Terminal folder picker — Raw view — 2026-05-14

Author: @claude2 TTVPh3mnu8wERzALQLJO6
Gate: canonical @codex2 RQO32LuIK8xmcV7fq04Oq
Driver: JWPK EvoluteAnt — "while it is in raw mode there should be a
visual folder section that auto-fills the cd command"

## Locked assumptions (per coordinator defaults)

| # | Assumption | Why |
|---|---|---|
| A1 | Picker renders ONLY when `viewMode === 'raw'` | Per JWPK "in raw mode"; doesn't clutter Chat/ANT |
| A2 | Source = current-cwd breadcrumb (auto-detected) + N user bookmarks | Combines context + speed; matches JWPK default |
| A3 | Cwd detection: PASSIVE — parse shell-prompt cwd markers from incoming PTY stream OR OSC 7 / OSC 1337 if shell emits, OR explicit "refresh cwd" user button. **NO background `pwd\n` injection** (would pollute PTY + collide with user/agent input). Degrade gracefully when no marker available. | Banked PTY-INJECT discipline + JWPK gap |
| A4 | Bookmarks stored in `localStorage` via new store mirroring `agentKinds` pattern | Per-client preference; no backend dep |
| A5 | Click handler uses banked two-call PTY protocol: `postInput('cd ' + shellQuote(path))` then `setTimeout(() => postInput('\r'), 5)`. shellQuote = single-quote wrap + `'` escape. Matches existing `Terminal.svelte` `handleSpecialKey` paste branch. | Banked feedback_pty_paste_buffer_first + feedback_shell_quote_pty_inject |
| A6 | Bookmark management UX: tiny `+` button to add current cwd; `×` on each pill to remove | Minimal-chrome; in Settings later if it grows |
| A7 | Path display: last 2 parts shortened (e.g. `…/CascadeProjects/ant`) with full-path title attribute | Matches existing `fmtCwd` helper in TerminalAntCommandBlock |

## Components

### NEW `src/lib/stores/terminalBookmarks.svelte.ts` (~50L)
State class `add`/`remove`/`reset` + `localStorage` key `ant-cwd-bookmarks`.
Default seed = `[]` (no system-supplied bookmarks; user-driven).
Mirrors `theme.svelte.ts` + `agentKinds.svelte.ts` pattern.

### NEW `src/lib/components/TerminalFolderPicker.svelte` (~120L)
Props:
- `currentCwd: string | null` (passed by Terminal.svelte after detection)
- `onChangeDir: (path: string) => void` (callback that posts `cd <path>\n` to PTY)

Render:
- Left: breadcrumb of `currentCwd` (clickable parents → cd to that level)
- Middle: bookmark pills (each `path` with `×` to remove)
- Right: `+` button (add current cwd to bookmarks)
- Empty currentCwd: hide breadcrumb, show "cwd unknown — type `pwd↵` to detect"

### Update `src/lib/components/Terminal.svelte` (+ ~30L)
- New `cwd = $state<string | null>(null)` — last-detected working dir
- **Passive cwd detection** (per A3 — no PTY injection): on each
  enqueueWrite, scan the chunk for `OSC 7` (`\x1b]7;file://...\x1b\\`)
  or `OSC 1337` (iTerm2 CurrentDir) escape; if matched, decode + set
  `cwd`. If shell doesn't emit either, picker shows "cwd unknown — click
  refresh to detect" with a small refresh button that calls a one-shot
  `pwd` ONLY on explicit click (user-driven, not background).
- Mount `<TerminalFolderPicker currentCwd={cwd} onChangeDir={handleCd} />`
  above `<TerminalSpecialKeys />`, only when view-mode=raw.
- `handleCd(path)` implements two-call protocol:
  ```
  await postInput('cd ' + shellQuote(path));
  setTimeout(() => postInput('\r'), 5);
  ```
  with `shellQuote(p) = "'" + p.replace(/'/g, "'\\''") + "'"`.

### Update `src/lib/components/TerminalCard.svelte` (0L delta)
Raw view already mounts `<Terminal />`; no card-level change needed.

## Trust + safety boundary

- Path injection: `cd $path\n` where $path is bookmark text → user-supplied
  strings. Risk: shell injection via `;` or backticks. Mitigation:
  client-side escape with single-quotes: `cd '${path.replace(/'/g, "'\\''")}'\n`
- Bookmarks are per-client localStorage; never sent to backend
- No file-system enumeration — picker NEVER reads `~/` or filesystem
  directly. Cwd comes from PTY's shell only.

## Out of scope (deferred)

- OSC 7 cwd reporting (faster + more accurate; v2)
- Filesystem tree browser (would need backend `/api/fs/list`; v2)
- Drag-reorder bookmarks (v2)
- Per-terminal vs global bookmarks (v1 = global per-client)
- Recent-cwd history (separate from bookmarks)

## Acceptance

- Doc ≤180L
- 2 new files (store + component) + Terminal.svelte delta
- Raw view shows picker strip with breadcrumb + bookmarks + add button
- Click bookmark → cd injected → shell prompt updates
- Add current cwd → appears as new pill + persists in localStorage
- Remove pill → disappears + persists
- Chat/ANT views do NOT show the picker (raw only)
- bun run check 0/0/0 + build PASS
- Browser-runtime verify on real terminal: cd round-trip succeeds

## Ship order

1. **FOLDER-1**: terminalBookmarks store (~15min)
2. **FOLDER-2**: TerminalFolderPicker component (~45min)
3. **FOLDER-3**: Terminal.svelte cwd detection + picker mount (~45min)
4. **FOLDER-4**: browser-runtime acceptance + JWPK retest (~30min)

Total ~2-2.5h. No backend dependency.
