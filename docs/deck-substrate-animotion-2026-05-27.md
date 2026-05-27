# Deck Substrate: Animotion Primary

ANT Stage decks are room-scoped ANT records backed by an external built deck
folder.

## Boundaries

- ANT stores the deck metadata in the room: title, room id, password, slides
  JSON, and `theme`.
- Animotion is the primary live deck substrate. A deck row points to it with
  `theme=animotion:<slug>`.
- Open-Slide remains a compatibility substrate with
  `theme=open-slide:<slug>`.
- Built deck folders live outside this repository. Do not commit generated
  deck source or `dist/` output into `a-nice-terminal`.
- The server finds built decks from `ANT_BUILT_DECKS_ROOTS`, falling back to
  `~/CascadeProjects/ANT-Decks` and then
  `~/CascadeProjects/ANT-Open-Slide`.

## Operator Flow

1. Build the deck into an external folder such as
   `~/CascadeProjects/ANT-Decks/state-of-play/dist`.
2. Create the room-scoped Stage deck:

   ```sh
   ant decks add --room ROOM_ID --title "State of Play" --animotion-slug state-of-play --password stage-demo
   ```

3. Open the Stage deck at `/decks/:deckId?password=stage-demo`.

The `/d/:slug` route is a static proxy for built deck output. It rewrites
absolute SvelteKit bundle paths so Svelte/Animotion decks can run under the
ANT route prefix.
