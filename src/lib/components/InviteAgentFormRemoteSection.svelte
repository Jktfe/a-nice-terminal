<!--
  InviteAgentFormRemoteSection — collapsible "Invite a remote agent"
  block carved out of InviteAgentForm so the parent stays under the
  600-line component cap.

  JWPK msg_tw6ucsckfw + msg_jp9ncn9av2: v3-lift remote-invite UX.
  Label + password + multi-kind selection (cli / mcp / web). The
  operator hands the password out-of-band and the share string the
  joiner-end uses (e.g. a web URL for browser join, an ant:// link
  for CLI). Backed by the operator-only browser endpoint
  /api/chat-rooms/[roomId]/operator-invites which wraps the existing
  chatInviteStore (admin-bearer /api/chat-invites stays for CLI /
  external automation).
-->
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
  };

  let { roomId }: Props = $props();

  let remoteLabel = $state('');
  let remotePassword = $state('');
  let revealRemotePassword = $state(false);
  let remoteKinds = $state<Record<InviteKind, boolean>>({ cli: true, mcp: true, web: true });
  let mintingRemote = $state(false);
  let mintedInvite = $state<RemoteInvite | null>(null);
  let remoteMintError = $state('');
  let copiedKind = $state<InviteKind | null>(null);

  const selectedRemoteKinds = $derived(
    (Object.entries(remoteKinds) as Array<[InviteKind, boolean]>)
      .filter(([, on]) => on)
      .map(([kind]) => kind)
  );

  const KIND_HELP: Record<InviteKind, string> = {
    cli: 'For `ant join-room` on a remote terminal.',
    mcp: 'For MCP-based agent integrations.',
    web: 'Opens directly in the browser — no install required.'
  };

  async function mintRemoteInvite(): Promise<void> {
    mintingRemote = true;
    remoteMintError = '';
    try {
      if (remoteLabel.trim().length === 0) throw new Error('Give the invite a label.');
      if (remotePassword.length < 4) throw new Error('Password must be at least 4 characters.');
      if (selectedRemoteKinds.length === 0) throw new Error('Pick at least one kind.');

      const response = await fetch(
        `/api/chat-rooms/${encodeURIComponent(roomId)}/operator-invites`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            label: remoteLabel.trim(),
            password: remotePassword,
            kinds: selectedRemoteKinds
          })
        }
      );
      if (!response.ok) {
        const failure = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(failure.message ?? 'Could not mint invite.');
      }
      const payload = (await response.json()) as { invite: RemoteInvite };
      mintedInvite = payload.invite;
      // Wipe the password from memory once minting succeeds — the operator
      // already saw it; storing it longer is just risk.
      remotePassword = '';
    } catch (cause) {
      remoteMintError = cause instanceof Error ? cause.message : 'Could not mint invite.';
    } finally {
      mintingRemote = false;
    }
  }

  async function copyShareString(kind: InviteKind, value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      copiedKind = kind;
      setTimeout(() => {
        if (copiedKind === kind) copiedKind = null;
      }, 1500);
    } catch {
      /* clipboard refused — user can hand-copy from the visible field */
    }
  }

  function resetRemoteFlow(): void {
    mintedInvite = null;
    remoteMintError = '';
    copiedKind = null;
    remoteLabel = '';
    remotePassword = '';
    revealRemotePassword = false;
    remoteKinds = { cli: true, mcp: true, web: true };
  }
</script>

