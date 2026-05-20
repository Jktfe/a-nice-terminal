# FINDING-1 ANT-input-parity — 2026-05-15

Author: @claude2 TTVPh3mnu8wERzALQLJO6
Gate: canonical @codex2 RQO32LuIK8xmcV7fq04Oq
Queue: AFTER B2-3 scope-A (coordinator-locked). This is the design doc;
impl follows B2-3 impl.
Driver: JWPK dogfood — the ANT view is read-only, has NO input
affordance. RAW has the SpecialKeys row + accepts PTY input; ANT does
not. JWPK: "the ANT view has no input — it should be treated as raw
input with special keys etc."

## Diagnosis (on-disk, verified — not assumed)

| Fact | Evidence |
|---|---|
| ANT view renders transcript only, no input UI | TerminalAntView.svelte 424L: `<section class="ant-view">` L286-349 is CommandBlock/AgentEventCard rendering; zero text input / SpecialKeys |
| The PTY input path is ALREADY wired in this component | TerminalAntView L118 `POST /api/terminals/[id]/input {data}` inside `handleAgentRespond` (agent-prompt keystroke responses) |
| RAW's input handlers live in Terminal.svelte (not shared) | Terminal.svelte `postInput` (loopback-guarded), `handleSpecialKey` (two-call paste protocol), `<TerminalSpecialKeys onKey=…/>` |
| SpecialKeys is already a clean reusable component | TerminalSpecialKeys.svelte: pure `onKey(seq)` callback + paste sentinel; its own header says "ChatView can reuse this" |

**Conclusion:** FINDING-1 is NOT a new input path — the endpoint +
two-call protocol already work and are already invoked from
TerminalAntView. The gap is purely the missing **user-facing
affordance** (SpecialKeys row + free-text composer). Lift RAW's, don't
reinvent.

## Design — lift, don't duplicate

### 1. Extract shared PTY-input helper (lift, not copy)
NEW `src/lib/terminal/ptyInput.ts` (~40L):
- `postInput(terminalId, data)` — loopback-guarded single POST (verbatim
  RAW logic, moved not rewritten).
- `sendText(terminalId, text)` — two-call protocol: `postInput(text)`
  then `setTimeout(()=>postInput('\r'), 5)` (RAW's exact timing).
- `handleSpecialKey(terminalId, seq)` — RAW's paste-vs-key branch
  (multi-char non-ESC/non-CR → text then optional `\r`; else raw seq).
- Terminal.svelte REFACTORED to import these (behaviour identical —
  proves the extraction by RAW's existing acceptance still passing).

### 2. Add the affordance to TerminalAntView (additive, bottom)
- `<TerminalSpecialKeys onKey={(s)=>handleSpecialKey(terminalId,s)} />`
- A composer: `<textarea>` + Send button → `sendText(terminalId, value)`
  then clear; Enter submits, Shift+Enter newline (mirrors RAW/Chat
  composer ergonomics).
- Mounted BELOW the transcript scroll region inside `.ant-view`, so the
  read-only transcript rendering is preserved and input is additive at
  the bottom — mirrors RAW's layout (SpecialKeys + input under content).

## Locked assumptions

| # | Assumption | Why |
|---|---|---|
| A1 | Extraction to `ptyInput.ts` is in-scope and is the "lift" | Copy-paste would let RAW/ANT drift; banked LIFT-not-reinvent. RAW refactor is behaviour-preserving. |
| A2 | No xterm in ANT — composer is a plain textarea, NOT an xterm onData capture | ANT renders cards, not a terminal grid; xterm.onData is RAW-only |
| A3 | Same endpoint, same two-call timing, same loopback guard as RAW | "reuse the EXACT path" — zero protocol divergence |
| A4 | Transcript stays read-only + authoritative; input does not alter the TRANSCRIPT-AUTHORITATIVE-GATE | Input produces PTY bytes → transcript reflects them naturally; no special-casing |
| A5 | handleAgentRespond's existing inline fetch (L118) stays as-is OR is migrated to `postInput` for consistency | Prefer migrate (one path) — call it out at impl, behaviour identical |

## Out of scope

- Slash-command menu / quick-actions in ANT (separate D11 slice).
- Composer history / draft persistence (Chat-view concern).
- Changing RAW's UX (refactor is behaviour-preserving only).
- Any transcript-rendering change.

## Acceptance (4-layer)

- `bun run check` 0/0/0 + `bun run build` PASS.
- vitest: `ptyInput.sendText` issues text then `\r` (fake-timer or
  fetch-spy); `handleSpecialKey` paste-branch vs raw-seq branch.
- CLI: POST /input round-trips after extraction (RAW unchanged).
- **Chrome (load-bearing): ANT view on a LIVE terminal shows
  SpecialKeys + composer; typing a command + Send → PTY receives it →
  it appears in the transcript; verified in rendered DOM on the EXACT
  terminal, idle/representative moment (not a favourable one).**
- RAW view regression check: SpecialKeys + input still work post-refactor
  (same browser pass, RAW tab).

## Ship order (after B2-3 impl)

1. F1-1: extract `ptyInput.ts` + refactor Terminal.svelte to it,
   green check/build + RAW browser regression (~35min)
2. F1-2: SpecialKeys + composer into TerminalAntView, additive bottom
   (~35min)
3. F1-3: browser-runtime acceptance on exact terminal + RAW regression
   (~30min)
