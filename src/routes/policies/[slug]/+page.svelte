<!--
  /policies/[slug] — view a single policy.

  Shows the policy table (read-only via PolicyEditor with disabled=true)
  + an Audit tab listing every mutation in DESC order. Owner sees Edit /
  Delete / Clone buttons; non-owner sees Clone only (when paid). All
  mutations route to the API, which carries the audit invariant.
-->
<script lang="ts">
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import { invalidateAll, goto } from '$app/navigation';
  import PolicyEditor from '$lib/components/PolicyEditor.svelte';
  import type { PageData } from './$types';
  import type { PolicyAuditEntry } from '$lib/server/policyStore';

  let { data }: { data: PageData } = $props();

  let activeTab = $state<'view' | 'audit'>('view');
  let busy = $state(false);
  let errorMessage = $state('');
  let cloneName = $state('');
  let showCloneForm = $state(false);

  const isOwner = $derived(data.myHandle === data.policy.ownerHandle);
  const canEdit = $derived(isOwner && data.verificationUxEnabled);
  const canClone = $derived(data.verificationUxEnabled);

  async function softDelete() {
    if (!confirm('Soft-delete this policy? It will disappear from the catalogue but stays in the audit trail.')) return;
    busy = true;
    errorMessage = '';
    try {
      const response = await fetch(`/api/policies/${encodeURIComponent(data.policy.slug)}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'soft-deleted via UI' })
      });
      if (!response.ok) {
        const errBody = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(errBody?.message ?? `Delete failed (${response.status}).`);
      }
      await goto('/policies');
    } catch (cause) {
      errorMessage = cause instanceof Error ? cause.message : 'Delete failed.';
    } finally {
      busy = false;
    }
  }

  async function submitClone(event: SubmitEvent) {
    event.preventDefault();
    if (cloneName.trim().length === 0) return;
    busy = true;
    errorMessage = '';
    try {
      const response = await fetch(`/api/policies/${encodeURIComponent(data.policy.slug)}/clone`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: cloneName, visibility: 'public', reason: 'cloned via UI' })
      });
      if (!response.ok) {
        const errBody = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(errBody?.message ?? `Clone failed (${response.status}).`);
      }
      const cloned = await response.json();
      await goto(`/policies/${encodeURIComponent(cloned.policy.slug)}`);
    } catch (cause) {
      errorMessage = cause instanceof Error ? cause.message : 'Clone failed.';
    } finally {
      busy = false;
    }
  }

  function formatAuditAction(entry: PolicyAuditEntry): string {
    const labels: Record<typeof entry.action, string> = {
      create: 'Created',
      update: 'Updated',
      soft_delete: 'Soft-deleted',
      restore: 'Restored',
      clone_source: 'Cloned by someone else',
      clone_target: 'Cloned from another policy',
      visibility_change: 'Visibility changed'
    };
    return labels[entry.action];
  }
</script>

<svelte:head><title>{data.policy.name} | Policy | ANT vNext</title></svelte:head>

<SimplePageShell
  eyebrow="Verification policy"
  title={data.policy.name}
  summary={`by ${data.policy.ownerHandle} · ${data.policy.visibility} · ${Object.keys(data.policy.policy.blocks ?? {}).length} block kinds + fallback`}
>
  <a class="back" href="/policies">← Catalogue</a>

  {#if data.policy.description}
    <p class="policy-desc">{data.policy.description}</p>
  {/if}

  {#if errorMessage}
    <p class="form-error" role="alert">{errorMessage}</p>
  {/if}

  <div class="tabs" role="tablist" aria-label="Policy sections">
    <button type="button" class="tab" class:active={activeTab === 'view'} role="tab" aria-selected={activeTab === 'view'} onclick={() => (activeTab = 'view')}>
      Definition
    </button>
    <button type="button" class="tab" class:active={activeTab === 'audit'} role="tab" aria-selected={activeTab === 'audit'} onclick={() => (activeTab = 'audit')}>
      Audit ({data.audit.length})
    </button>
    <span class="tabs-spacer"></span>
    {#if canEdit}
      <a class="action-btn" href={`/policies/${encodeURIComponent(data.policy.slug)}/edit`}>Edit</a>
      <button type="button" class="action-btn danger" onclick={softDelete} disabled={busy}>Delete</button>
    {/if}
    {#if canClone}
      <button type="button" class="action-btn" onclick={() => (showCloneForm = !showCloneForm)} disabled={busy}>
        {showCloneForm ? 'Cancel clone' : 'Clone'}
      </button>
    {/if}
  </div>

  {#if showCloneForm}
    <form class="clone-form" onsubmit={submitClone}>
      <label>
        <span class="field-label">New policy name</span>
        <input type="text" bind:value={cloneName} placeholder={`Clone of ${data.policy.name}`} required maxlength="120" />
      </label>
      <button type="submit" class="primary" disabled={busy || cloneName.trim().length === 0}>Create clone</button>
    </form>
  {/if}

  {#if activeTab === 'view'}
    <PolicyEditor
      value={(data.policy.policy.blocks ? data.policy.policy : { blocks: {}, fallback: undefined }) as any}
      onChange={() => { /* read-only in view tab */ }}
      disabled={true}
    />
  {:else}
    {#if data.audit.length === 0}
      <p class="empty-nudge">No audit entries.</p>
    {:else}
      <ul class="audit-list">
        {#each data.audit as entry (entry.id)}
          <li class="audit-row">
            <div class="audit-row-head">
              <span class={`audit-badge audit-${entry.action}`}>{formatAuditAction(entry)}</span>
              <span class="audit-actor">{entry.actorHandle} <span class="audit-kind">({entry.actorKind})</span></span>
              <span class="audit-when">{new Date(entry.createdAtMs).toLocaleString()}</span>
            </div>
            {#if entry.reason}
              <p class="audit-reason">{entry.reason}</p>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</SimplePageShell>

<style>
  .back { color: var(--ink-soft); text-decoration: none; font-weight: 700; font-size: 0.85rem; }
  .back:hover { color: var(--accent); }
  .policy-desc { margin: 1rem 0 0; color: var(--ink-strong); line-height: 1.5; }
  .form-error {
    margin: 1rem 0 0;
    padding: 0.85rem 1rem;
    border: 1px solid var(--warn);
    border-radius: 0.65rem;
    background: color-mix(in srgb, var(--warn) 18%, var(--surface-card));
    color: var(--ink-strong);
  }
  .tabs {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 1.25rem 0 0.85rem;
    flex-wrap: wrap;
  }
  .tab {
    padding: 0.5rem 0.95rem;
    border: 1px solid var(--line-soft);
    border-radius: 999px;
    background: var(--surface-card);
    color: var(--ink-strong);
    font: inherit;
    font-weight: 800;
    font-size: 0.82rem;
    cursor: pointer;
  }
  .tab.active { border-color: var(--accent); color: var(--accent); }
  .tabs-spacer { flex: 1; }
  .action-btn {
    padding: 0.5rem 0.95rem;
    border: 1px solid var(--line-soft);
    border-radius: 999px;
    background: var(--surface-card);
    color: var(--ink-strong);
    font: inherit;
    font-weight: 800;
    font-size: 0.82rem;
    cursor: pointer;
    text-decoration: none;
  }
  .action-btn:hover { border-color: var(--accent); color: var(--accent); }
  .action-btn.danger:hover { border-color: var(--warn); color: var(--warn); }
  .clone-form {
    display: flex;
    align-items: flex-end;
    gap: 0.85rem;
    padding: 1rem;
    margin-top: 0.5rem;
    border: 1px solid var(--accent);
    border-radius: 0.85rem;
    background: color-mix(in srgb, var(--accent) 8%, var(--surface-card));
  }
  .clone-form label { display: flex; flex-direction: column; gap: 0.35rem; flex: 1; }
  .clone-form input {
    padding: 0.55rem 0.75rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.5rem;
    background: var(--surface-card);
    color: var(--ink-strong);
    font: inherit;
  }
  .field-label { font-size: 0.75rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-soft); }
  .primary {
    padding: 0.55rem 1.1rem;
    border: 1px solid var(--accent);
    border-radius: 999px;
    background: var(--accent);
    color: white;
    font: inherit;
    font-weight: 800;
    cursor: pointer;
  }
  .primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .empty-nudge {
    padding: 1rem;
    border: 1px dashed var(--surface-edge);
    border-radius: 0.85rem;
    background: var(--bg);
    color: var(--ink-soft);
  }
  .audit-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.55rem; }
  .audit-row {
    border: 1px solid var(--line-soft);
    border-radius: 0.65rem;
    background: var(--surface-card);
    padding: 0.7rem 0.95rem;
  }
  .audit-row-head { display: flex; align-items: center; gap: 0.55rem; flex-wrap: wrap; }
  .audit-badge {
    padding: 0.15rem 0.55rem;
    border-radius: 999px;
    font-size: 0.7rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .audit-create { background: color-mix(in srgb, var(--ok) 15%, transparent); color: var(--ok); border: 1px solid color-mix(in srgb, var(--ok) 30%, transparent); }
  .audit-update { background: color-mix(in srgb, var(--info, #2563eb) 12%, transparent); color: var(--info, #2563eb); border: 1px solid color-mix(in srgb, var(--info, #2563eb) 30%, transparent); }
  .audit-soft_delete { background: color-mix(in srgb, var(--warn) 12%, transparent); color: var(--warn); border: 1px solid color-mix(in srgb, var(--warn) 30%, transparent); }
  .audit-restore, .audit-clone_target, .audit-clone_source, .audit-visibility_change {
    background: var(--bg);
    color: var(--ink-strong);
    border: 1px solid var(--line-soft);
  }
  .audit-actor { font-weight: 700; color: var(--ink-strong); font-family: 'JetBrains Mono', monospace; font-size: 0.85rem; }
  .audit-kind { color: var(--ink-soft); font-weight: 600; }
  .audit-when { color: var(--ink-soft); font-size: 0.82rem; margin-left: auto; }
  .audit-reason { margin: 0.45rem 0 0; color: var(--ink-soft); font-size: 0.85rem; line-height: 1.4; }
</style>
