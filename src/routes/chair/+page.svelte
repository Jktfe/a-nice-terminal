<!--
  Chair route — the always-on view that watches every room.
  Backs M29 chair session-tracker slice 1.

  Heuristic digests for now (counts + freshness + simple attention rules).
  Slice 2 swaps to a cheap-model LLM digest using GLM/Kimi/Haiku.

  The page is read-only on first paint; the refresh button reloads the
  SvelteKit page data via invalidateAll() so the server-rendered HTML
  always carries the freshest rows on first response.

  Chair-rename slice 2b optionality branch: when chairEnabledStore is
  false (set via PUT /api/chair-enabled), render a disabled-state notice
  instead of the ChairBoard. Default-true so first boot still renders.
-->
<script lang="ts">
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import Explainable from '$lib/components/Explainable.svelte';
  import ChairBoard from '$lib/components/ChairBoard.svelte';
  import ChairRoomNotesPanel from '$lib/components/ChairRoomNotesPanel.svelte';
  import type { ChairRowDigest } from '$lib/server/chairStore';
  import type { ChairDigestNote } from '$lib/server/chairDigestNoteStore';
  import { invalidateAll } from '$app/navigation';

  type Props = {
    data: {
      digestRowsFromServer: ChairRowDigest[];
      notesFromServer: ChairDigestNote[];
      digestFetchFailed: boolean;
      chairEnabled: boolean;
      refreshedAt: string;
    };
  };

  let { data }: Props = $props();

  // Render server-loaded values directly so first SSR HTML contains the
  // real digest rows + notes. $derived tracks page-data updates from
  // invalidateAll().
  const digestRows = $derived<ChairRowDigest[]>(data.digestRowsFromServer);
  const chairNotes = $derived<ChairDigestNote[]>(data.notesFromServer ?? []);
  const chairEnabled = $derived<boolean>(data.chairEnabled);
  const refreshedAt = $derived<string>(data.refreshedAt);

  // Room-name lookup derives from digestRows so notes show the readable
  // name. If a note references a room absent from the current digest
  // (rare — possible after a deletion), the panel falls back to roomId.
  const roomNameByRoomId = $derived<Record<string, string>>(
    Object.fromEntries(digestRows.map((row) => [row.roomId, row.roomName]))
  );

  async function refreshFromServer() {
    await invalidateAll();
  }
</script>

<svelte:head>
  <title>Chair | ANT vNext</title>
</svelte:head>

<SimplePageShell
  eyebrow="Chair"
  title="One screen for every room."
  summary="The chair watches every room and surfaces the digest plus a needs-attention flag. Slice 1 uses heuristic digests; cheap-model LLM digests land in slice 2."
>
  {#if !chairEnabled}
    <p class="chair-disabled" role="note">
      ANT Chair is disabled in settings. Re-enable via:
      <code>PUT /api/chair-enabled</code> with body
      <code>{'{"enabled":true}'}</code>.
    </p>
  {:else if data.digestFetchFailed}
    <p class="chair-error" role="alert">
      Could not load the chair digest from the server.
    </p>
  {:else}
    <ChairRoomNotesPanel notes={chairNotes} {roomNameByRoomId} />
    <ChairBoard {digestRows} {refreshedAt} onRefreshRequested={refreshFromServer} />
  {/if}
</SimplePageShell>

<style>
  .chair-disabled {
    margin: 0 0 0.85rem;
    padding: 0.85rem 1rem;
    border: 1px solid var(--surface-edge);
    border-radius: 0.85rem;
    color: var(--ink-soft);
    background: var(--surface);
    font-size: 0.92rem;
  }
  .chair-disabled code {
    background: var(--bg);
    padding: 0.05rem 0.35rem;
    border-radius: 0.3rem;
    font-size: 0.9em;
  }
  .chair-error {
    margin: 0 0 0.85rem;
    padding: 0.85rem 1rem;
    border: 1px solid var(--warn);
    border-radius: 0.85rem;
    color: var(--ink-strong);
    background: color-mix(in srgb, var(--warn) 18%, var(--surface-card));
    font-weight: 800;
  }
</style>
