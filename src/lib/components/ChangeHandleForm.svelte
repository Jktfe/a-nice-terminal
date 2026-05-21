<!--
  ChangeHandleForm — set or revert a room-scoped alias.
  Wireframe board WTHef state h03 (Claude lane, x=-6200 y=1800).
  Edge fe31 (alias collision) renders an inline suggestion that the user
  can pick with a single click; the suggestion increments any trailing
  number so @cdx -> @cdx-2 -> @cdx-3 and so on.

  Five named states the form moves through:
    1. idleNotEditingYet
    2. aliasBeingTyped
    3. submittingToServer
    4. aliasApplied
    5. aliasCollisionWithSuggestion
-->
<script lang="ts">
  import AliasCollisionHint from './AliasCollisionHint.svelte';

  type FormState =
    | 'idleNotEditingYet'
    | 'aliasBeingTyped'
    | 'submittingToServer'
    | 'aliasApplied'
    | 'aliasCollisionWithSuggestion';

  type Props = {
    roomId: string;
    globalHandle: string;
    currentAlias?: string;
    onAliasApplied?: (savedAlias: string) => void;
    onCancel?: () => void;
  };

  let { roomId, globalHandle, currentAlias, onAliasApplied, onCancel }: Props = $props();

  // Seeded from currentAlias on mount; subsequent prop changes do not
  // overwrite user-typed input. See feedback_svelte5_state_from_prop.
  // svelte-ignore state_referenced_locally
  let aliasBeingTyped = $state(currentAlias ?? '');
  let formState = $state<FormState>('idleNotEditingYet');
  let lastErrorMessage = $state('');
  let collisionSuggestion = $state('');

  function handleAliasInput(rawValue: string) {
    aliasBeingTyped = rawValue;
    lastErrorMessage = '';
    collisionSuggestion = '';
    const trimmed = rawValue.trim();
    const unchanged = trimmed === (currentAlias ?? '');
    formState = trimmed.length === 0 || unchanged ? 'idleNotEditingYet' : 'aliasBeingTyped';
  }

  function nextSuggestionFor(takenAlias: string): string {
    const match = takenAlias.match(/^(.*?)(?:-(\d+))?$/);
    if (!match) return takenAlias + '-2';
    const stem = match[1];
    const nextNumber = match[2] ? Number(match[2]) + 1 : 2;
    return `${stem}-${nextNumber}`;
  }

  async function submitAlias() {
    const trimmedAlias = aliasBeingTyped.trim();
    if (trimmedAlias.length === 0) return;

    formState = 'submittingToServer';

    try {
      const response = await fetch(`/api/chat-rooms/${roomId}/aliases`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ globalHandle, newAlias: trimmedAlias })
      });

      if (response.status === 409) {
        const collisionBody = (await response.json()) as { alias: string; collidesWith: string };
        collisionSuggestion = nextSuggestionFor(collisionBody.alias);
        lastErrorMessage = `${collisionBody.alias} is already used by ${collisionBody.collidesWith}.`;
        formState = 'aliasCollisionWithSuggestion';
        return;
      }

      if (!response.ok) {
        const failurePayload = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(failurePayload.message ?? 'Could not save alias.');
      }

      const successBody = (await response.json()) as { aliasEntry: { alias: string } };
      formState = 'aliasApplied';
      onAliasApplied?.(successBody.aliasEntry.alias);
    } catch (causeOfFailure) {
      lastErrorMessage =
        causeOfFailure instanceof Error ? causeOfFailure.message : 'Could not save alias.';
      formState = 'aliasBeingTyped';
    }
  }

  function pickSuggestion() {
    aliasBeingTyped = collisionSuggestion;
    collisionSuggestion = '';
    lastErrorMessage = '';
    formState = 'aliasBeingTyped';
  }

  function cancelEdit() {
    aliasBeingTyped = currentAlias ?? '';
    lastErrorMessage = '';
    collisionSuggestion = '';
    formState = 'idleNotEditingYet';
    onCancel?.();
  }

  const saveDisabled = $derived(
    formState !== 'aliasBeingTyped' || aliasBeingTyped.trim().length === 0
  );
</script>

<form
  class="change-handle-form"
  onsubmit={(submitEvent) => {
    submitEvent.preventDefault();
    submitAlias();
  }}
>
  <h2 class="form-title">Room alias for {globalHandle}</h2>

  <label class="field">
    <span class="field-label">Global handle</span>
    <input
      type="text"
      class="field-input locked"
      value={globalHandle}
      readonly
      aria-readonly="true"
    />
    <span class="locked-note">🔒 read-only here</span>
  </label>

  <label class="field">
    <span class="field-label">Room alias (this room only)</span>
    <!-- svelte-ignore a11y_autofocus -->
    <input
      type="text"
      class="field-input"
      placeholder="@short-name"
      value={aliasBeingTyped}
      autofocus
      oninput={(event) => handleAliasInput(event.currentTarget.value)}
      disabled={formState === 'submittingToServer'}
    />
  </label>

  {#if formState === 'aliasCollisionWithSuggestion'}
    <AliasCollisionHint
      message={lastErrorMessage}
      suggestion={collisionSuggestion}
      onPickSuggestion={pickSuggestion}
    />
  {:else if lastErrorMessage}
    <p class="error-message" role="alert">{lastErrorMessage}</p>
  {/if}

  <div class="form-actions">
    <button type="button" class="ghost" onclick={cancelEdit}>Cancel</button>
    <button type="submit" class="primary" disabled={saveDisabled}>
      {#if formState === 'submittingToServer'}Saving…{:else}Save{/if}
    </button>
  </div>
</form>

<style>
  .change-handle-form {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    padding: 1.1rem 1.3rem;
    background: var(--surface);
    border: 1px solid var(--surface-edge);
    border-radius: 1rem;
  }
  .form-title {
    margin: 0;
    font-size: 1rem;
    font-weight: 800;
    color: var(--ink-strong);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .field-label {
    font-size: 0.78rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--ink-soft);
  }
  .field-input {
    padding: 0.65rem 0.8rem;
    font-size: 1rem;
    font-family: 'JetBrains Mono', monospace;
    border: 1px solid var(--surface-edge);
    border-radius: 0.55rem;
    background: var(--bg);
    color: var(--ink-strong);
  }
  .field-input.locked {
    color: var(--ink-soft);
    background: var(--surface-edge);
  }
  .field-input:focus {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .locked-note {
    font-size: 0.7rem;
    color: var(--ink-soft);
  }
  .error-message {
    margin: 0;
    color: #c92020;
    font-size: 0.88rem;
  }
  .form-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.55rem;
  }
  .ghost {
    padding: 0.55rem 1rem;
    background: transparent;
    border: 1px solid var(--surface-edge);
    border-radius: 999px;
    font-weight: 700;
    color: var(--ink);
    cursor: pointer;
  }
  .primary {
    padding: 0.55rem 1.1rem;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 999px;
    font-weight: 800;
    cursor: pointer;
  }
  .primary:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
</style>
