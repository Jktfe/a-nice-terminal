<script lang="ts">
  import { page } from '$app/state';
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  // Defensive read — server-side test renders can hit this surface
  // before the request scope is wired and `page.error` throws.
  const errorMessage = (() => {
    try { return page.error?.message ?? "We couldn't find that room."; }
    catch { return "We couldn't find that room."; }
  })();
  const status = (() => {
    try { return page.status ?? 500; }
    catch { return 500; }
  })();
  const isNotFound = $derived(status === 404);
  const isDenied = $derived(status === 403);
</script>

<svelte:head>
  <title>Room unavailable | ANT vNext</title>
</svelte:head>

<SimplePageShell
  eyebrow={isNotFound ? 'Room not found' : isDenied ? 'Room access' : `Room error ${status}`}
  title={isNotFound ? 'This room is not here.' : isDenied ? 'You do not have access to this room.' : 'This room could not load.'}
  summary={isNotFound
    ? 'The room may have been deleted, expired, or created in another process.'
    : isDenied
      ? 'Your signed-in account does not have permission to read this room.'
      : 'Your sign-in was kept. Refresh this room or open Rooms to choose another room.'}
>
  <p class="error-detail" role="alert">{errorMessage}</p>
  <a class="back-link" href="/rooms" aria-label="Back to all rooms">
    <span aria-hidden="true">←</span> Back to all rooms
  </a>
</SimplePageShell>

<style>
  .error-detail {
    margin: 0 0 0.85rem;
    padding: 0.85rem 1rem;
    border: 1px solid var(--warn);
    border-radius: 0.85rem;
    color: var(--ink-strong);
    background: color-mix(in srgb, var(--warn) 18%, var(--surface-card));
  }
  .back-link {
    display: inline-block;
    padding: 0.7rem 1rem;
    border: 1px solid var(--line-soft);
    border-radius: 999px;
    color: var(--ink-strong);
    background: var(--surface-card);
    font-weight: 850;
    text-decoration: none;
  }
  .back-link:hover {
    color: var(--accent);
  }
</style>
