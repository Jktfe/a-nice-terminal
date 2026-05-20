<!--
  InviteAgentForm — invite an agent (or human) into a chat room.
  Wireframe board UK7Pq in antv5-wireframes.pen (Claude lane, x=-6200 y=1200).

  Five states the form moves through:
    1. emptyComposerWaitingForHandle
    2. handleBeingTyped
    3. submittingToServer
    4. invitedSuccessfully
    5. failedToInvite
-->
<script lang="ts">
  import { onMount } from 'svelte';

  type FormState =
    | 'emptyComposerWaitingForHandle'
    | 'handleBeingTyped'
    | 'submittingToServer'
    | 'invitedSuccessfully'
    | 'failedToInvite';

  type Props = {
    roomId: string;
    onAgentInvited?: (newAgentHandle: string) => void;
    /** Handles already in this room. The local-invite picker filters
     *  these out per JWPK msg_p40dikqhvl ("exclude agents that are
     *  already in the room"). Optional — when omitted no filtering
     *  happens (back-compat for callers that don't yet thread it). */
    existingMemberHandles?: string[];
  };

  let { roomId, onAgentInvited, existingMemberHandles = [] }: Props = $props();

  // Normalise the existing-members handle set (lower-case + @-prefix-stripped)
  // for case-insensitive comparison against the available picker handles.
  function normaliseHandleForCompare(h: string): string {
    return h.trim().toLowerCase().replace(/^@/, '');
  }
  const existingMemberSet = $derived(
    new Set(existingMemberHandles.map(normaliseHandleForCompare))
  );

  let handleBeingTyped = $state('');
  let formState = $state<FormState>('emptyComposerWaitingForHandle');
  let mostRecentlyInvitedHandle = $state('');
  let lastErrorMessage = $state('');

  // PICKER-DYNAMIC (2026-05-15, JWPK): chips are now sourced from real
  // terminals via /api/terminals/handles (union of explicit + derived
  // handles per terminalRecordsStore.listAllPickableHandles). Stays in
  // lockstep with the INVITE-VALIDATE gate so the picker can only offer
  // handles that POST /members will actually accept.
  let availableHandles = $state<string[]>([]);

  onMount(async () => {
    try {
      const response = await fetch('/api/terminals/handles');
      if (!response.ok) return;
      const payload = (await response.json()) as { handles?: unknown };
      if (Array.isArray(payload.handles)) {
        availableHandles = payload.handles.filter((h): h is string => typeof h === 'string');
      }
    } catch {
      // Network/parse failure leaves availableHandles empty — the form
      // still works (free-form typing path is unaffected; server-side
      // gate is the source of truth either way).
    }
  });

  // Picker = all available handles MINUS those already in the room
  // (JWPK msg_p40dikqhvl). Existing-member filter applies regardless of
  // the typed-search filter so a user typing a member's handle gets
  // the friendly empty-state instead of a clickable chip that would
  // 409 on submit.
  const eligibleHandles = $derived(
    availableHandles.filter((h) => !existingMemberSet.has(normaliseHandleForCompare(h)))
  );
  const filteredHandles = $derived.by(() => {
    const q = handleBeingTyped.trim().toLowerCase().replace(/^@/, '');
    if (q.length === 0) return eligibleHandles;
    return eligibleHandles.filter((h) => h.toLowerCase().replace(/^@/, '').includes(q));
  });

  function handleNameInput(value: string) {
    handleBeingTyped = value;
    if (value.trim().length === 0) {
      formState = 'emptyComposerWaitingForHandle';
    } else {
      formState = 'handleBeingTyped';
    }
  }

  function pickSuggestion(handle: string) {
    handleBeingTyped = handle;
    formState = 'handleBeingTyped';
  }

  async function submitInvite() {
    const trimmedHandle = handleBeingTyped.trim();
    if (trimmedHandle.length === 0) return;

    formState = 'submittingToServer';

    try {
      const response = await fetch(`/api/chat-rooms/${roomId}/members`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentHandle: trimmedHandle })
      });

      if (!response.ok) {
        const failurePayload = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(failurePayload.message ?? 'Could not invite agent.');
      }

      mostRecentlyInvitedHandle = trimmedHandle.startsWith('@')
        ? trimmedHandle
        : `@${trimmedHandle}`;
      handleBeingTyped = '';
      lastErrorMessage = '';
      formState = 'invitedSuccessfully';
      onAgentInvited?.(mostRecentlyInvitedHandle);
    } catch (causeOfFailure) {
      lastErrorMessage =
        causeOfFailure instanceof Error ? causeOfFailure.message : 'Could not invite agent.';
      formState = 'failedToInvite';
    }
  }

  function startAnotherInvite() {
    formState = 'emptyComposerWaitingForHandle';
    handleBeingTyped = '';
    lastErrorMessage = '';
  }

  // Remote-invite flow state — v3-lift shape (JWPK msg_tw6ucsckfw +
  // msg_jp9ncn9av2). Label + password + multi-kind selection; the
  // response carries per-kind share URLs the operator hands out.
  //
  // Backed by /api/chat-rooms/[roomId]/operator-invites which wraps the
  // existing chatInviteStore (admin-bearer-gated /api/chat-invites stays
  // for CLI/external automation; this companion is browser-cookie-gated
  // for the operator's room view).
  type InviteKind = 'cli' | 'mcp' | 'web';
  type RemoteInvite = {
    id: string;
    label: string;
    kinds: InviteKind[];
    share: Record<InviteKind, string>;
  };

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

