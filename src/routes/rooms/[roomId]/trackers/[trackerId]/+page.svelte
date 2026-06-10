<!--
  /rooms/[roomId]/trackers/[trackerId] — standalone passthrough view of one
  tracker (JWPK msg_g4ttgnn65i + msg_go3s64r7q4). Opened from the room's
  artefacts panel so a tracker is findable without scrolling chat. Renders the
  SAME live TrackerTable widget (store-backed), so edits here and edits in the
  inline chat render are the same table.
-->
<script lang="ts">
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import TrackerTable from '$lib/components/TrackerTable.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>{data.tracker.title} · tracker | ANT vNext</title></svelte:head>

<SimplePageShell
  eyebrow="Tracker"
  title={data.tracker.title}
  summary={`${data.tracker.rows.length} row${data.tracker.rows.length === 1 ? '' : 's'} · live, collaborative, audited.`}
>
  <a class="back" href={`/rooms/${encodeURIComponent(data.roomId)}`}>← Back to room</a>
  <div class="tracker-host">
    <TrackerTable trackerId={data.trackerId} roomId={data.roomId} initialTracker={data.tracker} />
  </div>
</SimplePageShell>

<style>
  .back { display: inline-block; margin-bottom: 1rem; color: var(--ink-soft); font-weight: 700; }
  .tracker-host { margin-top: 0.5rem; }
</style>
