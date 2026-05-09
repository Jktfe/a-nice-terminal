<script lang="ts">
  type Kind = 'cli' | 'mcp' | 'web';

  interface InviteResponse {
    invite: {
      id: string;
      label: string;
      kinds: Kind[];
      share: Record<Kind, string>;
    };
  }

  interface Props {
    sessionId: string;
    sessionName: string;
    onClose: () => void;
  }

  const { sessionId, sessionName, onClose }: Props = $props();

  let label = $state('');
  let password = $state('');
  let revealPassword = $state(false);
  let kinds = $state<Record<Kind, boolean>>({ cli: true, mcp: true, web: true });
  let busy = $state(false);
  let error = $state<string | null>(null);
  let result = $state<InviteResponse['invite'] | null>(null);
  let copied = $state<string | null>(null);

  const selectedKinds = $derived(
    (Object.entries(kinds) as Array<[Kind, boolean]>)
      .filter(([, v]) => v)
      .map(([k]) => k),
  );

  async function createInvite(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    busy = true;
    error = null;
    try {
      const trimmedLabel = label.trim();
      if (!trimmedLabel) throw new Error('Label is required');
      if (password.length < 4) throw new Error('Password must be at least 4 characters');
      if (selectedKinds.length === 0) throw new Error('Pick at least one invite kind');

      const res = await fetch(`/api/sessions/${sessionId}/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: trimmedLabel,
          password,
          kinds: selectedKinds,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message || body?.error || `Failed (${res.status})`);
      }
      const data = (await res.json()) as InviteResponse;
      result = data.invite;
      password = '';
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to create invite';
    } finally {
      busy = false;
    }
  }

  async function copy(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value);
      copied = key;
      setTimeout(() => {
        if (copied === key) copied = null;
      }, 1500);
    } catch {
      error = 'Could not copy to clipboard';
    }
  }

  function close() {
    if (busy) return;
    onClose();
  }

  function onBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) close();
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') close();
  }

  const kindHelp: Record<Kind, string> = {
    cli: 'For `ant join-room` from a terminal',
    mcp: 'For MCP-based agent integrations',
    web: 'Opens directly in /remote/[id] (browser/iOS)',
  };
</script>

<svelte:window onkeydown={onKeydown} />

<div
  class="invite-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
  style="background: rgba(0,0,0,0.55);"
  onclick={onBackdropClick}
  onkeydown={(e) => { if (e.key === 'Escape') close(); }}
  role="dialog"
  aria-modal="true"
  aria-label="Invite remote participant"
  tabindex="-1"
>
  <div
    class="invite-sheet w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg shadow-xl"
    style="background: var(--bg-surface); color: var(--text); border: 1px solid var(--border-subtle);"
  >
    <header class="px-5 py-3 border-b flex items-center justify-between" style="border-color: var(--border-subtle);">
      <div>
        <h2 class="text-sm font-semibold">Invite remote participant</h2>
        <p class="text-xs" style="color: var(--text-faint);">to <span class="font-mono">{sessionName}</span></p>
      </div>
      <button
        type="button"
        onclick={close}
        disabled={busy}
        class="px-2 py-1 rounded text-xs"
        style="color: var(--text-muted); background: transparent; border: 0;"
        aria-label="Close"
      >Close</button>
    </header>

    {#if !result}
      <form onsubmit={createInvite} class="px-5 py-4 space-y-3">
        <div>
          <label for="invite-label" class="block text-xs font-medium mb-1" style="color: var(--text-muted);">Label</label>
          <input
            id="invite-label"
            type="text"
            bind:value={label}
            placeholder="Daisy's laptop, mobile review, …"
            class="w-full px-3 py-2 rounded-md text-sm outline-none"
            style="background: var(--bg-card); border: 1px solid var(--border-subtle); color: var(--text);"
            required
          />
        </div>

        <div>
          <label for="invite-password" class="block text-xs font-medium mb-1" style="color: var(--text-muted);">
            Password <span style="color: var(--text-faint);">(min 4 chars — share this out-of-band)</span>
          </label>
          <div class="flex gap-2">
            <input
              id="invite-password"
              type={revealPassword ? 'text' : 'password'}
              bind:value={password}
              autocomplete="new-password"
              minlength="4"
              class="flex-1 px-3 py-2 rounded-md text-sm outline-none font-mono"
              style="background: var(--bg-card); border: 1px solid var(--border-subtle); color: var(--text);"
              required
            />
            <button
              type="button"
              onclick={() => (revealPassword = !revealPassword)}
              class="px-3 py-2 rounded-md text-xs"
              style="background: var(--bg-card); color: var(--text-muted); border: 1px solid var(--border-subtle);"
            >{revealPassword ? 'Hide' : 'Show'}</button>
          </div>
        </div>

        <fieldset>
          <legend class="block text-xs font-medium mb-1" style="color: var(--text-muted);">Invite kinds</legend>
          <div class="space-y-1">
            {#each ['cli', 'mcp', 'web'] as const as k}
              <label class="flex items-start gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  bind:checked={kinds[k]}
                  class="mt-0.5"
                />
                <span>
                  <span class="font-mono font-semibold" style="color: var(--text);">{k}</span>
                  <span style="color: var(--text-faint);"> — {kindHelp[k]}</span>
                </span>
              </label>
            {/each}
          </div>
        </fieldset>

        {#if error}
          <div class="text-xs rounded-md px-3 py-2" style="background: #EF444418; color: #F87171; border: 1px solid #EF444433;">
            {error}
          </div>
        {/if}

        <div class="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onclick={close}
            disabled={busy}
            class="px-3 py-2 rounded-md text-xs font-medium"
            style="background: transparent; color: var(--text-muted); border: 1px solid var(--border-subtle);"
          >Cancel</button>
          <button
            type="submit"
            disabled={busy || selectedKinds.length === 0}
            class="px-3 py-2 rounded-md text-xs font-medium"
            style="background: #6366F1; color: white; border: 0;"
          >{busy ? 'Creating…' : 'Create invite'}</button>
        </div>
      </form>
    {:else}
      <div class="px-5 py-4 space-y-3">
        <p class="text-xs" style="color: var(--text-muted);">
          Share these links with <span class="font-mono">{result.label}</span>. They'll need the password you entered.
        </p>

        {#each result.kinds as k}
          {@const value = result.share[k] ?? ''}
          <div class="space-y-1">
            <div class="flex items-center justify-between">
              <span class="text-xs font-mono font-semibold" style="color: var(--text);">{k}</span>
              <button
                type="button"
                onclick={() => copy(value, k)}
                class="text-xs px-2 py-0.5 rounded"
                style="background: var(--bg-card); color: var(--text-muted); border: 1px solid var(--border-subtle);"
              >{copied === k ? 'Copied' : 'Copy'}</button>
            </div>
            <code
              class="block text-[11px] font-mono break-all rounded-md px-2 py-1.5"
              style="background: var(--bg-card); color: var(--text); border: 1px solid var(--border-subtle);"
            >{value}</code>
          </div>
        {/each}

        <p class="text-[11px] pt-2" style="color: var(--text-faint);">
          Need a QR code? Run <span class="font-mono" style="color: var(--text-muted);">ant qr</span> in a terminal —
          it renders the antios:// deep-link for iOS pairing. Web links above can be sent over any channel.
        </p>

        <div class="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onclick={close}
            class="px-3 py-2 rounded-md text-xs font-medium"
            style="background: #6366F1; color: white; border: 0;"
          >Done</button>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  /* On phones (≤640px) the invite modal becomes a full-width bottom-sheet
     so the form fields, password reveal, and the long share-URL code
     blocks are reachable without horizontal scrolling. Safe-area padding
     keeps the home-indicator from overlapping the Done button. */
  @media (max-width: 640px) {
    .invite-backdrop {
      padding: 0;
      align-items: flex-end;
    }
    .invite-sheet {
      max-width: 100%;
      max-height: 100vh;
      border-radius: 16px 16px 0 0;
      padding-bottom: env(safe-area-inset-bottom, 0px);
    }
  }
</style>
