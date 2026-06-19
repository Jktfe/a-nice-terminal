<!--
  /verification/lenses — premium fallback lens designer.

  Native apps own the primary experience. This web route is deliberately
  operator-dense: it lets power users author the V2 lens rules contract that
  native apps and the server bridge consume.
-->
<script lang="ts">
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import type { PageData } from './$types';

  type RequirementKind = 'agent' | 'person' | 'source' | 'file' | 'filesystem' | 'website' | 'context_summary';
  type BlockMode = 'all' | 'any' | 'none';
  type LensKind = 'poc' | 'fca' | 'investment_memo' | 'scientific_claim' | 'marketing_copy' | 'custom';
  type Scope = 'public' | 'user' | 'org';

  type LensRequirement = {
    kind: RequirementKind;
    count: number;
    specific?: string[];
    allowedSources?: string[];
    specificFiles?: string[];
    allowedDomains?: string[];
  };

  type LensBlock = {
    mode: BlockMode;
    reason?: string;
    requirements?: LensRequirement[];
  };

  type LensRules = {
    version: 2;
    blocks: Record<string, LensBlock>;
    fallback?: LensBlock;
  };

  type Lens = PageData['lenses'][number];
  type Draft = {
    id: string | null;
    name: string;
    description: string;
    lensKind: LensKind;
    scope: Scope;
    scopeId: string;
    reason: string;
    rules: LensRules;
  };
  type AuditEntry = {
    id: string;
    actorHandle: string;
    actorKind: string;
    action: string;
    reason: string | null;
    createdAtMs: number;
  };

  const requirementKinds: RequirementKind[] = ['agent', 'person', 'source', 'file', 'filesystem', 'website', 'context_summary'];
  const lensKinds: LensKind[] = ['custom', 'poc', 'fca', 'investment_memo', 'scientific_claim', 'marketing_copy'];
  const blockModeLabels: Array<{ value: BlockMode; label: string }> = [
    { value: 'all', label: 'All rows must pass' },
    { value: 'any', label: 'Any row can satisfy' },
    { value: 'none', label: 'Waive this block' }
  ];

  let { data }: { data: PageData } = $props();
  const initialLenses: Lens[] = (() => data.lenses ?? [])();
  let lenses = $state<Lens[]>(initialLenses);
  let selectedId = $state<string | null>(initialLenses[0]?.id ?? null);
  let draft = $state<Draft>(lensToDraft(initialLenses[0] ?? null));
  let notice = $state('');
  let errorMessage = $state('');
  let saving = $state(false);
  let auditEntries = $state<AuditEntry[]>([]);
  let auditLoading = $state(false);

  const isPaid = $derived(data.verificationUxEnabled);
  const blockEntries = $derived(Object.entries(draft.rules.blocks));
  const fallbackRequirements = $derived(draft.rules.fallback?.requirements ?? []);

  function defaultRules(): LensRules {
    return {
      version: 2,
      blocks: {
        claim_material: {
          mode: 'all',
          requirements: [
            { kind: 'agent', count: 2 },
            { kind: 'person', count: 1 }
          ]
        },
        source_reference: {
          mode: 'any',
          requirements: [
            { kind: 'source', count: 2 },
            { kind: 'website', count: 1 }
          ]
        },
        opinion_or_strategy: {
          mode: 'none',
          reason: 'Judgement calls are labelled but not independently verified.'
        }
      },
      fallback: {
        mode: 'any',
        requirements: [{ kind: 'agent', count: 1 }]
      }
    };
  }

  function lensToDraft(lens: Lens | null): Draft {
    const parsedRules = lens && isLensRules(lens.rules) ? lens.rules : defaultRules();
    return {
      id: lens?.id ?? null,
      name: lens?.name ?? 'New verification lens',
      description: lens?.description ?? '',
      lensKind: parseLensKind(lens?.lensKind),
      scope: parseScope(lens?.scope),
      scopeId: lens?.scopeId ?? '',
      reason: '',
      rules: cloneLensRules(parsedRules)
    };
  }

  function cloneLensRules(rules: LensRules): LensRules {
    return JSON.parse(JSON.stringify(rules)) as LensRules;
  }

  function isLensRules(value: unknown): value is LensRules {
    return !!value && typeof value === 'object' && !Array.isArray(value) && 'blocks' in value;
  }

  function parseLensKind(value: unknown): LensKind {
    return typeof value === 'string' && lensKinds.includes(value as LensKind) ? value as LensKind : 'custom';
  }

  function parseScope(value: unknown): Scope {
    return value === 'public' || value === 'org' || value === 'user' ? value : 'user';
  }

  function selectLens(id: string): void {
    const lens = lenses.find((item) => item.id === id) ?? null;
    selectedId = lens?.id ?? null;
    draft = lensToDraft(lens);
    notice = '';
    errorMessage = '';
    auditEntries = [];
    if (lens) void loadAudit(lens.id);
  }

  function startNew(): void {
    selectedId = null;
    draft = lensToDraft(null);
    auditEntries = [];
    notice = '';
    errorMessage = '';
  }

  function cloneRules(): LensRules {
    return cloneLensRules(draft.rules);
  }

  function updateRules(nextRules: LensRules): void {
    draft = { ...draft, rules: nextRules };
  }

  function setBlockKind(oldKind: string, rawKind: string): void {
    const nextKind = normalizeBlockKind(rawKind);
    if (!nextKind || nextKind === oldKind || draft.rules.blocks[nextKind]) return;
    const nextRules = cloneRules();
    const nextBlocks: Record<string, LensBlock> = {};
    for (const [kind, block] of Object.entries(nextRules.blocks)) {
      nextBlocks[kind === oldKind ? nextKind : kind] = block;
    }
    nextRules.blocks = nextBlocks;
    updateRules(nextRules);
  }

  function setBlockMode(kind: string, mode: BlockMode): void {
    const nextRules = cloneRules();
    const block = nextRules.blocks[kind];
    if (!block) return;
    nextRules.blocks[kind] = mode === 'none'
      ? { mode, reason: block.reason ?? 'Not independently verified by this lens.' }
      : { mode, requirements: block.requirements?.length ? block.requirements : [{ kind: 'agent', count: 1 }] };
    updateRules(nextRules);
  }

  function setBlockReason(kind: string, reason: string): void {
    const nextRules = cloneRules();
    if (!nextRules.blocks[kind]) return;
    nextRules.blocks[kind] = { ...nextRules.blocks[kind], reason };
    updateRules(nextRules);
  }

  function addBlock(): void {
    const nextRules = cloneRules();
    let candidate = 'new_claim_type';
    let suffix = 1;
    while (nextRules.blocks[candidate]) {
      suffix += 1;
      candidate = `new_claim_type_${suffix}`;
    }
    nextRules.blocks[candidate] = { mode: 'all', requirements: [{ kind: 'agent', count: 1 }] };
    updateRules(nextRules);
  }

  function removeBlock(kind: string): void {
    const nextRules = cloneRules();
    delete nextRules.blocks[kind];
    updateRules(nextRules);
  }

  function setRequirement(blockKind: string, index: number, patch: Partial<LensRequirement>): void {
    const nextRules = cloneRules();
    const block = nextRules.blocks[blockKind];
    if (!block?.requirements?.[index]) return;
    block.requirements[index] = cleanRequirement({ ...block.requirements[index], ...patch });
    updateRules(nextRules);
  }

  function addRequirement(blockKind: string): void {
    const nextRules = cloneRules();
    const block = nextRules.blocks[blockKind];
    if (!block || block.mode === 'none') return;
    block.requirements = [...(block.requirements ?? []), { kind: 'agent', count: 1 }];
    updateRules(nextRules);
  }

  function removeRequirement(blockKind: string, index: number): void {
    const nextRules = cloneRules();
    const block = nextRules.blocks[blockKind];
    if (!block?.requirements) return;
    block.requirements = block.requirements.filter((_, i) => i !== index);
    if (block.requirements.length === 0) block.requirements = [{ kind: 'agent', count: 1 }];
    updateRules(nextRules);
  }

  function setFallbackMode(mode: BlockMode): void {
    const nextRules = cloneRules();
    nextRules.fallback = mode === 'none'
      ? { mode, reason: nextRules.fallback?.reason ?? 'No fallback verification required.' }
      : { mode, requirements: nextRules.fallback?.requirements?.length ? nextRules.fallback.requirements : [{ kind: 'agent', count: 1 }] };
    updateRules(nextRules);
  }

  function setFallbackRequirement(index: number, patch: Partial<LensRequirement>): void {
    const nextRules = cloneRules();
    if (!nextRules.fallback || nextRules.fallback.mode === 'none') return;
    const requirements = nextRules.fallback.requirements ?? [{ kind: 'agent', count: 1 }];
    requirements[index] = cleanRequirement({ ...requirements[index], ...patch });
    nextRules.fallback.requirements = requirements;
    updateRules(nextRules);
  }

  function addFallbackRequirement(): void {
    const nextRules = cloneRules();
    if (!nextRules.fallback || nextRules.fallback.mode === 'none') nextRules.fallback = { mode: 'any', requirements: [] };
    nextRules.fallback.requirements = [...(nextRules.fallback.requirements ?? []), { kind: 'agent', count: 1 }];
    updateRules(nextRules);
  }

  function removeFallbackRequirement(index: number): void {
    const nextRules = cloneRules();
    if (!nextRules.fallback?.requirements) return;
    nextRules.fallback.requirements = nextRules.fallback.requirements.filter((_, i) => i !== index);
    if (nextRules.fallback.requirements.length === 0) nextRules.fallback.requirements = [{ kind: 'agent', count: 1 }];
    updateRules(nextRules);
  }

  function parseCsv(raw: string): string[] | undefined {
    const values = raw.split(',').map((part) => part.trim()).filter(Boolean);
    return values.length > 0 ? values : undefined;
  }

  function csv(value: string[] | undefined): string {
    return (value ?? []).join(', ');
  }

  function countFromInput(value: string): number {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  }

  function normalizeBlockKind(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  }

  function cleanRequirement(row: LensRequirement): LensRequirement {
    const next: LensRequirement = { kind: row.kind, count: Math.max(1, Math.floor(row.count || 1)) };
    if (row.specific?.length) next.specific = row.specific;
    if (row.allowedSources?.length) next.allowedSources = row.allowedSources;
    if (row.specificFiles?.length) next.specificFiles = row.specificFiles;
    if (row.allowedDomains?.length) next.allowedDomains = row.allowedDomains;
    return next;
  }

  function payload() {
    return {
      name: draft.name,
      description: draft.description,
      lensKind: draft.lensKind,
      scope: draft.scope,
      scopeId: draft.scope === 'org' ? draft.scopeId : undefined,
      rules: draft.rules,
      reason: draft.reason
    };
  }

  async function responseFailureMessage(response: Response, action: string): Promise<string> {
    const body = await response.json().catch(() => null) as { message?: unknown } | null;
    const message = typeof body?.message === 'string' ? body.message.trim() : '';
    return message.length > 0
      ? `${action} failed (${response.status}): ${message}`
      : `${action} failed (${response.status}).`;
  }

  async function saveLens(): Promise<void> {
    if (!isPaid) return;
    saving = true;
    notice = '';
    errorMessage = '';
    try {
      const url = draft.id ? `/api/verification/lenses/${encodeURIComponent(draft.id)}` : '/api/verification/lenses';
      const response = await fetch(url, {
        method: draft.id ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload())
      });
      if (!response.ok) {
        throw new Error(await responseFailureMessage(response, 'Save'));
      }
      const body = await response.json() as { lens: Lens };
      lenses = [body.lens, ...lenses.filter((lens) => lens.id !== body.lens.id)];
      selectedId = body.lens.id;
      draft = lensToDraft(body.lens);
      notice = draft.id ? 'Lens saved.' : 'Lens created.';
      await loadAudit(body.lens.id);
    } catch (cause) {
      errorMessage = cause instanceof Error ? cause.message : 'Could not save the lens.';
    } finally {
      saving = false;
    }
  }

  async function archiveLens(): Promise<void> {
    if (!draft.id || !isPaid) return;
    saving = true;
    notice = '';
    errorMessage = '';
    try {
      const response = await fetch(`/api/verification/lenses/${encodeURIComponent(draft.id)}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: draft.reason || 'Archived from web designer.' })
      });
      if (!response.ok) throw new Error(await responseFailureMessage(response, 'Archive'));
      lenses = lenses.filter((lens) => lens.id !== draft.id);
      startNew();
      notice = 'Lens archived.';
    } catch (cause) {
      errorMessage = cause instanceof Error ? cause.message : 'Could not archive the lens.';
    } finally {
      saving = false;
    }
  }

  async function loadAudit(id: string): Promise<void> {
    auditLoading = true;
    try {
      const response = await fetch(`/api/verification/lenses/${encodeURIComponent(id)}/audit`);
      if (!response.ok) {
        auditEntries = [];
        return;
      }
      const body = await response.json() as { audit: AuditEntry[] };
      auditEntries = body.audit;
    } finally {
      auditLoading = false;
    }
  }
</script>

<svelte:head><title>Verification lenses | ANT vNext</title></svelte:head>

<SimplePageShell
  eyebrow="Premium verification"
  title="Design a lens."
  summary={`${lenses.length} lenses visible · ${isPaid ? 'authoring enabled' : 'premium feature — read-only on OSS'}`}
>
  {#if data.lensesLoadFailed}
    <p class="alert" role="alert">Could not load verification lenses.</p>
  {/if}

  {#if !isPaid}
    <aside class="premium-note" role="note">
      <strong>Premium feature</strong>
      <span>Native apps use this contract for the primary lens-designer UI. The web fallback is read-only on OSS.</span>
    </aside>
  {/if}

  <div class="lens-workspace">
    <aside class="lens-list" aria-label="Verification lenses">
      <div class="list-head">
        <h2>Lenses</h2>
        <button type="button" onclick={startNew} disabled={!isPaid}>New</button>
      </div>
      {#if lenses.length === 0}
        <p class="empty">No lenses yet.</p>
      {:else}
        {#each lenses as lens (lens.id)}
          <button type="button" class:selected={selectedId === lens.id} class="lens-row" onclick={() => selectLens(lens.id)}>
            <span class="lens-name">{lens.name}</span>
            <span class="lens-meta">{lens.lensKind} · {lens.scope}</span>
          </button>
        {/each}
      {/if}
    </aside>

    <section class="designer" aria-label="Lens designer">
      <div class="designer-head">
        <div>
          <p class="section-kicker">Contract</p>
          <h2>{draft.id ? 'Edit lens' : 'New lens'}</h2>
        </div>
        <div class="actions">
          {#if draft.id}
            <button type="button" class="secondary" onclick={archiveLens} disabled={!isPaid || saving}>Archive</button>
          {/if}
          <button type="button" class="primary" onclick={saveLens} disabled={!isPaid || saving || draft.name.trim().length === 0}>
            {saving ? 'Saving...' : draft.id ? 'Save lens' : 'Create lens'}
          </button>
        </div>
      </div>

      {#if notice}<p class="notice" role="status">{notice}</p>{/if}
      {#if errorMessage}<p class="alert" role="alert">{errorMessage}</p>{/if}

      <div class="meta-grid">
        <label>
          <span>Name</span>
          <input bind:value={draft.name} disabled={!isPaid} maxlength="120" />
        </label>
        <label>
          <span>Lens type</span>
          <select bind:value={draft.lensKind} disabled={!isPaid}>
            {#each lensKinds as kind}<option value={kind}>{kind}</option>{/each}
          </select>
        </label>
        <label>
          <span>Scope</span>
          <select bind:value={draft.scope} disabled={!isPaid}>
            <option value="user">user</option>
            <option value="public">public</option>
            <option value="org">org</option>
          </select>
        </label>
        {#if draft.scope === 'org'}
          <label>
            <span>Org scope id</span>
            <input bind:value={draft.scopeId} disabled={!isPaid} placeholder="new-model" />
          </label>
        {/if}
        <label class="wide">
          <span>Description</span>
          <textarea bind:value={draft.description} disabled={!isPaid} rows="2" placeholder="Where this lens should be used."></textarea>
        </label>
        <label class="wide">
          <span>Audit reason</span>
          <input bind:value={draft.reason} disabled={!isPaid} maxlength="240" placeholder="Why this change is being made" />
        </label>
      </div>

      <div class="rules-head">
        <div>
          <p class="section-kicker">What can be verified</p>
          <h3>Block rules</h3>
        </div>
        <button type="button" class="secondary" onclick={addBlock} disabled={!isPaid}>Add claim type</button>
      </div>

      <div class="blocks">
        {#each blockEntries as [kind, block] (kind)}
          <section class="block-row">
            <div class="block-top">
              <label>
                <span>Claim type</span>
                <input value={kind} disabled={!isPaid} onblur={(event) => setBlockKind(kind, event.currentTarget.value)} />
              </label>
              <label>
                <span>Mode</span>
                <select value={block.mode} disabled={!isPaid} onchange={(event) => setBlockMode(kind, event.currentTarget.value as BlockMode)}>
                  {#each blockModeLabels as mode}<option value={mode.value}>{mode.label}</option>{/each}
                </select>
              </label>
              <button type="button" class="icon-btn" onclick={() => removeBlock(kind)} disabled={!isPaid} aria-label={`Remove ${kind}`}>×</button>
            </div>

            {#if block.mode === 'none'}
              <label class="waiver">
                <span>Waiver reason</span>
                <input value={block.reason ?? ''} disabled={!isPaid} oninput={(event) => setBlockReason(kind, event.currentTarget.value)} />
              </label>
            {:else}
              <table class="requirements">
                <thead><tr><th>Verify by</th><th>How many</th><th>Specific agents / people</th><th>Sources / files / websites</th><th></th></tr></thead>
                <tbody>
                  {#each block.requirements ?? [] as requirement, index}
                    <tr>
                      <td>
                        <select value={requirement.kind} disabled={!isPaid} onchange={(event) => setRequirement(kind, index, { kind: event.currentTarget.value as RequirementKind })}>
                          {#each requirementKinds as requirementKind}<option value={requirementKind}>{requirementKind}</option>{/each}
                        </select>
                      </td>
                      <td><input type="number" min="1" value={requirement.count} disabled={!isPaid} oninput={(event) => setRequirement(kind, index, { count: countFromInput(event.currentTarget.value) })} /></td>
                      <td><input value={csv(requirement.specific)} disabled={!isPaid} placeholder="@agent, James" oninput={(event) => setRequirement(kind, index, { specific: parseCsv(event.currentTarget.value) })} /></td>
                      <td>
                        <input
                          value={csv(requirement.allowedSources ?? requirement.specificFiles ?? requirement.allowedDomains)}
                          disabled={!isPaid}
                          placeholder="source ids, file paths, domains"
                          oninput={(event) => {
                            const values = parseCsv(event.currentTarget.value);
                            if (requirement.kind === 'file' || requirement.kind === 'filesystem') setRequirement(kind, index, { specificFiles: values, allowedSources: undefined, allowedDomains: undefined });
                            else if (requirement.kind === 'website') setRequirement(kind, index, { allowedDomains: values, allowedSources: undefined, specificFiles: undefined });
                            else setRequirement(kind, index, { allowedSources: values, specificFiles: undefined, allowedDomains: undefined });
                          }}
                        />
                      </td>
                      <td><button type="button" class="icon-btn" onclick={() => removeRequirement(kind, index)} disabled={!isPaid} aria-label="Remove requirement">×</button></td>
                    </tr>
                  {/each}
                </tbody>
              </table>
              <button type="button" class="add-small" onclick={() => addRequirement(kind)} disabled={!isPaid}>Add verification row</button>
            {/if}
          </section>
        {/each}
      </div>

      <section class="fallback-block">
        <div class="rules-head compact">
          <div>
            <p class="section-kicker">Fallback</p>
            <h3>When no block rule matches</h3>
          </div>
          <select value={draft.rules.fallback?.mode ?? 'none'} disabled={!isPaid} onchange={(event) => setFallbackMode(event.currentTarget.value as BlockMode)}>
            {#each blockModeLabels as mode}<option value={mode.value}>{mode.label}</option>{/each}
          </select>
        </div>
        {#if draft.rules.fallback?.mode === 'none'}
          <p class="empty">No fallback verification is required.</p>
        {:else}
          <table class="requirements">
            <thead><tr><th>Verify by</th><th>How many</th><th>Specific agents / people</th><th>Sources / files / websites</th><th></th></tr></thead>
            <tbody>
              {#each fallbackRequirements as requirement, index}
                <tr>
                  <td>
                    <select value={requirement.kind} disabled={!isPaid} onchange={(event) => setFallbackRequirement(index, { kind: event.currentTarget.value as RequirementKind })}>
                      {#each requirementKinds as requirementKind}<option value={requirementKind}>{requirementKind}</option>{/each}
                    </select>
                  </td>
                  <td><input type="number" min="1" value={requirement.count} disabled={!isPaid} oninput={(event) => setFallbackRequirement(index, { count: countFromInput(event.currentTarget.value) })} /></td>
                  <td><input value={csv(requirement.specific)} disabled={!isPaid} placeholder="@agent, James" oninput={(event) => setFallbackRequirement(index, { specific: parseCsv(event.currentTarget.value) })} /></td>
                  <td><input value={csv(requirement.allowedSources ?? requirement.specificFiles ?? requirement.allowedDomains)} disabled={!isPaid} placeholder="source ids, file paths, domains" oninput={(event) => setFallbackRequirement(index, { allowedSources: parseCsv(event.currentTarget.value) })} /></td>
                  <td><button type="button" class="icon-btn" onclick={() => removeFallbackRequirement(index)} disabled={!isPaid} aria-label="Remove fallback requirement">×</button></td>
                </tr>
              {/each}
            </tbody>
          </table>
          <button type="button" class="add-small" onclick={addFallbackRequirement} disabled={!isPaid}>Add fallback row</button>
        {/if}
      </section>

      <section class="audit-panel" aria-label="Lens audit trail">
        <div class="rules-head compact">
          <div>
            <p class="section-kicker">Audit</p>
            <h3>Change trail</h3>
          </div>
          {#if draft.id}<button type="button" class="secondary" onclick={() => loadAudit(draft.id as string)} disabled={auditLoading}>Refresh</button>{/if}
        </div>
        {#if !draft.id}
          <p class="empty">Audit starts when the lens is created.</p>
        {:else if auditLoading}
          <p class="empty">Loading audit...</p>
        {:else if auditEntries.length === 0}
          <p class="empty">No visible audit rows.</p>
        {:else}
          <ol class="audit-list">
            {#each auditEntries as entry (entry.id)}
              <li><strong>{entry.action}</strong> by {entry.actorHandle} · {new Date(entry.createdAtMs).toLocaleString()}{entry.reason ? ` · ${entry.reason}` : ''}</li>
            {/each}
          </ol>
        {/if}
      </section>
    </section>
  </div>
</SimplePageShell>

<style>
  .alert, .notice, .premium-note {
    margin: 0 0 1rem;
    padding: 0.8rem 1rem;
    border-radius: 0.7rem;
    border: 1px solid var(--line-soft);
    background: var(--surface-card);
    color: var(--ink-strong);
  }
  .alert { border-color: var(--warn); background: color-mix(in srgb, var(--warn) 14%, var(--surface-card)); }
  .notice { border-color: var(--ok); background: color-mix(in srgb, var(--ok) 12%, var(--surface-card)); }
  .premium-note { display: flex; gap: 0.5rem; flex-wrap: wrap; }
  .premium-note strong { color: var(--accent); }
  .lens-workspace {
    display: grid;
    grid-template-columns: minmax(220px, 300px) minmax(0, 1fr);
    gap: 1rem;
    align-items: start;
  }
  .lens-list, .designer {
    border: 1px solid var(--line-soft);
    border-radius: 0.75rem;
    background: var(--surface-card);
  }
  .lens-list { padding: 0.8rem; position: sticky; top: 5.5rem; }
  .list-head, .designer-head, .rules-head, .block-top, .actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }
  .list-head h2, .designer h2, .designer h3 { margin: 0; color: var(--ink-strong); }
  .list-head h2 { font-size: 0.95rem; }
  .lens-row {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.2rem;
    margin-top: 0.45rem;
    padding: 0.65rem;
    border: 1px solid transparent;
    border-radius: 0.55rem;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }
  .lens-row:hover, .lens-row.selected { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent); }
  .lens-name { font-weight: 800; color: var(--ink-strong); }
  .lens-meta, .section-kicker, .empty { color: var(--ink-soft); font-size: 0.78rem; }
  .section-kicker { margin: 0 0 0.2rem; font-weight: 900; text-transform: uppercase; letter-spacing: 0.06em; }
  .designer { padding: 1rem; min-width: 0; }
  .meta-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.75rem;
    margin: 1rem 0;
  }
  label { display: flex; flex-direction: column; gap: 0.3rem; min-width: 0; }
  label span { font-size: 0.72rem; font-weight: 900; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-soft); }
  .wide { grid-column: 1 / -1; }
  input, textarea, select {
    width: 100%;
    box-sizing: border-box;
    padding: 0.5rem 0.6rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.45rem;
    background: var(--bg);
    color: var(--ink-strong);
    font: inherit;
    min-width: 0;
  }
  input:disabled, textarea:disabled, select:disabled { opacity: 0.7; cursor: not-allowed; }
  button {
    border: 1px solid var(--line-soft);
    border-radius: 0.5rem;
    background: var(--surface-card);
    color: var(--ink-strong);
    font: inherit;
    font-weight: 850;
    cursor: pointer;
  }
  button:disabled { opacity: 0.45; cursor: not-allowed; }
  .primary { padding: 0.55rem 0.9rem; border-color: var(--accent); background: var(--accent); color: white; }
  .secondary, .list-head button, .add-small { padding: 0.45rem 0.75rem; }
  .icon-btn { width: 2rem; height: 2rem; flex: 0 0 auto; font-size: 1rem; }
  .blocks { display: grid; gap: 0.8rem; margin-top: 0.75rem; }
  .block-row, .fallback-block, .audit-panel {
    border: 1px solid var(--line-soft);
    border-radius: 0.65rem;
    background: var(--bg);
    padding: 0.8rem;
  }
  .block-top { grid-template-columns: minmax(10rem, 1fr) minmax(12rem, 18rem) auto; }
  .waiver { margin-top: 0.75rem; }
  .requirements {
    width: 100%;
    border-collapse: collapse;
    margin-top: 0.75rem;
    font-size: 0.85rem;
  }
  .requirements th, .requirements td {
    padding: 0.45rem;
    border-bottom: 1px solid var(--line-soft);
    text-align: left;
    vertical-align: middle;
  }
  .requirements th {
    font-size: 0.68rem;
    color: var(--ink-soft);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .add-small { margin-top: 0.6rem; }
  .fallback-block, .audit-panel { margin-top: 1rem; }
  .compact { align-items: flex-start; }
  .audit-list { margin: 0.75rem 0 0; padding-left: 1.2rem; color: var(--ink-soft); }
  .audit-list li { margin: 0.35rem 0; }
  @media (max-width: 900px) {
    .lens-workspace { grid-template-columns: 1fr; }
    .lens-list { position: static; }
    .meta-grid { grid-template-columns: 1fr; }
    .designer-head, .rules-head, .block-top { align-items: stretch; flex-direction: column; }
    .actions { justify-content: flex-start; flex-wrap: wrap; }
    .requirements { display: block; overflow-x: auto; }
  }
</style>
