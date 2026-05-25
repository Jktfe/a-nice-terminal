<!--
  /vault — Vault management page (OSS-tier per JWPK msg_u7r6znc3ec).

  Browse archived rooms (post-Kill+Archive / post-room-archive). Each row
  has a "Mine for memories" button that runs a digest pass and surfaces
  candidate memory entries for the operator to accept / edit / reject.

  v1 shell: page exists, lists archives, mining endpoint returns a stub
  payload so the review UI works end-to-end. Real LLM-driven digest
  lands in a follow-up commit once we pick the engine + storage. The
  candidate review queue + accept-to-memory wiring is the next layer.
-->
<script lang="ts">
  import type { PageData } from './$types';
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import Explainable from '$lib/components/Explainable.svelte';

  let { data }: { data: PageData } = $props();

  type MemoryCandidate = {
    id: string;
    kind: 'project' | 'feedback' | 'reference' | 'user';
    title: string;
    body: string;
    sourceMessageId?: string;
    confidence: number;
  };

  type MineResult = { candidates: MemoryCandidate[]; status: 'stub' | 'ready' };

  let miningByArchive = $state<Map<string, boolean>>(new Map());
  let resultsByArchive = $state<Map<string, MineResult>>(new Map());
  let errorByArchive = $state<Map<string, string>>(new Map());

  function formatArchivedAt(ms: number | null): string {
    if (!ms) return 'unknown';
    return new Date(ms).toLocaleString();
  }

  function setMining(archiveId: string, value: boolean): void {
    const next = new Map(miningByArchive);
    if (value) next.set(archiveId, true);
    else next.delete(archiveId);
    miningByArchive = next;
  }

  function setResult(archiveId: string, value: MineResult | null): void {
    const next = new Map(resultsByArchive);
    if (value) next.set(archiveId, value);
    else next.delete(archiveId);
    resultsByArchive = next;
  }

  function setError(archiveId: string, message: string | null): void {
    const next = new Map(errorByArchive);
    if (message) next.set(archiveId, message);
    else next.delete(archiveId);
    errorByArchive = next;
  }

  async function mine(archiveId: string): Promise<void> {
    if (miningByArchive.get(archiveId)) return;
    setMining(archiveId, true);
    setError(archiveId, null);
    try {
      const response = await fetch(`/api/vault/${encodeURIComponent(archiveId)}/mine`, {
        method: 'POST'
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(failure.message ?? 'Could not mine archive.');
      }
      const body = (await response.json()) as MineResult;
      setResult(archiveId, body);
    } catch (cause) {
      setError(archiveId, cause instanceof Error ? cause.message : 'Could not mine archive.');
    } finally {
      setMining(archiveId, false);
    }
  }
</script>

<svelte:head>
  <title>Vault · ANT</title>
</svelte:head>

<SimplePageShell>
  <header class="vault-header">
    <h1>Vault</h1>
    <p class="vault-tagline">
      Archived rooms keep their full transcripts. Mine them to surface candidate memories
      future agents can pull from — the OSS-tier version of agents that learn from your past.
    </p>
  </header>

  {#if data.fetchFailed}
    <p class="vault-error" role="alert">
      Could not load the vault. You may need to sign in first via the rooms page.
    </p>
  {:else if data.archives.length === 0}
  <Explainable explainKey="vault-content">
  <section class="vault-empty">
      <h2>Nothing archived yet</h2>
      <p>
        Archive a room (via the room header) or Kill+Archive a terminal (from /terminals)
        and it'll show up here, ready for memory mining.
      </p>
    </section>
  </Explainable>
  {:else}
    <ul class="vault-list">
      {#each data.archives as archive (archive.roomId)}
        {@const isMining = miningByArchive.get(archive.roomId) === true}
        {@const mineResult = resultsByArchive.get(archive.roomId)}
        {@const mineError = errorByArchive.get(archive.roomId)}
        <li class="vault-row">
          <header class="vault-row-header">
            <div class="vault-row-title">
              <h2>{archive.name}</h2>
              <p class="vault-row-meta">
                Archived <time>{formatArchivedAt(archive.archivedAtMs)}</time>
                · {archive.messageCount} messages
                · created by <span class="vault-handle">{archive.whoCreatedIt}</span>
              </p>
            </div>
            <button
              type="button"
              class="vault-mine-btn"
              disabled={isMining || !archive.hasMineableContent}
              onclick={() => void mine(archive.roomId)}
              title={archive.hasMineableContent
                ? 'Run a digest pass to surface candidate memories'
                : 'Archive is too short to mine (need at least 3 messages)'}
            >
              {isMining ? 'Mining…' : 'Mine for memories'}
            </button>
          </header>

          {#if archive.summary && archive.summary.length > 0}
            <p class="vault-summary">{archive.summary}</p>
          {/if}

          {#if mineError}
            <p class="vault-error" role="alert">{mineError}</p>
          {/if}

          {#if mineResult}
            <section class="vault-results" aria-label="Memory candidates">
              <header class="vault-results-header">
                <h3>{mineResult.candidates.length} candidate memories</h3>
                {#if mineResult.status === 'stub'}
                  <span class="vault-stub-tag">stub digest — real engine ships in a follow-up</span>
                {/if}
              </header>
              <ul class="vault-candidates">
                {#each mineResult.candidates as candidate (candidate.id)}
                  <li class={`vault-candidate kind-${candidate.kind}`}>
                    <header class="vault-candidate-header">
                      <span class={`vault-candidate-kind kind-${candidate.kind}`}>{candidate.kind}</span>
                      <h4>{candidate.title}</h4>
                      <span class="vault-candidate-confidence">{Math.round(candidate.confidence * 100)}%</span>
                    </header>
                    <p class="vault-candidate-body">{candidate.body}</p>
                    <footer class="vault-candidate-actions">
                      <button type="button" class="vault-action-btn" disabled>Accept (coming soon)</button>
                      <button type="button" class="vault-action-btn ghost" disabled>Edit</button>
                      <button type="button" class="vault-action-btn ghost" disabled>Reject</button>
                    </footer>
                  </li>
                {/each}
              </ul>
            </section>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</SimplePageShell>

<style>
  .vault-header {
    margin-bottom: 1.5rem;
  }
  .vault-header h1 {
    margin: 0 0 0.4rem;
    font-size: 1.8rem;
    font-weight: 900;
    color: var(--ink-strong);
  }
  .vault-tagline {
    margin: 0;
    color: var(--ink-soft);
    font-size: 0.95rem;
    line-height: 1.5;
    max-width: 56ch;
  }
  .vault-empty {
    padding: 2rem 1.5rem;
    border: 1px dashed var(--surface-edge);
    border-radius: 1rem;
    background: var(--surface-card);
    text-align: center;
  }
  .vault-empty h2 {
    margin: 0 0 0.4rem;
    font-size: 1.1rem;
    color: var(--ink-strong);
  }
  .vault-empty p {
    margin: 0;
    color: var(--ink-soft);
    font-size: 0.9rem;
  }
  .vault-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }
  .vault-row {
    padding: 1.1rem 1.3rem;
    border: 1px solid var(--surface-edge);
    border-radius: 1rem;
    background: var(--surface-card);
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
  }
  .vault-row-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .vault-row-title h2 {
    margin: 0 0 0.2rem;
    font-size: 1.1rem;
    font-weight: 800;
    color: var(--ink-strong);
  }
  .vault-row-meta {
    margin: 0;
    color: var(--ink-soft);
    font-size: 0.82rem;
  }
  .vault-handle {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
  }
  .vault-mine-btn {
    padding: 0.55rem 1rem;
    border: none;
    border-radius: 999px;
    background: var(--accent);
    color: white;
    font-weight: 800;
    font-size: 0.85rem;
    cursor: pointer;
    white-space: nowrap;
  }
  .vault-mine-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .vault-summary {
    margin: 0;
    color: var(--ink-strong);
    font-size: 0.92rem;
    line-height: 1.5;
  }
  .vault-error {
    margin: 0;
    padding: 0.55rem 0.75rem;
    border-radius: 0.5rem;
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--accent);
    font-size: 0.85rem;
  }
  .vault-results {
    padding: 0.85rem 1rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.7rem;
    background: var(--bg);
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .vault-results-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .vault-results-header h3 {
    margin: 0;
    font-size: 0.95rem;
    color: var(--ink-strong);
  }
  .vault-stub-tag {
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--ink-soft) 18%, transparent);
    color: var(--ink-soft);
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .vault-candidates {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }
  .vault-candidate {
    padding: 0.65rem 0.8rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.55rem;
    background: var(--surface-card);
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .vault-candidate-header {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .vault-candidate-header h4 {
    margin: 0;
    flex: 1 1 auto;
    font-size: 0.9rem;
    font-weight: 700;
    color: var(--ink-strong);
  }
  .vault-candidate-kind {
    padding: 0.1rem 0.45rem;
    border-radius: 999px;
    font-size: 0.7rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .vault-candidate-kind.kind-project   { background: #dbeafe; color: #1d4ed8; }
  .vault-candidate-kind.kind-feedback  { background: #fef3c7; color: #b45309; }
  .vault-candidate-kind.kind-reference { background: #dcfce7; color: #15803d; }
  .vault-candidate-kind.kind-user      { background: #f3e8ff; color: #6b21a8; }
  .vault-candidate-confidence {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 0.75rem;
    color: var(--ink-soft);
  }
  .vault-candidate-body {
    margin: 0;
    font-size: 0.85rem;
    color: var(--ink-strong);
    line-height: 1.5;
  }
  .vault-candidate-actions {
    display: flex;
    gap: 0.35rem;
    flex-wrap: wrap;
  }
  .vault-action-btn {
    padding: 0.35rem 0.75rem;
    border-radius: 999px;
    border: 1px solid var(--accent);
    background: var(--accent);
    color: white;
    font-weight: 700;
    font-size: 0.78rem;
    cursor: pointer;
  }
  .vault-action-btn.ghost {
    background: transparent;
    color: var(--ink-strong);
    border-color: var(--line-soft);
  }
  .vault-action-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
</style>
