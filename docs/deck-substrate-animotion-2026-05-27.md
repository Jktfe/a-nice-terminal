# Deck Substrate: Animotion Primary

ANT supports two related deck surfaces:

- A normal deck artefact is a room shelf pointer to a built deck at `/d/:slug`.
- An ANT Stage presentation is a room-scoped Stage record at `/decks/:deckId`
  that wraps a deck with presenter mode, voice/talking, live feedback,
  real-time alternative generation, and validation overlays.

## Boundaries

- ANT stores Stage presentation metadata in the room: title, room id,
  password, slides JSON, and `theme`.
- Animotion is the primary live deck substrate. A Stage presentation row points
  to it with `theme=animotion:<slug>`.
- Open-Slide remains a compatibility substrate with
  `theme=open-slide:<slug>`.
- Built deck folders live outside this repository. They may live in Dropbox,
  iCloud Drive, a mounted share, or any other operator-managed filing system.
  Do not commit generated deck source or `dist/` output into
  `a-nice-terminal`.
- The server finds built decks from `ANT_BUILT_DECKS_ROOTS`, falling back to
  `~/CascadeProjects/ANT-Decks` and then
  `~/CascadeProjects/ANT-Open-Slide`.
- Each configured root contains one folder per deck slug. For example,
  `ANT_BUILT_DECKS_ROOTS="/Users/jamesking/New Model Dropbox/James King/ANTdecks"`
  means ANT will serve `state-of-play` from
  `/Users/jamesking/New Model Dropbox/James King/ANTdecks/state-of-play/dist/index.html`.

## Operator Flow

### Normal Deck Artefact

1. Choose an external deck root. JWPK's preferred local root is:

   ```sh
   export ANT_BUILT_DECKS_ROOTS="/Users/jamesking/New Model Dropbox/James King/ANTdecks"
   ```

   Multiple roots are supported by separating paths with `:` on macOS/Linux.

2. Build the deck into an external folder such as
   `/Users/jamesking/New Model Dropbox/James King/ANTdecks/state-of-play/dist`.

3. Add the built deck to the room artefacts shelf:

   ```sh
   ant deck build state-of-play
   ant artefact add --room ROOM_ID --kind deck --title "State of Play" --ref-url /d/state-of-play --summary "Built Animotion deck"
   ```

4. Confirm it is visible:

   ```sh
   ant artefact list --room ROOM_ID
   ```

### ANT Stage Presentation

Use this only when the deck needs Stage behaviour: presenter shell, talking,
live feedback, generated alternatives, validation overlays, and audience-led
iteration.

1. Build the deck into the external root as above.

2. Create the room-scoped Stage presentation:

   ```sh
   ant decks add --room ROOM_ID --title "State of Play" --animotion-slug state-of-play --password stage-demo
   ```

3. Open the Stage presentation at `/decks/:deckId?password=stage-demo`.

4. Optionally add the Stage presentation itself to artefacts:

   ```sh
   ant artefact add --room ROOM_ID --kind deck --title "State of Play Stage" --ref-url "/decks/DECK_ID?password=stage-demo" --summary "ANT Stage presentation with live feedback and alternatives"
   ```

The `/d/:slug` route is a static proxy for built deck output. It rewrites
absolute SvelteKit bundle paths so Svelte/Animotion decks can run under the
ANT route prefix.
