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
    existingMemberHandles?: string[];
  };

  let { roomId, onAgentInvited, existingMemberHandles = [] }: Props = $props();

  let handleBeingTyped = $state('');
  let formState = $state<FormState>('emptyComposerWaitingForHandle');
  let mostRecentlyInvitedHandle = $state('');
  let lastErrorMessage = $state('');
  let availableHandles = $state<string[]>([]);

  function normaliseHandleForCompare(handle: string): string {
    return handle.trim().toLowerCase().replace(/^@/, '');
  }

  const existingMemberSet = $derived(
    new Set(existingMemberHandles.map(normaliseHandleForCompare))
  );
  const eligibleHandles = $derived(
    availableHandles.filter((handle) => !existingMemberSet.has(normaliseHandleForCompare(handle)))
  );
  const filteredHandles = $derived.by(() => {
    const query = normaliseHandleForCompare(handleBeingTyped);
    if (query.length === 0) return eligibleHandles;
    return eligibleHandles.filter((handle) => normaliseHandleForCompare(handle).includes(query));
  });

  onMount(async () => {
    try {
      const response = await fetch('/api/terminals/handles');
      if (!response.ok) return;
      const payload = (await response.json()) as { handles?: unknown };
      if (Array.isArray(payload.handles)) {
        availableHandles = payload.handles.filter((handle): handle is string => typeof handle === 'string');
      }
    } catch {
      /* free-form typing still works; server validation is authoritative */
    }
  });

  function handleNameInput(value: string): void {
    handleBeingTyped = value;
    formState = value.trim().length === 0 ? 'emptyComposerWaitingForHandle' : 'handleBeingTyped';
  }

  function pickSuggestion(handle: string): void {
    handleBeingTyped = handle;
    formState = 'handleBeingTyped';
  }

  function startAnotherInvite(): void {
    formState = 'emptyComposerWaitingForHandle';
    handleBeingTyped = '';
    lastErrorMessage = '';
  }

  async function submitInvite(): Promise<void> {
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
        const failure = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(failure.message ?? 'Could not invite agent.');
      }
      mostRecentlyInvitedHandle = trimmedHandle.startsWith('@') ? trimmedHandle : `@${trimmedHandle}`;
      handleBeingTyped = '';
      lastErrorMessage = '';
      formState = 'invitedSuccessfully';
      onAgentInvited?.(mostRecentlyInvitedHandle);
    } catch (cause) {
      lastErrorMessage = cause instanceof Error ? cause.message : 'Could not invite agent.';
      formState = 'failedToInvite';
    }
  }
</script>

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
    onsubmit={(event) => {
      event.preventDefault();
      void submitInvite();
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
          <span>{handle}</span>
        </button>
      {:else}
        {#if availableHandles.length === 0}
          <p class="picker-empty">No terminals yet — <a href="/terminals">launch one</a> first.</p>
        {:else if eligibleHandles.length === 0}
          <p class="picker-empty">Every available terminal is already in this room.</p>
        {:else}
          <p class="picker-empty">No matching terminal.</p>
        {/if}
      {/each}
    </div>

    <button type="submit" class="primary" disabled={formState !== 'handleBeingTyped'}>
      {formState === 'submittingToServer' ? 'Inviting...' : 'Send invite'}
    </button>
  </form>
{/if}

<style>
  form { display: flex; flex-direction: column; gap: 0.65rem; }
  label { font-size: 0.85rem; font-weight: 700; color: var(--ink); }
  input {
    padding: 0.7rem 0.85rem;
    font-size: 1rem;
    border: 1px solid var(--surface-edge);
    border-radius: 0.65rem;
    background: var(--bg);
    color: var(--ink-strong);
  }
  input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  .suggestion-chips { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .chip {
    display: inline-flex;
    align-items: flex-start;
    padding: 0.45rem 0.7rem;
    background: var(--bg);
    border: 1px solid var(--surface-edge);
    border-radius: 0.6rem;
    cursor: pointer;
    text-align: left;
  }
  .chip:hover:not(:disabled) { border-color: var(--accent); }
  .chip span { font-size: 0.85rem; font-weight: 700; color: var(--ink-strong); }
  .picker-empty { margin: 0; font-size: 0.85rem; color: var(--ink-soft); }
  .picker-empty a { color: var(--accent); text-decoration: underline; }
  .primary {
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
  .primary:disabled { opacity: 0.55; cursor: not-allowed; }
  .success-message { margin: 0; color: var(--ink); }
  .error-message { margin: 0; color: var(--accent); }
</style>
