<script lang="ts">
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import type { PageData } from './$types';
  import type { RecoveryPlan, RecoveryRoom } from './+page';

  type ConsentGrant = {
    id: string;
    roomId: string;
    grantedTo: string;
    topic: string;
    sourceSet: string[];
    status: string;
    answerCount: number;
    maxAnswers: number | null;
    expiresAtMs: number | null;
    auditTrail: { action: string }[];
  };

  let { data }: { data: PageData } = $props();

  let adminToken = $state('');
  let roomId = $state('');
  let grantedTo = $state('');
  let topic = $state('file-read');
  let sourceCsv = $state('');
  let duration = $state('1h');
  let maxAnswers = $state('1');
  let actor = $state('@operator');
  let grants = $state<ConsentGrant[]>([]);
  let grantMessage = $state('');
  let busy = $state(false);

  // svelte-ignore state_referenced_locally
  let archivedRooms = $state<RecoveryRoom[]>(data.archivedRooms);
  // svelte-ignore state_referenced_locally
  let deletedRooms = $state<RecoveryRoom[]>(data.deletedRooms);
  // svelte-ignore state_referenced_locally
  let archivedPlans = $state<RecoveryPlan[]>(data.archivedPlans);
  // svelte-ignore state_referenced_locally
  let deletedPlans = $state<RecoveryPlan[]>(data.deletedPlans);
  let recoveryMessage = $state('');

  const hasRecovery = $derived(
    archivedRooms.length + deletedRooms.length + archivedPlans.length + deletedPlans.length > 0
  );

  function headers(): HeadersInit {
    return { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' };
  }

  async function refreshGrants() {
    if (!roomId.trim() || !adminToken.trim()) {
      grantMessage = 'Room id and admin token are required.';
      return;
    }
    busy = true;
    const response = await fetch(`/api/consent-grants?roomId=${encodeURIComponent(roomId.trim())}&includeInactive=1`, {
      headers: headers()
    }).catch(() => null);
    busy = false;
    if (!response?.ok) {
      grantMessage = `Could not load grants (${response?.status ?? 'network'}).`;
      return;
    }
    const body = (await response.json()) as { grants: ConsentGrant[] };
    grants = body.grants ?? [];
    grantMessage = grants.length === 0 ? 'No grants for this room.' : `Loaded ${grants.length} grants.`;
  }

  async function createGrant() {
    if (!roomId.trim() || !grantedTo.trim() || !topic.trim() || !adminToken.trim()) {
      grantMessage = 'Admin token, room, grantee, and topic are required.';
      return;
    }
    const parsedMax = Number(maxAnswers);
    busy = true;
    const response = await fetch('/api/consent-grants', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        roomId: roomId.trim(),
        grantedTo,
        topic,
        sourceSet: sourceCsv.split(',').map((entry) => entry.trim()).filter(Boolean),
        duration,
        maxAnswers: Number.isInteger(parsedMax) && parsedMax > 0 ? parsedMax : null,
        createdBy: actor
      })
    }).catch(() => null);
    busy = false;
    if (!response?.ok) {
      grantMessage = `Could not create grant (${response?.status ?? 'network'}).`;
      return;
    }
    await refreshGrants();
    grantMessage = 'Grant created.';
  }

  async function revokeGrant(grantId: string) {
    if (!adminToken.trim()) {
      grantMessage = 'Admin token is required.';
      return;
    }
    busy = true;
    const response = await fetch(`/api/consent-grants/${encodeURIComponent(grantId)}/revoke`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ revokedBy: actor })
    }).catch(() => null);
    busy = false;
    if (!response?.ok) {
      grantMessage = `Could not revoke grant (${response?.status ?? 'network'}).`;
      return;
    }
    await refreshGrants();
    grantMessage = 'Grant revoked.';
  }

  async function refreshRecovery() {
    const [roomsResponse, archivedPlansResponse, deletedPlansResponse] = await Promise.all([
      fetch('/api/chat-rooms/recovery').catch(() => null),
      fetch('/api/plans/completions?archived=1').catch(() => null),
      fetch('/api/plans/completions?deleted=1').catch(() => null)
    ]);
    if (roomsResponse?.ok) {
      const body = (await roomsResponse.json()) as { archivedRooms: RecoveryRoom[]; deletedRooms: RecoveryRoom[] };
      archivedRooms = body.archivedRooms ?? [];
      deletedRooms = body.deletedRooms ?? [];
    }
    archivedPlans = archivedPlansResponse?.ok
      ? ((await archivedPlansResponse.json()) as { plans: RecoveryPlan[] }).plans ?? []
      : [];
    deletedPlans = deletedPlansResponse?.ok
      ? ((await deletedPlansResponse.json()) as { plans: RecoveryPlan[] }).plans ?? []
      : [];
  }

  async function restoreRoom(id: string) {
    const response = await fetch(`/api/chat-rooms/${encodeURIComponent(id)}/archive`, { method: 'DELETE' }).catch(() => null);
    if (!response?.ok) {
      recoveryMessage = `Could not restore room (${response?.status ?? 'network'}).`;
      return;
    }
    await refreshRecovery();
    recoveryMessage = 'Room restored.';
  }

  async function restorePlan(id: string, action: 'unarchive' | 'restore') {
    if (!adminToken.trim()) {
      recoveryMessage = 'Admin token is required for plan recovery.';
      return;
    }
    const response = await fetch(`/api/plans/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ action })
    }).catch(() => null);
    if (!response?.ok) {
      recoveryMessage = `Could not restore plan (${response?.status ?? 'network'}).`;
      return;
    }
    await refreshRecovery();
    recoveryMessage = 'Plan restored.';
  }

  function grantSummary(grant: ConsentGrant): string {
    const source = grant.sourceSet.length === 0 ? 'all sources' : grant.sourceSet.join(', ');
    const max = grant.maxAnswers === null ? 'unlimited' : `${grant.answerCount}/${grant.maxAnswers}`;
    return `${grant.grantedTo} · ${grant.topic} · ${source} · ${max}`;
  }
</script>

<svelte:head><title>Safety | ANT vNext</title></svelte:head>

<SimplePageShell
  eyebrow="Safety"
  title="Safety."
  summary="Create and audit room consent grants, then recover archived work. Admin actions require an admin bearer."
>
  <section class="panel">
    <div class="panel-heading">
      <div>
        <h2>Consent grants</h2>
        <p>Explicit, room-scoped approval for sensitive operations.</p>
      </div>
      <button type="button" class="secondary" onclick={refreshGrants} disabled={busy}>Load</button>
    </div>
    <div class="form-grid">
      <label>Admin token <input type="password" bind:value={adminToken} /></label>
      <label>Room id <input type="text" bind:value={roomId} /></label>
      <label>Grantee <input type="text" bind:value={grantedTo} placeholder="@handle" /></label>
      <label>Topic <input type="text" bind:value={topic} /></label>
      <label class="wide">Sources <input type="text" bind:value={sourceCsv} placeholder="/path/a, https://example.test" /></label>
      <label>Duration <input type="text" bind:value={duration} /></label>
      <label>Max answers <input type="number" min="1" bind:value={maxAnswers} /></label>
      <label>Actor <input type="text" bind:value={actor} /></label>
    </div>
    <div class="actions-row">
      <button type="button" class="primary" onclick={createGrant} disabled={busy}>Create grant</button>
      {#if grantMessage}<span>{grantMessage}</span>{/if}
    </div>
    {#if grants.length > 0}
      <div class="list">
        {#each grants as grant (grant.id)}
          <article class="row-card">
            <div>
              <strong>{grantSummary(grant)}</strong>
              <p>{grant.status} · audit {grant.auditTrail.map((entry) => entry.action).join(' -> ')}</p>
            </div>
            <button type="button" class="danger" onclick={() => revokeGrant(grant.id)} disabled={grant.status !== 'active' || busy}>Revoke</button>
          </article>
        {/each}
      </div>
    {/if}
  </section>

  <section class="panel">
    <div class="panel-heading">
      <div>
        <h2>Recovery</h2>
        <p>Archived rooms and plans are restorable. Deleted-room restore is a visible boundary in this slice.</p>
      </div>
      <button type="button" class="secondary" onclick={refreshRecovery}>Refresh</button>
    </div>
    {#if data.recoveryFetchFailed}<p class="alert">Recovery rows could not load during page render.</p>{/if}
    {#if recoveryMessage}<p class="status-line">{recoveryMessage}</p>{/if}
    {#if !hasRecovery}
      <p class="empty">No archived or deleted work is waiting for recovery.</p>
    {:else}
      <div class="recovery-grid">
        <div>
          <h3>Archived rooms</h3>
          {#if archivedRooms.length === 0}<p class="empty compact">None.</p>{/if}
          {#each archivedRooms as room (room.id)}
            <article class="row-card">
              <div><strong>{room.name}</strong><p>{room.id}</p></div>
              <button type="button" class="primary small" onclick={() => restoreRoom(room.id)}>Restore</button>
            </article>
          {/each}
        </div>
        <div>
          <h3>Deleted rooms</h3>
          {#if deletedRooms.length === 0}<p class="empty compact">None.</p>{/if}
          {#each deletedRooms as room (room.id)}
            <article class="row-card boundary">
              <div><strong>{room.name}</strong><p>{room.deleteBoundary ?? 'Not restorable from this UI.'}</p></div>
            </article>
          {/each}
        </div>
        <div>
          <h3>Archived plans</h3>
          {#if archivedPlans.length === 0}<p class="empty compact">None.</p>{/if}
          {#each archivedPlans as plan (plan.planId)}
            <article class="row-card">
              <div><strong>{plan.title ?? plan.planId}</strong><p>{plan.completed}/{plan.total} tasks complete</p></div>
              <button type="button" class="primary small" onclick={() => restorePlan(plan.planId, 'unarchive')}>Unarchive</button>
            </article>
          {/each}
        </div>
        <div>
          <h3>Deleted plans</h3>
          {#if deletedPlans.length === 0}<p class="empty compact">None.</p>{/if}
          {#each deletedPlans as plan (plan.planId)}
            <article class="row-card">
              <div><strong>{plan.title ?? plan.planId}</strong><p>{plan.completed}/{plan.total} tasks complete</p></div>
              <button type="button" class="primary small" onclick={() => restorePlan(plan.planId, 'restore')}>Restore</button>
            </article>
          {/each}
        </div>
      </div>
    {/if}
  </section>
</SimplePageShell>

<style>
  .panel {
    margin-top: 1rem;
    padding: 1rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.85rem;
    background: var(--surface-card);
  }
  .panel-heading {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1rem;
  }
  h2, h3, p { margin: 0; }
  h2 { font-size: 1.15rem; }
  h3 { margin-bottom: 0.55rem; font-size: 0.92rem; }
  .panel-heading p, .row-card p, .actions-row span, .status-line, .empty { color: var(--ink-soft); }
  .form-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
    gap: 0.7rem;
  }
  label {
    display: grid;
    gap: 0.3rem;
    font-size: 0.82rem;
    font-weight: 800;
  }
  label.wide { grid-column: 1 / -1; }
  input {
    min-height: 2.3rem;
    padding: 0.45rem 0.6rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.45rem;
    background: var(--surface-raised);
    color: var(--ink-strong);
  }
  .actions-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
    margin-top: 0.85rem;
  }
  button {
    min-height: 2.25rem;
    padding: 0.45rem 0.8rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.45rem;
    font-weight: 800;
  }
  button:disabled { opacity: 0.55; cursor: not-allowed; }
  .primary {
    border-color: var(--accent);
    background: var(--accent);
    color: white;
  }
  :global(:root[data-theme='dark']) .primary { color: #101607; }
  .secondary, .danger {
    background: var(--surface-raised);
    color: var(--ink-strong);
  }
  .danger { color: var(--accent); }
  .small { min-height: 2rem; padding-inline: 0.65rem; }
  .list {
    display: grid;
    gap: 0.55rem;
    margin-top: 0.8rem;
  }
  .row-card {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.8rem;
    padding: 0.75rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.65rem;
    background: var(--surface-raised);
  }
  .row-card strong, .row-card p { overflow-wrap: anywhere; }
  .row-card p { margin-top: 0.2rem; font-size: 0.84rem; }
  .boundary { border-style: dashed; }
  .recovery-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
    gap: 1rem;
  }
  .empty, .alert {
    padding: 0.75rem;
    border: 1px dashed var(--line-soft);
    border-radius: 0.65rem;
    background: var(--surface-raised);
  }
  .empty.compact { padding: 0.6rem; }
  .alert {
    margin-bottom: 0.8rem;
    border-style: solid;
    border-color: var(--warn);
  }
  .status-line { margin-bottom: 0.8rem; }
</style>