<section class="invite-agent-form" aria-labelledby="inviteAgentHeading">
  <h2 id="inviteAgentHeading">Invite an agent</h2>

  {#if formState === 'failedToInvite'}
    <p class="error-message" role="alert">{lastErrorMessage}</p>
    <button type="button" class="primary" onclick={startAnotherInvite}>Try again</button>
  {:else if formState === 'invitedSuccessfully'}
    <p class="success-message" role="status">
      Invited <strong>{mostRecentlyInvitedHandle}</strong>. They are now a member of this room.
    </p>
    <button type="button" class="primary" onclick={startAnotherInvite}>Invite someone else</button>
  {:else}
    <form
      onsubmit={(submitEvent) => {
        submitEvent.preventDefault();
        submitInvite();
      }}
    >
      <label for="agentHandleField">Type or pick a handle</label>
      <input
        id="agentHandleField"
        type="text"
        autocomplete="off"
        placeholder="@evolveantclaude"
        value={handleBeingTyped}
        oninput={(event) => handleNameInput(event.currentTarget.value)}
        disabled={formState === 'submittingToServer'}
      />

      <div class="suggestion-chips">
        {#each filteredHandles as handle (handle)}
          <button
            type="button"
            class="chip"
            onclick={() => pickSuggestion(handle)}
            disabled={formState === 'submittingToServer'}
          >
            <span class="chip-handle">{handle}</span>
          </button>
        {:else}
          {#if availableHandles.length === 0}
            <p class="picker-empty">
              No terminals yet — <a href="/terminals">launch one from the Terminals page</a> first.
            </p>
          {:else if eligibleHandles.length === 0}
            <p class="picker-empty">
              Every available terminal is already a member of this room. Launch a new one from
              <a href="/terminals">Terminals</a> or invite a remote agent below.
            </p>
          {:else}
            <p class="picker-empty">No matching terminal. Refine your search or pick from the full list by clearing the field.</p>
          {/if}
        {/each}
      </div>

      <button
        type="submit"
        class="primary"
        disabled={formState !== 'handleBeingTyped'}
      >
        {#if formState === 'submittingToServer'}
          Inviting…
        {:else}
          Send invite
        {/if}
      </button>
    </form>

    <!-- JWPK msg_tw6ucsckfw + msg_jp9ncn9av2: v3-lift remote-invite UX.
         Label + password + multi-kind selection (cli / mcp / web). The
         operator hands the password out-of-band and the share string the
         joiner-end uses (e.g. a web URL for browser join, an ant://
         link for CLI). Backed by the operator-only browser endpoint
         /api/chat-rooms/[roomId]/operator-invites which wraps the
         existing chatInviteStore (admin-bearer /api/chat-invites stays
         for CLI / external automation). -->
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
  {/if}
</section>

<style>
  .invite-agent-form {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    padding: 1.25rem 1.4rem;
    background: var(--surface);
    border: 1px solid var(--surface-edge);
    border-radius: 1rem;
  }

  h2 {
    font-size: 1.05rem;
    font-weight: 800;
    margin: 0;
    color: var(--ink-strong);
  }

  form {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }

  label {
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--ink);
  }

  input {
    padding: 0.7rem 0.85rem;
    font-size: 1rem;
    border: 1px solid var(--surface-edge);
    border-radius: 0.65rem;
    background: var(--bg);
    color: var(--ink-strong);
  }

  input:focus {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .suggestion-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .chip {
    display: inline-flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 0.45rem 0.7rem;
    background: var(--bg);
    border: 1px solid var(--surface-edge);
    border-radius: 0.6rem;
    cursor: pointer;
    text-align: left;
  }

  .chip:hover:not(:disabled) {
    border-color: var(--accent);
  }

  .chip-handle {
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--ink-strong);
  }

  .picker-empty {
    margin: 0;
    font-size: 0.85rem;
    color: var(--ink-soft);
  }

  .picker-empty a {
    color: var(--accent);
    text-decoration: underline;
  }

  button.primary {
    align-self: flex-start;
    padding: 0.6rem 1.1rem;
    font-weight: 800;
    font-size: 0.95rem;
    color: white;
    background: var(--accent);
    border: none;
    border-radius: 999px;
    cursor: pointer;
  }

  button.primary:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .success-message {
    margin: 0;
    color: var(--ink);
  }

  .error-message {
    margin: 0;
    color: var(--accent);
  }
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
