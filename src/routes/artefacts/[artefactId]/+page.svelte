<script lang="ts">
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  type ValidationClaim = {
    id: string;
    kind: string;
    text: string;
    source: { pointer: string; url?: string };
  };

  type ValidationClaimResult = {
    id: string;
    kind: string;
    passed: boolean;
    required: string;
  };

  type ValidationResult = {
    lens: { slug: string; name: string };
    claims: ValidationClaim[];
    score: {
      totalClaims: number;
      passedClaims: number;
      percent: number;
      claimResults: ValidationClaimResult[];
    };
    orchestration: {
      summary: {
        assignments: number;
        missingSlots: number;
      };
    };
    validationWork: null | {
      created: number;
      reused: number;
      items: Array<{
        taskId: string;
        taskTitle: string;
        claimId: string;
        sourcePointer: string;
        verifierKind: string;
        reused: boolean;
      }>;
    };
  };

  const artefact = $derived(data.artefact);
  const canFrame = $derived(
    artefact.refUrl
      ? artefact.refUrl.startsWith('/') || artefact.refUrl.startsWith('http://') || artefact.refUrl.startsWith('https://')
      : false
  );
  const isUniverKind = $derived(['spreadsheet', 'doc', 'deck'].includes(artefact.kind));
  const canValidate = $derived(['doc', 'deck'].includes(artefact.kind));
  const kindLabel = $derived(artefact.kind === 'doc' ? 'Document' : artefact.kind === 'deck' ? 'Slides' : artefact.kind === 'spreadsheet' ? 'Spreadsheet' : 'Artefact');
  let validationLoading = $state(false);
  let workLoading = $state(false);
  let validationError = $state('');
  let validationResult = $state<ValidationResult | null>(null);

  async function runValidation(createWork = false) {
    if (createWork) workLoading = true;
    else validationLoading = true;
    const existing = validationResult;
    validationError = '';
    try {
      const response = await fetch(`/api/artefacts/${encodeURIComponent(artefact.id)}/validate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ policySlug: 'jks-validation-rule', createWork })
      });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `Validation failed (${response.status})`);
      }
      validationResult = await response.json() as ValidationResult;
    } catch (err) {
      validationResult = existing;
      validationError = err instanceof Error ? err.message : 'Validation failed.';
    } finally {
      validationLoading = false;
      workLoading = false;
    }
  }
</script>

<svelte:head><title>{artefact.title} | Artefact | ANT</title></svelte:head>

<SimplePageShell
  eyebrow={isUniverKind ? `Univer ${kindLabel}` : kindLabel}
  title={artefact.title}
  summary={`${kindLabel} from room ${artefact.roomId}${artefact.createdBy ? ` · by ${artefact.createdBy}` : ''}`}
>
  <div class="toolbar" role="toolbar" aria-label="Artefact controls">
    <a class="back" href={`/rooms/${encodeURIComponent(artefact.roomId)}`}>← Back to room</a>
    <span class="spacer"></span>
    {#if artefact.refUrl}
      <a class="action" href={artefact.refUrl} target="_blank" rel="noreferrer">Open source</a>
    {/if}
  </div>

  {#if artefact.summary}
    <p class="summary">{artefact.summary}</p>
  {/if}

  {#if canValidate}
    <section class="validation-panel" aria-label="Validation lens">
      <div>
        <span class="panel-label">Validation Lens</span>
        <strong>JK's Validation Rule</strong>
      </div>
      <button class="validate-button" type="button" onclick={() => runValidation(false)} disabled={validationLoading || workLoading}>
        {validationLoading ? 'Validating...' : 'Validate claims'}
      </button>
      {#if validationError}
        <p class="validation-error">{validationError}</p>
      {/if}
      {#if validationResult}
        <div class="score-row" aria-label="Validation score">
          <span class="score">{validationResult.score.percent}%</span>
          <span>{validationResult.score.passedClaims}/{validationResult.score.totalClaims} claims pass this lens</span>
          <span>{validationResult.orchestration.summary.missingSlots} missing verifier slots</span>
        </div>
        <div class="work-row">
          <button class="secondary-button" type="button" onclick={() => runValidation(true)} disabled={workLoading || validationLoading}>
            {workLoading ? 'Creating work...' : 'Create verifier work'}
          </button>
          {#if validationResult.validationWork}
            <span>
              {validationResult.validationWork.created} created · {validationResult.validationWork.reused} already existed
            </span>
          {:else}
            <span>Creates room tasks for missing verifier slots without marking claims as trusted.</span>
          {/if}
        </div>
        <ol class="claim-list">
          {#each validationResult.claims as claim}
            {@const result = validationResult.score.claimResults.find((entry) => entry.id === claim.id)}
            <li>
              <span class:pass={result?.passed} class:fail={!result?.passed}>
                {result?.passed ? 'verified' : 'unverified'}
              </span>
              <div>
                <strong>{claim.kind}</strong>
                <p>{claim.text}</p>
                <small>{result?.required ?? 'No requirement found'} · {claim.source.pointer}</small>
              </div>
            </li>
          {/each}
        </ol>
      {/if}
    </section>
  {/if}

  {#if isUniverKind}
    <section class="univer-shell" aria-label="Univer workspace">
      <header>
        <span>{kindLabel}</span>
        <strong>Viewer shell</strong>
      </header>
      {#if canFrame && artefact.refUrl}
        <iframe title={artefact.title} src={artefact.refUrl}></iframe>
      {:else}
        <div class="empty-state">
          <p>No inline source is attached yet.</p>
        </div>
      {/if}
    </section>
  {:else if canFrame && artefact.refUrl}
    <iframe class="generic-frame" title={artefact.title} src={artefact.refUrl}></iframe>
  {:else}
    <div class="empty-state">
      <p>This artefact has no browser-viewable source yet.</p>
      {#if artefact.refUrl}<code>{artefact.refUrl}</code>{/if}
    </div>
  {/if}
</SimplePageShell>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-bottom: 1rem;
  }
  .spacer { flex: 1; }
  .back,
  .action {
    color: var(--ink-soft);
    text-decoration: none;
    font-weight: 800;
    font-size: 0.86rem;
  }
  .back:hover,
  .action:hover { color: var(--accent); }
  .summary {
    margin: 0 0 1rem;
    color: var(--ink-soft);
  }
  .validation-panel {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.7rem 1rem;
    align-items: start;
    padding: 0.85rem 1rem;
    margin: 0 0 1rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.5rem;
    background: var(--surface-card);
  }
  .panel-label {
    display: block;
    margin-bottom: 0.15rem;
    color: var(--ink-soft);
    font-size: 0.76rem;
    font-weight: 800;
    text-transform: uppercase;
  }
  .validate-button {
    border: 1px solid var(--line-soft);
    border-radius: 0.45rem;
    background: var(--accent);
    color: white;
    padding: 0.55rem 0.8rem;
    font-weight: 850;
    cursor: pointer;
  }
  .secondary-button {
    border: 1px solid var(--line-soft);
    border-radius: 0.45rem;
    background: transparent;
    color: var(--ink);
    padding: 0.5rem 0.75rem;
    font-weight: 850;
    cursor: pointer;
  }
  .secondary-button:disabled {
    cursor: wait;
    opacity: 0.72;
  }
  .validate-button:disabled {
    cursor: wait;
    opacity: 0.72;
  }
  .validation-error {
    grid-column: 1 / -1;
    margin: 0;
    color: #b91c1c;
    font-weight: 750;
  }
  .score-row {
    grid-column: 1 / -1;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
    align-items: baseline;
    color: var(--ink-soft);
    font-weight: 750;
  }
  .score {
    color: var(--ink);
    font-size: 1.55rem;
    font-weight: 900;
  }
  .work-row {
    grid-column: 1 / -1;
    display: flex;
    flex-wrap: wrap;
    gap: 0.65rem 1rem;
    align-items: center;
    color: var(--ink-soft);
    font-weight: 750;
  }
  .claim-list {
    grid-column: 1 / -1;
    display: grid;
    gap: 0.55rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .claim-list li {
    display: grid;
    grid-template-columns: 6.5rem 1fr;
    gap: 0.7rem;
    padding-top: 0.55rem;
    border-top: 1px solid var(--line-soft);
  }
  .claim-list p {
    margin: 0.15rem 0;
  }
  .claim-list small {
    color: var(--ink-soft);
  }
  .pass,
  .fail {
    width: fit-content;
    height: fit-content;
    border-radius: 999px;
    padding: 0.18rem 0.5rem;
    font-size: 0.74rem;
    font-weight: 900;
    text-transform: uppercase;
  }
  .pass {
    background: #dcfce7;
    color: #166534;
  }
  .fail {
    background: #fee2e2;
    color: #991b1b;
  }
  .univer-shell {
    min-height: 68vh;
    border: 1px solid var(--line-soft);
    border-radius: 0.85rem;
    background: var(--surface-card);
    overflow: hidden;
  }
  .univer-shell header {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.7rem 0.9rem;
    border-bottom: 1px solid var(--line-soft);
    color: var(--ink-soft);
    font-size: 0.84rem;
    font-weight: 800;
  }
  .univer-shell iframe,
  .generic-frame {
    width: 100%;
    min-height: 68vh;
    border: 0;
    background: white;
  }
  .generic-frame {
    border: 1px solid var(--line-soft);
    border-radius: 0.85rem;
  }
  .empty-state {
    display: grid;
    place-items: center;
    min-height: 18rem;
    padding: 2rem;
    color: var(--ink-soft);
    text-align: center;
  }
  .empty-state code {
    display: block;
    max-width: 100%;
    overflow-wrap: anywhere;
  }
</style>
