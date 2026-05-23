---
doc_id: stage-zeta-postmessage-research-2026-05-23
title: "Stage ζ research — cross-iframe postMessage shape for wrapping external decks"
status: research
visibility: oss
auditor: "@speedyclaude"
audited_at: 2026-05-23
linked_rooms: ["orsz2321qb"]
---

# Stage ζ — wrapping external decks via cross-iframe postMessage

## Background

The Stage product is positioned as a **shell** that wraps the user's existing deck source (Slidev / Reveal.js / Canva / Google Slides / a PDF) and adds the agent-context layer on top: narration, click-to-explain, pause-context capture, alternative-track generation. See:

- [stage-live-edit-spec](../../../../../.claude/projects/-Users-you-CascadeProjects-a-nice-terminal/memory/project_stage_live_edit_spec_jwpk_2026_05_22.md) — canonical Stage spec
- `project_stage_is_shell_not_deck_2026_05_22.md` — the original "shell, not a deck" course-correction
- `project_ant_plugs_into_existing_tools_not_replaces_them_2026_05_22.md` — positioning principle

Slice ζ is the part that makes Stage source-agnostic: the deck renders inside an `<iframe>` and Stage talks to it via `postMessage`. This doc maps the protocol shape we'll need across the 4 candidate sources.

## What Stage needs the iframe to do

Per the live-edit spec, Stage drives:

1. **Slide navigation** — go to slide N (1-indexed), get current slide index, get total slide count
2. **Pause/resume narration** — Stage's TTS layer pauses when the user clicks pause; the deck iframe doesn't need to know about TTS but should expose a slide-change event so Stage can update its current-slide pointer
3. **Capture pause-context** — at pause time, Stage needs: current slide's narrative text (speaker notes), the deck's source URL/slug, optionally the current visible text on-screen
4. **Render alternative-track preview** — when an agent proposes a Version-B slide, Stage may render it as an overlay outside the iframe (the iframe stays as the source-of-truth slides; alternatives live in Stage's own UI). No mutation API needed for slice ζ.

## Per-source capability matrix

| Source | Embeddable? | Has API for nav + events? | Speaker notes accessible? |
|---|---|---|---|
| **Slidev** | Yes — `npm run dev` then iframe the URL | Native postMessage support via [@slidev/parser](https://sli.dev/guide/syntax.html#frontmatter); slide-id in URL fragment | Yes — `<!-- note: ... -->` blocks parse into JSON |
| **Reveal.js** | Yes — iframe the rendered HTML | Built-in postMessage API (`{method, args}` shape); `slidechanged` event; `slide()` method | Yes — `data-notes` attribute on `<section>` |
| **Canva** | Yes — public-link embed at `https://www.canva.com/design/<id>/view?embed` | Limited: navigation only via URL params (`#1`, `#2`, etc.); no event API documented | NO — speaker notes not exposed cross-origin |
| **Google Slides** | Yes — `https://docs.google.com/presentation/d/<id>/embed` | NO public postMessage API; navigation works via URL params (`#slide=id.gXXX`) | NO — notes not exposed via embed |
| **PDF** | Yes — `<embed>` or `<iframe src="file.pdf">` | Browser-native PDF viewers don't expose a stable postMessage protocol; pdf.js does (we'd need to host it) | Conditional — pdf.js can extract text but "speaker notes" are not a PDF primitive |

## Recommended protocol shape (Stage ↔ iframe)

For **Slidev and Reveal.js** (the two sources that support full postMessage):

```typescript
// Stage → iframe (parent → child)
{
  type: 'stage.command',
  command: 'goto' | 'next' | 'prev' | 'getCurrent' | 'getTotal' | 'getNote',
  args?: { slide?: number | string }
}

// iframe → Stage (child → parent)
{
  type: 'stage.event',
  event: 'slide-changed' | 'ready' | 'error',
  payload: {
    currentSlide?: number,
    totalSlides?: number,
    slideId?: string,
    note?: string,         // speaker notes for current slide
    visibleText?: string,  // optional: what's rendered on-screen now
  }
}
```

Origin checking: Stage MUST verify `event.origin` matches the configured deck source. Untrusted origin → drop the message (don't act on it, don't bridge to agents).

For **Canva and Google Slides** (URL-fragment-only): Stage falls back to "passive observation" mode. It can:
- Set the slide via URL fragment (changes the iframe `src`)
- NOT receive slide-change events from the iframe
- NOT read speaker notes (those live in Stage's own metadata layer for these sources — user pastes notes into Stage when configuring the deck)

For **PDFs**: ship as a Stage-hosted pdf.js render. Stage owns the chrome, the iframe is just for the PDF viewer; the postMessage shape above applies because Stage controls both sides.

## Slice scope (proposed for whoever picks this up)

**Slice ζ-1: contract** (this doc) — define the protocol; no code.

**Slice ζ-2: Slidev wrapper** — embed a local Slidev instance in an iframe, implement the Stage ↔ iframe postMessage handler. Cheapest source to validate the shape (Slidev exposes everything we need natively).

**Slice ζ-3: Reveal.js wrapper** — same shape, second source. Catches differences between two "full-capability" sources.

**Slice ζ-4: passive-observation fallback** — Canva + Google Slides. Stage owns the speaker-notes layer for these (user provides notes per slide); navigation via URL fragment; no slide-change events.

**Slice ζ-5: PDF via pdf.js** — Stage-hosted pdf.js, full postMessage shape on Stage-owned chrome.

Each slice is independent; the contract slice is the gate. After ζ-1 lands, the four wrappers can ship in parallel.

## Security notes

- `<iframe sandbox>` attributes: Stage iframes need at least `allow-scripts` for Slidev/Reveal (they're SPA-style). Canva and Google Slides drop into stricter sandboxes by their own choice.
- Origin pinning: every wrapped deck has a configured `expected_origin` field. postMessage from any other origin is dropped silently.
- No agent-side message handling from untrusted origins: even if a malicious embedded deck sent `{type: 'stage.event', event: 'execute-this-arbitrary-command'}`, Stage's parent-side handler is a fixed switch — only `slide-changed`, `ready`, `error` are dispatched. Anything else is logged and ignored.

## Open questions

1. **Speaker-notes storage for Canva/Google Slides** — if Stage owns the notes layer for these sources, where does it persist? Per-deck metadata table seems right, but tied to which user/org? Likely `chat_room_decks.notes_metadata_json` or similar; out of scope for ζ but worth flagging now.
2. **Iframe-shape for the alternative-track preview** — does Version-B render in the same iframe (replacing the source), or as an overlay outside the iframe? Earlier dictation suggests "decision tree of pre-prepared alternatives" — those are SEPARATE iframes Stage swaps between, not in-place mutation of the source iframe. Worth ratifying.
3. **Resize handling** — embedded decks set their own viewport. Stage's window may resize; passing resize events into the iframe (or letting CSS handle via `width: 100%`) is a Slidev/Reveal-specific concern.

## Cross-references

- `project_stage_live_edit_spec_jwpk_2026_05_22.md` — Stage canonical spec; this slice slots in as ζ
- `project_ant_plugs_into_existing_tools_not_replaces_them_2026_05_22.md` — the principle this slice operationalises
- `docs/contracts/exploration-backlog.md` — this slice was item #3 of the backlog (now ✅)

## Status

Research only. No code. Marks the Stage-ζ exploration-backlog item as ✅.
