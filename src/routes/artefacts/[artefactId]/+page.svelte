<script lang="ts">
  import Explainable from '$lib/components/Explainable.svelte';
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import UniverViewer from '$lib/components/UniverViewer.svelte';
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
        assignedTo: string | null;
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
  // F-Univer slice: when the artefact has a univer-json body, render
  // it via the Univer canvas instead of falling back to the iframe
  // placeholder. The content row is optional — a freshly-created deck
  // / doc / sheet seeds an empty snapshot in the viewer until first
  // save.
  const shouldRenderUniver = $derived(
    isUniverKind && (data.content?.contentFormat === 'univer-json' || data.content === null)
  );
  let viewerError = $state('');
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
  explainKey="artefact-view"
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
    <Explainable explainKey="artefact-validate">
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
    </Explainable>
  {/if}

  {#if shouldRenderUniver}
    <Explainable explainKey="artefact-frame">
    <section class="univer-shell" aria-label="Univer workspace">
      <header>
        <span>{kindLabel}</span>
        <strong>Univer canvas</strong>
      </header>
      {#if viewerError}
        <p class="viewer-error" role="alert">Viewer error: {viewerError}</p>
      {/if}
      <UniverViewer
        kind={artefact.kind as 'deck' | 'doc' | 'spreadsheet'}
        artefactId={artefact.id}
        roomId={artefact.roomId}
        contentBody={data.content?.contentBody ?? null}
        contentFormat={data.content?.contentFormat ?? null}
        onError={(message) => { viewerError = message; }}
      />
    </section>
    </Explainable>
  {:else if isUniverKind}
    <Explainable explainKey="artefact-frame">
    <section class="univer-shell" aria-label="Univer workspace">
      <header>
        <span>{kindLabel}</span>
        <strong>Legacy iframe shell</strong>
      </header>
      {#if canFrame && artefact.refUrl}
        <iframe title={artefact.title} src={artefact.refUrl}></iframe>
      {:else}
        <div class="empty-state">
          <p>No inline source is attached yet.</p>
        </div>
      {/if}
    </section>
    </Explainable>
  {:else if canFrame && artefact.refUrl}
    <Explainable explainKey="artefact-frame">
    <iframe class="generic-frame" title={artefact.title} src={artefact.refUrl}></iframe>
    </Explainable>
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
    font-size: 0.92rem;
  }
  .validation-panel {
    display: grid;
    gap: 0.6rem;
    margin-bottom: 1.2rem;
    padding: 0.9rem;
    border: 1px dashed var(--accent);
    border-radius: 0.6rem;
    background: var(--surface-raised);
  }
  .panel-label {
    display: block;
    font-size: 0.75rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--ink-muted);
  }
  .validate-button {
    justify-self: start;
    padding: 0.35rem 0.8rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.35rem;
    background: var(--surface-card);
    color: var(--ink-strong);
    font: inherit;
    font-weight: 700;
    font-size: 0.82rem;
    cursor: pointer;
  }
  .validate-button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .validate-button:disabled { opacity: 0.5; cursor: not-allowed; }
  .validation-error {
    margin: 0;
    color: var(--accent);
    font-size: 0.82rem;
  }
  .score-row {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    font-size: 0.82rem;
  }
  .score {
    padding: 0.12rem 0.45rem;
    border-radius: 0.25rem;
    background: var(--surface-card);
    font-weight: 800;
    font-size: 0.9rem;
  }
  .work-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.78rem;
  }
  .secondary-button {
    padding: 0.25rem 0.6rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.3rem;
    background: var(--surface-card);
    color: var(--ink-strong);
    font: inherit;
    font-weight: 700;
    font-size: 0.78rem;
    cursor: pointer;
  }
  .secondary-button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .secondary-button:disabled { opacity: 0.5; cursor: not-allowed; }
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
  .viewer-error {
    margin: 0.5rem 0.9rem;
    padding: 0.45rem 0.75rem;
    color: var(--warn, #c92020);
    background: color-mix(in srgb, var(--warn, #c92020) 8%, transparent);
    border-radius: 0.4rem;
    font-size: 0.85rem;
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
