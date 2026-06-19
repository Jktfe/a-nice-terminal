<!--
  /cron — UI page for the cron-jobs primitive (JWPK msg_hjv6ac64zo).
  Drives /api/cron-jobs without operators needing curl.

  Sections:
    1. Create new job — name + interval + action picker + (when
       action=room.message) target room + message template
    2. Active jobs list — per-row status pill, last/next-fire, fire
       count, start/pause/stop/delete buttons (1-click since jobs are
       reversible — delete is soft, restart from paused etc)
    3. Stopped/deleted jobs collapsed by default (toggle to expand)
-->
<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';

  type CronJob = {
    id: string;
    name: string;
    status: 'running' | 'paused' | 'stopped' | 'deleted';
    intervalMs: number | null;
    action: string;
    targetRoomId: string | null;
    targetMessageTemplate: string | null;
    createdByHandle: string | null;
    createdAtMs: number;
    lastFiredAtMs: number | null;
    nextFireAtMs: number | null;
    fireCount: number;
    lastOutcomeStatus: 'succeeded' | 'skipped' | 'blocked' | 'failed' | null;
    lastOutcomeMessage: string | null;
    lastOutcomeAtMs: number | null;
  };

  type Props = { data: { jobs: CronJob[]; fetchFailed: boolean } };
  let { data }: Props = $props();

  // Create form
  let newName = $state('');
  let newIntervalSec = $state(60);
  let newAction = $state<'room.message' | 'console.log' | 'webhook.post' | 'task.create'>('room.message');
  let newRoomId = $state('');
  let newMessage = $state('');
  let newWebhookUrl = $state('');
  let newTaskTitle = $state('');
  let creating = $state(false);
  let createError = $state('');
  let showInactive = $state(false);

  const activeJobs = $derived(
    data.jobs.filter((j) => j.status === 'running' || j.status === 'paused')
  );
  const inactiveJobs = $derived(
    data.jobs.filter((j) => j.status === 'stopped' || j.status === 'deleted')
  );

  function formatInterval(ms: number | null): string {
    if (ms === null || !Number.isFinite(ms)) return '—';
    const sec = Math.round(ms / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min}m`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr}h`;
    return `${Math.round(hr / 24)}d`;
  }

  function formatTimestamp(ms: number | null): string {
    if (ms === null || !Number.isFinite(ms)) return '—';
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString();
  }

  function outcomeLabel(status: CronJob['lastOutcomeStatus']): string {
    if (status === null) return 'not run';
    return status;
  }

  async function createJob(event: SubmitEvent) {
    event.preventDefault();
    if (creating) return;
    creating = true;
    createError = '';
    try {
      const body: Record<string, unknown> = {
        name: newName.trim(),
        intervalMs: Math.max(1000, newIntervalSec * 1000),
        action: newAction,
        startImmediately: false
      };
      if (newAction === 'room.message') {
        body.targetRoomId = newRoomId.trim();
        body.targetMessageTemplate = newMessage.trim();
      } else if (newAction === 'webhook.post') {
        body.actionConfig = { url: newWebhookUrl.trim() };
      } else if (newAction === 'task.create') {
        body.actionConfig = { title: newTaskTitle.trim() };
      }
      const response = await fetch('/api/cron-jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({ message: response.statusText }));
        createError = failure.message ?? `Could not create (${response.status}).`;
        return;
      }
      newName = '';
      newRoomId = '';
      newMessage = '';
      newWebhookUrl = '';
      newTaskTitle = '';
      await invalidateAll();
    } catch (cause) {
      createError = cause instanceof Error ? cause.message : 'Create failed.';
    } finally {
      creating = false;
    }
  }

  async function patchJob(id: string, body: Record<string, unknown>) {
    try {
      const response = await fetch(`/api/cron-jobs/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (response.ok) await invalidateAll();
    } catch { /* swallow — refresh will surface the unchanged state */ }
  }

  const startJob  = (id: string) => patchJob(id, { action: 'start' });
  const pauseJob  = (id: string) => patchJob(id, { action: 'pause' });
  const stopJob   = (id: string) => patchJob(id, { action: 'stop' });
  const deleteJob = (id: string) => patchJob(id, { action: 'delete' });
</script>

<svelte:head><title>Cron jobs | ANT vNext</title></svelte:head>

<SimplePageShell
  eyebrow="Automations · Cron"
  title="Cron jobs."
  summary="Operator-defined recurring jobs. Each job emits its action on its interval — room messages, log lines, webhook POSTs, or new tasks. Status is one of running · paused · stopped · deleted; the ticker only fires running jobs."
>
  {#if data.fetchFailed}
    <p class="error" role="alert">Could not load cron jobs from the server.</p>
  {/if}

  <section class="create-card" aria-labelledby="createHeading">
    <h2 id="createHeading">Create a new job</h2>
    <form class="create-form" onsubmit={createJob}>
      <label>
        <span>Name</span>
        <input type="text" bind:value={newName} required placeholder="e.g. local-agent heartbeat" />
      </label>
      <label>
        <span>Interval (seconds)</span>
        <input type="number" min="1" bind:value={newIntervalSec} required />
      </label>
      <label>
        <span>Action</span>
        <select bind:value={newAction}>
          <option value="room.message">room.message — post system message</option>
          <option value="console.log">console.log — server-side log only</option>
          <option value="webhook.post">webhook.post — POST JSON to a URL</option>
          <option value="task.create">task.create — auto-create a task</option>
        </select>
      </label>
      {#if newAction === 'room.message'}
        <label>
          <span>Target room id</span>
          <input type="text" bind:value={newRoomId} placeholder="e.g. zj4jlety9q" />
        </label>
        <label class="full">
          <span>Message body</span>
          <textarea bind:value={newMessage} rows="2" placeholder="💓 still alive"></textarea>
        </label>
      {:else if newAction === 'webhook.post'}
        <label class="full">
          <span>Webhook URL</span>
          <input type="text" bind:value={newWebhookUrl} placeholder="https://example.com/hook" />
        </label>
      {:else if newAction === 'task.create'}
        <label class="full">
          <span>Task title</span>
          <input type="text" bind:value={newTaskTitle} placeholder="Auto-task subject" />
        </label>
      {/if}
      {#if createError}
        <p class="error" role="alert">{createError}</p>
      {/if}
      <button type="submit" class="primary" disabled={creating || newName.trim().length === 0}>
        {creating ? 'Creating…' : 'Create (paused)'}
      </button>
    </form>
    <p class="muted">New jobs start <strong>paused</strong> — review the row + hit <em>Start</em> when ready.</p>
  </section>

  <section class="jobs-section" aria-labelledby="activeHeading">
    <h2 id="activeHeading">Active jobs ({activeJobs.length})</h2>
    {#if activeJobs.length === 0}
      <p class="muted">No running or paused jobs yet. Create one above.</p>
    {:else}
      <ul class="jobs-list">
        {#each activeJobs as job (job.id)}
          <li class={`job-row status-${job.status}`}>
            <header>
              <span class={`status-pill status-${job.status}`}>{job.status}</span>
              <strong class="job-name">{job.name}</strong>
              <code class="job-id" title={job.id}>{job.id.slice(0, 8)}</code>
            </header>
            <p class="job-meta">
              <span><strong>{formatInterval(job.intervalMs)}</strong> · {job.action}</span>
              <span>fires: <strong>{job.fireCount}</strong></span>
              <span>last: {formatTimestamp(job.lastFiredAtMs)}</span>
              <span>next: {formatTimestamp(job.nextFireAtMs)}</span>
            </p>
            <p class={`job-outcome outcome-${job.lastOutcomeStatus ?? 'none'}`}>
              <strong>Last result:</strong> {outcomeLabel(job.lastOutcomeStatus)}
              {#if job.lastOutcomeMessage}
                · {job.lastOutcomeMessage}
              {/if}
            </p>
            {#if job.targetMessageTemplate}
              <p class="job-template" title={job.targetMessageTemplate}>↳ {job.targetMessageTemplate}</p>
            {/if}
            <div class="job-actions">
              {#if job.status === 'paused'}
                <button type="button" class="action-btn start" onclick={() => void startJob(job.id)}>▶ Start</button>
              {:else}
                <button type="button" class="action-btn pause" onclick={() => void pauseJob(job.id)}>⏸ Pause</button>
              {/if}
              <button type="button" class="action-btn stop" onclick={() => void stopJob(job.id)}>⏹ Stop</button>
              <button type="button" class="action-btn delete" onclick={() => void deleteJob(job.id)}>🗑 Delete</button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  {#if inactiveJobs.length > 0}
    <section class="jobs-section" aria-labelledby="inactiveHeading">
      <button type="button" class="toggle" onclick={() => (showInactive = !showInactive)} aria-expanded={showInactive}>
        <h2 id="inactiveHeading">Stopped + deleted ({inactiveJobs.length}) {showInactive ? '▾' : '▸'}</h2>
      </button>
      {#if showInactive}
        <ul class="jobs-list dimmed">
          {#each inactiveJobs as job (job.id)}
            <li class={`job-row status-${job.status}`}>
              <header>
                <span class={`status-pill status-${job.status}`}>{job.status}</span>
                <strong class="job-name">{job.name}</strong>
                <code class="job-id" title={job.id}>{job.id.slice(0, 8)}</code>
              </header>
              <p class="job-meta">
                <span>{formatInterval(job.intervalMs)} · {job.action} · fires: {job.fireCount}</span>
              </p>
              <p class={`job-outcome outcome-${job.lastOutcomeStatus ?? 'none'}`}>
                <strong>Last result:</strong> {outcomeLabel(job.lastOutcomeStatus)}
                {#if job.lastOutcomeMessage}
                  · {job.lastOutcomeMessage}
                {/if}
              </p>
              {#if job.status === 'stopped'}
                <div class="job-actions">
                  <button type="button" class="action-btn start" onclick={() => void startJob(job.id)}>▶ Restart</button>
                  <button type="button" class="action-btn delete" onclick={() => void deleteJob(job.id)}>🗑 Delete</button>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</SimplePageShell>

<style>
  .error { margin: 0 0 1rem; padding: 0.7rem 1rem; color: var(--warn, #c92020); border: 1px solid var(--warn, #c92020); border-radius: 0.6rem; background: color-mix(in srgb, var(--warn, #c92020) 8%, transparent); }
  .muted { color: var(--ink-soft); font-size: 0.85rem; }
  .create-card { padding: 1.2rem; border: 1px solid var(--line-soft); border-radius: 0.9rem; background: var(--surface-card); margin-bottom: 1.5rem; }
  .create-card h2 { margin: 0 0 0.8rem; font-size: 1.05rem; color: var(--ink-strong); }
  .create-form { display: grid; grid-template-columns: 1fr 1fr; gap: 0.65rem 0.85rem; align-items: end; }
  .create-form label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.78rem; color: var(--ink-soft); font-weight: 700; }
  .create-form label.full { grid-column: 1 / -1; }
  .create-form input, .create-form select, .create-form textarea {
    padding: 0.45rem 0.6rem; border: 1px solid var(--line-soft); border-radius: 0.45rem;
    background: var(--bg); color: var(--ink-strong); font-size: 0.88rem; font-family: inherit;
  }
  .create-form input:focus, .create-form select:focus, .create-form textarea:focus { outline: none; border-color: var(--accent); }
  .create-form .primary { grid-column: 1 / -1; justify-self: end; padding: 0.5rem 1.2rem; border-radius: 999px; border: 1px solid var(--accent); background: var(--accent); color: white; font-weight: 800; cursor: pointer; }
  .create-form .primary:disabled { opacity: 0.5; cursor: not-allowed; }

  .jobs-section { margin-bottom: 1.4rem; }
  .jobs-section h2 { margin: 0 0 0.6rem; font-size: 1rem; color: var(--ink-strong); }
  .jobs-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
  .jobs-list.dimmed { opacity: 0.78; }
  .job-row { padding: 0.8rem 1rem; border: 1px solid var(--line-soft); border-radius: 0.75rem; background: var(--surface-card); }
  .job-row header { display: flex; align-items: baseline; gap: 0.55rem; margin-bottom: 0.4rem; }
  .job-name { color: var(--ink-strong); font-size: 0.95rem; }
  .job-id { color: var(--ink-soft); font-size: 0.74rem; font-family: ui-monospace, monospace; }
  .status-pill {
    padding: 0.12rem 0.45rem; border-radius: 999px; font-size: 0.7rem; font-weight: 800;
    text-transform: uppercase; letter-spacing: 0.04em;
  }
  .status-pill.status-running { background: color-mix(in srgb, var(--ok) 18%, transparent); color: var(--ok); }
  .status-pill.status-paused  { background: color-mix(in srgb, var(--info, #2563eb) 14%, transparent); color: var(--info, #2563eb); }
  .status-pill.status-stopped { background: var(--bg); color: var(--ink-soft); border: 1px solid var(--line-soft); }
  .status-pill.status-deleted { background: var(--bg); color: var(--ink-muted); border: 1px dashed var(--line-soft); text-decoration: line-through; }
  .job-meta { display: flex; flex-wrap: wrap; gap: 0.7rem; margin: 0.2rem 0; color: var(--ink-soft); font-size: 0.78rem; }
  .job-meta strong { color: var(--ink-strong); }
  .job-outcome {
    margin: 0.25rem 0;
    color: var(--ink-soft);
    font-size: 0.78rem;
    line-height: 1.4;
  }
  .job-outcome strong { color: var(--ink-strong); }
  .job-outcome.outcome-succeeded { color: var(--ok); }
  .job-outcome.outcome-failed,
  .job-outcome.outcome-blocked { color: var(--warn, #c92020); }
  .job-template {
    margin: 0.3rem 0;
    padding: 0.4rem 0.55rem;
    background: var(--bg);
    border-left: 3px solid var(--accent);
    border-radius: 0.4rem;
    color: var(--ink-soft);
    font-size: 0.78rem;
    font-family: ui-monospace, monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .job-actions { display: flex; gap: 0.4rem; margin-top: 0.4rem; flex-wrap: wrap; }
  .action-btn { padding: 0.3rem 0.7rem; border-radius: 999px; border: 1px solid var(--line-soft); background: var(--bg); color: var(--ink-strong); font-weight: 700; font-size: 0.78rem; cursor: pointer; }
  .action-btn:hover { border-color: var(--accent); }
  .action-btn.start:hover  { color: var(--ok); border-color: var(--ok); }
  .action-btn.delete:hover { color: var(--warn, #c92020); border-color: var(--warn, #c92020); }
  .toggle { appearance: none; border: none; background: transparent; padding: 0; cursor: pointer; color: inherit; }
  .toggle h2 { margin-bottom: 0.4rem; }
</style>
