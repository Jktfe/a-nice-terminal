<!--
  /policies/new — author a new verification policy.

  Strawman defaults seeded from JWPK's example kinds. Author chooses
  name, description, visibility, the block-kind table, plus a "reason"
  for the audit row. Premium-gated; OSS users 402 at POST time but the
  form is rendered so they see what they'd get.
-->
<script lang="ts">
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import { goto } from '$app/navigation';
  import PolicyEditor from '$lib/components/PolicyEditor.svelte';

  type Body = {
    blocks: Record<string, { agents?: number; humans?: number; named_verifiers?: string[]; verifyLive?: boolean }>;
    fallback?: { agents?: number; humans?: number; named_verifiers?: string[]; verifyLive?: boolean };
  };

  let name = $state('');
  let description = $state('');
  let visibility = $state<'public' | 'unlisted' | 'private'>('public');
  let reason = $state('');
  let saving = $state(false);
  let errorMessage = $state('');

  // Strawman defaults from JWPK's artefact-room examples.
  let body = $state<Body>({
    blocks: {
      external_link: { agents: 2, verifyLive: true },
      external_doc_summary: { agents: 3 },
      critical_statistic: { agents: 3 },
      non_impactful_evidence: { agents: 1 },
      prose: { humans: 1 },
      design_decision: { named_verifiers: [] }
    },
    fallback: { humans: 1 }
  });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    saving = true;
    errorMessage = '';
    try {
      const response = await fetch('/api/policies', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, description, visibility, policy: body, reason })
      });
      if (!response.ok) {
        const errBody = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(errBody?.message ?? `Could not create policy (${response.status}).`);
      }
      const created = await response.json();
      await goto(`/policies/${encodeURIComponent(created.slug)}`);
    } catch (cause) {
      errorMessage = cause instanceof Error ? cause.message : 'Could not create policy.';
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head><title>New verification policy | ANT vNext</title></svelte:head>

<SimplePageShell eyebrow="Verification" title="New policy." summary="Define block-kind verification requirements.">
  <a class="back" href="/policies">← Catalogue</a>

  <form onsubmit={submit} class="policy-form">
    {#if errorMessage}
      <p class="form-error" role="alert">{errorMessage}</p>
    {/if}

    <label class="field">
      <span class="field-label">Name</span>
      <input type="text" bind:value={name} placeholder="e.g. New Model's Standard, FCA Compliance, Innoture Investor" required maxlength="120" />
    </label>

    <label class="field">
      <span class="field-label">Description</span>
      <textarea bind:value={description} rows="2" placeholder="When and where this policy should be applied"></textarea>
    </label>

    <label class="field">
      <span class="field-label">Visibility</span>
      <select bind:value={visibility}>
        <option value="public">public — everyone sees + can reference</option>
        <option value="unlisted">unlisted — anyone with the slug</option>
        <option value="private">private — only me</option>
      </select>
    </label>

    <fieldset class="field-block">
      <legend>Block requirements</legend>
      <PolicyEditor value={body} onChange={(next) => (body = next)} />
    </fieldset>

    <label class="field">
      <span class="field-label">Reason (recorded in audit trail)</span>
      <input type="text" bind:value={reason} placeholder="optional — e.g. 'first draft for New Model research SOP'" maxlength="240" />
    </label>

    <div class="actions">
      <a class="ghost" href="/policies">Cancel</a>
      <button type="submit" class="primary" disabled={saving || name.trim().length === 0}>
        {saving ? 'Saving…' : 'Create policy'}
      </button>
    </div>
  </form>
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
