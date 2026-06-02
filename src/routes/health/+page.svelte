<!--
  /health — dedicated route for the read-only room-identity health surface.

  Renders the existing RoomHealthPanel (which fetches /api/room-health itself)
  inside the standard SimplePageShell chrome, matching the /settings pattern
  (eyebrow + title in the intro, the panel in the body). Minimal by design:
  no load function, no nav link (deferred).
-->
<script lang="ts">
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import RoomHealthPanel from '$lib/components/RoomHealthPanel.svelte';
</script>

<svelte:head>
  <title>Room health | ANT vNext</title>
</svelte:head>

<SimplePageShell
  eyebrow="Diagnostics"
  title="Room health."
  summary="Per-terminal room-identity health. Green when the identity invariant chain holds; amber/red with the specific reason when a link is broken — see drift before it becomes a 403."
>
  <RoomHealthPanel />
</SimplePageShell>
