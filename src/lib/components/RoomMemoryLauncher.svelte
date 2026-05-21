<!--
  RoomMemoryLauncher — in-room entry point for memory recall, scoped to
  this room (M22 family / memory-recall slice 10).

  PURE FORM. URL-DRIVEN NAVIGATION ONLY. There is no JS state, no fetch,
  no invalidateAll, no store imports, no endpoint imports, no callbacks
  (per @evolveantcodex slice 10 guardrails). Submitting the form is a
  plain GET to /memory with q and roomId fields, which lands on the
  accepted slice 9 scoped-recall UI (Scoped to <Room> banner + Clear
  scope link + scoped hit list).

  Audit-note on copied form pattern:
  Copied-from src/routes/memory/+page.svelte (memory-recall UI slice 2,
  the existing search form at the top of the /memory route)
  Verdict: KEEP — same labelled-form pattern; the launcher just adds a
  hidden roomId input to scope the navigation to this specific room.

  Per @evolveantcodex slice 10 guardrails:
    - Pure form/navigation only — no fetch, no invalidateAll, no state.
    - Real accessible label on the search input.
    - Labelled section with a visible heading.
    - Hidden roomId field carries the current room id.
    - Empty-input submit lands on /memory?q=&roomId=<this-room> which
      the accepted slice 9 UI handles via the empty-query state.
-->
<script lang="ts">
  type Props = { roomId: string };
  let { roomId }: Props = $props();
</script>

<section
  class="memory-launcher"
  aria-labelledby="room-memory-heading"
>
  <h2 id="room-memory-heading" class="heading">Memory recall in this room</h2>
  <form method="GET" action="/memory" class="launcher-form">
    <input type="hidden" name="roomId" value={roomId} />
    <label for="roomMemoryField" class="visually-hidden">
      Search this room's memory
    </label>
    <input
      id="roomMemoryField"
      name="q"
      type="search"
      autocomplete="off"
      placeholder="Search this room's memory…"
      class="search-input"
    />
    <button type="submit" class="primary">Search</button>
  </form>
  <form method="GET" action="/memory" class="launcher-form secondary">
    <input type="hidden" name="roomId" value={roomId} />
    <input type="hidden" name="longMemory" value="1" />
    <label for="roomLongMemoryField" class="visually-hidden">
      Search this room's long memory
    </label>
    <input
      id="roomLongMemoryField"
      name="q"
      type="search"
      autocomplete="off"
      placeholder="Search before the latest break…"
      class="search-input"
    />
    <button type="submit" class="secondary-button">Long memory</button>
  </form>
</section>

<style>
  .memory-launcher {
    margin-top: 1rem;
    padding: 0.9rem 1rem;
    border: 1px solid var(--surface-edge);
    border-radius: 0.7rem;
    background: var(--surface);
  }
  .heading {
    margin: 0 0 0.55rem;
    font-size: 1rem;
    color: var(--ink-strong);
  }
  .launcher-form {
    display: flex;
    gap: 0.5rem;
  }
  .launcher-form.secondary { margin-top: 0.5rem; }
  .search-input {
    flex: 1;
    padding: 0.5rem 0.7rem;
    font-size: 0.95rem;
    border: 1px solid var(--surface-edge);
    border-radius: 0.5rem;
    background: var(--bg);
    color: var(--ink-strong);
  }
  .search-input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  button.primary {
    padding: 0.5rem 1.05rem;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 999px;
    font-weight: 700;
    cursor: pointer;
  }
  .secondary-button {
    padding: 0.5rem 1.05rem;
    background: var(--surface-card);
    color: var(--ink-strong);
    border: 1px solid var(--surface-edge);
    border-radius: 999px;
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
  }
  .secondary-button:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
