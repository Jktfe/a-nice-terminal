<script lang="ts">
  type InviteKind = 'cli' | 'mcp' | 'web';
  type RemoteInvite = {
    id: string;
    label: string;
    kinds: InviteKind[];
    share: Record<InviteKind, string>;
  };

  type Props = {
    roomId: string;
    onClose: () => void;
  };

  let { roomId, onClose }: Props = $props();

  let label = $state('');
  let password = $state('');
  let revealPassword = $state(false);
  let kinds = $state<Record<InviteKind, boolean>>({ web: true, cli: true, mcp: false });
  let busy = $state(false);
  let errorMessage = $state('');
  let invite = $state<RemoteInvite | null>(null);
  let copiedKind = $state<InviteKind | null>(null);

  const selectedKinds = $derived((Object.entries(kinds) as Array<[InviteKind, boolean]>)
    .filter(([, enabled]) => enabled).map(([kind]) => kind));

  const kindHelp: Record<InviteKind, string> = {
    web: 'Browser join link for colleagues.',
    cli: 'Terminal join link for antchat or ant CLI.',
    mcp: 'MCP integration link for tool clients.'
  };

  async function createInvite(): Promise<void> {
    if (busy) return;
    busy = true;
    errorMessage = '';
    try {
      validateForm();
      const response = await postInvite();
      invite = response.invite;
      password = '';
    } catch (cause) {
      errorMessage = cause instanceof Error ? cause.message : 'Could not create invite.';
    } finally {
      busy = false;
    }
  }

  function validateForm(): void {
    if (label.trim().length === 0) throw new Error('Label is required.');
    if (password.length < 4) throw new Error('Password must be at least 4 characters.');
    if (selectedKinds.length === 0) throw new Error('Pick at least one access kind.');
  }

  async function postInvite(): Promise<{ invite: RemoteInvite }> {
    const response = await fetch(`/api/chat-rooms/${encodeURIComponent(roomId)}/operator-invites`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: label.trim(), password, kinds: selectedKinds })
    });
    if (!response.ok) {
      const failure = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(failure.message ?? 'Could not create invite.');
    }
    return (await response.json()) as { invite: RemoteInvite };
  }

  async function copyShare(kind: InviteKind, value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      copiedKind = kind;
      setTimeout(() => {
        if (copiedKind === kind) copiedKind = null;
      }, 1600);
    } catch {
      errorMessage = 'Could not copy to clipboard.';
    }
  }

  function resetInvite(): void {
    label = '';
    password = '';
    revealPassword = false;
    kinds = { web: true, cli: true, mcp: false };
    invite = null;
    copiedKind = null;
    errorMessage = '';
  }

  function closeIfBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget && !busy) onClose();
  }
</script>

<svelte:window onkeydown={(event) => { if (event.key === 'Escape' && !busy) onClose(); }} />

<div
  class="backdrop"
  role="dialog"
  aria-modal="true"
  aria-labelledby="remoteInviteTitle"
  tabindex="-1"
  onclick={closeIfBackdrop}
  onkeydown={(event) => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget && !busy) onClose();
  }}