<details class="remote-invite-section">
  <summary>
    <span class="remote-summary-text">Invite a remote agent</span>
    <span class="remote-chevron" aria-hidden="true">▾</span>
  </summary>
  <div class="remote-body">
    {#if mintedInvite}
      <div class="remote-result" role="status">
        <p class="remote-result-intro">
          Share the link AND the password with <strong>{mintedInvite.label}</strong> —
          they need both to join.
        </p>
        {#each mintedInvite.kinds as kind (kind)}
          {@const value = mintedInvite.share[kind] ?? ''}
          <div class="remote-share-row">
            <div class="remote-share-header">
              <span class="remote-share-kind">{kind}</span>
              <button
                type="button"
                class="remote-copy-btn"
                onclick={() => void copyShareString(kind, value)}
              >{copiedKind === kind ? 'Copied ✓' : 'Copy'}</button>
            </div>
            <code class="remote-share-value">{value}</code>
          </div>
        {/each}
        <button type="button" class="remote-reset-btn" onclick={resetRemoteFlow}>
          Mint another invite
        </button>
      </div>
    {:else}
      <p class="remote-explainer">
        Set a label so this invite is easy to track, pick a password to share out-of-band,
        and choose how the joiner connects.
      </p>
      <form
        class="remote-mint-form"
        onsubmit={(e) => { e.preventDefault(); void mintRemoteInvite(); }}
      >
        <label class="remote-field-label" for="remote-label-{roomId}">Label</label>
        <input
          id="remote-label-{roomId}"
          type="text"
          class="remote-text-input"
          bind:value={remoteLabel}
          placeholder="e.g. Daisy's laptop"
          maxlength="120"
          required
          disabled={mintingRemote}
        />

        <label class="remote-field-label" for="remote-password-{roomId}">
          Password <span class="remote-field-hint">(min 4 chars, share out-of-band)</span>
        </label>
        <div class="remote-password-row">
          <input
            id="remote-password-{roomId}"
            type={revealRemotePassword ? 'text' : 'password'}
            class="remote-text-input"
            bind:value={remotePassword}
            autocomplete="new-password"
            minlength="4"
            required
            disabled={mintingRemote}
          />
          <button
            type="button"
            class="remote-reveal-btn"
            onclick={() => { revealRemotePassword = !revealRemotePassword; }}
            disabled={mintingRemote}
          >{revealRemotePassword ? 'Hide' : 'Show'}</button>
        </div>

        <fieldset class="remote-kinds-fieldset" disabled={mintingRemote}>
          <legend class="remote-field-label">Join how?</legend>
          {#each (['web', 'cli', 'mcp'] as const) as kind (kind)}
            <label class="remote-kind-row">
              <input
                type="checkbox"
                bind:checked={remoteKinds[kind]}
                disabled={mintingRemote}
              />
              <span class="remote-kind-text">
                <strong>{kind}</strong>
                <span class="remote-kind-help">— {KIND_HELP[kind]}</span>
              </span>
            </label>
          {/each}
        </fieldset>

        <button
          type="submit"
          class="remote-mint-btn"
          disabled={mintingRemote || selectedRemoteKinds.length === 0}
        >
          {mintingRemote ? 'Minting…' : 'Mint invite'}
        </button>
        {#if remoteMintError}
          <p class="remote-error" role="alert">{remoteMintError}</p>
        {/if}
      </form>
    {/if}
  </div>
</details>

<style>
  .remote-invite-section {
    margin-top: 0.5rem;
    padding-top: 0.85rem;
    border-top: 1px solid var(--surface-edge);
  }
  .remote-invite-section summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.4rem;
    padding: 0.2rem 0;
    cursor: pointer;
    list-style: none;
    color: var(--ink-strong);
    font-weight: 700;
    font-size: 0.92rem;
  }
  .remote-invite-section summary::-webkit-details-marker { display: none; }
  .remote-summary-text {
    flex: 1;
  }
  .remote-chevron {
    color: var(--ink-soft);
    font-size: 0.85rem;
    transition: transform 180ms ease;
  }
  .remote-invite-section[open] .remote-chevron {
    transform: rotate(180deg);
  }
  .remote-body {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    margin-top: 0.55rem;
  }
  .remote-explainer,
  .remote-result-intro {
    margin: 0;
    color: var(--ink-soft);
    font-size: 0.85rem;
    line-height: 1.45;
  }
  .remote-mint-form {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .remote-field-label {
    font-size: 0.82rem;
    font-weight: 700;
    color: var(--ink);
  }
  .remote-field-hint {
    font-weight: 500;
    color: var(--ink-soft);
  }
  .remote-text-input {
    padding: 0.55rem 0.7rem;
    border: 1px solid var(--surface-edge);
    border-radius: 0.5rem;
    background: var(--bg);
    color: var(--ink-strong);
    font-size: 0.92rem;
  }
  .remote-text-input:focus {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .remote-password-row {
    display: flex;
    gap: 0.4rem;
  }
  .remote-password-row .remote-text-input {
    flex: 1;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
  }
  .remote-reveal-btn {
    padding: 0 0.85rem;
    border: 1px solid var(--surface-edge);
    border-radius: 0.5rem;
    background: var(--bg);
    color: var(--ink-strong);
    font-size: 0.82rem;
    font-weight: 700;
    cursor: pointer;
  }
  .remote-reveal-btn:hover { border-color: var(--accent); color: var(--accent); }
  .remote-kinds-fieldset {
    margin: 0;
    padding: 0;
    border: none;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .remote-kind-row {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 0.3rem 0.1rem;
    cursor: pointer;
  }
  .remote-kind-row input[type='checkbox'] {
    margin-top: 0.18rem;
  }
  .remote-kind-text {
    font-size: 0.85rem;
    color: var(--ink-strong);
  }
  .remote-kind-text strong {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 0.82rem;
  }
  .remote-kind-help {
    color: var(--ink-soft);
  }
  .remote-mint-btn {
    align-self: flex-start;
    margin-top: 0.3rem;
    padding: 0.55rem 1rem;
    border: none;
    border-radius: 999px;
    background: var(--accent);
    color: white;
    font-weight: 800;
    font-size: 0.88rem;
    cursor: pointer;
  }
  .remote-mint-btn:disabled { opacity: 0.55; cursor: not-allowed; }
  .remote-error {
    margin: 0;
    color: var(--accent);
    font-size: 0.82rem;
  }
  .remote-result {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem 0.85rem;
    border: 1px solid var(--accent);
    border-radius: 0.55rem;
    background: color-mix(in srgb, var(--accent) 6%, transparent);
  }
  .remote-share-row {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .remote-share-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .remote-share-kind {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 0.78rem;
    font-weight: 800;
    color: var(--ink-strong);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .remote-share-value {
    display: block;
    padding: 0.5rem 0.65rem;
    border: 1px solid var(--surface-edge);
    border-radius: 0.45rem;
    background: var(--bg);
    color: var(--ink-strong);
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 0.78rem;
    word-break: break-all;
  }
  .remote-copy-btn {
    padding: 0.55rem 0.95rem;
    border: 1px solid var(--accent);
    border-radius: 999px;
    background: var(--surface-card);
    color: var(--accent);
    font-weight: 800;
    font-size: 0.82rem;
    cursor: pointer;
  }
  .remote-copy-btn:hover { background: var(--accent); color: white; }
  .remote-reset-btn {
    align-self: flex-start;
    padding: 0.35rem 0.8rem;
    border: 1px solid var(--line-soft);
    border-radius: 999px;
    background: transparent;
    color: var(--ink-strong);
    font-size: 0.78rem;
    font-weight: 700;
    cursor: pointer;
  }
  .remote-reset-btn:hover { border-color: var(--accent); color: var(--accent); }
</style>
