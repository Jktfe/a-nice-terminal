<!--
  TaskDetailPanel — L3 task-detail (Lane-D S2 + Task #79 edit slice).
  Renders one task's subject / assigned agent / status / priority /
  description / evidence[] / notes. Priority is editable inline and the
  blocked_by list supports add/remove against /api/tasks/:id/dependencies.
  Evidence reuses the EvidenceRef shape ({kind, ref, label?}); url/file
  kinds render as links.
-->
<script lang="ts">
  import type { Task } from '$lib/server/taskStore';

  type Props = {
    task: Task | null;
    onClose: () => void;
    allTasks?: Task[];
    onMutated?: () => void;
  };
  let { task, onClose, allTasks = [], onMutated }: Props = $props();

  let isEditingPriority = $state(false);
  let priorityDraftRaw = $state('');
  let isSavingPriority = $state(false);
  let blockerToAdd = $state('');
  let isMutatingBlockers = $state(false);
  let lastErrorMessage = $state('');

  $effect(() => {
    if (task) {
      isEditingPriority = false;
      priorityDraftRaw = task.priority === null ? '' : String(task.priority);
      lastErrorMessage = '';
      blockerToAdd = '';
    }
  });

  function isLink(kind: string): boolean {
    return kind === 'url' || kind === 'file';
  }

  function blockerTitleFor(id: string): string {
    return allTasks.find((entry) => entry.id === id)?.subject ?? id;
  }

  function statusLabel(status: string): string {
    return status
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  const availableBlockerCandidates = $derived.by(() => {
    if (!task) return [];
    return allTasks.filter(
      (candidate) =>
        candidate.id !== task.id && !task.blockedBy.includes(candidate.id)
    );
  });

  async function savePriority() {
    if (!task) return;
    const trimmed = priorityDraftRaw.trim();
    const newPriority: number | null = trimmed.length === 0 ? null : Number(trimmed);
    if (newPriority !== null && !Number.isFinite(newPriority)) {
      lastErrorMessage = 'Priority must be a number or blank.';
      return;
    }
    isSavingPriority = true;
    lastErrorMessage = '';
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ priority: newPriority })
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(failure.message ?? 'Could not save priority.');
      }
      isEditingPriority = false;
      onMutated?.();
    } catch (causeOfFailure) {
      lastErrorMessage =
        causeOfFailure instanceof Error ? causeOfFailure.message : 'Could not save priority.';
    } finally {
      isSavingPriority = false;
    }
  }

  async function addBlocker() {
    if (!task || !blockerToAdd) return;
    isMutatingBlockers = true;
    lastErrorMessage = '';
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/dependencies`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ blockerId: blockerToAdd })
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(failure.message ?? 'Could not add dependency.');
      }
      blockerToAdd = '';
      onMutated?.();
    } catch (causeOfFailure) {
      lastErrorMessage =
        causeOfFailure instanceof Error ? causeOfFailure.message : 'Could not add dependency.';
    } finally {
      isMutatingBlockers = false;
    }
  }

  async function removeBlocker(blockerId: string) {
    if (!task) return;
    isMutatingBlockers = true;
    lastErrorMessage = '';
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/dependencies`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ blockerId })
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(failure.message ?? 'Could not remove dependency.');
      }
      onMutated?.();
    } catch (causeOfFailure) {
      lastErrorMessage =
        causeOfFailure instanceof Error ? causeOfFailure.message : 'Could not remove dependency.';
    } finally {
      isMutatingBlockers = false;
    }
  }
</script>

