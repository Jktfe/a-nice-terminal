# antios — Design principles

**Status:** locked (JWPK `msg_8jbcsn5eg0` priorities + `msg_f65kx77fy0`/`msg_0t7urjpbno` ANT Cards naming + team consensus on roles + CanvasGrid-first review surface)
**Owners:** @antux (spec lead) · @antchatmacdev (native feasibility + build) · @codexuxant (ANT Cards visual lane + state vocabulary) · @antmacdevcodex (QC gate)
**Review substrate:** **CanvasGrid** — every screen wrapped as `CanvasGrid("Name") { ScreenView() }` so the captures land in `~/Library/Containers/itswilder.CanvasGrid/Data/.../Projects/antios_*/Images/` and JWPK can screenshot the full board from mobile.

---

## The ten load-bearing rules

These are the **decision filter** for every antios screen, slice, and feature. If something fails one of these, it is wrong — not "would be nice to fix later."

### Six priorities (what antios IS for) — `msg_8jbcsn5eg0`

| # | Priority | The decision filter |
|---|---|---|
| 1 | **See what is going on — fast** | Switching between rooms must be a single gesture from the front door. Multi-room status visible without entering each. Home tab = **ANT Cards** = the room switcher reframed for the emotional "remember why I pay" moment. |
| 2 | **See PROGRESS** | Plans + tasks need their own surface. Rooms gain a `purpose` chip in the header (cross-team ask to Main team for the server-side field). |
| 3 | **See context of the work** — files / memories / artefacts + **EXPLAIN THIS** | Sheet-up gesture from anywhere reveals context for the current room. Long-press any term → inline grounded Explain panel. **Explain delivers what interview asks** (Chair-pair — folds into the paused Chair strategy session). |
| 4 | **EASY feedback** — text / voice / interview / ask | Persistent compose FAB always reachable. Tap = text. Hold = voice. Swipe = mode. **Drafts AUTO-SAVE on every keystroke, restore on app foreground, warn on swipe-away if dirty.** |
| 5 | **EASY instructions delivery** | Same compose primitive with Instruction mode pre-filling `/instruct @who` so the target is one tap. |
| 6 | **EASY agent + room adding + bring-in-LLM** | Big `+` in tab bar opens an action sheet — New room · Invite agent · Bring in Claude Mobile · Bring in ChatGPT iOS · Bring in Gemini. Same Slice 7 pattern, native deep-links. |

### Four anti-goals (what antios IS NOT) — `msg_8jbcsn5eg0`

| Anti-goal | The decision filter |
|---|---|
| **Convoluted long UX experiences** | Tap depth ≤ 3 everywhere (tab → detail → action). Anything deeper requires re-design. |
| **All detail immediately** | Progressive disclosure default — summary on tap, full detail on second tap. |
| **TO LOSE DRAFTS!!!!** | Cardinal sin. Persist on every keystroke. Restore on app foreground. Warn on swipe-away. Cover three failure modes: backgrounding, room-switch, network-drop. |
| **Another Slack** | Not a chat firehose. Today / Now is a curated digest. Chat is INSIDE a room, not the front door. |

---

## Two cross-cutting decisions

**A. Code-first design loop for antios.** Unlike Concept D on Mac (Pencil-first), antios design lands as SwiftUI views directly wrapped in CanvasGrid. The CanvasGrid project folder is the review substrate JWPK screenshots from mobile. Pencil is reserved for late-stage static spec artefacts (typography lock-down, colour swatches) — not for IA-first design.

**B. The Home tab IS the emotional surface.** Cold-launch destination = **ANT Cards** (the named premium surface, per `msg_0t7urjpbno` — "keeps it locked with this is what I pay for"). 3D-stacked card deck of rooms, ambient motion, spring-physics lift. Per-card surfaces the team's work. The Home tab and ANT Cards are the same view; the room switcher and the magic moment are the same surface viewed two ways.

---

## Cross-team coordination tracked (Main team via room `hyz00k0ibh`)

- `room.purpose: String?` field — server-side addition so antios surfaces it as a chip in the room header
- `room.plan_id: String?` field — server-side link so the Plans tab can deep-link from room context
- Chair / EXPLAIN-THIS pair — folds into the paused Chair strategy session (no implementation work until JWPK runs the session)
- `GET /api/activity?roomId&since` — summary endpoint returning decision-class events for the ANT Cards activity timeline

---

## Related memories

- [[project_antios_priorities_jwpk_2026_05_24]] — the priority/anti-goal constraint set
- [[project_antios_ant_cards_2026_05_24]] — the magic-moment ANT Cards surface
- [[project_chair_is_agent_kind_2026_05_23]] — Chair pair for EXPLAIN-THIS
- [[project_bring_in_llm_buttons_2026_05_23]] — Bring-in-LLM mobile native shape
- [[project_ant_plugs_into_existing_tools_not_replaces_them_2026_05_22]] — positioning anchor
