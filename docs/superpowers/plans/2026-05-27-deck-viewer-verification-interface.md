# Deck Viewer + Verification Interface Plan

## Goal

Give normal deck artefacts a first-class ANT review surface without changing the raw built deck route.

The raw deck stays at `/d/<slug>` so it can be shared, embedded, exported, and served by Cloudflare. The ANT artefact page at `/artefacts/:artefactId` becomes the premium operator interface around that deck: controlled frame sizing, review notes, validation lenses, evidence gaps, and verifier work creation.

## Product Shape

### Raw deck

- Route: `/d/<slug>`
- Purpose: play the built deck exactly as authored.
- No ANT chrome.
- No notes panel.
- No verification controls.
- Good for Zoom screen share, Cloudflare Pages, and external links.

### ANT deck review artefact

- Route: `/artefacts/:artefactId`
- Purpose: review, verify, and capture feedback around a normal deck.
- Embeds the raw deck in a frame.
- Adds frame modes:
  - Fit: use available space.
  - 16:9: PowerPoint widescreen review frame.
  - 4:3: legacy boardroom/projector check.
- Adds review notes beside the deck.
- Adds verification panel beside the deck, using existing artefact validation API.

### ANT Stage deck

- Route: `/decks/:deckId`
- Purpose: live presentation with presenter tooling.
- Keeps Stage-only features: narration, live feedback, alternatives, validation overlay, and real-time append/edit moments.
- Can point at an Animotion/Open-Slide built deck, but remains a different product surface from normal deck artefacts.

## Verification Interface V1

The premium verification UI should make four things obvious:

1. Which lens is active.
2. Which claims were extracted.
3. Which claims pass or fail the lens.
4. What work is needed to close missing verifier slots.

V1 uses existing backend primitives, with one explicit contract gap:

- `GET /api/validation-schemas?scope=public` lists the Stage-facing lens taxonomy.
- `POST /api/artefacts/:artefactId/validate` executes validation by `policySlug`.
- `POST /api/artefacts/:artefactId/validate` with `createWork: true` for verifier task creation.

The schema list and executable policy store are currently separate. Step 2 must add a small adapter so the UI never sends a schema id where the server expects a policy slug.

## Implementation Steps

### Step 1: Deck review shell

- On `/artefacts/:artefactId`, detect normal deck artefacts with a browser-viewable `refUrl`.
- Replace the generic iframe shell for those artefacts with a deck review layout.
- Add frame mode state: `fit | widescreen | classic`.
- Render the iframe in a stable aspect container.
- Add a review notes panel with local draft and copy action.
- Keep non-deck artefact rendering unchanged.

### Step 2: Verification controls

- Fetch visible validation schemas on demand.
- Resolve each selectable item to an executable policy slug, or mark it as display-only until a policy exists.
- Add a lens selector only for executable policies.
- Send selected `policySlug` to the validation endpoint.
- Keep the built-in JK validation rule as the executable fallback.
- Show score, claim list, and missing verifier slots in the right rail.
- Keep `Create verifier work` wired to the existing `createWork` path.

### Step 3: Notes persistence

- Add a server-backed notes path after the shell is stable.
- Preferred V1 persistence target: room-linked event/note that includes `artefactId`, `deckRefUrl`, `frameMode`, and note text.
- Do not invent a separate content system until we know whether notes should become chat messages, Stage feedback, or artefact annotations.

### Step 4: Stage connection

- Add an affordance from normal deck artefact review to "Promote to Stage" when the user wants narration, live feedback, or alternatives.
- Promotion should create a Stage deck row pointing at the existing built deck slug, not duplicate deck source.

## Verification Plan

- `nvm exec 22 npm run check`
- `nvm exec 22 npm run build`
- Browser check a normal deck artefact:
  - `/artefacts/:id` renders the review shell.
  - Fit / 16:9 / 4:3 switches do not shift toolbar text or overflow on mobile.
  - Raw source link opens `/d/<slug>`.
  - Validation still works for markdown-backed deck artefacts.
- Browser check raw deck:
  - `/d/<slug>` still renders without ANT chrome.

## Capability Ledger

Update `docs/capability-ledger.md` when Step 1 ships:

- Capability: Deck artefact review shell.
- Verdict: CHANGE.
- Note: normal deck artefacts now have frame modes and local review notes around the raw `/d/<slug>` deck; Stage remains separate.
