<!--
  /policies — verification policy catalogue.

  Public policies anyone can see, plus the caller's own (any visibility)
  when an identity is resolved. Toggle 'Mine only' filter, link to
  authoring form, premium-upgrade nudge on OSS tier.
-->
<script lang="ts">
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const isPaid = $derived(data.verificationUxEnabled);
</script>

<svelte:head><title>Verification policies | ANT vNext</title></svelte:head>

<SimplePageShell
  eyebrow="Verification"
  title="Policies."
  summary={`${data.policies.length} ${data.policies.length === 1 ? 'policy' : 'policies'} visible · ${isPaid ? 'authoring enabled' : 'premium feature — read-only on OSS'}`}
>
  {#if data.serverFailed}
    <p class="server-error" role="alert">Could not load the policy catalogue.</p>
  {/if}

  {#if !isPaid}
    <aside class="premium-nudge" role="note">
      <strong>Premium feature</strong>
      <p>
        Verification policies (authoring, applying to artefacts, asks-fanout enforcement, audit retention)
        ship with <strong>ANT Native</strong> (£5.99/mo) and <strong>ANT Enterprise</strong>.
        OSS users can read public policies here but can't author or apply them.
      </p>
    </aside>
  {/if}

  <nav class="toolbar" aria-label="Policy filters">
    <div class="filter-chips" role="tablist" aria-label="Scope">
      <a class="chip" class:active={!data.mineOnly} role="tab" aria-selected={!data.mineOnly} href="/policies">All visible</a>
      {#if data.myHandle}
        <a class="chip" class:active={data.mineOnly} role="tab" aria-selected={data.mineOnly} href="/policies?mine=1">Mine ({data.myHandle})</a>
      {/if}
    </div>
    <div class="actions">
      {#if isPaid}
        <a class="primary-btn" href="/policies/new">New policy</a>
      {:else}
        <span class="disabled-btn" title="Upgrade to ANT Native to author policies">New policy (premium)</span>
      {/if}
    </div>
  </nav>

  {#if data.policies.length === 0}
    <p class="empty-nudge">
      {data.mineOnly
        ? 'You haven\'t authored any policies yet.'
        : 'No public policies in the catalogue. ' + (isPaid ? 'Author the first one with "New policy" above.' : '')}
    </p>
  {:else}
    <ul class="policy-list">
      {#each data.policies as policy (policy.id)}
        <li class="policy-row">
          <a class="policy-link" href={`/policies/${encodeURIComponent(policy.slug)}`}>
            <div class="policy-row-head">
              <span class="policy-name">{policy.name}</span>
              <span class={`visibility visibility-${policy.visibility}`}>{policy.visibility}</span>
              {#if policy.deletedAtMs}
                <span class="visibility visibility-deleted">deleted</span>
              {/if}
            </div>
            {#if policy.description}
              <p class="policy-desc">{policy.description}</p>
            {/if}
            <div class="policy-meta">
              by {policy.ownerHandle}
              · created {new Date(policy.createdAtMs).toLocaleDateString()}
              {#if policy.updatedAtMs}· updated {new Date(policy.updatedAtMs).toLocaleDateString()}{/if}
              · {Object.keys(policy.policy.blocks ?? {}).length} block kinds
            </div>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</SimplePageShell>

<style>
  .server-error {
    margin: 0 0 0.85rem;
    padding: 0.85rem 1rem;
    border: 1px solid var(--warn);
    border-radius: 0.85rem;
    background: color-mix(in srgb, var(--warn) 18%, var(--surface-card));
    color: var(--ink-strong);
    font-weight: 800;
  }
  .premium-nudge {
    margin: 0 0 1rem;
    padding: 1rem 1.1rem;
    border: 1px solid var(--accent);
    border-radius: 0.85rem;
    background: color-mix(in srgb, var(--accent) 10%, var(--surface-card));
    color: var(--ink-strong);
  }
  .premium-nudge strong { color: var(--accent); }
  .premium-nudge p { margin: 0.4rem 0 0; color: var(--ink-soft); line-height: 1.45; }
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin: 0 0 1rem;
    flex-wrap: wrap;
  }
  .filter-chips { display: flex; gap: 0.4rem; flex-wrap: wrap; }
  .chip {
    padding: 0.4rem 0.85rem;
    border: 1px solid var(--line-soft);
    border-radius: 999px;
    background: var(--surface-card);
    color: var(--ink-strong);
    text-decoration: none;
    font-weight: 800;
    font-size: 0.82rem;
  }
  .chip.active { border-color: var(--accent); color: var(--accent); }
  .primary-btn {
    padding: 0.55rem 1.1rem;
    border: 1px solid var(--accent);
    border-radius: 999px;
    background: var(--accent);
    color: white;
    text-decoration: none;
    font-weight: 800;
    font-size: 0.85rem;
  }
  .disabled-btn {
    padding: 0.55rem 1.1rem;
    border: 1px dashed var(--line-soft);
    border-radius: 999px;
    color: var(--ink-soft);
    font-weight: 800;
    font-size: 0.85rem;
    cursor: not-allowed;
  }
  .empty-nudge {
    margin: 0;
    padding: 1rem;
    border: 1px dashed var(--surface-edge);
    border-radius: 0.85rem;
    background: var(--bg);
    color: var(--ink-soft);
  }
  .policy-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.55rem; }
  .policy-row { border: 1px solid var(--line-soft); border-radius: 0.85rem; background: var(--surface-card); }
  .policy-row:hover { border-color: var(--accent); }
  .policy-link {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.95rem 1.05rem;
    text-decoration: none;
    color: inherit;
  }
  .policy-row-head { display: flex; align-items: center; gap: 0.55rem; flex-wrap: wrap; }
  .policy-name { font-weight: 800; color: var(--ink-strong); font-size: 1.02rem; }
  .visibility {
    padding: 0.12rem 0.5rem;
    border-radius: 999px;
    font-size: 0.68rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .visibility-public { background: color-mix(in srgb, var(--ok) 15%, transparent); color: var(--ok); border: 1px solid color-mix(in srgb, var(--ok) 30%, transparent); }
  .visibility-unlisted { background: color-mix(in srgb, var(--info, #2563eb) 12%, transparent); color: var(--info, #2563eb); border: 1px solid color-mix(in srgb, var(--info, #2563eb) 30%, transparent); }
  .visibility-private { background: color-mix(in srgb, var(--warn) 12%, transparent); color: var(--warn); border: 1px solid color-mix(in srgb, var(--warn) 30%, transparent); }
  .visibility-deleted { background: var(--bg); color: var(--ink-soft); border: 1px dashed var(--surface-edge); }
  .policy-desc { margin: 0; color: var(--ink-strong); line-height: 1.4; }
  .policy-meta { font-size: 0.78rem; color: var(--ink-soft); }
</style>