>
  <section class="modal">
    <header>
      <div>
        <h2 id="remoteInviteTitle">Invite remote ANT</h2>
        <p>Choose access, mint links, share the password out-of-band.</p>
      </div>
      <button type="button" class="ghost" onclick={onClose} disabled={busy}>Close</button>
    </header>

    {#if invite}
      <div class="content">
        <p class="hint">Share the selected link with <strong>{invite.label}</strong>. They also need the password.</p>
        {#each invite.kinds as kind (kind)}
          {@const value = invite.share[kind] ?? ''}
          <div class="share-block">
            <div class="share-head">
              <span>{kind}</span>
              <button type="button" onclick={() => void copyShare(kind, value)}>{copiedKind === kind ? 'Copied' : 'Copy'}</button>
            </div>
            <code>{value}</code>
          </div>
        {/each}
        <div class="actions">
          <button type="button" class="secondary" onclick={resetInvite}>Mint another</button>
          <button type="button" class="primary" onclick={onClose}>Done</button>
        </div>
      </div>
    {:else}
      <form class="content" onsubmit={(event) => { event.preventDefault(); void createInvite(); }}>
        <label for="remoteInviteLabel">Label</label>
        <input id="remoteInviteLabel" type="text" bind:value={label} placeholder="Alex laptop" maxlength="120" disabled={busy} required />

        <label for="remoteInvitePassword">Password</label>
        <div class="password-row">
          <input
            id="remoteInvitePassword"
            type={revealPassword ? 'text' : 'password'}
            bind:value={password}
            autocomplete="new-password"
            minlength="4"
            disabled={busy}
            required
          />
          <button type="button" class="secondary" onclick={() => (revealPassword = !revealPassword)}>{revealPassword ? 'Hide' : 'Show'}</button>
        </div>

        <fieldset disabled={busy}>
          <legend>Access</legend>
          {#each (['web', 'cli', 'mcp'] as const) as kind (kind)}
            <label class="kind-row">
              <input type="checkbox" bind:checked={kinds[kind]} />
              <span><strong>{kind}</strong> - {kindHelp[kind]}</span>
            </label>
          {/each}
        </fieldset>

        {#if errorMessage}
          <p class="error" role="alert">{errorMessage}</p>
        {/if}

        <div class="actions">
          <button type="button" class="secondary" onclick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" class="primary" disabled={busy || selectedKinds.length === 0}>
            {busy ? 'Creating...' : 'Create invite'}
          </button>
        </div>
      </form>
    {/if}
  </section>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    background: rgba(10, 12, 18, 0.58);
  }
  .modal {
    width: min(34rem, 100%);
    max-height: 92vh;
    overflow-y: auto;
    border: 1px solid var(--surface-edge);
    border-radius: 0.9rem;
    background: var(--surface-card);
    box-shadow: var(--shadow-card);
  }
  header, .content { padding: 1rem 1.1rem; }
  header {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    border-bottom: 1px solid var(--line-soft);
  }
  h2 { margin: 0; color: var(--ink-strong); font-size: 1.05rem; }
  p { margin: 0.25rem 0 0; color: var(--ink-soft); font-size: 0.86rem; }
  .content { display: flex; flex-direction: column; gap: 0.65rem; }
  label, legend { color: var(--ink); font-size: 0.82rem; font-weight: 800; }
  input {
    min-width: 0;
    padding: 0.62rem 0.72rem;
    border: 1px solid var(--surface-edge);
    border-radius: 0.5rem;
    background: var(--bg);
    color: var(--ink-strong);
    font: inherit;
  }
  input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  .password-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0.45rem; }
  fieldset { margin: 0; padding: 0; border: 0; display: grid; gap: 0.35rem; }
  .kind-row { display: flex; align-items: flex-start; gap: 0.5rem; font-weight: 500; }
  .kind-row input { margin-top: 0.1rem; }
  .share-block { display: grid; gap: 0.3rem; }
  .share-head { display: flex; justify-content: space-between; gap: 0.5rem; align-items: center; }
  .share-head span { font: 800 0.78rem 'JetBrains Mono', ui-monospace, monospace; text-transform: uppercase; }
  code {
    display: block;
    padding: 0.55rem 0.65rem;
    border: 1px solid var(--surface-edge);
    border-radius: 0.45rem;
    background: var(--bg);
    color: var(--ink-strong);
    font: 0.78rem 'JetBrains Mono', ui-monospace, monospace;
    word-break: break-all;
  }
  .actions { display: flex; justify-content: flex-end; gap: 0.55rem; margin-top: 0.25rem; }
  button { border-radius: 999px; padding: 0.55rem 0.9rem; font-weight: 800; cursor: pointer; }
  .primary { border: 0; background: var(--accent); color: white; }
  .secondary, .ghost, .share-head button {
    border: 1px solid var(--surface-edge);
    background: transparent;
    color: var(--ink-strong);
  }
  button:disabled { opacity: 0.55; cursor: not-allowed; }
  .error { color: var(--accent); }
  @media (max-width: 640px) {
    .backdrop { align-items: flex-end; padding: 0; }
    .modal { width: 100%; border-radius: 0.9rem 0.9rem 0 0; }
  }
</style>