{#if task}
  <aside class="panel" aria-label="Task detail">
    <header>
      <strong>{task.subject}</strong>
      <button type="button" class="x" onclick={onClose} aria-label="Close detail">✕</button>
    </header>
    <dl>
      <div><dt>Status</dt><dd>{statusLabel(task.status)}</dd></div>
      <div class="priority-row">
        <dt>Priority</dt>
        {#if isEditingPriority}
          <form
            class="priority-edit"
            onsubmit={(event) => { event.preventDefault(); void savePriority(); }}
          >
            <input
              type="number"
              step="1"
              bind:value={priorityDraftRaw}
              placeholder="—"
              aria-label="Priority"
              disabled={isSavingPriority}
            />
            <button type="submit" class="inline-save" disabled={isSavingPriority}>
              {isSavingPriority ? '…' : 'Save'}
            </button>
            <button
              type="button"
              class="inline-cancel"
              onclick={() => { isEditingPriority = false; priorityDraftRaw = task.priority === null ? '' : String(task.priority); }}
              disabled={isSavingPriority}
            >Cancel</button>
          </form>
        {:else}
          <dd class="priority-value">
            {task.priority ?? '—'}
            <button type="button" class="inline-edit" onclick={() => (isEditingPriority = true)} aria-label="Edit priority">Edit</button>
          </dd>
        {/if}
      </div>
      <div><dt>Agent</dt><dd>{task.assignedAgent ?? '—'}</dd></div>
      {#if task.planId}<div><dt>Plan</dt><dd>{task.planId}</dd></div>{/if}
    </dl>

    <section class="dependencies">
      <h3>Blocked by ({task.blockedBy.length})</h3>
      {#if task.blockedBy.length === 0}
        <p class="muted">No blockers.</p>
      {:else}
        <ul class="blocker-list">
          {#each task.blockedBy as blockerId (blockerId)}
            <li class="blocker-chip">
              <span class="blocker-name">{blockerTitleFor(blockerId)}</span>
              <button
                type="button"
                class="blocker-remove"
                aria-label={`Remove blocker ${blockerTitleFor(blockerId)}`}
                onclick={() => void removeBlocker(blockerId)}
                disabled={isMutatingBlockers}
              >×</button>
            </li>
          {/each}
        </ul>
      {/if}
      {#if availableBlockerCandidates.length > 0}
        <form
          class="add-blocker"
          onsubmit={(event) => { event.preventDefault(); void addBlocker(); }}
        >
          <select
            bind:value={blockerToAdd}
            aria-label="Add a blocker"
            disabled={isMutatingBlockers}
          >
            <option value="">— add a blocker —</option>
            {#each availableBlockerCandidates as candidate (candidate.id)}
              <option value={candidate.id}>{candidate.subject}</option>
            {/each}
          </select>
          <button type="submit" class="inline-save" disabled={!blockerToAdd || isMutatingBlockers}>
            {isMutatingBlockers ? '…' : 'Add'}
          </button>
        </form>
      {/if}
    </section>

    {#if lastErrorMessage}
      <p class="error" role="alert">{lastErrorMessage}</p>
    {/if}

    {#if task.description}
      <section><h3>Description</h3><pre>{task.description}</pre></section>
    {/if}

    <section>
      <h3>Evidence ({task.evidence.length})</h3>
      {#if task.evidence.length === 0}
        <p class="muted">No evidence attached.</p>
      {:else}
        <ul class="evidence">
          {#each task.evidence as e, i (i)}
            <li>
              <span class="kind">{e.kind}</span>
              {#if isLink(e.kind)}
                <a href={e.ref} target="_blank" rel="noreferrer">{e.label ?? e.ref}</a>
              {:else}
                <span>{e.label ?? e.ref}</span>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    {#if task.notes}
      <section><h3>Notes</h3><pre>{task.notes}</pre></section>
    {/if}
  </aside>
{/if}

<style>
  .panel {
    display: flex; flex-direction: column; gap: 0.85rem;
    padding: 1rem 1.1rem; height: 100%;
    background: var(--surface-card);
    border-left: 1px solid var(--line-soft);
    overflow-y: auto;
  }
  header { display: flex; justify-content: space-between; gap: 0.6rem; align-items: flex-start; }
  header strong { font-size: 1.05rem; color: var(--ink-strong); line-height: 1.3; }
  .x {
    flex: 0 0 auto; border: 0; background: transparent;
    color: var(--ink-soft); font-size: 1rem; cursor: pointer;
  }
  dl { margin: 0; display: grid; gap: 0.3rem; }
  dl div { display: flex; justify-content: space-between; gap: 1rem; align-items: center; }
  dt { color: var(--ink-soft); font-size: 0.82rem; }
  dd { margin: 0; color: var(--ink-strong); font-size: 0.85rem; font-weight: 600; }
  .priority-row { gap: 0.6rem; }
  .priority-value { display: inline-flex; align-items: center; gap: 0.45rem; }
  .priority-edit {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
  .priority-edit input {
    width: 4.5rem;
    padding: 0.25rem 0.45rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.35rem;
    background: var(--bg);
    color: var(--ink-strong);
    font: inherit;
    text-align: right;
  }
  .inline-save,
  .inline-cancel,
  .inline-edit {
    padding: 0.2rem 0.55rem;
    border-radius: 999px;
    font: inherit;
    font-size: 0.75rem;
    font-weight: 700;
    cursor: pointer;
    border: 1px solid var(--line-soft);
    background: transparent;
    color: var(--ink-strong);
  }
  .inline-save { border-color: var(--accent); background: var(--accent); color: white; }
  .inline-save:disabled { opacity: 0.55; cursor: not-allowed; }
  .inline-edit { color: var(--accent); border-color: transparent; padding: 0.15rem 0.45rem; }
  .inline-edit:hover { border-color: var(--accent); }
  .dependencies {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding-top: 0.4rem;
    border-top: 1px solid var(--line-soft);
  }
  .blocker-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }
  .blocker-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.15rem 0.45rem 0.15rem 0.6rem;
    border: 1px dashed color-mix(in srgb, var(--accent) 35%, var(--line-soft));
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent) 6%, transparent);
    color: var(--ink-strong);
    font-size: 0.78rem;
  }
  .blocker-remove {
    width: 1.3rem;
    height: 1.3rem;
    padding: 0;
    border-radius: 999px;
    border: none;
    background: transparent;
    color: var(--ink-soft);
    cursor: pointer;
  }
  .blocker-remove:hover { color: var(--accent); }
  .add-blocker {
    display: flex;
    gap: 0.3rem;
    align-items: center;
  }
  .add-blocker select {
    flex: 1;
    padding: 0.3rem 0.5rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.4rem;
    background: var(--bg);
    color: var(--ink-strong);
    font: inherit;
  }
  .error { margin: 0; color: var(--accent); font-size: 0.8rem; }
  h3 {
    margin: 0 0 0.35rem; font-size: 0.78rem; text-transform: uppercase;
    letter-spacing: 0.04em; color: var(--ink-soft);
  }
  pre {
    margin: 0; white-space: pre-wrap; word-break: break-word;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.82rem; color: var(--ink-strong);
  }
  .muted { margin: 0; color: var(--ink-soft); font-size: 0.85rem; }
  .evidence { margin: 0; padding: 0; list-style: none; display: grid; gap: 0.3rem; }
  .evidence li { display: flex; gap: 0.5rem; align-items: baseline; font-size: 0.82rem; }
  .kind {
    flex: 0 0 auto; padding: 0.05rem 0.4rem; border-radius: 0.3rem;
    background: var(--surface-raised); color: var(--ink-soft);
    font-size: 0.72rem; text-transform: uppercase;
  }
  .evidence a { color: var(--accent); word-break: break-all; }
</style>
