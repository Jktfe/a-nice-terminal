<!--
  ChairRoomNotesPanel — shows every active per-room digest note.
  Backs M29 chair session-tracker slice 3 (display).

  Slice 3 ships DISPLAY ONLY. Notes are written via the M29 slice 2
  PUT /api/chair/notes/[roomId] endpoint (already accepted baseline).
  A later slice will add an inline edit form and the cheap-model LLM
  writer hook.

  Pure render — no fetch, no state, no mutation. Pairs each note with
  the room name resolved from the chair digest rows. If a note
  somehow references a room that is not in the current digest snapshot
  (rare, possible after a room rename or delete) the roomId is shown
  as a safe fallback so the panel never throws.
-->
<script lang="ts">
  import type { ChairDigestNote } from '$lib/server/chairDigestNoteStore';

  type Props = {
    notes: ChairDigestNote[];
    roomNameByRoomId: Record<string, string>;
  };

  let { notes, roomNameByRoomId }: Props = $props();

  function describeSetAt(setAt: string): string {
    const moment = new Date(setAt);
    if (Number.isNaN(moment.getTime())) return setAt;
    return moment.toLocaleString();
  }

  function describeRoomFor(note: ChairDigestNote): string {
    const matchingRoomName = roomNameByRoomId[note.roomId];
    return matchingRoomName ?? note.roomId;
  }
</script>

{#if notes.length > 0}
  <section class="notes-panel" aria-label="Active chair notes">
    <header class="panel-header">
      <span class="header-eyebrow">Chair notes</span>
      <span class="header-count">{notes.length}</span>
    </header>
    <p class="panel-blurb">
      Per-room notes written by the chair. Each note is the freshest
      thought attached to that room; setting a new note replaces the old.
    </p>
    <ul class="note-list">
      {#each notes as note (note.roomId)}
        <li class="note-row">
          <div class="row-top">
            <span class="room-name">{describeRoomFor(note)}</span>
            <span class="set-at">Set {describeSetAt(note.setAt)}</span>
          </div>
          <p class="note-text">{note.noteText}</p>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .notes-panel {
    margin: 0 0 1rem;
    padding: 0.95rem 1.1rem;
    border: 1px solid var(--accent);
    border-radius: 0.75rem;
    background: color-mix(in srgb, var(--accent) 8%, var(--surface));
  }

  .panel-header {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    margin-bottom: 0.35rem;
  }

  .header-eyebrow {
    font-weight: 700;
    text-transform: uppercase;
    font-size: 0.75rem;
    letter-spacing: 0.05em;
    color: var(--accent);
  }

  .header-count {
    font-size: 0.8rem;
    background: var(--bg);
    border: 1px solid var(--surface-edge);
    border-radius: 999px;
    padding: 0 0.5rem;
    color: var(--ink-soft);
  }

  .panel-blurb {
    margin: 0 0 0.55rem;
    color: var(--ink-soft);
    font-size: 0.9rem;
  }

  .note-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }

  .note-row {
    padding: 0.6rem 0.7rem;
    background: var(--bg);
    border: 1px solid var(--surface-edge);
    border-radius: 0.55rem;
  }

  .row-top {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.55rem;
    margin-bottom: 0.25rem;
  }

  .room-name {
    font-weight: 800;
    color: var(--ink-strong);
  }

  .set-at {
    font-size: 0.75rem;
    color: var(--ink-soft);
    font-variant-numeric: tabular-nums;
    margin-left: auto;
  }

  .note-text {
    margin: 0;
    color: var(--ink);
    line-height: 1.45;
  }
</style>
