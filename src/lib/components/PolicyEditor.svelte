<!--
  PolicyEditor — block-kind requirements table.

  The verification policy body is a record of block-kind → requirement.
  This editor presents that as a table where each row is one block-kind
  with editable agents/humans counts, an optional named-verifier list,
  and a 'verify live' flag (only meaningful for link-kind blocks but
  exposed for any kind in case authors want it). A 'fallback' requirement
  applies to any block-kind not explicitly listed.

  Block-kind names are free-form strings — there's no fixed enum.
  Strawman defaults seeded on first open are JWPK's examples from the
  artefacts thread: external_link, external_doc_summary, critical_statistic,
  non_impactful_evidence, prose, design_decision.
-->
<script lang="ts">
  type Requirement = {
    agents?: number;
    humans?: number;
    named_verifiers?: string[];
    verifyLive?: boolean;
  };

  type Body = {
    blocks: Record<string, Requirement>;
    fallback?: Requirement;
  };

  type Props = {
    value: Body;
    onChange: (next: Body) => void;
    disabled?: boolean;
  };

  let { value, onChange, disabled = false }: Props = $props();

  const KIND_ORDER = $derived(Object.keys(value.blocks ?? {}));

  function setKindRequirement(kind: string, patch: Partial<Requirement>): void {
    const nextBlocks = { ...value.blocks };
    nextBlocks[kind] = { ...nextBlocks[kind], ...patch };
    onChange({ ...value, blocks: nextBlocks });
  }

  function renameKind(oldKind: string, newKind: string): void {
    const trimmed = newKind.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (!trimmed || trimmed === oldKind) return;
    if (value.blocks[trimmed]) return; // conflict — silently no-op
    const nextBlocks: Record<string, Requirement> = {};
    for (const k of Object.keys(value.blocks)) {
      nextBlocks[k === oldKind ? trimmed : k] = value.blocks[k];
    }
    onChange({ ...value, blocks: nextBlocks });
  }

  function deleteKind(kind: string): void {
    const nextBlocks = { ...value.blocks };
    delete nextBlocks[kind];
    onChange({ ...value, blocks: nextBlocks });
  }

  function addKind(): void {
    let candidate = 'new_block_kind';
    let counter = 1;
    while (value.blocks[candidate]) {
      counter += 1;
      candidate = `new_block_kind_${counter}`;
    }
    onChange({ ...value, blocks: { ...value.blocks, [candidate]: { agents: 1 } } });
  }

  function setFallback(patch: Partial<Requirement>): void {
    onChange({ ...value, fallback: { ...(value.fallback ?? {}), ...patch } });
  }

  function intOrUndefined(raw: string): number | undefined {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    return undefined;
  }

  function parseHandleList(raw: string): string[] {
    return raw.split(',').map((part) => part.trim()).filter((part) => part.length > 0);
  }
</script>

<table class="policy-editor">
  <thead>
    <tr>
      <th>Block kind</th>
      <th>Agents</th>
      <th>Humans</th>
      <th>Named verifiers (comma-sep)</th>
      <th>Verify live</th>
      <th aria-label="Actions"></th>
    </tr>
  </thead>
  <tbody>
    {#each KIND_ORDER as kind (kind)}
      <tr>
        <td>
          <input
            type="text"
            class="kind-input"
            value={kind}
            {disabled}
            onblur={(event) => renameKind(kind, event.currentTarget.value)}
          />
        </td>
        <td>
          <input
            type="number"
            min="0"
            value={value.blocks[kind].agents ?? ''}
            {disabled}
            onchange={(event) => setKindRequirement(kind, { agents: intOrUndefined(event.currentTarget.value) })}
          />
        </td>
        <td>
          <input
            type="number"
            min="0"
            value={value.blocks[kind].humans ?? ''}
            {disabled}
            onchange={(event) => setKindRequirement(kind, { humans: intOrUndefined(event.currentTarget.value) })}
          />
        </td>
        <td>
          <input
            type="text"
            value={(value.blocks[kind].named_verifiers ?? []).join(', ')}
            placeholder="@handle, @other"
            {disabled}
            onchange={(event) => setKindRequirement(kind, { named_verifiers: parseHandleList(event.currentTarget.value) })}
          />
        </td>
        <td>
          <input
            type="checkbox"
            checked={value.blocks[kind].verifyLive ?? false}
            {disabled}
            onchange={(event) => setKindRequirement(kind, { verifyLive: event.currentTarget.checked })}
          />
        </td>
        <td>
          <button type="button" class="row-delete" {disabled} onclick={() => deleteKind(kind)} aria-label={`Remove ${kind}`}>×</button>
        </td>
      </tr>
    {/each}
    <tr class="fallback-row">
      <td><strong>(fallback — any other kind)</strong></td>
      <td>
        <input
          type="number"
          min="0"
          value={value.fallback?.agents ?? ''}
          {disabled}
          onchange={(event) => setFallback({ agents: intOrUndefined(event.currentTarget.value) })}
        />
      </td>
      <td>
        <input
          type="number"
          min="0"
          value={value.fallback?.humans ?? ''}
          {disabled}
          onchange={(event) => setFallback({ humans: intOrUndefined(event.currentTarget.value) })}
        />
      </td>
      <td>
        <input
          type="text"
          value={(value.fallback?.named_verifiers ?? []).join(', ')}
          placeholder="@handle"
          {disabled}
          onchange={(event) => setFallback({ named_verifiers: parseHandleList(event.currentTarget.value) })}
        />
      </td>
      <td>
        <input
          type="checkbox"
          checked={value.fallback?.verifyLive ?? false}
          {disabled}
          onchange={(event) => setFallback({ verifyLive: event.currentTarget.checked })}
        />
      </td>
      <td></td>
    </tr>
  </tbody>
</table>

{#if !disabled}
  <button type="button" class="add-row" onclick={addKind}>+ Add block kind</button>
{/if}

<style>
  .policy-editor {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.88rem;
  }
  .policy-editor th, .policy-editor td {
    padding: 0.5rem 0.55rem;
    border-bottom: 1px solid var(--line-soft);
    text-align: left;
    vertical-align: middle;
  }
  .policy-editor th {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--ink-soft);
    border-bottom: 1px solid var(--surface-edge);
    background: var(--bg);
  }
  .policy-editor input[type='text'],
  .policy-editor input[type='number'] {
    padding: 0.4rem 0.55rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.4rem;
    background: var(--surface-card);
    color: var(--ink-strong);
    font: inherit;
    width: 100%;
    min-width: 4rem;
  }
  .policy-editor input[type='number'] { width: 5rem; }
  .policy-editor .kind-input { font-family: 'JetBrains Mono', monospace; font-weight: 700; }
  .policy-editor input:disabled { opacity: 0.6; cursor: not-allowed; }
  .row-delete {
    width: 1.6rem;
    height: 1.6rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.4rem;
    background: var(--surface-card);
    color: var(--ink-soft);
    font: inherit;
    font-weight: 800;
    cursor: pointer;
  }
  .row-delete:hover:not(:disabled) { border-color: var(--warn); color: var(--warn); }
  .row-delete:disabled { opacity: 0.4; cursor: not-allowed; }
  .fallback-row { background: var(--bg); }
  .add-row {
    margin-top: 0.85rem;
    padding: 0.5rem 1rem;
    border: 1px dashed var(--line-soft);
    border-radius: 999px;
    background: transparent;
    color: var(--ink-strong);
    font: inherit;
    font-weight: 800;
    cursor: pointer;
  }
  .add-row:hover { border-color: var(--accent); color: var(--accent); }
</style>
