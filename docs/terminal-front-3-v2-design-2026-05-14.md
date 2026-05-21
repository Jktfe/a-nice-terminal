# FRONT-3 v2 design — ANT-view enhancements (v3 lift) — 2026-05-14

Author: @claude2 TTVPh3mnu8wERzALQLJO6
Gate: canonical @codex2 RQO32LuIK8xmcV7fq04Oq
Anchor: coordinator v3 ANT-view audit (10 lift items)
Sources: a-nice-terminal/src/lib/shared/special-keys.ts (19L) +
         /src/lib/components/CommandBlock.svelte (590L) +
         /src/lib/components/Terminal.svelte (664L)

## Scope (10 lift items)

| # | Item | v1 state | v2 plan |
|---|---|---|---|
| 1 | Special keys row | absent | new `TerminalSpecialKeys.svelte` mounted in Raw view |
| 2 | Composer keyboard (Cmd+Enter / Esc / two-call paste) | ChatView Enter-only | extend Chat composer + Raw paste |
| 3 | Terminal response blocking | `ansiResponseFilter.ts` shipped | verify DA1/DA2/DSR/OSC10/11 coverage — likely no-op |
| 4 | Sticky block header | flat blocks | `position:sticky top:0 z-index:1` on `.event-meta` for command+tool_call |
| 5 | Collapsible output | always-expanded blocks | chevron toggle + firstLine + "+N more" badge for kind∈{command,tool_call,raw} with >3 lines |
| 6 | Status indicator | trust-tier badge only | green/red dot on command kind by `payload.exit_code` |
| 7 | Copy buttons | none | copy-command + copy-output with "Copied 1.2s" fade |
| 8 | Metadata compacting | timestamp + kind+trust badges | add cwd-last-2-parts + duration `fmtDuration` + container-query hide cwd <480px |
| 9 | Re-run callback | none | command kind emits `onRerun(cmd)` → parent POSTs `cmd+\r` to `/input` |
| 10 | Tool result rendering | basic args details | richer payload: `result` preview + status + duration |

## New components

### `TerminalSpecialKeys.svelte` (~60L)
Props: `onKey(seq: string): void`. Renders a horizontal button strip seeded
from `SPECIAL_KEYS` (lift `src/lib/terminal/specialKeys.ts` — new file copying
v3 const). `Paste` button calls `navigator.clipboard.readText()` then forwards
result to `onKey`. Other buttons forward `seq` directly.

### `TerminalAntCommandBlock.svelte` (~150L)
Props: `event: AntEvent`, `onRerun?: (cmd: string) => void`. Encapsulates
items 4-9 for the command-kind block. ANT view delegates to this component
when `event.kind === 'command'`. Sticky head, status dot, copy buttons,
collapsible body when `lineCount > 3`. Same component handles `tool_call`
kind with `onRerun` disabled.

### `src/lib/terminal/specialKeys.ts` (~25L)
Direct lift of v3 `SPECIAL_KEYS` + `getKeySequence` — re-export under
fresh-ANT path. No dependency on v3.

## Changes to existing components

### `Terminal.svelte` (Raw view)
- Add `<TerminalSpecialKeys onKey={postInput} />` above `<div bind:this={hostEl} />`
- Wire paste two-call protocol: `await postInput(text); setTimeout(()=>postInput('\r'), 5)`

### `TerminalChatView.svelte`
- Keyboard delta: Cmd/Ctrl+Enter = submit (already Enter alone), Esc = blur
- Paste sentinel honored in composer (paste via Special Keys row applies here too if mounted)

### `TerminalAntView.svelte`
- For `event.kind === 'command' || event.kind === 'tool_call'`: render
  `<TerminalAntCommandBlock {event} onRerun={handleRerun} />` instead of the
  inline `command-body` / `tool-body` markup
- Pass `onRerun` prop up to TerminalCard which forwards to parent's `postInput`

### `TerminalCard.svelte`
- Add `onRerun` handler: POST `/api/terminals/[id]/input` with `data: cmd+'\r'`
- Forward to `<TerminalAntView />`

## Trust + safety boundary

Per ANTstorm §3 trust tiers:
- `trust='high'` blocks render rich content (status dot, copy, sticky)
- `trust='medium'` renders structured frame but escaped text
- `trust='raw'` always mono `<pre>` — no buttons except copy

Re-run callback ONLY fires for `trust='high'` command blocks. Medium/raw
command kinds render read-only (no re-run button).

## Out of scope (deferred)

- Artifact rendering (`/api/artifacts/` endpoint not in v1 backend)
- Inline prompt-card overlays (ANTstorm §7 Track 1 — needs spatial anchor)
- WebGL renderer flag (ANTstorm Track 2 §5)
- Tool result preview expansion beyond stringified `payload.result` first 240 chars
- Container queries on AntView width <480px (T3 mobile slice)

## Acceptance

- Doc ≤180L
- All 4 new/modified components type-check + svelte-check 0/0
- AntView command-kind block: sticky head + green-dot exit-0 / red-dot exit-1 + copy fade + collapsed-by-default >3 lines + re-run button fires POST /input
- Special Keys row mounted in Raw view, Paste reads clipboard, Ctrl+C kills
- Composer Cmd+Enter submits; Esc blurs
- Browser-runtime verified at :6461 — sticky scroll, copy "Copied" fade visible, re-run round-trip via claude-code spawn
- No regression on FRONT-1/2/3 v1 acceptance

## Ship order (claim-first slices)

1. **FRONT-3v2-1**: specialKeys.ts lift + TerminalSpecialKeys.svelte + Raw mount (~45min)
2. **FRONT-3v2-2**: TerminalAntCommandBlock + AntView delegate + sticky/dot/copy/collapse (~1.5h)
3. **FRONT-3v2-3**: composer keyboard (Cmd+Enter / Esc) + paste two-call protocol (~30min)
4. **FRONT-3v2-4**: onRerun wire-through TerminalAntView → TerminalCard → POST /input (~30min)

Each slice ships claim-first under canonical RQO + browser-runtime verified
before next claim.
