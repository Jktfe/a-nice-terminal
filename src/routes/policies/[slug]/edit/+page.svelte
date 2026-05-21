<!--
  /policies/[slug]/edit — edit form for an existing policy.

  Owner-only; non-owners are redirected to the view page. Persists via
  PATCH which routes through policyStore.updatePolicy → audit row in the
  same transaction. A "reason" field is exposed so authors can record
  why a change was made.
-->
<script lang="ts">
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import { goto } from '$app/navigation';
  import PolicyEditor from '$lib/components/PolicyEditor.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const isOwner = $derived(data.myHandle === data.policy.ownerHandle);

  // Init local edit state from the loaded policy
  // svelte-ignore state_referenced_locally
  let name = $state(data.policy.name);
  // svelte-ignore state_referenced_locally
  let description = $state(data.policy.description ?? '');
  // svelte-ignore state_referenced_locally
  let visibility = $state<'public' | 'unlisted' | 'private'>(data.policy.visibility);
  let reason = $state('');
  let saving = $state(false);
  let errorMessage = $state('');

  // svelte-ignore state_referenced_locally
  let body = $state(data.policy.policy.blocks
    ? data.policy.policy
    : { blocks: {}, fallback: undefined }
  );

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!isOwner) {
      errorMessage = 'Only the policy owner can edit.';
      return;
    }
    saving = true;
    errorMessage = '';
    try {
      const response = await fetch(`/api/policies/${encodeURIComponent(data.policy.slug)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          description,
          visibility,
          policy: body,
          reason
        })
      });
      if (!response.ok) {
        const errBody = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(errBody?.message ?? `Save failed (${response.status}).`);
      }
      await goto(`/policies/${encodeURIComponent(data.policy.slug)}`);
    } catch (cause) {
      errorMessage = cause instanceof Error ? cause.message : 'Save failed.';
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head><title>Edit {data.policy.name} | Policy | ANT vNext</title></svelte:head>

<SimplePageShell eyebrow="Verification policy" title={`Edit: ${data.policy.name}`} summary={`Owner: ${data.policy.ownerHandle}`}>
  <a class="back" href={`/policies/${encodeURIComponent(data.policy.slug)}`}>← Back to policy</a>

  {#if !isOwner}
    <p class="form-error" role="alert">Only the policy owner can edit. <a href={`/policies/${encodeURIComponent(data.policy.slug)}`}>Back to view</a>.</p>
  {:else}
    <form onsubmit={submit} class="policy-form">
      {#if errorMessage}
        <p class="form-error" role="alert">{errorMessage}</p>
      {/if}

      <label class="field">
        <span class="field-label">Name</span>
        <input type="text" bind:value={name} required maxlength="120" />
      </label>

      <label class="field">
        <span class="field-label">Description</span>
        <textarea bind:value={description} rows="2"></textarea>
      </label>

      <label class="field">
        <span class="field-label">Visibility</span>
        <select bind:value={visibility}>
          <option value="public">public</option>
          <option value="unlisted">unlisted</option>
          <option value="private">private</option>
        </select>
      </label>

      <fieldset class="field-block">
        <legend>Block requirements</legend>
        <PolicyEditor value={body as any} onChange={(next) => (body = next as any)} />
      </fieldset>

      <label class="field">
        <span class="field-label">Reason for this change (recorded in audit trail)</span>
        <input type="text" bind:value={reason} placeholder="e.g. 'tightened critical-statistic to 3 agents after Innoture incident'" maxlength="240" />
      </label>

      <div class="actions">
        <a class="ghost" href={`/policies/${encodeURIComponent(data.policy.slug)}`}>Cancel</a>
        <button type="submit" class="primary" disabled={saving || name.trim().length === 0}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  {/if}
</SimplePageShell>

<style>
  .back { color: var(--ink-soft); text-decoration: none; font-weight: 700; font-size: 0.85rem; }
  .back:hover { color: var(--accent); }
  .policy-form { display: flex; flex-direction: column; gap: 1rem; margin-top: 1rem; }
  .form-error {
    margin: 0;
    padding: 0.85rem 1rem;
    border: 1px solid var(--warn);
    border-radius: 0.65rem;
    background: color-mix(in srgb, var(--warn) 18%, var(--surface-card));
    color: var(--ink-strong);
  }
  .field { display: flex; flex-direction: column; gap: 0.35rem; }
  .field-label { font-size: 0.75rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-soft); }
  .field input[type='text'], .field textarea, .field select {
    padding: 0.6rem 0.75rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.55rem;
    background: var(--surface-card);
    color: var(--ink-strong);
    font: inherit;
  }
  .field-block {
    border: 1px solid var(--line-soft);
    border-radius: 0.85rem;
    padding: 0.85rem;
    background: var(--bg);
  }
  .field-block legend {
    padding: 0 0.5rem;
    font-size: 0.75rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--ink-soft);
  }
  .actions { display: flex; justify-content: flex-end; gap: 0.55rem; }
  .ghost, .primary {
    padding: 0.6rem 1.2rem;
    border-radius: 999px;
    font-weight: 800;
    text-decoration: none;
    cursor: pointer;
    border: 1px solid var(--line-soft);
    background: var(--surface-card);
    color: var(--ink-strong);
    font: inherit;
  }
  .primary {
    border-color: var(--accent);
    background: var(--accent);
    color: white;
  }
  .primary:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
