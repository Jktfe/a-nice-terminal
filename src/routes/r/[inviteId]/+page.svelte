<!--
  B2-2 read-only invite landing /r/[inviteId] — external-colleague
  browser-accept surface. No ANT chrome (root layout is already bare).
  Session-less by design: the colleague has no ANT cookie; the invite id
  + password are the whole auth. tokenSecret is used ONLY for the
  immediate join-with-token call — never rendered, logged, or stored.
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let password = $state('');
  let handle = $state('');
  let busy = $state(false);
  // 401 and 403 carry deliberately distinct copy (A6 vs A8); collapse
  // everything else into the generic message — never leak which.
  let errorMsg = $state<string | null>(null);

  const summary = $derived(data.summary);
  const usable = $derived(summary !== null && summary.revoked === false);

  async function join(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!summary || busy) return;
    errorMsg = null;
    busy = true;
    try {
      const exRes = await fetch(
        `/api/chat-invites/${encodeURIComponent(data.inviteId)}/exchange`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ password, kind: 'web', handle })
        }
      );
      if (exRes.status === 403) {
        errorMsg =
          "That handle isn't on this invite's allowlist. Use a permitted handle or ask the inviter to add yours.";
        return;
      }
      if (!exRes.ok) {
        errorMsg = "This invite can't be used (wrong password, revoked, or expired).";
        return;
      }
      const { tokenSecret } = (await exRes.json()) as { tokenSecret: string };
      const joinRes = await fetch(
        `/api/chat-rooms/${encodeURIComponent(summary.roomId)}/join-with-token`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tokenSecret })
        }
      );
      if (!joinRes.ok) {
        errorMsg = "This invite can't be used (wrong password, revoked, or expired).";
        return;
      }
      await goto(`/rooms/${encodeURIComponent(summary.roomId)}`);
    } catch {
      errorMsg = 'Something went wrong reaching the server. Please try again.';
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Join chat · ANT</title></svelte:head>

<main id="main-content" class="wrap">
  <div class="card">
    {#if !usable}
      <h1>Invite unavailable</h1>
      <p class="muted">
        This invite link can't be used — it may not exist, or it's been
        revoked. Ask whoever shared it for a fresh link.
      </p>
    {:else}
      <h1>Join “{summary?.label}”</h1>
      <p class="muted">
        Enter the invite password and choose the handle you'll appear as
        in the room.
      </p>
      <form onsubmit={join}>
        <label for="pw">Invite password</label>
        <input
          id="pw"
          type="password"
          autocomplete="off"
          bind:value={password}
          required
          disabled={busy}
        />
        <label for="hd">Your handle</label>
        <input
          id="hd"
          type="text"
          autocomplete="off"
          placeholder="e.g. alex"
          bind:value={handle}
          required
          disabled={busy}
        />
        {#if errorMsg}
          <p class="err" role="alert">{errorMsg}</p>
        {/if}
        <button type="submit" disabled={busy || password === '' || handle === ''}>
          {busy ? 'Joining…' : 'Join room'}
        </button>
      </form>
    {/if}
  </div>
</main>

<style>
  .wrap {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    background: var(--surface-app);
  }
  .card {
    width: 100%;
    max-width: 24rem;
    background: var(--surface-card);
    border: 1px solid var(--line-soft);
    border-radius: 0.9rem;
    box-shadow: var(--shadow-card);
    padding: 1.75rem;
  }
  h1 {
    margin: 0 0 0.5rem;
    font-size: 1.3rem;
    color: var(--ink-strong);
  }
  .muted {
    margin: 0 0 1.25rem;
    color: var(--ink-muted);
    font-size: 0.9rem;
    line-height: 1.45;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  label {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--ink-soft);
    margin-top: 0.5rem;
  }
  input {
    padding: 0.6rem 0.7rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.5rem;
    background: var(--surface-raised);
    color: var(--ink-strong);
    font-size: 0.95rem;
  }
  input:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .err {
    margin: 0.75rem 0 0;
    color: var(--accent-strong);
    font-size: 0.85rem;
    line-height: 1.4;
  }
  button {
    margin-top: 1.1rem;
    padding: 0.65rem 1rem;
    border: 0;
    border-radius: 0.5rem;
    background: var(--accent);
    color: var(--surface-card);
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
</style>
